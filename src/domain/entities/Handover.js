import { ValidationError } from "../../shared/errors.js";
import { config } from "../../infrastructure/config/index.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = config.security.nameMaxLength;
const MAX_PHONE = config.security.phoneMaxLength;
const MAX_NOTE = config.security.noteMaxLength;

const cleanPhone = (s) => (typeof s === "string" ? s.replace(/[^\d+]/g, "").slice(0, MAX_PHONE) : "");

/**
 * Entrega (Handover): registro de qué conductor tuvo un carro y desde/hasta cuándo.
 * Rango inclusivo [startDate, endDate]. Si `endDate` es null, la entrega está vigente.
 * Un carro puede tener una sola entrega vigente a la vez.
 */
export class Handover {
  constructor({ id, carId, driverName = "", driverPhone = "", startDate = null, endDate = null, note = "", createdAt = null }) {
    this.id = id;
    this.carId = carId;
    this.driverName = (driverName || "").trim().slice(0, MAX_NAME);
    this.driverPhone = cleanPhone(driverPhone);
    this.startDate = startDate || null;
    this.endDate = endDate || null;
    this.note = (note || "").trim().slice(0, MAX_NOTE);
    this.createdAt = createdAt;
    this.validate();
  }

  validate() {
    if (!this.carId || typeof this.carId !== "string" || this.carId.length < 10 || this.carId.length > 30) {
      throw new ValidationError("El carro es obligatorio");
    }
    if (!this.driverName) throw new ValidationError("El nombre del conductor es obligatorio");
    if (!DATE_RE.test(this.startDate || "")) throw new ValidationError("Fecha de entrega inválida (YYYY-MM-DD)");
    if (this.endDate && !DATE_RE.test(this.endDate)) throw new ValidationError("Fecha de devolución inválida (YYYY-MM-DD)");
    if (this.endDate && this.endDate < this.startDate) {
      throw new ValidationError("La devolución no puede ser anterior a la entrega");
    }
    return this;
  }

  get isActive() {
    return !this.endDate;
  }

  // ¿Esta entrega cubre la fecha indicada?
  covers(date) {
    return date >= this.startDate && (!this.endDate || date <= this.endDate);
  }

  toJSON() {
    return {
      id: this.id,
      carId: this.carId,
      driverName: this.driverName,
      driverPhone: this.driverPhone,
      startDate: this.startDate,
      endDate: this.endDate,
      active: this.isActive,
      note: this.note,
      createdAt: this.createdAt,
    };
  }
}
