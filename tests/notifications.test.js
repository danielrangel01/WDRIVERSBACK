import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SubscribePushUseCase, UnsubscribePushUseCase } from "../src/application/use-cases/push/index.js";
import { ReminderDispatcher } from "../src/infrastructure/notify/ReminderDispatcher.js";
import { startReminderScheduler, localParts } from "../src/infrastructure/notify/reminderScheduler.js";

const sub = (endpoint) => ({ endpoint, keys: { p256dh: "k_p256dh", auth: "k_auth" } });

const fakePushRepo = () => {
  const store = new Map();
  return {
    store,
    async upsert(subscription) { store.set(subscription.endpoint, subscription); return subscription; },
    async removeByEndpoint(endpoint) { return store.delete(endpoint) ? 1 : 0; },
  };
};

describe("📲 Suscripciones Web Push", () => {
  it("registra una suscripción válida", async () => {
    const repo = fakePushRepo();
    const r = await new SubscribePushUseCase({ pushSubscriptionRepository: repo }).execute({ subscription: sub("https://push/1"), userAgent: "UA" });
    expect(r).toEqual({ ok: true, endpoint: "https://push/1" });
    expect(repo.store.has("https://push/1")).toBe(true);
  });

  it("rechaza suscripción sin endpoint", async () => {
    const repo = fakePushRepo();
    const uc = new SubscribePushUseCase({ pushSubscriptionRepository: repo });
    await expect(uc.execute({ subscription: { keys: { p256dh: "k", auth: "a" } } })).rejects.toThrow(/endpoint/i);
  });

  it("rechaza suscripción sin claves", async () => {
    const repo = fakePushRepo();
    const uc = new SubscribePushUseCase({ pushSubscriptionRepository: repo });
    await expect(uc.execute({ subscription: { endpoint: "https://push/2" } })).rejects.toThrow(/p256dh/i);
  });

  it("elimina una suscripción por endpoint", async () => {
    const repo = fakePushRepo();
    await repo.upsert(sub("https://push/3"));
    const r = await new UnsubscribePushUseCase({ pushSubscriptionRepository: repo }).execute({ endpoint: "https://push/3" });
    expect(r).toEqual({ ok: true, removed: 1 });
  });

  it("exige endpoint al eliminar", async () => {
    const repo = fakePushRepo();
    await expect(new UnsubscribePushUseCase({ pushSubscriptionRepository: repo }).execute({})).rejects.toThrow(/endpoint/i);
  });
});

describe("📤 ReminderDispatcher", () => {
  it("envía correo (con enlace WhatsApp) y push, podando suscripciones caducadas", async () => {
    const emailCalls = [];
    const pushCalls = [];
    const pruned = [];
    const emailNotifier = { enabled: true, send: async (m) => { emailCalls.push(m); return { ok: true }; } };
    const pushNotifier = {
      enabled: true,
      send: async (subscription) => {
        pushCalls.push(subscription.endpoint);
        if (subscription.endpoint === "bad") { const e = new Error("gone"); e.statusCode = 410; throw e; }
        return { ok: true };
      },
    };
    const pushSubscriptionRepository = {
      findAll: async () => [
        { endpoint: "good", subscription: sub("good") },
        { endpoint: "bad", subscription: sub("bad") },
      ],
      removeByEndpoint: async (ep) => { pruned.push(ep); return 1; },
    };

    const dispatcher = new ReminderDispatcher({ emailNotifier, pushNotifier, pushSubscriptionRepository });
    const res = await dispatcher.dispatch({
      date: "2024-06-30",
      moment: "morning",
      reminders: [{ icon: "🎯", title: "Cobrar hoy" }, { icon: "🚨", title: "Atrasados" }],
      whatsappText: "Reporte del día",
      settings: { adminPhone: "573001234567", adminEmail: "admin@wdrivers.app" },
    });

    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0].to).toBe("admin@wdrivers.app");
    expect(emailCalls[0].text).toContain("https://wa.me/573001234567");
    expect(pushCalls).toEqual(["good", "bad"]);
    expect(pruned).toEqual(["bad"]);
    expect(res.push).toEqual({ sent: 1, pruned: 1 });
  });

  it("no hace nada si los canales están deshabilitados", async () => {
    const dispatcher = new ReminderDispatcher({
      emailNotifier: { enabled: false },
      pushNotifier: { enabled: false },
      pushSubscriptionRepository: { findAll: async () => [], removeByEndpoint: async () => 0 },
    });
    expect(dispatcher.channels).toEqual({ email: false, push: false, whatsapp: false, telegram: false });
    const res = await dispatcher.dispatch({ date: "2024-06-30", moment: "morning", reminders: [], whatsappText: "", settings: {} });
    expect(res).toEqual({});
  });
});

