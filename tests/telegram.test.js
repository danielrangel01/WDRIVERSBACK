import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramNotifier } from "../src/infrastructure/notify/TelegramNotifier.js";
import { SendTelegramUseCase } from "../src/application/use-cases/telegram/index.js";
import { WhatsAppAgentUseCase } from "../src/application/use-cases/agent/index.js";
import { extractTelegramUpdates } from "../src/interfaces/http/routes/telegramWebhook.js";
import { createApp } from "../src/interfaces/http/app.js";
import { config } from "../src/infrastructure/config/index.js";

const CHAT = "998877";
const CAR_A = "a".repeat(24);
const CAR_B = "b".repeat(24);

const agendaFixture = () => ({
  date: "2026-11-23",
  summary: { coveredCount: 0, fleetTotal: 2, collectTodayAmount: 170000, pendingCarsCount: 2, fleetDebt: 170000 },
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
    get: vi.fn(async (k) => store[k] || null),
    save: vi.fn(async (s) => { store[s.phone] = { ...s }; return s; }),
    clear: vi.fn(async (k) => { delete store[k]; return { ok: true }; }),
  };
}

function makeTelegramAgent(over = {}) {
  const sessionRepo = over.agentSessionRepository || makeSessionRepo();
  const deps = {
    getSettings: { execute: vi.fn().mockResolvedValue({ adminPhone: "", telegramChatId: CHAT }) },
    getAgenda: { execute: vi.fn().mockImplementation(() => Promise.resolve(over.agenda ? over.agenda() : agendaFixture())) },
    addPayment: { execute: vi.fn().mockResolvedValue({ id: "p1" }) },
    toggleOffDay: { execute: vi.fn().mockResolvedValue({ active: true }) },
    sendWhatsApp: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    sendTelegram: { execute: vi.fn().mockResolvedValue({ ok: true }) },
    agentSessionRepository: sessionRepo,
  };
  return { agent: new WhatsAppAgentUseCase(deps), deps, sessionRepo };
}

