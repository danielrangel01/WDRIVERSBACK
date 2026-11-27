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
 * correo (SMTP), Web Push (PWA), push nativo (FCM, apps iOS/Android) y un canal
 * de chat (WhatsApp Cloud API o Telegram Bot API). El canal in-app no se envía
 * aquí: se sirve como texto/enlace desde el endpoint de recordatorios.
 *
 * WhatsApp y Telegram son mutuamente excluyentes ("un canal activo a la vez"):
 * se elige con `settings.notifyChannel` para no duplicar avisos.
 */
export class ReminderDispatcher {
  constructor({ emailNotifier, pushNotifier, fcmNotifier, whatsappNotifier, telegramNotifier, pushSubscriptionRepository, deviceTokenRepository, telegramChatId = "" } = {}) {
    this.email = emailNotifier;
    this.push = pushNotifier;
    this.fcm = fcmNotifier;
    this.whatsapp = whatsappNotifier;
    this.telegram = telegramNotifier;
    this.pushSubs = pushSubscriptionRepository;
    this.devices = deviceTokenRepository;
    // Respaldo del chat id del admin (env) si no está en Ajustes.
    this.telegramChatId = telegramChatId || "";
  }

  get channels() {
    return {
      email: !!(this.email && this.email.enabled),
      push: !!(this.push && this.push.enabled),
      fcm: !!(this.fcm && this.fcm.enabled),
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
      ? `🌙 W Drivers — Última llamada ${dmy(date)}`
      : moment === "midday"
        ? `🕑 W Drivers — Avance del día ${dmy(date)}`
        : moment === "lateMorning"
          ? `⏰ W Drivers — Aún estás a tiempo ${dmy(date)}`
          : `🌅 W Drivers — Buenos días ${dmy(date)}`;
    const channel = this.activeChatChannel(settings);
    const phone = (settings.adminPhone || "").replace(/\D/g, "");
    const chatId = String(settings.telegramChatId || this.telegramChatId || "").trim();
    const waLink = (channel === "whatsapp" && phone)
      ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText)}`
      : "";

    const results = {};

    // Preferencias de push: el interruptor global y la categoría "Recordatorios"
    // deben estar activos para despachar por push (Web Push y FCM nativo).
    const pushAllowed = settings.pushEnabled !== false && settings.pushReminders !== false;

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

    if (pushAllowed && this.push && this.push.enabled && this.pushSubs) {
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

    // Push nativo a las apps iOS/Android registradas (FCM).
    if (pushAllowed && this.fcm && this.fcm.enabled && this.devices) {
      const devices = await this.devices.findAll();
      const body = reminders.slice(0, 3).map((r) => `${r.icon} ${r.title}`).join("\n") || "Sin pendientes";
      const data = { type: "reminder", moment: String(moment || ""), date: String(date || ""), url: "/" };
      let sent = 0;
      let pruned = 0;
      for (const d of devices) {
        const r = await this.fcm.send(d.token, { title: subject, body, data, platform: d.platform });
        if (r && r.ok) sent += 1;
        else if (r && r.code === "messaging/registration-token-not-registered") {
          await this.devices.removeByToken(d.token);
          pruned += 1;
        }
      }
      results.fcm = { sent, pruned };
    }

    return results;
  }
}
