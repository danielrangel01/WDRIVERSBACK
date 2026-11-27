import { Payment } from "../../../domain/entities/index.js";
import { NotFoundError, ValidationError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

const cop = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n) || 0);

export class AddPaymentUseCase {
  constructor({ paymentRepository, carRepository, settingsRepository, fcmNotifier, deviceTokenRepository }) {
    this.payments = paymentRepository;
    this.cars = carRepository;
    // Opcionales: si están presentes, se envía un push informativo al registrar
    // el pago (respeta el interruptor global y la categoría "Pagos").
    this.settings = settingsRepository;
    this.fcm = fcmNotifier;
    this.devices = deviceTokenRepository;
  }
  async execute({ carId, date, amount, note }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");
    const payment = new Payment({ carId, date, amount, note });
    const created = await this.payments.create(payment);
    // El push es informativo y best-effort: nunca debe romper el registro del pago.
    await this.notifyPayment(car, created);
    return created;
  }

  async notifyPayment(car, payment) {
    try {
      if (!this.fcm || !this.fcm.enabled || !this.devices || !this.settings) return;
      const s = await this.settings.get();
      if (!s || s.pushEnabled === false || s.pushPayments === false) return;
      const devices = await this.devices.findAll();
      if (!devices.length) return;
      const label = car.alias || car.name || "";
      const title = "💰 Pago registrado";
      const body = `${car.plate}${label ? ` · ${label}` : ""} — ${cop(payment.amount)}`;
      const data = { type: "payment", carId: String(car.id || "") };
      for (const d of devices) {
        const r = await this.fcm.send(d.token, { title, body, data, platform: d.platform });
        if (r && r.code === "messaging/registration-token-not-registered") {
          await this.devices.removeByToken(d.token);
        }
      }
    } catch (err) {
      console.warn("[push] pago no notificado:", err && err.message ? err.message : String(err));
    }
  }
}

export class DeletePaymentUseCase {
  constructor({ paymentRepository }) {
    this.payments = paymentRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador inválido");
    await this.payments.delete(id);
    return { ok: true };
  }
}
