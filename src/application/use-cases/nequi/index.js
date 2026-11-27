import { PendingPayment } from "../../../domain/entities/index.js";
import { formatCOP, payerLabel } from "../../../domain/services/AgentCommand.js";
import { NotFoundError, ValidationError, ConflictError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 500;

// dd/mm/aaaa a partir de "aaaa-mm-dd".
const dmy = (iso) => {
  const [y, m, d] = String(iso || "").split("-");
  return d ? `${d}/${m}/${y}` : String(iso || "");
};

// Fecha y hora del pago ("dd/mm/aaaa 6:56 p.m."), omitiendo la hora si no vino.
const when = (p) => `${dmy(p.detectedDate)}${p.detectedTime ? ` ${p.detectedTime}` : ""}`;

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
          payerName: c.payerName,
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
   * Envía a Telegram el aviso de pagos Nequi recién detectados, con el nombre de
   * quien pagó y botones para conciliar/descartar sin abrir la app. Nunca lanza:
   * un fallo de notificación no debe romper la sincronización de correos.
   */
  async notifyNewPayments(items) {
    if (!this.sendTelegram || !this.sendTelegram.enabled) return;
    try {
      const to = await this.resolveChatId();
      if (!to) return;

      const MAX_LINES = 10;
      const MAX_BUTTONS = 8;
      const lines = items.slice(0, MAX_LINES)
        .map((p) => `• *${formatCOP(p.amount)}* — ${payerLabel(p)} · ${when(p)}`);
      if (items.length > MAX_LINES) lines.push(`…y ${items.length - MAX_LINES} más.`);

      const text = [
        `🏦 *Nequi* — ${items.length} pago(s) nuevo(s) por asignar`,
        "",
        ...lines,
        "",
        "Toca *Gestionar* para asignarlo a un carro y elegir el día, o 🚫 para descartarlo.",
      ].join("\n");

      // Un renglón por pago: [Gestionar] / 🚫 descartar.
      const buttons = items.slice(0, MAX_BUTTONS)
        .filter((p) => p.id)
        .map((p) => ({
          row: [
            { id: `nq:ok:${p.id}`, title: "Gestionar" },
            { id: `nq:no:${p.id}`, title: "🚫" },
          ],
        }));

      if (buttons.length) {
        await this.sendTelegram.execute({ kind: "buttons", to, text, buttons });
      } else {
        await this.sendTelegram.execute({ kind: "text", to, text });
      }
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
// Un mismo pago Nequi puede cubrir varias tarifas (días), por eso acepta
// `allocations: [{ date, amount }]` (un registro de pago por día). Si no se
// envían, se registra un único pago con el monto total y la fecha indicada.
export class ApprovePendingPaymentUseCase {
  constructor({ pendingPaymentRepository, addPaymentUseCase }) {
    this.pending = pendingPaymentRepository;
    this.addPayment = addPaymentUseCase;
  }
  async execute({ id, carId, date, note, allocations }) {
    if (!validOid(id)) throw new ValidationError("Pago pendiente inválido");

    const pending = await this.pending.findById(id);
    if (!pending) throw new NotFoundError("El pago pendiente no existe");
    if (pending.status !== "pending") throw new ConflictError("Este pago ya fue procesado");

    const finalNote = (typeof note === "string" && note.trim())
      ? note.trim().slice(0, MAX_NOTE)
      : `Nequi · ${payerLabel(pending)}`.slice(0, MAX_NOTE);

    const list = (Array.isArray(allocations) && allocations.length)
      ? allocations
      : [{ date, amount: pending.amount }];

    const payments = [];
    for (const a of list) {
      if (!DATE_RE.test(String((a && a.date) || ""))) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
      const amount = Math.round(Number(a && a.amount));
      if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError("Monto inválido en la asignación");
      payments.push(await this.addPayment.execute({ carId, date: a.date, amount, note: finalNote }));
    }

    pending.status = "approved";
    pending.approvedPaymentId = payments[0].id;
    await this.pending.update(pending);

    return {
      ok: true,
      payment: payments.length === 1 ? payments[0].toJSON() : undefined,
      payments: payments.map((p) => p.toJSON()),
      pending: pending.toJSON(),
    };
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
