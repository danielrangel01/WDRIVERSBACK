import { describe, it, expect, vi } from "vitest";
import { SyncNequiUseCase } from "../src/application/use-cases/nequi/index.js";

// Candidato de correo Nequi (mínimo que consume el caso de uso).
const candidate = (over = {}) => ({
  amount: 80000,
  detectedDate: "2026-03-10",
  from: "JUAN PEREZ",
  subject: "Recibiste un pago",
  snippet: "recibiste un pago por $80.000",
  messageId: "m1",
  ...over,
});

// Arma el caso de uso con dobles de prueba. `inserted` = pagos realmente nuevos.
const build = ({
  candidates = [candidate()],
  inserted = [{ amount: 80000, from: "JUAN PEREZ", detectedDate: "2026-03-10" }],
  configured = true,
  settings = { telegramChatId: "7911560495" },
  telegramChatId = "",
  telegram,
} = {}) => {
  const sendTelegram = telegram === undefined
    ? { enabled: true, execute: vi.fn().mockResolvedValue({ ok: true }) }
    : telegram;
  const log = { error: vi.fn() };
  const uc = new SyncNequiUseCase({
    pendingPaymentRepository: { insertMany: vi.fn().mockResolvedValue(inserted) },
    mailReader: {
      fetchPaymentCandidates: vi.fn().mockResolvedValue({ configured, scanned: 1, candidates }),
    },
    sendTelegram,
    getSettings: { execute: vi.fn().mockResolvedValue(settings) },
    telegramChatId,
    log,
  });
  return { uc, sendTelegram, log };
};

describe("SyncNequiUseCase — notificación por Telegram", () => {
  it("notifica por Telegram al detectar pagos nuevos", async () => {
    const { uc, sendTelegram } = build();
    const r = await uc.execute();

    expect(r.ok).toBe(true);
    expect(r.created).toBe(1);
    expect(sendTelegram.execute).toHaveBeenCalledTimes(1);

    const arg = sendTelegram.execute.mock.calls[0][0];
    expect(arg.to).toBe("7911560495");
    expect(arg.text).toContain("$80.000");
    expect(arg.text).toContain("Nequi");
  });

  it("el botón de gestión dice 'Gestionar' (sin el chulo ni el monto)", async () => {
    const { uc, sendTelegram } = build({
      inserted: [{ id: "f".repeat(24), amount: 80000, from: "JUAN PEREZ", detectedDate: "2026-03-10" }],
    });
    await uc.execute();

    const arg = sendTelegram.execute.mock.calls[0][0];
    expect(arg.kind).toBe("buttons");
    const titles = arg.buttons.flatMap((r) => (r.row || []).map((b) => b.title));
    expect(titles).toContain("Gestionar");
    expect(titles.some((t) => t.includes("✅"))).toBe(false);
    expect(arg.buttons[0].row[0].id).toMatch(/^nq:ok:/);
    expect(arg.text).toContain("Gestionar");
  });

  it("muestra la hora en que llegó el dinero cuando el correo la trae", async () => {
    const { uc, sendTelegram } = build({
      inserted: [{ id: "f".repeat(24), amount: 80000, from: "JUAN PEREZ", detectedDate: "2026-03-10", detectedTime: "6:56 p.m." }],
    });
    await uc.execute();

    const arg = sendTelegram.execute.mock.calls[0][0];
    expect(arg.text).toContain("10/03/2026 6:56 p.m.");
    expect(arg.text).toContain("por asignar");
  });

  it("NO notifica si no hay pagos nuevos", async () => {
    const { uc, sendTelegram } = build({ inserted: [] });
    const r = await uc.execute();

    expect(r.created).toBe(0);
    expect(sendTelegram.execute).not.toHaveBeenCalled();
  });

  it("NO notifica si el buzón no está configurado", async () => {
    const { uc, sendTelegram } = build({ configured: false });
    const r = await uc.execute();

    expect(r.ok).toBe(false);
    expect(sendTelegram.execute).not.toHaveBeenCalled();
  });

  it("usa el respaldo del entorno si Ajustes no tiene chat id", async () => {
    const { uc, sendTelegram } = build({ settings: {}, telegramChatId: "7911560495" });
    await uc.execute();

    expect(sendTelegram.execute.mock.calls[0][0].to).toBe("7911560495");
  });

  it("no rompe la sincronización si el envío por Telegram falla", async () => {
    const { uc, log } = build({
      telegram: { enabled: true, execute: vi.fn().mockRejectedValue(new Error("Telegram caído")) },
    });
    const r = await uc.execute();

    expect(r.ok).toBe(true);
    expect(r.created).toBe(1);
    expect(log.error).toHaveBeenCalled();
  });

  it("omite el envío si Telegram no está configurado", async () => {
    const { uc, sendTelegram } = build({ telegram: { enabled: false, execute: vi.fn() } });
    const r = await uc.execute();

    expect(r.created).toBe(1);
    expect(sendTelegram.execute).not.toHaveBeenCalled();
  });

  it("resume la lista cuando hay muchos pagos nuevos", async () => {
    const inserted = Array.from({ length: 13 }, (_, i) => ({
      amount: 50000, from: `REMITENTE ${i + 1}`, detectedDate: "2026-03-10",
    }));
    const { uc, sendTelegram } = build({ inserted });
    await uc.execute();

    const arg = sendTelegram.execute.mock.calls[0][0];
    expect(arg.text).toContain("13 pago(s) nuevo(s)");
    expect(arg.text).toContain("y 3 más");
  });
});
