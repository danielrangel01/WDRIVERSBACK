import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { WhatsAppAgentUseCase } from "../src/application/use-cases/agent/index.js";
import { extractIncomingMessages } from "../src/interfaces/http/routes/whatsappWebhook.js";
import { buildDayCloseReport } from "../src/domain/services/DayCloseReport.js";
import { INTENT } from "../src/domain/services/AgentCommand.js";
import { createApp } from "../src/interfaces/http/app.js";
import { config } from "../src/infrastructure/config/index.js";

const ADMIN = "+57 300 111 2233";
const FROM = "573001112233";
const CAR_A = "a".repeat(24);
const CAR_B = "b".repeat(24);

const agendaFixture = () => ({
  date: "2026-11-23",
  summary: {
    coveredCount: 0, fleetTotal: 2, collectTodayAmount: 170000,
    pendingCarsCount: 2, fleetDebt: 170000, overdueCount: 0, overdueAmount: 0,
  },
  forecast: { probability: 40, status: "behind", target: 170000, collected: 0 },
  checklist: [
    { carId: CAR_A, plate: "ABC123", name: "Juan", debt: 90000, dailyTotal: 90000, rate: 90000, paidToday: 0, covered: false, offToday: false, driverName: "Juan" },
    { carId: CAR_B, plate: "XYZ789", name: "Pedro", debt: 80000, dailyTotal: 80000, rate: 80000, paidToday: 0, covered: false, offToday: false, driverName: "Pedro" },
  ],
  pendingCars: [
    { carId: CAR_A, plate: "ABC123", name: "Juan", debt: 90000, dailyTotal: 90000, rate: 90000, paidToday: 0, covered: false, offToday: false, driverName: "Juan" },
    { carId: CAR_B, plate: "XYZ789", name: "Pedro", debt: 80000, dailyTotal: 80000, rate: 80000, paidToday: 0, covered: false, offToday: false, driverName: "Pedro" },
  ],
  refinances: [], documents: [], nequiPending: [],
});

function makeSessionRepo() {
  const store = {};
  return {
    store,
    get: vi.fn(async (phone) => store[String(phone).replace(/\D/g, "")] || null),
    save: vi.fn(async (s) => { store[s.phone] = { ...s }; return s; }),
    clear: vi.fn(async (phone) => { delete store[String(phone).replace(/\D/g, "")]; return { ok: true }; }),
  };
}

function makeAgent(over = {}) {
  const sessionRepo = over.agentSessionRepository || makeSessionRepo();
  const deps = {
    getSettings: { execute: vi.fn().mockResolvedValue({ adminPhone: ADMIN }) },
    getAgenda: { execute: vi.fn().mockImplementation(() => Promise.resolve(over.agenda ? over.agenda() : agendaFixture())) },
    addPayment: { execute: vi.fn().mockResolvedValue({ id: "p1" }) },
    toggleOffDay: { execute: vi.fn().mockResolvedValue({ active: true }) },
    sendWhatsApp: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    agentSessionRepository: sessionRepo,
  };
  return { agent: new WhatsAppAgentUseCase(deps), deps, sessionRepo };
}

describe("🔘 Webhook — botones interactivos", () => {
  it("extrae respuestas de botón (interactive.button_reply)", () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [
              { from: FROM, id: "w1", type: "text", text: { body: "revisar" } },
              { from: FROM, id: "w2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: `pay:${CAR_A}`, title: "Ya pagó" } } },
              { from: FROM, id: "w3", type: "image" },
            ],
          },
        }],
      }],
    };
    const msgs = extractIncomingMessages(payload);
    expect(msgs).toEqual([
      { from: FROM, text: "revisar", messageId: "w1" },
      { from: FROM, action: `pay:${CAR_A}`, messageId: "w2" },
    ]);
  });

  it("extrae el payload de un botón de PLANTILLA (type: button)", () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [
              { from: FROM, id: "b1", type: "button", button: { text: "Revisar ahora", payload: "CHECKIN" } },
              { from: FROM, id: "b2", type: "button", button: { text: "Ver cierre" } },
            ],
          },
        }],
      }],
    };
    expect(extractIncomingMessages(payload)).toEqual([
      { from: FROM, action: "CHECKIN", messageId: "b1" },
      { from: FROM, action: "Ver cierre", messageId: "b2" },
    ]);
  });
});

