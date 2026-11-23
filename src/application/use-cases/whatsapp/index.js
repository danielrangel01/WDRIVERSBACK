import { ValidationError } from "../../../shared/errors.js";

// Límite de la Cloud API para mensajes de texto libres.
const MAX_TEXT = 4096;

/**
 * Envía mensajes por WhatsApp Cloud API (Meta).
 * Modos:
 *  - "test":      mensaje de prueba corto.
 *  - "text":      texto libre provisto por el cliente.
 *  - "statement": extracto/estado de cuenta de un carro (texto generado en el backend).
 *  - "reminder":  recordatorio del día (mañana/tarde) desde el motor de agenda.
 */
export class SendWhatsAppUseCase {
  constructor({ whatsappNotifier, statementUseCase, remindersUseCase, settingsRepository } = {}) {
    this.notifier = whatsappNotifier;
    this.statement = statementUseCase;
    this.reminders = remindersUseCase;
    this.settings = settingsRepository;
  }

  get enabled() {
    return !!(this.notifier && this.notifier.enabled);
  }

  async execute({ kind = "text", to, text, carId, moment, template, date } = {}) {
    if (!this.enabled) {
      throw new ValidationError(
        "WhatsApp no está configurado (faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)"
      );
    }

    let recipient = String(to || "").trim();
    let body = String(text || "").trim();

    if (kind === "test") {
      body = body || "✅ *W Drivers* — Prueba de WhatsApp exitosa.";
    } else if (kind === "statement") {
      if (!carId) throw new ValidationError("Falta carId para generar el extracto");
      const st = await this.statement.execute({ carId });
      body = st.whatsappText || "";
    } else if (kind === "reminder") {
      const r = await this.reminders.execute({ moment, date });
      body = r.whatsappText || "";
      if (!recipient && this.settings) {
        const s = await this.settings.get();
        recipient = (s && s.adminPhone) || "";
      }
    }

    if (!recipient) throw new ValidationError("Falta el número destino (to)");
    if (!body) throw new ValidationError("El mensaje está vacío");
    if (body.length > MAX_TEXT) body = body.slice(0, MAX_TEXT);

    const result = await this.notifier.send({ to: recipient, text: body, template });
    return { ...result, to: this.notifier.normalizePhone(recipient), kind };
  }
}
