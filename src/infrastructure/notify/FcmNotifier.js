// Notificaciones push nativas (iOS/Android) vía Firebase Cloud Messaging.
// Se activa solo si hay credenciales de servicio de Firebase configuradas.
// La dependencia `firebase-admin` se carga de forma diferida (import dinámico)
// para que el resto del sistema —y las pruebas— funcione sin ella instalada.
// Algunas consolas (Railway, paneles web) convierten los `\n` del JSON en saltos
// de línea reales al pegar las credenciales, dejando el JSON inválido. Reparamos
// los caracteres de control que hayan quedado dentro de las cadenas.
function repairJsonControlChars(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\t" ? "\\t" : ch === "\r" ? "" : "\\n";
      continue;
    }
    out += ch;
  }
  return out;
}

function parseServiceAccount(raw) {
  if (!raw) return null;
  let obj = typeof raw === "string" ? null : raw;
  if (!obj && typeof raw === "string") {
    for (const candidate of [raw, repairJsonControlChars(raw)]) {
      try { obj = JSON.parse(candidate); break; } catch (_) { obj = null; }
    }
  }
  if (obj && obj.project_id && obj.private_key && obj.client_email) return obj;
  return null;
}

export class FcmNotifier {
  constructor({ serviceAccount, projectId } = {}) {
    this.credentials = parseServiceAccount(serviceAccount);
    this.projectId = projectId || "";
    this.enabled = !!this.credentials;
    this.app = null;
    this.error = "";
  }

  async _loadApp() {
    if (this.app) return this.app;
    const mod = await import("firebase-admin");
    const admin = mod.default || mod;
    const apps = typeof admin.getApps === "function" ? admin.getApps() : (admin.apps || []);
    this.app = apps.length
      ? apps[0]
      : admin.initializeApp({
          credential: admin.credential.cert(this.credentials),
          projectId: this.projectId || this.credentials.project_id,
        });
    return this.app;
  }

  /** Envía una notificación a un token de dispositivo FCM. */
  async send(token, payload = {}) {
    if (!this.enabled || !token) return { ok: false, skipped: true, reason: "fcm_disabled" };
    try {
      const app = await this._loadApp();
      const message = {
        token,
        notification: { title: payload.title || "W Drivers", body: payload.body || "" },
        data: payload.data || {},
        android: { priority: "high", notification: { channelId: "wdrivers_default", sound: "default" } },
        apns: { payload: { aps: { sound: "default" } } },
      };
      const messageId = await app.messaging().send(message);
      return { ok: true, messageId };
    } catch (err) {
      const code = (err && (err.code || (err.errorInfo && err.errorInfo.code))) || "";
      return { ok: false, error: err && err.message ? err.message : String(err), code };
    }
  }
}
