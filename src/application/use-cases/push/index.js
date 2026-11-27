import { ValidationError } from "../../../shared/errors.js";

/**
 * Registra (o actualiza) una suscripción de Web Push de la PWA.
 * El navegador entrega un objeto `subscription` con endpoint y claves.
 */
export class SubscribePushUseCase {
  constructor({ pushSubscriptionRepository }) {
    this.subscriptions = pushSubscriptionRepository;
  }

  async execute({ subscription, userAgent } = {}) {
    if (!subscription || !subscription.endpoint) {
      throw new ValidationError("Suscripción inválida: falta el endpoint");
    }
    const keys = subscription.keys || {};
    if (!keys.p256dh || !keys.auth) {
      throw new ValidationError("Suscripción inválida: faltan las claves p256dh/auth");
    }
    await this.subscriptions.upsert(subscription, { userAgent });
    return { ok: true, endpoint: subscription.endpoint };
  }
}

/** Elimina una suscripción de Web Push por su endpoint. */
export class UnsubscribePushUseCase {
  constructor({ pushSubscriptionRepository }) {
    this.subscriptions = pushSubscriptionRepository;
  }

  async execute({ endpoint } = {}) {
    if (!endpoint) throw new ValidationError("Falta el endpoint");
    const removed = await this.subscriptions.removeByEndpoint(endpoint);
    return { ok: true, removed };
  }
}

/**
 * Registra (o actualiza) el token de dispositivo de una app nativa (iOS/Android)
 * para enviarle notificaciones push vía FCM. El token lo genera el SDK de
 * Firebase en el dispositivo y se envía aquí tras el login.
 */
export class RegisterDeviceUseCase {
  constructor({ deviceTokenRepository }) {
    this.devices = deviceTokenRepository;
  }

  async execute({ token, platform, deviceName } = {}) {
    const t = String(token || "").trim();
    if (!t) throw new ValidationError("Token de dispositivo inválido");
    const p = platform === "ios" ? "ios" : "android";
    // `isNew` permite al llamador distinguir el primer alta (p. ej. para enviar
    // un saludo de bienvenida) de un simple refresco del mismo token.
    const isNew = !(await this.devices.exists(t));
    await this.devices.upsert({ token: t, platform: p, deviceName });
    return { ok: true, platform: p, token: t.slice(-12), isNew };
  }
}

/** Elimina el token de dispositivo (p. ej. al cerrar sesión). */
export class UnregisterDeviceUseCase {
  constructor({ deviceTokenRepository }) {
    this.devices = deviceTokenRepository;
  }

  async execute({ token } = {}) {
    const t = String(token || "").trim();
    if (!t) throw new ValidationError("Falta el token de dispositivo");
    const removed = await this.devices.removeByToken(t);
    return { ok: true, removed };
  }
}
