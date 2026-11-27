import { describe, it, expect } from "vitest";
import { RegisterDeviceUseCase, UnregisterDeviceUseCase } from "../src/application/use-cases/push/index.js";
import { FcmNotifier } from "../src/infrastructure/notify/FcmNotifier.js";
import { ReminderDispatcher } from "../src/infrastructure/notify/ReminderDispatcher.js";

const fakeDeviceRepo = () => {
  const store = new Map();
  return {
    store,
    async findAll() { return [...store.values()]; },
    async exists(token) { return store.has(String(token || "").trim()); },
    async upsert({ token, platform, deviceName }) {
      const d = { token, platform, deviceName: deviceName || "", enabled: true, lastSeenAt: new Date() };
      store.set(token, d);
      return d;
    },
    async removeByToken(token) { return store.delete(token) ? 1 : 0; },
  };
};

describe("📱 Registro de dispositivos (FCM)", () => {
  it("registra un token de Android por defecto", async () => {
    const repo = fakeDeviceRepo();
    const r = await new RegisterDeviceUseCase({ deviceTokenRepository: repo }).execute({ token: "tok-android-1234567890" });
    expect(r).toEqual({ ok: true, platform: "android", token: "d-1234567890", isNew: true });
    expect(repo.store.has("tok-android-1234567890")).toBe(true);
  });

  it("marca isNew=false al re-registrar el mismo token", async () => {
    const repo = fakeDeviceRepo();
    const uc = new RegisterDeviceUseCase({ deviceTokenRepository: repo });
    await uc.execute({ token: "tok-repeat-1234567890" });
    const r = await uc.execute({ token: "tok-repeat-1234567890" });
    expect(r.isNew).toBe(false);
  });

  it("registra un token de iOS y guarda el nombre del dispositivo", async () => {
    const repo = fakeDeviceRepo();
    await new RegisterDeviceUseCase({ deviceTokenRepository: repo }).execute({
      token: "tok-ios-abcdefghijkl", platform: "ios", deviceName: "iPhone 15",
    });
    const saved = repo.store.get("tok-ios-abcdefghijkl");
    expect(saved.platform).toBe("ios");
    expect(saved.deviceName).toBe("iPhone 15");
  });

  it("normaliza plataformas desconocidas a android", async () => {
    const repo = fakeDeviceRepo();
    const r = await new RegisterDeviceUseCase({ deviceTokenRepository: repo }).execute({ token: "tok-x-1234567890", platform: "web" });
    expect(r.platform).toBe("android");
  });

  it("rechaza tokens vacíos", async () => {
    const repo = fakeDeviceRepo();
    const uc = new RegisterDeviceUseCase({ deviceTokenRepository: repo });
    await expect(uc.execute({ token: "   " })).rejects.toThrow(/token/i);
    await expect(uc.execute({})).rejects.toThrow(/token/i);
  });

  it("elimina un token de dispositivo", async () => {
    const repo = fakeDeviceRepo();
    await repo.upsert({ token: "tok-del-0000000000" });
    const r = await new UnregisterDeviceUseCase({ deviceTokenRepository: repo }).execute({ token: "tok-del-0000000000" });
    expect(r).toEqual({ ok: true, removed: 1 });
  });

  it("exige token al eliminar", async () => {
    const repo = fakeDeviceRepo();
    await expect(new UnregisterDeviceUseCase({ deviceTokenRepository: repo }).execute({})).rejects.toThrow(/token/i);
  });
});

describe("🔥 FcmNotifier", () => {
  it("queda deshabilitado sin credenciales válidas", () => {
    expect(new FcmNotifier({}).enabled).toBe(false);
    expect(new FcmNotifier({ serviceAccount: "{ no-json }" }).enabled).toBe(false);
    expect(new FcmNotifier({ serviceAccount: { foo: "bar" } }).enabled).toBe(false);
  });

  it("se habilita con una cuenta de servicio completa", () => {
    const n = new FcmNotifier({
      serviceAccount: { project_id: "wdrivers", private_key: "-----BEGIN KEY-----x", client_email: "svc@wdrivers.iam" },
    });
    expect(n.enabled).toBe(true);
  });

  it("omite el envío cuando está deshabilitado", async () => {
    const r = await new FcmNotifier({}).send("tok", { title: "Hola" });
    expect(r).toEqual({ ok: false, skipped: true, reason: "fcm_disabled" });
  });
});

describe("📤 ReminderDispatcher · push nativo (FCM)", () => {
  const baseReminders = [{ icon: "🎯", title: "Cobrar hoy" }, { icon: "🚨", title: "Atrasados" }];

  it("envía a todos los dispositivos y poda los tokens no registrados", async () => {
    const sentTo = [];
    const pruned = [];
    const fcmNotifier = {
      enabled: true,
      send: async (token) => {
        sentTo.push(token);
        if (token === "bad") return { ok: false, code: "messaging/registration-token-not-registered" };
        return { ok: true, messageId: "m1" };
      },
    };
    const deviceTokenRepository = {
      findAll: async () => [{ token: "good" }, { token: "bad" }],
      removeByToken: async (t) => { pruned.push(t); return 1; },
    };

    const dispatcher = new ReminderDispatcher({
      fcmNotifier, deviceTokenRepository,
      emailNotifier: { enabled: false },
      pushNotifier: { enabled: false },
      pushSubscriptionRepository: { findAll: async () => [], removeByEndpoint: async () => 0 },
    });

    expect(dispatcher.channels.fcm).toBe(true);
    const res = await dispatcher.dispatch({
      date: "2024-06-30", moment: "morning", reminders: baseReminders,
      whatsappText: "Reporte del día", settings: {},
    });

    expect(sentTo).toEqual(["good", "bad"]);
    expect(pruned).toEqual(["bad"]);
    expect(res.fcm).toEqual({ sent: 1, pruned: 1 });
  });

  it("no envía FCM si no hay dispositivos registrados", async () => {
    const fcmNotifier = { enabled: true, send: async () => ({ ok: true }) };
    const dispatcher = new ReminderDispatcher({
      fcmNotifier,
      deviceTokenRepository: { findAll: async () => [], removeByToken: async () => 0 },
      emailNotifier: { enabled: false }, pushNotifier: { enabled: false },
      pushSubscriptionRepository: { findAll: async () => [], removeByEndpoint: async () => 0 },
    });
    const res = await dispatcher.dispatch({ date: "2024-06-30", moment: "morning", reminders: [], whatsappText: "", settings: {} });
    expect(res.fcm).toEqual({ sent: 0, pruned: 0 });
  });
});
