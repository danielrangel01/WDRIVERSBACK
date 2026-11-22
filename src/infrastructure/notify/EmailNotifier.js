import nodemailer from "nodemailer";

// Envía correos por SMTP. Si no hay credenciales, queda deshabilitado (no-op).
export class EmailNotifier {
  constructor({ host, port, secure, user, pass, from } = {}) {
    this.enabled = !!(host && user && pass);
    this.from = from || user || "";
    this.transporter = this.enabled
      ? nodemailer.createTransport({ host, port, secure, auth: { user, pass } })
      : null;
  }

  async send({ to, subject, text }) {
    if (!this.enabled) return { ok: false, skipped: true, reason: "email_disabled" };
    if (!to) return { ok: false, skipped: true, reason: "no_recipient" };
    const info = await this.transporter.sendMail({ from: this.from, to, subject, text });
    return { ok: true, messageId: info.messageId };
  }
}
