// Notificaciones push nativas (iOS/Android) vía Firebase Cloud Messaging.
// Se activa solo si hay credenciales de servicio de Firebase configuradas.
// La dependencia `firebase-admin` se carga de forma diferida (import dinámico)
// para que el resto del sistema —y las pruebas— funcione sin ella instalada.
function parseServiceAccount(raw) {
  if (!raw) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (obj && obj.project_id && obj.private_key && obj.client_email) return obj;
  } catch (_) {}
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
