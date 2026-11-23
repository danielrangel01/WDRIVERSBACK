import express from "express";
import crypto from "crypto";
import { config } from "../../../infrastructure/config/index.js";

/** Verifica la firma HMAC-SHA256 que envía Meta (X-Hub-Signature-256). */
export function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true; // sin secreto configurado no se verifica (dev)
  if (!rawBody || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

/**
 * Extrae los mensajes entrantes relevantes del payload de Meta:
 *  - texto libre → `{ from, text, messageId }`
 *  - respuesta de botón interactivo (interactive.button_reply) → `{ from, action, messageId }`
 *  - respuesta de botón de PLANTILLA (type: "button") → `{ from, action, messageId }`
 */
export function extractIncomingMessages(payload) {
  const out = [];
  const entries = (payload && payload.entry) || [];
  for (const entry of entries) {
    for (const change of (entry && entry.changes) || []) {
      const value = (change && change.value) || {};
      for (const msg of value.messages || []) {
        if (!msg) continue;
        if (msg.type === "text") {
          const text = msg.text && msg.text.body;
          if (text) out.push({ from: msg.from, text, messageId: msg.id });
        } else if (msg.type === "interactive") {
          const action = msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.id;
          if (action) out.push({ from: msg.from, action, messageId: msg.id });
        } else if (msg.type === "button") {
          // Botón de respuesta rápida de una PLANTILLA: llega el payload y/o el texto.
          const btn = msg.button || {};
          const action = btn.payload || btn.text;
          if (action) out.push({ from: msg.from, action, messageId: msg.id });
        }
      }
    }
  }
  return out;
}

/**
 * Router PÚBLICO del webhook de WhatsApp (Meta).
 *  - GET  /  → verificación del webhook (hub.challenge).
 *  - POST /  → recepción de mensajes entrantes.
 * NO lleva authMiddleware: Meta no envía JWT. La autorización real es que el
 * remitente sea el "Teléfono administrador" configurado en la app.
 */
export function buildWhatsAppWebhook({ useCases, cfg = config, logger = console } = {}) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected = cfg.notifications.whatsappVerifyToken;
    if (mode === "subscribe" && expected && token === expected) {
      return res.status(200).type("text/plain").send(String(challenge || ""));
    }
    return res.sendStatus(403);
  });

  router.post("/", async (req, res) => {
    const signature = req.get("x-hub-signature-256");
    if (!verifySignature(req.rawBody, signature, cfg.notifications.whatsappAppSecret)) {
      return res.sendStatus(401);
    }
    const messages = extractIncomingMessages(req.body);
    for (const msg of messages) {
      try {
        await useCases.whatsAppAgent.handleIncoming({ from: msg.from, text: msg.text, action: msg.action });
      } catch (err) {
        if (logger && logger.error) {
          logger.error("[whatsapp-webhook] error procesando mensaje:", err && err.message);
        }
      }
    }
    // Siempre 200 para que Meta no reintente el evento.
    res.status(200).json({ ok: true });
  });

  return router;
}