describe("🔘 Botones de plantilla → acciones del agente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("'Revisar ahora' inicia el check-in", async () => {
    const { agent, deps } = makeAgent();
    const r = await agent.handleIncoming({ from: FROM, action: "CHECKIN" });
    expect(r.intent).toBe("button");
    expect(r.reply).toContain("Revisión paso a paso");
    expect(deps.sendWhatsApp.execute.mock.calls[0][0].kind).toBe("buttons");
  });

  it("'Ver cierre' (texto del botón) envía el cierre del día", async () => {
    const { agent } = makeAgent();
    const r = await agent.handleIncoming({ from: FROM, action: "Ver cierre" });
    expect(r.reply).toContain("Cierre del día");
  });

  it("'Ayuda' devuelve los comandos", async () => {
    const { agent } = makeAgent();
    const r = await agent.handleIncoming({ from: FROM, action: "Ayuda" });
    expect(r.reply).toContain("Asistente W Drivers");
  });
});

describe("📤 Fallback a plantilla fuera de la ventana de 24 h", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proactiveCheckin cae a la plantilla si no se pueden enviar botones", async () => {
    const { agent, deps } = makeAgent();
    // Primer envío (botones) falla por re-engagement; el segundo (plantilla) funciona.
    deps.sendWhatsApp.execute
      .mockRejectedValueOnce(Object.assign(new Error("re-engagement"), { code: 131047 }))
      .mockResolvedValueOnce({ ok: true });
    await agent.proactiveCheckin(FROM);
    const fallback = deps.sendWhatsApp.execute.mock.calls.at(-1)[0];
    expect(fallback.kind).toBe("template");
    expect(fallback.template.name).toBe("wdrivers_checkin_util");
    expect(fallback.template.components[0].parameters[0].text).toBe("2");
  });

  it("proactiveClose cae a la plantilla si el cierre no se puede enviar", async () => {
    const { agent, deps } = makeAgent();
    deps.sendWhatsApp.execute.mockRejectedValueOnce(Object.assign(new Error("fuera de ventana"), { code: 131047 }));
    await agent.proactiveClose(FROM);
    const fallback = deps.sendWhatsApp.execute.mock.calls.at(-1)[0];
    expect(fallback.kind).toBe("template");
  });

  it("proactiveClosePreviousDay usa la agenda de AYER y envía el cierre", async () => {
    const { agent, deps } = makeAgent();
    const r = await agent.proactiveClosePreviousDay(FROM, "whatsapp", "2026-11-22");
    expect(deps.getAgenda.execute).toHaveBeenCalledWith({ date: "2026-11-22" });
    expect(r.text).toContain("Cierre del día");
    expect(deps.sendWhatsApp.execute.mock.calls.at(-1)[0].kind).toBe("text");
  });
});

