import { ValidationError } from "../../../shared/errors.js";

// Límite de la Bot API para mensajes de texto (4096 caracteres).
const MAX_TEXT = 4096;

/**
 * Envía mensajes por Telegram (Bot API). Espejo de `SendWhatsAppUseCase`: el
 * agente y el despachador lo usan con el MISMO contrato
 * ({ kind, to, text, buttons, footer }), de modo que el canal es intercambiable.
 *
 * Modos:
 *  - "test":    mensaje de prueba corto.
 *  - "text":    texto libre provisto por el llamador.
 *  - "buttons": mensaje con botones inline (check-in paso a paso).
 *  - "template": en Telegram no existen plantillas; se envía como texto (con
 *                botones si el llamador los aporta). Se acepta por compatibilidad.
 */
export class SendTelegramUseCase {
  constructor({ telegramNotifier } = {}) {
    this.notifier = telegramNotifier;
  }

  get enabled() {
    return !!(this.notifier && this.notifier.enabled);
  }

  async execute({ kind = "text", to, text, buttons, footer } = {}) {
    if (!this.enabled) {
      throw new ValidationError("Telegram no está configurado (falta TELEGRAM_BOT_TOKEN)");
    }

    const recipient = String(to || "").trim();
    if (!recipient) throw new ValidationError("Falta el chat destino (to)");

    let body = String(text || "").trim();
    if (kind === "test") {
      body = body || "✅ *W Drivers* — Prueba de Telegram exitosa.";
    }
    if (!body) throw new ValidationError("El mensaje está vacío");
    if (body.length > MAX_TEXT) body = body.slice(0, MAX_TEXT);

    if (kind === "buttons" && (buttons || []).length) {
      const result = await this.notifier.sendButtons({ to: recipient, text: body, buttons, footer });
      return { ...result, to: recipient, kind };
    }

    const result = await this.notifier.sendText({ to: recipient, text: body });
    return { ...result, to: recipient, kind };
  }

  // Cierra el spinner del botón pulsado (best-effort).
  async answerCallbackQuery(callbackQueryId, text) {
    if (!this.notifier || !this.notifier.answerCallbackQuery) return { ok: false, skipped: true };
    return this.notifier.answerCallbackQuery({ callbackQueryId, text });
  }
}
