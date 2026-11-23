// Envía mensajes por la Telegram Bot API.
// Si no hay token del bot, queda deshabilitado (no-op).
//
// A diferencia de WhatsApp, Telegram NO tiene "ventana de 24 h" ni plantillas
// aprobadas: se puede escribir en cualquier momento y usar botones inline
// (`inline_keyboard`) cuyos `callback_data` vuelven como `callback_query`.
//
// Markdown: usamos el modo legacy "Markdown" (el mismo `*negrita*` / `_cursiva_`
// que ya usan los textos del agente). Si Telegram rechaza el markup (entidades
// mal formadas), reintentamos en texto plano: así nunca se pierde el mensaje.

const API_BASE = "https://api.telegram.org";

export class TelegramNotifier {
  constructor({ token, apiBase = API_BASE } = {}) {
    this.token = token || "";
    this.apiBase = apiBase || API_BASE;
    this.enabled = !!this.token;
  }

  // Telegram identifica el destino por chat id (string). No se normaliza a dígitos.
  normalizePhone(chatId) {
    return String(chatId || "").trim();
  }

  url(method) {
    return `${this.apiBase}/bot${this.token}/${method}`;
  }

  async call(method, payload) {
    if (!this.enabled) return { ok: false, skipped: true, reason: "telegram_disabled" };
    const res = await fetch(this.url(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.ok !== true) {
      const description = (data && data.description) || `Telegram API error (${res.status})`;
      const err = new Error(description);
      err.statusCode = res.status;
      err.details = data;
      throw err;
    }
    return { ok: true, result: data.result };
  }

  async sendText({ to, text, markdown = true }) {
    const chatId = this.normalizePhone(to);
    if (!this.enabled) return { ok: false, skipped: true, reason: "telegram_disabled" };
    if (!chatId) return { ok: false, skipped: true, reason: "no_recipient" };
    const body = String(text || "").trim();
    if (!body) return { ok: false, skipped: true, reason: "empty_message" };
    const payload = { chat_id: chatId, text: body };
    if (markdown) payload.parse_mode = "Markdown";
    try {
      return await this.call("sendMessage", payload);
    } catch (err) {
      // Markup inválido (400): reintenta sin parse_mode para no perder el mensaje.
      if (markdown && err && (err.statusCode === 400 || !err.statusCode)) {
        return this.call("sendMessage", { chat_id: chatId, text: body });
      }
      throw err;
    }
  }

  /**
   * Mensaje con botones inline. Cada `button = { id, title }` se envía como una
   * fila; al pulsarlo, Telegram devuelve un `callback_query` con `data === id`.
   * No hay límite de "ventana de 24 h": funciona siempre.
   */
  async sendButtons({ to, text, buttons = [], footer = "" }) {
    const chatId = this.normalizePhone(to);
    if (!this.enabled) return { ok: false, skipped: true, reason: "telegram_disabled" };
    if (!chatId) return { ok: false, skipped: true, reason: "no_recipient" };
    let body = String(text || "").trim();
    if (!body) return { ok: false, skipped: true, reason: "empty_message" };
    if (footer) body += `\n\n_${String(footer)}_`;

    const rows = (buttons || [])
      .filter((b) => b && b.id && b.title)
      .slice(0, 6)
      .map((b) => [{ text: String(b.title).slice(0, 64), callback_data: String(b.id).slice(0, 64) }]);
    if (rows.length === 0) return this.sendText({ to: chatId, text: body });

    const base = { chat_id: chatId, text: body, reply_markup: { inline_keyboard: rows } };
    try {
      return await this.call("sendMessage", { ...base, parse_mode: "Markdown" });
    } catch (err) {
      if (err && (err.statusCode === 400 || !err.statusCode)) {
        return this.call("sendMessage", base);
      }
      throw err;
    }
  }

  // Cierra el "reloj" del botón (spinner) al recibir un callback_query.
  async answerCallbackQuery({ callbackQueryId, text } = {}) {
    if (!this.enabled || !callbackQueryId) return { ok: false, skipped: true };
    const payload = { callback_query_id: String(callbackQueryId) };
    if (text) payload.text = String(text).slice(0, 200);
    try {
      return await this.call("answerCallbackQuery", payload);
    } catch (_) {
      return { ok: false };
    }
  }

  // Registro del webhook (autorreferencia). Útil para el endpoint de configuración.
  async setWebhook({ url, secretToken } = {}) {
    const payload = { url: String(url || "") };
    if (secretToken) payload.secret_token = String(secretToken);
    return this.call("setWebhook", payload);
  }

  async send({ to, text }) {
    return this.sendText({ to, text });
  }
}
