const dmy = (date) => {
  const [y, m, d] = String(date).split("-");
  return `${d}/${m}/${y}`;
};

/**
 * Reparte un recordatorio ya calculado por los canales de envío automático:
 * correo (SMTP), Web Push (PWA) y WhatsApp (Cloud API). El canal in-app no se
 * envía aquí: se sirve como texto/enlace desde el endpoint de recordatorios.
 */
export class ReminderDispatcher {
  constructor({ emailNotifier, pushNotifier, whatsappNotifier, pushSubscriptionRepository } = {}) {
    this.email = emailNotifier;
    this.push = pushNotifier;
    this.whatsapp = whatsappNotifier;
    this.pushSubs = pushSubscriptionRepository;
  }

  get channels() {
    return {
      email: !!(this.email && this.email.enabled),
      push: !!(this.push && this.push.enabled),
      whatsapp: !!(this.whatsapp && this.whatsapp.enabled),
    };
  }

  async dispatch({ date, moment, reminders = [], whatsappText = "", settings = {} }) {
    const subject = moment === "evening"
      ? `🌙 W Drivers — Cierre ${dmy(date)}`
      : `🌅 W Drivers — Buenos días ${dmy(date)}`;
    const phone = (settings.adminPhone || "").replace(/\D/g, "");
    const waLink = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText)}` : "";

    const results = {};

    if (this.email && this.email.enabled) {
      let text = whatsappText;
      if (waLink) text += `\n\n📲 Enviar por WhatsApp: ${waLink}`;
      results.email = await this.email.send({ to: settings.adminEmail, subject, text });
    }

    if (this.whatsapp && this.whatsapp.enabled && phone) {
      try {
        results.whatsapp = await this.whatsapp.send({ to: phone, text: whatsappText });
      } catch (err) {
        results.whatsapp = { ok: false, error: err && err.message ? err.message : String(err) };
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