describe("📋 Check-in paso a paso", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inicia la revisión con botones y guarda la sesión", async () => {
    const { agent, deps, sessionRepo } = makeAgent();
    const r = await agent.handleIncoming({ from: FROM, text: "revisar" });
    expect(r.intent).toBe("checkin");
    expect(r.sent).toBe(true);
    expect(r.reply).toContain("Revisión paso a paso");
    expect(r.reply).toContain("ABC123");
    const call = deps.sendWhatsApp.execute.mock.calls[0][0];
    expect(call.kind).toBe("buttons");
    expect(call.buttons).toEqual([
      { id: `pay:${CAR_A}`, title: "Ya pagó" },
      { id: `off:${CAR_A}`, title: "En taller" },
      { id: `ok:${CAR_A}`, title: "Sin novedad" },
    ]);
    expect(sessionRepo.save).toHaveBeenCalled();
    expect(sessionRepo.store[FROM].queue).toEqual([CAR_A, CAR_B]);
    expect(sessionRepo.store[FROM].index).toBe(0);
  });

  it("avanza al siguiente carro al responder un botón", async () => {
    const { agent, deps } = makeAgent();
    await agent.handleIncoming({ from: FROM, text: "revisar" });
    const r = await agent.handleIncoming({ from: FROM, action: `pay:${CAR_A}` });
    expect(deps.addPayment.execute).toHaveBeenCalledWith(
      expect.objectContaining({ carId: CAR_A, date: "2026-11-23", amount: 90000 })
    );
    expect(r.reply).toContain("ABC123");
    expect(r.reply).toContain("2/2");
    expect(r.reply).toContain("XYZ789");
    expect(deps.sendWhatsApp.execute.mock.calls[1][0].kind).toBe("buttons");
  });

  it("al terminar la lista envía el cierre del día y limpia la sesión", async () => {
    const { agent, deps, sessionRepo } = makeAgent();
    await agent.handleIncoming({ from: FROM, text: "revisar" });
    await agent.handleIncoming({ from: FROM, action: `ok:${CAR_A}` });
    const r = await agent.handleIncoming({ from: FROM, action: `ok:${CAR_B}` });
    expect(r.reply).toContain("Cierre del día");
    expect(r.reply).toContain("Gestión");
    const last = deps.sendWhatsApp.execute.mock.calls.at(-1)[0];
    expect(last.kind).toBe("text");
    expect(sessionRepo.clear).toHaveBeenCalledWith(FROM);
  });

  it("interpreta texto libre como respuesta del carro actual", async () => {
    const { agent, deps } = makeAgent();
    await agent.handleIncoming({ from: FROM, text: "revisar" });
    await agent.handleIncoming({ from: FROM, text: "ya pagó" });
    expect(deps.addPayment.execute).toHaveBeenCalledWith(
      expect.objectContaining({ carId: CAR_A })
    );
  });

  it("acepta el botón 'en taller' y marca el día libre", async () => {
    const { agent, deps } = makeAgent();
    await agent.handleIncoming({ from: FROM, text: "revisar" });
    await agent.handleIncoming({ from: FROM, action: `off:${CAR_A}` });
    expect(deps.toggleOffDay.execute).toHaveBeenCalledWith(
      expect.objectContaining({ carId: CAR_A, date: "2026-11-23", reason: "taller" })
    );
  });

  it("sin sesión activa avisa que no hay revisión", async () => {
    const { agent } = makeAgent();
    const r = await agent.handleIncoming({ from: FROM, action: `pay:${CAR_A}` });
    expect(r.reply).toContain("No hay una revisión activa");
  });

  it("proactiveCheckin envía la revisión y proactiveClose el cierre", async () => {
    const { agent, deps } = makeAgent();
    await agent.proactiveCheckin(FROM);
    expect(deps.sendWhatsApp.execute.mock.calls[0][0].kind).toBe("buttons");
    const r = await agent.proactiveClose(FROM);
    expect(r.text).toContain("Cierre del día");
    expect(deps.sendWhatsApp.execute.mock.calls.at(-1)[0].kind).toBe("text");
  });
});

