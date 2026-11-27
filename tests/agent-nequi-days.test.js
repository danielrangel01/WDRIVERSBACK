import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppAgentUseCase } from "../src/application/use-cases/agent/index.js";

// Chat id del admin en Telegram (destino del aviso Nequi).
const TG = "7911560495";
const KEY = `tg:${TG}`;
const CAR_A = "a".repeat(24);
const CAR_B = "b".repeat(24);
const PENDING_ID = "f".repeat(24);
const TODAY = "2026-11-23";

const agendaFixture = () => ({
  date: TODAY,
  summary: {
    coveredCount: 0, fleetTotal: 2, collectTodayAmount: 170000,
    pendingCarsCount: 2, fleetDebt: 170000, overdueCount: 0, overdueAmount: 0,
  },
  forecast: { probability: 40, status: "behind", target: 170000, collected: 0 },
  checklist: [
    { carId: CAR_A, plate: "ABC123", name: "Juan", debt: 90000, dailyTotal: 90000, rate: 90000, paidToday: 0, covered: false, offToday: false, driverName: "Juan" },
    { carId: CAR_B, plate: "XYZ789", name: "Pedro", debt: 80000, dailyTotal: 80000, rate: 80000, paidToday: 0, covered: false, offToday: false, driverName: "Pedro" },
  ],
  pendingCars: [],
  refinances: [], documents: [], nequiPending: [],
});

// Repositorio de sesiones que indexa por la clave TAL CUAL (incluye el prefijo
// de canal "tg:"), sin recortar dígitos.
function makeSessionRepo() {
  const store = {};
  return {
    store,
    get: vi.fn(async (phone) => store[phone] || null),
    save: vi.fn(async (s) => { store[s.phone] = { ...s }; return s; }),
    clear: vi.fn(async (phone) => { delete store[phone]; return { ok: true }; }),
  };
}

// Tres días pendientes de $90.000, del más antiguo al más reciente.
const pendingDays = () => ([
  { date: "2026-11-15", remaining: 90000, amount: 90000, partial: false },
  { date: "2026-11-16", remaining: 90000, amount: 90000, partial: false },
  { date: "2026-11-17", remaining: 90000, amount: 90000, partial: false },
]);

function makeAgent({ amount = 80000, detectedDate = "2026-11-20", detectedTime = "", days = pendingDays() } = {}) {
  const pending = {
    id: PENDING_ID, amount, detectedDate, detectedTime, from: "JUAN", payerName: "JUAN", status: "pending",
  };
  const sessionRepo = makeSessionRepo();
  const deps = {
    getSettings: { execute: vi.fn().mockResolvedValue({ telegramChatId: TG }) },
    getAgenda: { execute: vi.fn().mockResolvedValue(agendaFixture()) },
    addPayment: { execute: vi.fn().mockResolvedValue({ id: "p1" }) },
    toggleOffDay: { execute: vi.fn().mockResolvedValue({ active: true }) },
    sendWhatsApp: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    sendTelegram: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    agentSessionRepository: sessionRepo,
    listPendingPayments: { execute: vi.fn().mockResolvedValue([pending]) },
    approvePendingPayment: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    dismissPendingPayment: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    getCarDebtDetail: { execute: vi.fn().mockResolvedValue({ days, rate: 90000 }) },
  };
  return { agent: new WhatsAppAgentUseCase(deps), deps, sessionRepo, pending };
}

// Abre la conciliación (botón "Gestionar") y elige el carro #1 (ABC123).
async function openAndPickCar(agent) {
  const opened = await agent.handleIncoming({ from: TG, action: `nq:ok:${PENDING_ID}`, channel: "telegram" });
  const picked = await agent.handleIncoming({ from: TG, text: "1", channel: "telegram" });
  return { opened, picked };
}

