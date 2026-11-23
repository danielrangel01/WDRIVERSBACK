import express from "express";
import { config } from "../../../infrastructure/config/index.js";

/**
 * Extrae las actualizaciones relevantes del payload de Telegram (Bot API):
 *  - mensaje de texto  → `{ from, text, messageId }`
 *  - pulsación de botón inline (`callback_query`) → `{ from, action, callbackQueryId, messageId }`
 * `from` es el chat id (string) al que se responde.
 */
export function extractTelegramUpdates(update) {
  const out = [];
  if (!update) return out;

  const msg = update.message || update.edited_message;
  if (msg && msg.chat) {
    const text = msg.text || msg.caption;
    if (text) {
      out.push({ from: String(msg.chat.id), text: String(text), messageId: String(msg.message_id) });
    }
  }

  const cq = update.callback_query;
  if (cq && cq.message && cq.message.chat) {
    out.push({
      from: String(cq.message.chat.id),
      action: cq.data,
      callbackQueryId: String(cq.id),
      messageId: String(cq.message.message_id),
    });
  }

  return out;
}

/**
 * Router PÚBLICO del webhook de Telegram.
 * NO lleva authMiddleware: Telegram no envía JWT. La autorización real es que el
 * chat id remitente coincida con el "Chat ID de Telegram" configurado.
 * El secreto opcional (`TELEGRAM_WEBHOOK_SECRET`) se valida con el header que
 * Telegram envía al registrar el webhook.
 */
export function buildTelegramWebhook({ useCases, cfg = config, logger = console } = {}) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const secret = cfg.notifications.telegramWebhookSecret;
    if (secret) {
      const got = req.get("x-telegram-bot-api-secret-token");
      if (got !== secret) return res.sendStatus(401);
    }

    const items = extractTelegramUpdates(req.body);
    for (const it of items) {
      try {
        const result = await useCases.whatsAppAgent.handleIncoming({
          from: it.from, text: it.text, action: it.action, channel: "telegram",
        });
        // Si el chat no es el autorizado, le devolvemos su chat id para que lo
        // configure en Ajustes (no se ejecuta ninguna acción).
        if (result && result.reason === "unauthorized" && useCases.sendTelegram) {
          await useCases.sendTelegram.execute({
            kind: "text",
            to: it.from,
            text: `🔒 No autorizado.\nTu chat id es *${it.from}*.\nAgrégalo en Ajustes → Telegram para activar el asistente.`,
          }).catch(() => {});
        }
      } catch (err) {
        if (logger && logger.error) {
          logger.error("[telegram-webhook] error procesando update:", err && err.message);
        }
      }
      // Cierra el spinner del botón pulsado (best-effort).
      if (it.callbackQueryId && useCases.sendTelegram) {
        await useCases.sendTelegram.answerCallbackQuery(it.callbackQueryId).catch(() => {});
      }
    }

    // Siempre 200 para que Telegram no reintente el update.
    res.status(200).json({ ok: true });
  });

  return router;
}