describe("⏰ ReminderScheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("localParts calcula fecha y hora en la zona horaria indicada", () => {
    vi.setSystemTime(new Date("2024-06-30T14:30:00Z")); // 09:30 en America/Bogota (UTC-5)
    expect(localParts("America/Bogota")).toEqual({ date: "2024-06-30", hour: 9 });
  });

  it("envía y registra un recordatorio una sola vez cuando coincide la hora", async () => {
    vi.setSystemTime(new Date("2024-06-30T14:30:00Z"));
    const dispatched = [];
    const recorded = [];

    const stop = startReminderScheduler({
      useCase: { execute: async ({ date, moment }) => ({ date, moment, reminders: [{ id: "collect", icon: "🎯", title: "Cobrar" }], whatsappText: "hi" }) },
      dispatcher: { dispatch: async (d) => { dispatched.push(d); return { email: { ok: true } }; } },
      settingsRepository: { get: async () => ({ remindersEnabled: true, morningHour: 9, eveningHour: 20, adminPhone: "", adminEmail: "a@b.com" }) },
      reminderLogRepository: { exists: async () => false, record: async (key) => { recorded.push(key); } },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    expect(recorded).toEqual(["2024-06-30:morning", "2024-06-30:morningClose"]);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].moment).toBe("morning");
  });

  it("mañana: arranca la gestión del día ANTERIOR como mensaje aparte", async () => {
    vi.setSystemTime(new Date("2024-06-30T14:30:00Z")); // 09:30 en Bogota
    const dispatch = vi.fn(async () => ({}));
    const managePrev = vi.fn().mockResolvedValue({ text: "gestión de ayer" });

    const stop = startReminderScheduler({
      useCase: { execute: async ({ date, moment }) => ({ date, moment, reminders: [], whatsappText: "hi" }) },
      dispatcher: { channels: { whatsapp: true }, dispatch },
      settingsRepository: { get: async () => ({ remindersEnabled: true, morningHour: 9, eveningHour: 20, adminPhone: "573001112233" }) },
      reminderLogRepository: { exists: async () => false, record: async () => {} },
      agent: { proactiveManagePreviousDay: managePrev },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    // El agente arranca la gestión de AYER (recibe la fecha de HOY; resta el día).
    expect(managePrev).toHaveBeenCalledTimes(1);
    expect(managePrev.mock.calls[0].slice(0, 3)).toEqual(["573001112233", "whatsapp", "2024-06-30"]);
    // La gestión de ayer NO se manda por el dispatcher (correo/push).
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].moment).toBe("morning");
  });

  it("tarde: NO cierra el día (ni check-in ni cierre del agente)", async () => {
    vi.setSystemTime(new Date("2024-07-01T01:30:00Z")); // 20:30 del 30 en Bogota
    const dispatch = vi.fn(async () => ({}));
    const proactiveClose = vi.fn();

    const stop = startReminderScheduler({
      useCase: { execute: async ({ date, moment }) => ({ date, moment, reminders: [], whatsappText: "hi" }) },
      dispatcher: { channels: { whatsapp: true }, dispatch },
      settingsRepository: { get: async () => ({ remindersEnabled: true, morningHour: 8, eveningHour: 20, adminPhone: "573001112233" }) },
      reminderLogRepository: { exists: async () => false, record: async () => {} },
      agent: { proactiveClose },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].moment).toBe("evening");
    expect(proactiveClose).not.toHaveBeenCalled();
  });

  it("dispara la media mañana en la hora configurada (segundo recordatorio)", async () => {
    vi.setSystemTime(new Date("2024-06-30T14:30:00Z")); // 09:30 en Bogota
    const dispatched = [];

    const stop = startReminderScheduler({
      useCase: { execute: async ({ date, moment }) => ({ date, moment, reminders: [], whatsappText: "hi" }) },
      dispatcher: { dispatch: async (d) => { dispatched.push(d); return {}; } },
      settingsRepository: { get: async () => ({ remindersEnabled: true, morningHour: 7, lateMorningHour: 9, middayHour: 14, afternoonHour: 16, eveningHour: 20 }) },
      reminderLogRepository: { exists: async () => false, record: async () => {} },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].moment).toBe("lateMorning");
  });

  it("insistencia de la tarde: llama a agent.insistPreviousDay (nivel 3) sin recordatorio general", async () => {
    vi.setSystemTime(new Date("2024-06-30T21:05:00Z")); // 16:05 en Bogota
    const dispatched = [];
    const insist = vi.fn().mockResolvedValue(true);

    const stop = startReminderScheduler({
      useCase: { execute: async () => { throw new Error("no debe usarse en la insistencia"); } },
      dispatcher: { channels: { whatsapp: true }, dispatch: async (d) => { dispatched.push(d); return {}; } },
      settingsRepository: { get: async () => ({ remindersEnabled: true, morningHour: 8, lateMorningHour: 11, middayHour: 14, afternoonHour: 16, eveningHour: 20, adminPhone: "573001112233" }) },
      reminderLogRepository: { exists: async () => false, record: async () => {} },
      agent: { insistPreviousDay: insist },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    expect(dispatched).toHaveLength(0);
    expect(insist).toHaveBeenCalledWith("573001112233", "whatsapp", "2024-06-30", 3);
  });

  it("noche: insiste en la gestión de ayer con el nivel más alto (4)", async () => {
    vi.setSystemTime(new Date("2024-07-01T01:30:00Z")); // 20:30 del 30 en Bogota
    const dispatch = vi.fn(async () => ({}));
    const insist = vi.fn().mockResolvedValue(true);

    const stop = startReminderScheduler({
      useCase: { execute: async ({ date, moment }) => ({ date, moment, reminders: [], whatsappText: "hi" }) },
      dispatcher: { channels: { whatsapp: true }, dispatch },
      settingsRepository: { get: async () => ({ remindersEnabled: true, morningHour: 8, eveningHour: 20, adminPhone: "573001112233" }) },
      reminderLogRepository: { exists: async () => false, record: async () => {} },
      agent: { insistPreviousDay: insist },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    // El general sale (correo/push) pero el chat lo maneja el agente.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].moment).toBe("evening");
    expect(dispatch.mock.calls[0][0].skipWhatsApp).toBe(true);
    expect(insist).toHaveBeenCalledWith("573001112233", "whatsapp", "2024-06-30", 4);
  });

  it("no reenvía si ya existe registro para ese día/momento (idempotencia)", async () => {
    vi.setSystemTime(new Date("2024-06-30T14:30:00Z"));
    const dispatched = [];

    const stop = startReminderScheduler({
      useCase: { execute: async () => ({ reminders: [], whatsappText: "" }) },
      dispatcher: { dispatch: async (d) => { dispatched.push(d); return {}; } },
      settingsRepository: { get: async () => ({ remindersEnabled: true, morningHour: 9, eveningHour: 20 }) },
      reminderLogRepository: { exists: async () => true, record: async () => {} },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    expect(dispatched).toHaveLength(0);
  });

  it("respeta remindersEnabled=false", async () => {
    vi.setSystemTime(new Date("2024-06-30T14:30:00Z"));
    const dispatched = [];

    const stop = startReminderScheduler({
      useCase: { execute: async () => ({ reminders: [], whatsappText: "" }) },
      dispatcher: { dispatch: async (d) => { dispatched.push(d); return {}; } },
      settingsRepository: { get: async () => ({ remindersEnabled: false, morningHour: 9, eveningHour: 20 }) },
      reminderLogRepository: { exists: async () => false, record: async () => {} },
      timeZone: "America/Bogota",
      everyMs: 100000,
      initialDelayMs: 1,
      log: { log() {}, error() {} },
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    expect(dispatched).toHaveLength(0);
  });
});
