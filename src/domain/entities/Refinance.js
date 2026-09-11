import { ValidationError } from "../../shared/errors.js";
import { config } from "../../infrastructure/config/index.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = config.security.noteMaxLength;

export class Refinance {
  constructor({ id, carId, date, originalAmount, days, paidToPlan = 0, note = "", active = true, createdAt = null }) {
    this.id = id;
    this.carId = carId;
    this.date = date;
    this.originalAmount = Number(originalAmount);
    this.days = Number(days);
    this.paidToPlan = Number(paidToPlan) || 0;
    this.note = (note || "").trim().slice(0, MAX_NOTE);
    this.active = !!active;
    this.createdAt = createdAt;
    this.validate();
  }

  validate() {
    if (!this.carId || typeof this.carId !== "string" || this.carId.length < 10 || this.carId.length > 30) {
      throw new ValidationError("El carro es obligatorio");
    }
    if (!DATE_RE.test(this.date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
    if (isNaN(this.originalAmount) || !isFinite(this.originalAmount) || this.originalAmount <= 0) {
      throw new ValidationError("El monto a refinanciar debe ser mayor a 0");
    }
    if (this.originalAmount > 1e11) throw new ValidationError("Monto excesivo");
    if (isNaN(this.days) || !isFinite(this.days) || this.days < 1) {
      throw new ValidationError("El plazo debe ser de al menos 1 día");
    }
    if (this.days > 365 * 10) throw new ValidationError("Plazo excesivo");
    if (this.paidToPlan < 0) throw new ValidationError("El abono no puede ser negativo");
    if (this.paidToPlan > this.originalAmount) throw new ValidationError("Abono excede el monto original");
    return this;
  }

  get dailyInstallment() {
    if (this.days <= 0) return 0;
    return Math.round((this.originalAmount / this.days) * 100) / 100;
  }

  get remaining() {
    return Math.max(0, this.originalAmount - this.paidToPlan);
  }

  get installmentsPaid() {
    if (this.dailyInstallment <= 0) return 0;
    return Math.min(this.days, Math.floor(this.paidToPlan / this.dailyInstallment));
  }

  get isSettled() {
    return this.remaining <= 0.001;
  }

  toJSON() {
    return {
      id: this.id,
      carId: this.carId,
      date: this.date,
      originalAmount: this.originalAmount,
      days: this.days,
      dailyInstallment: this.dailyInstallment,
      paidToPlan: this.paidToPlan,
      remaining: this.remaining,
      installmentsPaid: this.installmentsPaid,
      isSettled: this.isSettled,
      note: this.note,
      active: this.active,
      createdAt: this.createdAt,
    };
  }
}