// ── TelegramNotifier (Bot API) ─────────────────────────────────────────────
describe("🤖 TelegramNotifier", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envía texto con parse_mode Markdown al endpoint del bot", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    }));
    const n = new TelegramNotifier({ token: "TOKEN" });
    await n.sendText({ to: CHAT, text: "hola *mundo*" });
    expect(calls[0].url).toContain("/botTOKEN/sendMessage");
    expect(calls[0].body).toEqual({ chat_id: CHAT, text: "hola *mundo*", parse_mode: "Markdown" });
  });

  it("reintenta sin parse_mode si Telegram rechaza el markup (400)", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      if (calls.length === 1) {
        return { ok: false, status: 400, json: async () => ({ ok: false, description: "can't parse entities" }) };
      }
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    }));
    const n = new TelegramNotifier({ token: "TOKEN" });
    const res = await n.sendText({ to: CHAT, text: "texto _raro" });
    expect(res.ok).toBe(true);
    expect(calls[0].parse_mode).toBe("Markdown");
    expect(calls[1].parse_mode).toBeUndefined();
  });

  it("construye botones inline y añade el footer en cursiva", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    }));
    const n = new TelegramNotifier({ token: "TOKEN" });
    await n.sendButtons({
      to: CHAT,
      text: "¿Ya pagó?",
      buttons: [{ id: `pay:${CAR_A}`, title: "Ya pagó" }, { id: `ok:${CAR_A}`, title: "Sin novedad" }],
      footer: "También puedes escribir.",
    });
    const body = calls[0];
    expect(body.reply_markup.inline_keyboard).toEqual([
      [{ text: "Ya pagó", callback_data: `pay:${CAR_A}` }],
      [{ text: "Sin novedad", callback_data: `ok:${CAR_A}` }],
    ]);
    expect(body.text).toContain("_También puedes escribir._");
  });

  it("queda deshabilitado sin token (no llama a la API)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const n = new TelegramNotifier({});
    const res = await n.sendText({ to: CHAT, text: "x" });
    expect(n.enabled).toBe(false);
    expect(res.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── SendTelegramUseCase ────────────────────────────────────────────────────
describe("📤 SendTelegramUseCase", () => {
  it("envía un mensaje de prueba por defecto", async () => {
    const execute = vi.fn(async (a) => a);
    const uc = new SendTelegramUseCase({ telegramNotifier: { enabled: true, sendText: execute } });
    const r = await uc.execute({ kind: "test", to: CHAT });
    expect(r.kind).toBe("test");
    expect(execute.mock.calls[0][0].text).toContain("W Drivers");
  });

  it("envía botones cuando se pasan", async () => {
    const sendButtons = vi.fn(async (a) => a);
    const uc = new SendTelegramUseCase({ telegramNotifier: { enabled: true, sendButtons } });
    await uc.execute({ kind: "buttons", to: CHAT, text: "hola", buttons: [{ id: "CHECKIN", title: "Revisar" }] });
    expect(sendButtons).toHaveBeenCalledTimes(1);
    expect(sendButtons.mock.calls[0][0].to).toBe(CHAT);
  });

  it("exige que Telegram esté configurado", async () => {
    const uc = new SendTelegramUseCase({ telegramNotifier: { enabled: false } });
    await expect(uc.execute({ to: CHAT, text: "x" })).rejects.toThrow(/Telegram no está configurado/);
  });
});

// ── Agente con canal telegram ──────────────────────────────────────────────
describe("🤖 Agente por canal Telegram", () => {
  beforeEach(() => vi.clearAllMocks());

  it("autoriza por chat id y responde por Telegram (no por WhatsApp)", async () => {
    const { agent, deps, sessionRepo } = makeTelegramAgent();
    const r = await agent.handleIncoming({ from: CHAT, text: "revisar", channel: "telegram" });
    expect(r.handled).toBe(true);
    expect(r.channel).toBe("telegram");
    expect(r.sent).toBe(true);
    expect(deps.sendTelegram.execute).toHaveBeenCalled();
    expect(deps.sendWhatsApp.execute).not.toHaveBeenCalled();
    expect(deps.sendTelegram.execute.mock.calls[0][0].kind).toBe("buttons");
    expect(sessionRepo.store[`tg:${CHAT}`].queue).toEqual([CAR_A, CAR_B]);
  });

  it("rechaza un chat no autorizado", async () => {
    const { agent, deps } = makeTelegramAgent();
    const r = await agent.handleIncoming({ from: "555", text: "estado", channel: "telegram" });
    expect(r.handled).toBe(false);
    expect(r.reason).toBe("unauthorized");
    expect(deps.sendTelegram.execute).not.toHaveBeenCalled();
  });

  it("proactiveCheckin envía botones inline y guarda la sesión con prefijo tg:", async () => {
    const { agent, deps, sessionRepo } = makeTelegramAgent();
    await agent.proactiveCheckin(CHAT, "telegram");
    expect(deps.sendTelegram.execute.mock.calls[0][0].kind).toBe("buttons");
    expect(sessionRepo.store[`tg:${CHAT}`]).toBeTruthy();
    expect(deps.sendWhatsApp.execute).not.toHaveBeenCalled();
  });

  it("insistPreviousDay reenvía con botones si la gestión de ayer no avanzó", async () => {
    const { agent, deps, sessionRepo } = makeTelegramAgent();
    sessionRepo.save({ phone: `tg:${CHAT}`, date: "2026-11-22", queue: [CAR_A, CAR_B], index: 0, answers: [], status: "active" });
    const sent = await agent.insistPreviousDay(CHAT, "telegram", "2026-11-23", 1);
    expect(sent).toBe(true);
    const call = deps.sendTelegram.execute.mock.calls.at(-1)[0];
    expect(call.kind).toBe("buttons");
    expect(call.text).toContain("Recordatorio");
    expect(call.buttons.map((b) => b.id)).toContain(`pay:${CAR_A}`);
  });

  it("sendCheckinTemplate usa un mensaje con botones (no plantillas)", async () => {
    const { agent, deps } = makeTelegramAgent();
    await agent.sendCheckinTemplate(CHAT, "telegram");
    const call = deps.sendTelegram.execute.mock.calls.at(-1)[0];
    expect(call.kind).toBe("buttons");
    expect(call.text).toContain("vehículo(s)");
  });

  it("proactiveClose envía el cierre y limpia la sesión", async () => {
    const { agent, deps, sessionRepo } = makeTelegramAgent();
    sessionRepo.save({ phone: `tg:${CHAT}`, date: "2026-11-23", queue: [CAR_A], index: 0, answers: [], status: "active" });
    const r = await agent.proactiveClose(CHAT, "telegram");
    expect(r.text).toContain("Cierre del día");
    expect(deps.sendTelegram.execute.mock.calls.at(-1)[0].kind).toBe("buttons");
    expect(sessionRepo.clear).toHaveBeenCalledWith(`tg:${CHAT}`);
  });
});

// ── Menú de opciones iniciales (botones) ───────────────────────────────────
describe("🗂️ Menú de opciones en los avisos (Telegram)", () => {
  beforeEach(() => vi.clearAllMocks());

  const MENU_IDS = ["CHECKIN", "STATUS", "PENDING", "CLOSURES", "HELP"];

  it("el aviso de check-in lleva el menú completo", async () => {
    const { agent, deps } = makeTelegramAgent();
    await agent.sendCheckinTemplate(CHAT, "telegram");
    const call = deps.sendTelegram.execute.mock.calls.at(-1)[0];
    expect(call.kind).toBe("buttons");
    expect(call.buttons.map((b) => b.id)).toEqual(MENU_IDS);
  });

  it("arranca la gestión del día ANTERIOR por Telegram (usa la agenda de ayer)", async () => {
    const { agent, deps } = makeTelegramAgent();
    const r = await agent.proactiveManagePreviousDay(CHAT, "telegram", "2026-11-23");
    expect(deps.getAgenda.execute).toHaveBeenCalledWith({ date: "2026-11-22" });
    expect(r.text).toContain("Gestión del día anterior");
    const call = deps.sendTelegram.execute.mock.calls.at(-1)[0];
    expect(call.kind).toBe("buttons");
    expect(call.buttons.map((b) => b.id)).toEqual([`pay:${CAR_A}`, `off:${CAR_A}`, `ok:${CAR_A}`]);
  });

  it("si ayer quedó al día, solo avisa (sin botones)", async () => {
    const base = agendaFixture();
    const { agent, deps } = makeTelegramAgent({ agenda: () => ({ ...base, pendingCars: [] }) });
    const r = await agent.proactiveManagePreviousDay(CHAT, "telegram", "2026-11-23");
    expect(r.text).toContain("estaba al día");
    expect(deps.sendTelegram.execute.mock.calls.at(-1)[0].kind).toBe("text");
  });

  it("cuando no se entiende (saludo) responde con el menú completo", async () => {
    const { agent, deps } = makeTelegramAgent();
    const r = await agent.handleIncoming({ from: CHAT, text: "hola", channel: "telegram" });
    expect(r.reply).toContain("No entendí");
    const call = deps.sendTelegram.execute.mock.calls.at(-1)[0];
    expect(call.kind).toBe("buttons");
    expect(call.buttons.map((b) => b.id)).toEqual(MENU_IDS);
  });

  it("una consulta normal NO lleva menú", async () => {
    const { agent, deps } = makeTelegramAgent();
    await agent.handleIncoming({ from: CHAT, text: "estado", channel: "telegram" });
    const call = deps.sendTelegram.execute.mock.calls.at(-1)[0];
    expect(call.kind).toBe("text");
    expect(call.buttons).toBeUndefined();
  });

  it("cada botón del menú enruta a su acción", async () => {
    const { agent } = makeTelegramAgent();
    const status = await agent.handleIncoming({ from: CHAT, action: "STATUS", channel: "telegram" });
    expect(status.reply).toContain("Estado del día");
    const pending = await agent.handleIncoming({ from: CHAT, action: "PENDING", channel: "telegram" });
    expect(pending.reply).toContain("Pendientes de hoy");
    const help = await agent.handleIncoming({ from: CHAT, action: "HELP", channel: "telegram" });
    expect(help.reply).toContain("Asistente W Drivers");
    expect(help.reply).toContain("cierres");
    const closures = await agent.handleIncoming({ from: CHAT, action: "CLOSURES", channel: "telegram" });
    expect(closures.reply).toContain("Cierres pendientes");
  });
});

// ── Webhook de Telegram ────────────────────────────────────────────────────
describe("🔗 Webhook de Telegram", () => {
  it("extrae mensajes de texto y callback_query", () => {
    const update = { update_id: 1001, message: { chat: { id: 123 }, message_id: 7, text: "revisar" } };
    expect(extractTelegramUpdates(update)).toEqual([
      { from: "123", text: "revisar", messageId: "7", updateId: "1001" },
    ]);

    const cq = { update_id: 1002, callback_query: { id: "cb1", data: `pay:${CAR_A}`, message: { message_id: 8, chat: { id: 999 } } } };
    expect(extractTelegramUpdates(cq)).toEqual([
      { from: "999", action: `pay:${CAR_A}`, callbackQueryId: "cb1", messageId: "8", updateId: "1002" },
    ]);
  });

  it("exige el secret_token cuando está configurado y responde 200", async () => {
    const previous = config.notifications.telegramWebhookSecret;
    config.notifications.telegramWebhookSecret = "s3cr3t";
    const app = createApp();
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const noSecret = await fetch(`${base}/api/telegram/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(noSecret.status).toBe(401);

      const ok = await fetch(`${base}/api/telegram/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "s3cr3t" },
        body: JSON.stringify({}),
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true });
    } finally {
      server.close();
      config.notifications.telegramWebhookSecret = previous;
    }
  });
});
