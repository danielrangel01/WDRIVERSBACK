import { PendingPayment } from "../../../domain/entities/index.js";
import { formatCOP } from "../../../domain/services/AgentCommand.js";
import { NotFoundError, ValidationError, ConflictError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 500;

// dd/mm/aaaa a partir de "aaaa-mm-dd".
const dmy = (iso) => {
  const [y, m, d] = String(iso || "").split("-");
  return d ? `${d}/${m}/${y}` : String(iso || "");
};

// Detecta pagos recibidos (Nequi) desde el buzón y los guarda como pendientes.
// Al detectar pagos NUEVOS envía además una notificación por Telegram al admin
// (mismo destino que el agente: Ajustes.telegramChatId o el respaldo del entorno).
export class SyncNequiUseCase {
  constructor({ pendingPaymentRepository, mailReader, sendTelegram, getSettings, telegramChatId, log = console } = {}) {
    this.pending = pendingPaymentRepository;
    this.mail = mailReader;
    this.sendTelegram = sendTelegram;
    this.getSettings = getSettings;
    this.telegramChatId = telegramChatId || "";
    this.log = log;
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

    const inserted = await this.pending.insertMany(valid);
    const created = inserted.length;

    // Solo se notifica cuando hay pagos realmente NUEVOS (no duplicados).
    if (created > 0) await this.notifyNewPayments(inserted);

    return { ok: true, scanned: res.scanned, detected: res.candidates.length, created };
  }

  /** Destino del admin: Ajustes primero, con respaldo al chat id del entorno. */
  async resolveChatId() {
    try {
      const settings = this.getSettings ? await this.getSettings.execute() : null;
      const fromSettings = String((settings && settings.telegramChatId) || "").replace(/\D/g, "");
      if (fromSettings) return fromSettings;
    } catch {
      // Ajustes no disponibles: se usa el respaldo del entorno.
    }
    return String(this.telegramChatId || "").replace(/\D/g, "");
  }

  /**
   * Envía a Telegram el aviso de pagos Nequi recién detectados. Nunca lanza:
   * un fallo de notificación no debe romper la sincronización de correos.
   */
  async notifyNewPayments(items) {
    if (!this.sendTelegram || !this.sendTelegram.enabled) return;
    try {
      const to = await this.resolveChatId();
      if (!to) return;

      const MAX = 10;
      const lines = items.slice(0, MAX).map(
        (p) => `• ${formatCOP(p.amount)} — ${p.from || "Nequi"} (${dmy(p.detectedDate)})`
      );
      if (items.length > MAX) lines.push(`…y ${items.length - MAX} más.`);

      const text = [
        `🏦 *Nequi* — ${items.length} pago(s) nuevo(s) por conciliar`,
        "",
        ...lines,
        "",
        "_Ábrelo en la app: Pagos → Nequi para conciliarlos._",
      ].join("\n");

      await this.sendTelegram.execute({ kind: "text", to, text });
    } catch (err) {
      this.log.error("[Nequi] No se pudo notificar por Telegram:", err?.message || err);
    }
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
