import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCommand, parseMoney, parseIndex, parsePlateToken, normalizeText, normalizePlate,
  formatCOP, samePhone, INTENT,
} from "../src/domain/services/AgentCommand.js";
import { WhatsAppAgentUseCase } from "../src/application/use-cases/agent/index.js";
import { verifySignature, extractIncomingMessages } from "../src/interfaces/http/routes/whatsappWebhook.js";
import crypto from "crypto";

const ADMIN = "+57 300 111 2233";
const CAR_A = "a".repeat(24);
const CAR_B = "b".repeat(24);

const agendaFixture = () => ({
  date: "2026-11-23",
  summary: {
    coveredCount: 6, fleetTotal: 12, collectTodayAmount: 1200000,
    pendingCarsCount: 6, nequiPendingCount: 0, nequiPendingAmount: 0,
  },
  forecast: { probability: 62, status: "on_track", target: 1200000, collected: 744000 },
  checklist: [
    { carId: CAR_A, plate: "ABC123", name: "Juan", debt: 90000, dailyTotal: 90000, rate: 90000, paidToday: 0, covered: false, offToday: false, driverName: "Juan" },
    { carId: CAR_B, plate: "XYZ789", name: "Pedro", debt: 0, dailyTotal: 80000, rate: 80000, paidToday: 80000, covered: true, offToday: false, driverName: "Pedro" },
  ],
  pendingCars: [
    { carId: CAR_A, plate: "ABC123", name: "Juan", debt: 90000, dailyTotal: 90000, rate: 90000, paidToday: 0, covered: false, offToday: false, driverName: "Juan" },
  ],
});

function makeAgent(over = {}) {
  const deps = {
    getSettings: { execute: vi.fn().mockResolvedValue({ adminPhone: ADMIN }) },
    getAgenda: { execute: vi.fn().mockImplementation(() => Promise.resolve(agendaFixture())) },
    addPayment: { execute: vi.fn().mockResolvedValue({ id: "p1" }) },
    toggleOffDay: { execute: vi.fn().mockResolvedValue({ active: true }) },
    sendWhatsApp: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    ...over,
  };
  return { agent: new WhatsAppAgentUseCase(deps), deps };
}

describe("🧩 AgentCommand (parser determinista)", () => {
  it("normaliza acentos y espacios", () => {
    expect(normalizeText("  ABC123  Pagó  ")).toBe("abc123 pago");
    expect(normalizePlate("abc-123")).toBe("ABC123");
  });

  it("parseMoney reconoce formatos colombianos", () => {
    expect(parseMoney("90000")).toBe(90000);
    expect(parseMoney("$90.000")).toBe(90000);
    expect(parseMoney("90,000")).toBe(90000);
    expect(parseMoney("90k")).toBe(90000);
    expect(parseMoney("1")).toBeNull();       // es índice
    expect(parseMoney("abc123")).toBeNull();
  });

  it("parseIndex acepta enteros cortos ≥1", () => {
    expect(parseIndex("3")).toBe(3);
    expect(parseIndex("0")).toBeNull();
    expect(parseIndex("999")).toBeNull();
  });

  it("parsePlateToken exige letras y dígitos", () => {
    expect(parsePlateToken("abc-123")).toBe("ABC123");
    expect(parsePlateToken("pago")).toBeNull();
    expect(parsePlateToken("123")).toBeNull();
  });

  it("formatCOP y samePhone", () => {
    expect(formatCOP(90000)).toBe("$90.000");
    expect(formatCOP(1234567)).toBe("$1.234.567");
    expect(samePhone("573001112233", "+57 300 111 2233")).toBe(true);
    expect(samePhone("573001112233", "573009999999")).toBe(false);
  });

  it("detecta intenciones y referencias", () => {
    const p = parseCommand("ABC123 pagó 90.000");
    expect(p.intent).toBe(INTENT.PAYMENT);
    expect(p.amount).toBe(90000);
    expect(p.refs).toEqual([{ kind: "plate", value: "ABC123" }]);

    const i = parseCommand("3 ya pagó");
    expect(i.intent).toBe(INTENT.PAYMENT);
    expect(i.refs).toEqual([{ kind: "index", value: 3 }]);

    const o = parseCommand("XYZ789 taller");
    expect(o.intent).toBe(INTENT.OFFDAY);
    expect(o.reason).toBe("taller");

    expect(parseCommand("estado").intent).toBe(INTENT.STATUS);
    expect(parseCommand("quien falta").intent).toBe(INTENT.PENDING);
    expect(parseCommand("ayuda").intent).toBe(INTENT.HELP);
    // "cierres" (plural) = cierres pendientes; "cierre" (singular) = cierre del día.
    expect(parseCommand("cierres").intent).toBe(INTENT.CLOSURES);
    expect(parseCommand("cierres pendientes").intent).toBe(INTENT.CLOSURES);
    expect(parseCommand("cierre").intent).toBe(INTENT.CLOSE);

    const noCar = parseCommand("ese carro ya pagó");
    expect(noCar.intent).toBe(INTENT.PAYMENT);
    expect(noCar.refs).toEqual([]);
  });
});

