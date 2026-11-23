// Envía mensajes por la WhatsApp Business Cloud API (Meta / Graph API).
// Si no hay token ni número emisor, queda deshabilitado (no-op).
//
// Regla de Meta: solo se puede enviar texto libre dentro de la "ventana de
// atención al cliente" de 24 h (el destinatario escribió primero). Fuera de ella
// hay que usar una PLANTILLA aprobada. `send()` intenta texto y, si la API lo
// rechaza por re-engagement, reintenta con la plantilla configurada usando los
// `components` (variables) que aporte el llamador. Las plantillas UTILITY exigen
// parámetros estructurados, así que sin `components` no se reintenta.

const GRAPH = "https://graph.facebook.com";

// Códigos de Meta que indican "necesitas plantilla": 131047 (re-engagement),
// 470 / 131026 (fuera de ventana / no entregable).
const NEEDS_TEMPLATE = new Set([131047, 470, 131026]);


export class WhatsAppNotifier {
  constructor({ token, phoneNumberId, apiVersion = "v21.0", template = "", templateLang = "es" } = {}) {
    this.token = token || "";
    this.phoneNumberId = phoneNumberId || "";
    this.apiVersion = apiVersion || "v21.0";
    this.template = template || "";
    this.templateLang = templateLang || "es";
    this.enabled = !!(this.token && this.phoneNumberId);
  }

  normalizePhone(phone) {
    return String(phone || "").replace(/[^\d]/g, "");
  }

  async post(payload) {
    if (!this.enabled) return { ok: false, skipped: true, reason: "whatsapp_disabled" };
    const url = `${GRAPH}/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiErr = data && data.error ? data.error : {};
      const err = new Error(apiErr.message || `WhatsApp API error (${res.status})`);
      err.statusCode = res.status;
      err.code = apiErr.code;
      err.details = data;
      throw err;
    }
    return { ok: true, messages: (data && data.messages) || [] };
  }

  async sendText({ to, text }) {
    const phone = this.normalizePhone(to);
    if (!this.enabled) return { ok: false, skipped: true, reason: "whatsapp_disabled" };
    if (!phone) return { ok: false, skipped: true, reason: "no_recipient" };
    const body = String(text || "").trim();
    if (!body) return { ok: false, skipped: true, reason: "empty_message" };
    return this.post({ to: phone, type: "text", text: { preview_url: false, body } });
  }

  async sendTemplate({ to, name, lang, components }) {
    const phone = this.normalizePhone(to);
    if (!this.enabled) return { ok: false, skipped: true, reason: "whatsapp_disabled" };
    if (!phone) return { ok: false, skipped: true, reason: "no_recipient" };
    const templateName = name || this.template;
    if (!templateName) {
      const err = new Error("Falta configurar WHATSAPP_TEMPLATE (plantilla aprobada) para enviar fuera de la ventana de 24 h");
      err.code = 131047;
      throw err;
    }
    const template = { name: templateName, language: { code: lang || this.templateLang } };
    if (components) template.components = components;
    return this.post({ to: phone, type: "template", template });
  }

  /**
   * Mensaje interactivo con botones de respuesta rápida (máx. 3).
   * Los botones solo se pueden usar DENTRO de la ventana de 24 h; fuera de ella
   * Meta rechaza el envío (código 131047) y el llamador debe caer a plantilla.
   */
  async sendButtons({ to, text, buttons = [], footer = "" }) {
    const phone = this.normalizePhone(to);
    if (!this.enabled) return { ok: false, skipped: true, reason: "whatsapp_disabled" };
    if (!phone) return { ok: false, skipped: true, reason: "no_recipient" };
    const body = String(text || "").trim();
    if (!body) return { ok: false, skipped: true, reason: "empty_message" };
    const list = (buttons || [])
      .filter((b) => b && b.id && b.title)
      .slice(0, 3)
      .map((b) => ({ type: "reply", reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) } }));
    if (list.length === 0) return this.sendText({ to: phone, text: body });
    const interactive = { type: "button", body: { text: body }, action: { buttons: list } };
    if (footer) interactive.footer = { text: String(footer).slice(0, 60) };
    return this.post({ to: phone, type: "interactive", interactive });
  }

  async send({ to, text, template, lang, components }) {
    if (!this.enabled) return { ok: false, skipped: true, reason: "whatsapp_disabled" };
    try {
      return await this.sendText({ to, text });
    } catch (err) {
      const code = (err && err.code) || 0;
      const name = template || this.template;
      // Solo se reintenta con plantilla si el llamador aporta las variables:
      // las plantillas UTILITY exigen parámetros estructurados.
      if (NEEDS_TEMPLATE.has(code) && name && components) {
        return this.sendTemplate({ to, name, lang, components });
      }
      throw err;
    }
  }
}
