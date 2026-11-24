import { ValidationError } from "../../shared/errors.js";
import { config } from "../../infrastructure/config/index.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = config.security.noteMaxLength;
const MAX_NAME = config.security.nameMaxLength;
const MAX_PHONE = config.security.phoneMaxLength;
const MAX_EMAIL = 160;
const MAX_CATEGORY = config.security.categoryMaxLength;
const MAX_DOCTYPE = config.security.documentTypeMaxLength;
const MAX_CHATID = 32;

// Canales de notificación soportados. Solo uno está activo a la vez.
export const NOTIFY_CHANNELS = ["whatsapp", "telegram"];

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

export const OFF_DAY_REASONS = ["descanso", "no_trabajo", "taller", "otro"];
export const MAX_OFF_DAY_DETAIL = 200;

export class OffDay {
  constructor({ id, carId, date, reason = "", detail = "" }) {
    this.id = id;
    this.carId = carId;
    this.date = date;
    this.reason = (reason || "").trim().toLowerCase();
    this.detail = typeof detail === "string" ? detail.trim().slice(0, MAX_OFF_DAY_DETAIL) : "";
    this.validate();
  }
  validate() {
    if (!this.carId || typeof this.carId !== "string" || this.carId.length < 10 || this.carId.length > 30) {
      throw new ValidationError("El carro es obligatorio");
    }
    if (!DATE_RE.test(this.date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
    if (!this.reason) throw new ValidationError("El motivo del día no trabajado es obligatorio");
    if (!OFF_DAY_REASONS.includes(this.reason)) {
      throw new ValidationError("Motivo inválido. Usa 'descanso', 'no_trabajo', 'taller' u 'otro'");
    }
    if (this.reason === "otro" && !this.detail) {
      throw new ValidationError("Debes especificar el detalle cuando el motivo es 'otro'");
    }
    return this;
  }
  get isRestDay() {
    return this.reason === "descanso";
  }
  toJSON() {
    return { id: this.id, carId: this.carId, date: this.date, reason: this.reason, detail: this.detail };
  }
}

export const PENDING_PAYMENT_STATUS = ["pending", "approved", "dismissed"];

// Pago entrante detectado desde correo (Nequi) y pendiente de conciliar por el admin.
export class PendingPayment {
  constructor({ id, amount, detectedDate, source = "nequi", from = "", payerName = "", subject = "", snippet = "", messageId, status = "pending", approvedPaymentId = null, createdAt = null }) {
    this.id = id;
    this.amount = Number(amount);
    this.detectedDate = detectedDate;
    this.source = req(source, 40) || "nequi";
    this.from = req(from, 160);
    this.payerName = req(payerName, 160);
    this.subject = req(subject, 200);
    this.snippet = typeof snippet === "string" ? snippet.slice(0, 400) : "";
    this.messageId = req(messageId, 300);
    this.status = status;
    this.approvedPaymentId = approvedPaymentId ? String(approvedPaymentId) : null;
    this.createdAt = createdAt;
    this.validate();
  }
  validate() {
    if (isNaN(this.amount) || !isFinite(this.amount) || this.amount <= 0) {
      throw new ValidationError("El monto debe ser mayor a 0");
    }
    if (this.amount > 1e11) throw new ValidationError("Monto excesivo");
    if (!DATE_RE.test(this.detectedDate || "")) throw new ValidationError("Fecha detectada inválida (YYYY-MM-DD)");
    if (!this.messageId) throw new ValidationError("El pago pendiente requiere messageId");
    if (!PENDING_PAYMENT_STATUS.includes(this.status)) throw new ValidationError("Estado de pago pendiente inválido");
    return this;
  }
  toJSON() {
    return {
      id: this.id, amount: this.amount, detectedDate: this.detectedDate, source: this.source,
      from: this.from, payerName: this.payerName, subject: this.subject, snippet: this.snippet,
      messageId: this.messageId, status: this.status, approvedPaymentId: this.approvedPaymentId,
      createdAt: this.createdAt,
    };
  }
}

export class Settings {
  constructor({ adminPhone = "", adminEmail = "", remindersEnabled = true, morningHour = 8, lateMorningHour = 11, middayHour = 14, afternoonHour = 16, eveningHour = 20, notifyChannel = "whatsapp", telegramChatId = "" } = {}) {
    this.adminPhone = req(adminPhone, MAX_PHONE);
    this.adminEmail = req(adminEmail, MAX_EMAIL);
    this.remindersEnabled = remindersEnabled === undefined ? true : !!remindersEnabled;
    this.morningHour = clampHour(morningHour, 8);
    this.lateMorningHour = clampHour(lateMorningHour, 11);
    this.middayHour = clampHour(middayHour, 14);
    this.afternoonHour = clampHour(afternoonHour, 16);
    this.eveningHour = clampHour(eveningHour, 20);
    // Canal activo (solo uno a la vez) y chat id del admin en Telegram.
    this.notifyChannel = NOTIFY_CHANNELS.includes(notifyChannel) ? notifyChannel : "whatsapp";
    this.telegramChatId = req(telegramChatId, MAX_CHATID);
  }
  validate() {
    if (this.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.adminEmail)) {
      throw new ValidationError("Correo inválido");
    }
    return this;
  }
  toJSON() {
    return {
      adminPhone: this.adminPhone,
      adminEmail: this.adminEmail,
      remindersEnabled: this.remindersEnabled,
      morningHour: this.morningHour,
      lateMorningHour: this.lateMorningHour,
      middayHour: this.middayHour,
      afternoonHour: this.afternoonHour,
      eveningHour: this.eveningHour,
      notifyChannel: this.notifyChannel,
      telegramChatId: this.telegramChatId,
    };
  }
}

function clampHour(h, fallback) {
  const n = Number(h);
  if (isNaN(n) || n < 0 || n > 23) return fallback;
  return Math.trunc(n);
}
