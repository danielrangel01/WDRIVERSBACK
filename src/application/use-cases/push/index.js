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
