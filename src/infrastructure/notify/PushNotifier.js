import { setVapidDetails, sendNotification } from "web-push";

// Envía notificaciones Web Push (PWA). Si no hay claves VAPID, queda deshabilitado.
export class PushNotifier {
  constructor({ publicKey, privateKey, subject } = {}) {
    this.enabled = !!(publicKey && privateKey);
    if (this.enabled) {
      setVapidDetails(subject || "mailto:admin@wdrivers.app", publicKey, privateKey);
    }
  }

  async send(subscription, payload) {
    if (!this.enabled || !subscription || !subscription.endpoint) {
      return { ok: false, skipped: true, reason: "push_disabled" };
    }
    const res = await sendNotification(subscription, JSON.stringify(payload));
    return { ok: true, statusCode: res && res.statusCode };
  }
}
