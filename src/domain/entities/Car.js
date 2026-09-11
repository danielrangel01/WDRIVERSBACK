import { ValidationError } from "../../shared/errors.js";
import { config } from "../../infrastructure/config/index.js";

const MAX_NAME = config.security.nameMaxLength;
const MAX_NOTE = config.security.noteMaxLength;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class Car {
  constructor({ id, plate, name = "", rate = 80000, startDate = null, active = true, createdAt = null }) {
    this.id = id;
    this.plate = Car.normalizePlate(plate);
    this.name = (name || "").trim().slice(0, MAX_NAME);
    this.rate = Number(rate) || 0;
    this.startDate = startDate || null;
    this.active = !!active;
    this.createdAt = createdAt;
  }

  static normalizePlate(plate) {
    if (!plate || typeof plate !== "string") {
      throw new ValidationError("La placa es obligatoria");
    }
    const clean = plate.trim().toUpperCase().replace(/\s+/g, "");
    const maxLen = config.security.plateMaxLength;
    if (clean.length < 3 || clean.length > maxLen) {
      throw new ValidationError(`La placa debe tener entre 3 y ${maxLen} caracteres`);
    }
    if (!/^[A-Z0-9\-]+$/.test(clean)) {
      throw new ValidationError("La placa contiene caracteres inválidos");
    }
    return clean;
  }

  validate() {
    if (isNaN(this.rate) || !isFinite(this.rate) || this.rate < 0) {
      throw new ValidationError("La tarifa no puede ser negativa");
    }
    if (this.rate > 1e11) throw new ValidationError("Tarifa excesiva");
    if (this.startDate && !DATE_RE.test(this.startDate)) {
      throw new ValidationError("La fecha de inicio debe tener formato YYYY-MM-DD");
    }
    return this;
  }

  deactivate() {
    this.active = false;
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      plate: this.plate,
      name: this.name,
      rate: this.rate,
      startDate: this.startDate,
      active: this.active,
      createdAt: this.createdAt,
    };
  }
}