describe("🔔 Insistencia de media tarde (nagCheckin)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reenvía la plantilla de check-in cuando el admin no respondió", async () => {
    const { agent, deps, sessionRepo } = makeAgent();
    // El check-in del mediodía quedó sin responder (index 0, sin respuestas).
    sessionRepo.save({ phone: FROM, date: "2026-11-23", queue: [CAR_A, CAR_B], index: 0, answers: [], status: "active" });
    const sent = await agent.nagCheckin(FROM);
    expect(sent).toBe(true);
    const call = deps.sendWhatsApp.execute.mock.calls.at(-1)[0];
    expect(call.kind).toBe("template");
    expect(call.template.name).toBe("wdrivers_checkin_util");
  });

  it("no molesta si el admin ya avanzó la revisión", async () => {
    const { agent, deps, sessionRepo } = makeAgent();
    sessionRepo.save({ phone: FROM, date: "2026-11-23", queue: [CAR_A, CAR_B], index: 1, answers: [{ carId: CAR_A, action: "pay" }], status: "active" });
    const sent = await agent.nagCheckin(FROM);
    expect(sent).toBe(false);
    expect(deps.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it("no insiste si ya no quedan carros pendientes", async () => {
    const base = agendaFixture();
    const { agent, deps } = makeAgent({ agenda: () => ({ ...base, pendingCars: [] }) });
    const sent = await agent.nagCheckin(FROM);
    expect(sent).toBe(false);
    expect(deps.sendWhatsApp.execute).not.toHaveBeenCalled();
  });
});

describe("🌙 Cierre del día (reporte)", () => {
  it("arma el texto del cierre a partir de la agenda", () => {
    const text = buildDayCloseReport(agendaFixture());
    expect(text).toContain("Cierre del día");
    expect(text).toContain("23/11/2026");
    expect(text).toContain("Gestión: *0/2*");
    expect(text).toContain("Sin gestionar");
    expect(text).toContain("ABC123");
    expect(text).toContain("W Drivers");
  });

  it("ignora agendas vacías sin romper", () => {
    expect(() => buildDayCloseReport({ date: "2026-11-23" })).not.toThrow();
  });
});

describe("🗂️ Cierres pendientes (opción del menú)", () => {
  const TODAY = "2026-11-23";
  const item = (id, plate, debt) => ({
    carId: id, plate, name: plate, debt, dailyTotal: debt, rate: debt,
    paidToday: 0, covered: false, offToday: false, driverName: "",
  });
  const agendaOn = (date, pending = []) => ({
    date,
    summary: {
      coveredCount: 0, fleetTotal: pending.length,
      collectTodayAmount: pending.reduce((s, c) => s + c.debt, 0),
      pendingCarsCount: pending.length, fleetDebt: 0,
    },
    forecast: null, checklist: pending, pendingCars: pending,
    refinances: [], documents: [], nequiPending: [],
  });

  function makeClosuresAgent(byDate) {
    const sessionRepo = makeSessionRepo();
    const deps = {
      getSettings: { execute: vi.fn().mockResolvedValue({ adminPhone: ADMIN }) },
      getAgenda: { execute: vi.fn(async ({ date } = {}) => byDate[date || TODAY] || agendaOn(date || TODAY, [])) },
      addPayment: { execute: vi.fn().mockResolvedValue({ id: "p1" }) },
      toggleOffDay: { execute: vi.fn().mockResolvedValue({ active: true }) },
      sendWhatsApp: { execute: vi.fn().mockResolvedValue({ ok: true }) },
      agentSessionRepository: sessionRepo,
    };
    return { agent: new WhatsAppAgentUseCase({ ...deps, closureLookbackDays: 30 }), deps, sessionRepo };
  }

  beforeEach(() => vi.clearAllMocks());

  it("'cierres' lista los días recientes con carros sin gestionar", async () => {
    const { agent } = makeClosuresAgent({
      [TODAY]: agendaOn(TODAY, []),
      "2026-11-22": agendaOn("2026-11-22", [item(CAR_A, "ABC123", 90000)]),
      "2026-11-20": agendaOn("2026-11-20", [item(CAR_A, "ABC123", 90000), item(CAR_B, "XYZ789", 80000)]),
    });
    const r = await agent.handleIncoming({ from: FROM, text: "cierres" });
    expect(r.intent).toBe(INTENT.CLOSURES);
    expect(r.reply).toContain("Cierres pendientes");
    expect(r.reply).toContain("22/11/2026");
    expect(r.reply).toContain("20/11/2026");
    expect(r.reply).not.toContain("21/11/2026"); // ese día quedó completo
  });

  it("elegir un día arranca su revisión y registra el pago en ESA fecha", async () => {
    const { agent, deps } = makeClosuresAgent({
      [TODAY]: agendaOn(TODAY, []),
      "2026-11-22": agendaOn("2026-11-22", [item(CAR_A, "ABC123", 90000)]),
    });
    await agent.handleIncoming({ from: FROM, text: "cierres" });
    const sel = await agent.handleIncoming({ from: FROM, text: "1" });
    expect(sel.reply).toContain("Revisión paso a paso");
    expect(sel.reply).toContain("22/11/2026");
    await agent.handleIncoming({ from: FROM, text: "ya pagó" });
    expect(deps.addPayment.execute).toHaveBeenCalledWith(
      expect.objectContaining({ carId: CAR_A, date: "2026-11-22" })
    );
  });

  it("avisa cuando no hay cierres pendientes", async () => {
    const { agent } = makeClosuresAgent({ [TODAY]: agendaOn(TODAY, []) });
    const r = await agent.handleIncoming({ from: FROM, text: "cierres" });
    expect(r.reply).toContain("No hay cierres pendientes");
  });
});

describe("🔗 Webhook montado en la app real (regresión mongoSanitize)", () => {
  it("verifica hub.mode (no se corrompe a hub_mode) y exige firma válida", async () => {
    // Forzamos valores conocidos: el router los lee en tiempo de petición.
    config.notifications.whatsappVerifyToken = "test_verify_token_123";
    config.notifications.whatsappAppSecret = "test_secret_abc";

    const app = createApp();
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const ok = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token_123&hub.challenge=CH123`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("CH123");

      const bad = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x`);
      expect(bad.status).toBe(403);

      const raw = JSON.stringify({ entry: [] });
      const noSig = await fetch(`${base}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
        body: raw,
      });
      expect(noSig.status).toBe(401);

      const good = "sha256=" + crypto.createHmac("sha256", "test_secret_abc").update(Buffer.from(raw)).digest("hex");
      const withSig = await fetch(`${base}/api/whatsapp/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": good },
        body: raw,
      });
      expect(withSig.status).toBe(200);
      expect(await withSig.json()).toEqual({ ok: true });
    } finally {
      server.close();
    }
  });
});
