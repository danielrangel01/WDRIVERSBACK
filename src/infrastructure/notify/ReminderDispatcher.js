const dmy = (date) => {
  const [y, m, d] = String(date).split("-");
  return `${d}/${m}/${y}`;
};

const cop = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n) || 0);

// Parámetros de la plantilla UTILITY `wdrivers_recordatorio` (3 variables):
// {{1}} carros con cobro pendiente, {{2}} monto por cobrar, {{3}} deuda de la flota.
const buildTemplateComponents = (counts = {}) => [
  {
    type: "body",
    parameters: [
      { type: "text", text: String(counts.collect ?? counts.pending ?? 0) },
      { type: "text", text: cop(counts.collectAmount ?? 0) },
      { type: "text", text: cop(counts.fleetDebt ?? 0) },
    ],
  },
];

/**
 * Reparte un recordatorio ya calculado por los canales de envío automático:
 * correo (SMTP), Web Push (PWA) y un canal de chat (WhatsApp Cloud API o
 * Telegram Bot API). El canal in-app no se envía aquí: se sirve como
 * texto/enlace desde el endpoint de recordatorios.
 *
 * WhatsApp y Telegram son mutuamente excluyentes ("un canal activo a la vez"):
 * se elige con `settings.notifyChannel` para no duplicar avisos.
 */
export class ReminderDispatcher {
  constructor({ emailNotifier, pushNotifier, whatsappNotifier, telegramNotifier, pushSubscriptionRepository } = {}) {
    this.email = emailNotifier;
    this.push = pushNotifier;
    this.whatsapp = whatsappNotifier;
    this.telegram = telegramNotifier;
    this.pushSubs = pushSubscriptionRepository;
  }

  get channels() {
    return {
      email: !!(this.email && this.email.enabled),
      push: !!(this.push && this.push.enabled),
      whatsapp: !!(this.whatsapp && this.whatsapp.enabled),
      telegram: !!(this.telegram && this.telegram.enabled),
    };
  }

  /** Canal de chat activo según los Ajustes (WhatsApp por defecto). */
  activeChatChannel(settings = {}) {
    return settings && settings.notifyChannel === "telegram" ? "telegram" : "whatsapp";
  }

  async dispatch({ date, moment, reminders = [], whatsappText = "", settings = {}, counts = {}, skipWhatsApp = false }) {
    const subject = moment === "evening"
      ? `🌙 W Drivers — Cierre ${dmy(date)}`
      : moment === "midday"
        ? `🕑 W Drivers — Avance del día ${dmy(date)}`
        : moment === "lateMorning"
          ? `⏰ W Drivers — Aún estás a tiempo ${dmy(date)}`
          : `🌅 W Drivers — Buenos días ${dmy(date)}`;
    const channel = this.activeChatChannel(settings);
    const phone = (settings.adminPhone || "").replace(/\D/g, "");
    const chatId = String(settings.telegramChatId || "").trim();
    const waLink = (channel === "whatsapp" && phone)
      ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText)}`
      : "";

    const results = {};

    if (this.email && this.email.enabled) {
      let text = whatsappText;
      if (waLink) text += `\n\n📲 Enviar por WhatsApp: ${waLink}`;
      results.email = await this.email.send({ to: settings.adminEmail, subject, text });
    }

    // Canal de chat activo (WhatsApp o Telegram). `skipWhatsApp` indica que el
    // agente ya se encarga de él (check-in/cierre), así que no se duplica.
    if (!skipWhatsApp) {
      const target = channel === "telegram" ? chatId : phone;
      const notifier = channel === "telegram" ? this.telegram : this.whatsapp;
      if (notifier && notifier.enabled && target) {
        try {
          results[channel] = channel === "telegram"
            ? await notifier.send({ to: target, text: whatsappText })
            : await notifier.send({ to: target, text: whatsappText, components: buildTemplateComponents(counts) });
        } catch (err) {
          results[channel] = { ok: false, error: err && err.message ? err.message : String(err) };
        }
      }
    }

    if (this.push && this.push.enabled && this.pushSubs) {
      const subs = await this.pushSubs.findAll();
      const payload = {
        title: subject,
        body: reminders.slice(0, 3).map((r) => `${r.icon} ${r.title}`).join("\n") || "Sin pendientes",
        url: "/",
        tag: `wdrivers-${moment}-${date}`,
      };
      let sent = 0;
      let pruned = 0;
      for (const s of subs) {
        try {
          await this.push.send(s.subscription, payload);
          sent += 1;
        } catch (err) {
          const code = (err && (err.statusCode || err.code)) || 0;
          if (code === 404 || code === 410) {
            await this.pushSubs.removeByEndpoint(s.endpoint);
            pruned += 1;
          }
        }
      }
      results.push = { sent, pruned };
    }

    return results;
  }
}
