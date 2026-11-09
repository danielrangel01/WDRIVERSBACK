import { PendingPayment } from "../../../domain/entities/index.js";
import { NotFoundError, ValidationError, ConflictError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 500;

// Detecta pagos recibidos (Nequi) desde el buzón y los guarda como pendientes.
export class SyncNequiUseCase {
  constructor({ pendingPaymentRepository, mailReader }) {
    this.pending = pendingPaymentRepository;
    this.mail = mailReader;
  }
  async execute() {
    const res = await this.mail.fetchPaymentCandidates();
    if (!res || !res.configured) {
      return { ok: false, reason: "not_configured", scanned: 0, detected: 0, created: 0 };
    }

    const valid = [];
    for (const c of res.candidates) {
      try {
        valid.push(new PendingPayment({
          amount: c.amount,
          detectedDate: c.detectedDate,
          source: "nequi",
          from: c.from,
          subject: c.subject,
          snippet: c.snippet,
          messageId: c.messageId,
          status: "pending",
        }));
      } catch {
        // candidato inválido: se ignora sin abortar la sincronización
      }
    }

    const created = await this.pending.insertMany(valid);
    return { ok: true, scanned: res.scanned, detected: res.candidates.length, created };
  }
}

export class ListPendingPaymentsUseCase {
  constructor({ pendingPaymentRepository }) {
    this.pending = pendingPaymentRepository;
  }
  async execute({ status = "pending" } = {}) {
    const list = await this.pending.findAll({ status: status === "all" ? undefined : status });
    return list.map((p) => p.toJSON());
  }
}

// Aprueba un pendiente: crea el pago real asignado al carro y fecha elegidos.
export class ApprovePendingPaymentUseCase {
  constructor({ pendingPaymentRepository, addPaymentUseCase }) {
    this.pending = pendingPaymentRepository;
    this.addPayment = addPaymentUseCase;
  }
  async execute({ id, carId, date, note }) {
    if (!validOid(id)) throw new ValidationError("Pago pendiente inválido");
    if (!DATE_RE.test(date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");

    const pending = await this.pending.findById(id);
    if (!pending) throw new NotFoundError("El pago pendiente no existe");
    if (pending.status !== "pending") throw new ConflictError("Este pago ya fue procesado");

    const finalNote = (typeof note === "string" && note.trim())
      ? note.trim().slice(0, MAX_NOTE)
      : `Nequi · ${pending.from || "pago recibido"}`.slice(0, MAX_NOTE);

    const payment = await this.addPayment.execute({
      carId,
      date,
      amount: pending.amount,
      note: finalNote,
    });

    pending.status = "approved";
    pending.approvedPaymentId = payment.id;
    await this.pending.update(pending);

    return { ok: true, payment: payment.toJSON(), pending: pending.toJSON() };
  }
}

export class DismissPendingPaymentUseCase {
  constructor({ pendingPaymentRepository }) {
    this.pending = pendingPaymentRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Pago pendiente inválido");
    const pending = await this.pending.findById(id);
    if (!pending) throw new NotFoundError("El pago pendiente no existe");
    if (pending.status !== "pending") throw new ConflictError("Este pago ya fue procesado");

    pending.status = "dismissed";
    await this.pending.update(pending);
    return { ok: true };
  }
}