describe("🏦 Nequi — botón 'Gestionar' → carro → días", () => {
  beforeEach(() => vi.clearAllMocks());

  it("el botón abre la conciliación y pregunta el carro", async () => {
    const { agent } = makeAgent();
    const r = await agent.handleIncoming({ from: TG, action: `nq:ok:${PENDING_ID}`, channel: "telegram" });
    expect(r.reply).toContain("¿A qué carro lo asigno?");
    expect(r.reply).toContain("ABC123");
  });

  it("muestra la hora en que llegó el pago cuando el correo la trae", async () => {
    const { agent } = makeAgent({ detectedTime: "6:56 p.m." });
    const r = await agent.handleIncoming({ from: TG, action: `nq:ok:${PENDING_ID}`, channel: "telegram" });
    expect(r.reply).toContain("Fecha: 20/11/2026 6:56 p.m.");
  });

  it("tras elegir el carro lista los días pendientes y estima la cobertura", async () => {
    const { agent } = makeAgent({ amount: 80000 });
    const { picked } = await openAndPickCar(agent);
    expect(picked.reply).toContain("Días pendientes");
    expect(picked.reply).toContain("15/11/2026");
    // $80.000 alcanza para 1 tarifa (la más antigua), parcial.
    expect(picked.reply).toContain("cubre ~*1*");
  });

  it("registra el pago en el día elegido (fecha = día pendiente)", async () => {
    const { agent, deps } = makeAgent({ amount: 80000 });
    await openAndPickCar(agent);
    const r = await agent.handleIncoming({ from: TG, text: "1", channel: "telegram" });
    expect(deps.approvePendingPayment.execute).toHaveBeenCalledWith({
      id: PENDING_ID,
      carId: CAR_A,
      allocations: [{ date: "2026-11-15", amount: 80000 }],
    });
    expect(r.reply).toContain("15/11/2026");
    expect(r.reply).toContain("ABC123");
  });

  it("un pago que cubre varias tarifas registra un pago por día", async () => {
    const { agent, deps } = makeAgent({ amount: 170000 });
    await openAndPickCar(agent);
    const r = await agent.handleIncoming({ from: TG, text: "1,2", channel: "telegram" });
    expect(deps.approvePendingPayment.execute).toHaveBeenCalledWith({
      id: PENDING_ID,
      carId: CAR_A,
      allocations: [
        { date: "2026-11-15", amount: 90000 },
        { date: "2026-11-16", amount: 80000 },
      ],
    });
    expect(r.reply).toContain("15/11/2026");
    expect(r.reply).toContain("16/11/2026");
  });

  it("'ok' usa los días sugeridos (más antiguos primero)", async () => {
    const { agent, deps } = makeAgent({ amount: 170000 });
    await openAndPickCar(agent);
    await agent.handleIncoming({ from: TG, text: "ok", channel: "telegram" });
    const arg = deps.approvePendingPayment.execute.mock.calls[0][0];
    expect(arg.allocations.map((a) => a.date)).toEqual(["2026-11-15", "2026-11-16"]);
  });

  it("el sobrante se aplica al siguiente día pendiente", async () => {
    const { agent, deps } = makeAgent({ amount: 100000 });
    await openAndPickCar(agent);
    await agent.handleIncoming({ from: TG, text: "1", channel: "telegram" });
    const arg = deps.approvePendingPayment.execute.mock.calls[0][0];
    expect(arg.allocations).toEqual([
      { date: "2026-11-15", amount: 90000 },
      { date: "2026-11-16", amount: 10000 },
    ]);
  });

  it("un carro al día se registra con la fecha detectada (sin elegir días)", async () => {
    const { agent, deps } = makeAgent({ amount: 80000, days: [] });
    await openAndPickCar(agent);
    expect(deps.approvePendingPayment.execute).toHaveBeenCalledWith({
      id: PENDING_ID,
      carId: CAR_A,
      allocations: [{ date: "2026-11-20", amount: 80000 }],
    });
  });

  it("un texto no numérico durante la selección re-pregunta los días", async () => {
    const { agent, deps } = makeAgent({ amount: 80000 });
    await openAndPickCar(agent);
    const r = await agent.handleIncoming({ from: TG, text: "asdf", channel: "telegram" });
    expect(r.reply).toContain("¿A qué días");
    expect(deps.approvePendingPayment.execute).not.toHaveBeenCalled();
  });

  it("un comando global durante la selección NO secuestra el flujo", async () => {
    const { agent, deps } = makeAgent({ amount: 80000 });
    await openAndPickCar(agent);
    const r = await agent.handleIncoming({ from: TG, text: "estado", channel: "telegram" });
    expect(r.reply).not.toContain("¿A qué días");
    expect(deps.approvePendingPayment.execute).not.toHaveBeenCalled();
  });

  it("limpia la sesión al conciliar", async () => {
    const { agent, sessionRepo } = makeAgent({ amount: 80000 });
    await openAndPickCar(agent);
    await agent.handleIncoming({ from: TG, text: "1", channel: "telegram" });
    expect(sessionRepo.clear).toHaveBeenCalledWith(KEY);
  });
});
