import { ValidationError } from "../../../shared/errors.js";

/**
 * Envía un mensaje por el canal de chat ACTIVO configurado en Ajustes
 * (WhatsApp o Telegram). Centraliza el enrutamiento para que la app móvil/Web
 * usen un único endpoint sin conocer el canal. El contrato es el mismo de
 * `SendWhatsAppUseCase` ({ kind, to, text, carId, moment, date }).
 *
 *  - WhatsApp: delega en `SendWhatsAppUseCase` (genera en el backend el texto de
 *    extracto/recordatorio cuando hace falta).
 *  - Telegram: envía al chat del admin configurado (el bot solo conversa con el
 *    admin). Los modos "statement"/"reminder" generan su texto y se envían como
 *    texto plano.
 */
export class SendNotificationUseCase {
  constructor({ sendWhatsApp, sendTelegram, getSettings, statementUseCase, remindersUseCase, telegramChatId } = {}) {
    this.whatsapp = sendWhatsApp;
    this.telegram = sendTelegram;
    this.settings = getSettings;
    this.statement = statementUseCase;
    this.reminders = remindersUseCase;
    this.telegramChatId = telegramChatId;
  }

  async execute({ kind = "text", to, text, carId, moment, date } = {}) {
    const s = this.settings ? await this.settings.execute() : null;
    const channel = s && s.notifyChannel === "telegram" ? "telegram" : "whatsapp";

    if (channel !== "telegram") {
      return this.whatsapp.execute({ kind, to, text, carId, moment, date });
    }

    const chatId = String((s && s.telegramChatId) || this.telegramChatId || "").trim();
    if (!chatId) {
      throw new ValidationError("Configura el 'Chat ID de Telegram' en Ajustes para usar el bot");
    }

    let body = String(text || "").trim();
    if (kind === "statement") {
      if (!carId) throw new ValidationError("Falta carId para generar el extracto");
      const st = await this.statement.execute({ carId });
      body = (st && st.whatsappText) || "";
    } else if (kind === "reminder") {
      const r = await this.reminders.execute({ moment, date });
      body = (r && r.whatsappText) || "";
    }

    const result = await this.telegram.execute({
      kind: kind === "test" ? "test" : "text",
      to: chatId,
      text: body,
    });
    return { ...result, channel };
  }
}