describe("🤖 WhatsAppAgentUseCase (determinista)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignora remitentes que no son el administrador", async () => {
    const { agent, deps } = makeAgent();
    const r = await agent.handleIncoming({ from: "573009999999", text: "estado" });
    expect(r.handled).toBe(false);
    expect(r.reason).toBe("unauthorized");
    expect(deps.sendWhatsApp.execute).not.toHaveBeenCalled();
    expect(deps.addPayment.execute).not.toHaveBeenCalled();
  });

  it("registra un pago por placa", async () => {
    const { agent, deps } = makeAgent();
    const r = await agent.handleIncoming({ from: "573001112233", text: "ABC123 pagó 90.000" });
    expect(deps.addPayment.execute).toHaveBeenCalledWith(
      expect.objectContaining({ carId: CAR_A, date: "2026-11-23", amount: 90000 })
    );
    expect(deps.sendWhatsApp.execute).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text", to: "573001112233" })
    );
    expect(r.sent).toBe(true);
    expect(r.intent).toBe(INTENT.PAYMENT);
    expect(r.reply).toContain("ABC123");
  });

  it("registra un pago por número usando la cuota diaria si no hay monto", async () => {
    const { agent, deps } = makeAgent();
    await agent.handleIncoming({ from: "573001112233", text: "1 ya pagó" });
    expect(deps.addPayment.execute).toHaveBeenCalledWith(
      expect.objectContaining({ carId: CAR_A, amount: 90000 })
    );
  });

  it("marca el día libre (taller) por placa", async () => {
    const { agent, deps } = makeAgent();
    await agent.handleIncoming({ from: "573001112233", text: "ABC123 en taller" });
    expect(deps.toggleOffDay.execute).toHaveBeenCalledWith(
      expect.objectContaining({ carId: CAR_A, date: "2026-11-23", reason: "taller" })
    );
  });

  it("pide el carro cuando el pago no lo especifica", async () => {
    const { agent, deps } = makeAgent();
    const r = await agent.handleIncoming({ from: "573001112233", text: "ya pagó" });
    expect(deps.addPayment.execute).not.toHaveBeenCalled();
    expect(r.reply).toContain("¿Para qué carro");
  });

  it("devuelve el estado del día con la predicción", async () => {
    const { agent } = makeAgent();
    const r = await agent.handleIncoming({ from: "573001112233", text: "estado" });
    expect(r.reply).toContain("Estado del día");
    expect(r.reply).toContain("62%");
  });

  it("lista los pendientes numerados", async () => {
    const { agent } = makeAgent();
    const r = await agent.handleIncoming({ from: "573001112233", text: "pendientes" });
    expect(r.reply).toContain("1. *ABC123*");
  });

  it("devuelve la ayuda", async () => {
    const { agent } = makeAgent();
    const r = await agent.handleIncoming({ from: "573001112233", text: "ayuda" });
    expect(r.reply).toContain("Asistente W Drivers");
  });
});

describe("🔐 Webhook de WhatsApp", () => {
  it("verifySignature valida el HMAC y lo rechaza si no coincide", () => {
    const secret = "s3cr3t";
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const good = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, good, secret)).toBe(true);
    expect(verifySignature(body, "sha256=deadbeef", secret)).toBe(false);
    expect(verifySignature(body, good, "")).toBe(true); // sin secreto no verifica
  });

  it("extractIncomingMessages obtiene solo los textos", () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [
              { from: "573001112233", id: "w1", type: "text", text: { body: "estado" } },
              { from: "573001112233", id: "w2", type: "image" },
            ],
          },
        }],
      }],
    };
    const msgs = extractIncomingMessages(payload);
    expect(msgs).toEqual([{ from: "573001112233", text: "estado", messageId: "w1" }]);
  });
});
