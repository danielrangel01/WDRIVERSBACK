import { ValidationError } from "../../shared/errors.js";
import { config } from "../../infrastructure/config/index.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = config.security.noteMaxLength;
const MAX_NAME = config.security.nameMaxLength;
const MAX_PHONE = config.security.phoneMaxLength;
const MAX_CATEGORY = config.security.categoryMaxLength;
const MAX_DOCTYPE = config.security.documentTypeMaxLength;

const trunc = (s, n) => (typeof s === "string" ? s.slice(0, n) : s || "");
const req = (s, n) => {
  if (typeof s !== "string") return "";
  const t = s.trim();
  return t.slice(0, n);
};

export class User {
  constructor({ id, username, passwordHash }) {
    this.id = id;
    this.username = (username || "").toLowerCase().trim().slice(0, 40);
    this.passwordHash = passwordHash;
  }
  toJSON() {
    return { id: this.id, username: this.username };
  }
}

export class Payment {
  constructor({ id, carId, date, amount, note = "", createdAt = null }) {
    this.id = id;
    this.carId = carId;
    this.date = date;
    this.amount = Number(amount);
    this.note = req(note, MAX_NOTE);
    this.createdAt = createdAt;
    this.validate();
  }
  validate() {
    if (!this.carId || typeof this.carId !== "string" || this.carId.length < 10 || this.carId.length > 30) {
      throw new ValidationError("El carro es obligatorio");
    }
    if (!DATE_RE.test(this.date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
    if (isNaN(this.amount) || !isFinite(this.amount) || this.amount <= 0) {
      throw new ValidationError("El monto debe ser mayor a 0");
    }
    if (this.amount > 1e11) throw new ValidationError("Monto excesivo");
    return this;
  }
  toJSON() {
    return { id: this.id, carId: this.carId, date: this.date, amount: this.amount, note: this.note, createdAt: this.createdAt };
  }
}

export class Expense {
  constructor({ id, date, amount, category = "Otro", note = "", createdAt = null }) {
    this.id = id;
    this.date = date;
    this.amount = Number(amount);
    this.category = req(category, MAX_CATEGORY) || "Otro";
    this.note = req(note, MAX_NOTE);
    this.createdAt = createdAt;
    this.validate();
  }
  validate() {
    if (!DATE_RE.test(this.date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
    if (isNaN(this.amount) || !isFinite(this.amount) || this.amount <= 0) {
      throw new ValidationError("El monto debe ser mayor a 0");
    }
    if (this.amount > 1e11) throw new ValidationError("Monto excesivo");
    return this;
  }
  toJSON() {
    return { id: this.id, date: this.date, amount: this.amount, category: this.category, note: this.note, createdAt: this.createdAt };
  }
}

export class VehicleDocument {
  constructor({ id, carId, type, expiry, note = "", createdAt = null }) {
    this.id = id;
    this.carId = carId;
    this.type = req(type, MAX_DOCTYPE);
    this.expiry = expiry;
    this.note = req(note, MAX_NOTE);
    this.createdAt = createdAt;
    this.validate();
  }
  validate() {
    if (!this.carId || typeof this.carId !== "string" || this.carId.length < 10 || this.carId.length > 30) {
      throw new ValidationError("El carro es obligatorio");
    }
    if (!this.type) throw new ValidationError("El tipo de documento es obligatorio");
    if (!DATE_RE.test(this.expiry || "")) throw new ValidationError("Fecha de vencimiento inválida (YYYY-MM-DD)");
    return this;
  }
  toJSON() {
    return { id: this.id, carId: this.carId, type: this.type, expiry: this.expiry, note: this.note, createdAt: this.createdAt };
  }
}

export class OffDay {
  constructor({ id, carId, date }) {
    this.id = id;
    this.carId = carId;
    this.date = date;
    if (!this.carId || typeof this.carId !== "string" || this.carId.length < 10 || this.carId.length > 30) {
      throw new ValidationError("El carro es obligatorio");
    }
    if (!DATE_RE.test(this.date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
  }
  toJSON() {
    return { id: this.id, carId: this.carId, date: this.date };
  }
}

export class Settings {
  constructor({ adminPhone = "", morningHour = 8, eveningHour = 20 } = {}) {
    this.adminPhone = req(adminPhone, MAX_PHONE);
    this.morningHour = clampHour(morningHour, 8);
    this.eveningHour = clampHour(eveningHour, 20);
  }
  toJSON() {
    return { adminPhone: this.adminPhone, morningHour: this.morningHour, eveningHour: this.eveningHour };
  }
}

function clampHour(h, fallback) {
  const n = Number(h);
  if (isNaN(n) || n < 0 || n > 23) return fallback;
  return Math.trunc(n);
}
