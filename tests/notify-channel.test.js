import { describe, it, expect, vi } from "vitest";
import { SendNotificationUseCase } from "../src/application/use-cases/notify/index.js";

// Arma el caso de uso con dobles de prueba.
const build = ({
  channel = "whatsapp",
  settings = {},
  telegramChatId = "",
  statementText = "EXTRACTO",
  reminderText = "RECORDATORIO",
} = {}) => {
  const sendWhatsApp = { execute: vi.fn().mockResolvedValue({ ok: true, channel: "whatsapp" }) };
  const sendTelegram = { execute: vi.fn().mockResolvedValue({ ok: true, channel: "telegram" }) };
  const statementUseCase = { execute: vi.fn().mockResolvedValue({ whatsappText: statementText }) };
  const remindersUseCase = { execute: vi.fn().mockResolvedValue({ whatsappText: reminderText }) };
  const uc = new SendNotificationUseCase({
    sendWhatsApp,
    sendTelegram,
    getSettings: { execute: vi.fn().mockResolvedValue({ notifyChannel: channel, ...settings }) },
    statementUseCase,
    remindersUseCase,
    telegramChatId,
  });
  return { uc, sendWhatsApp, sendTelegram, statementUseCase, remindersUseCase };
};

describe("SendNotificationUseCase — enrutamiento por canal", () => {
  it("con canal WhatsApp delega en SendWhatsAppUseCase", async () => {
    const { uc, sendWhatsApp, sendTelegram } = build({ channel: "whatsapp" });
    const r = await uc.execute({ kind: "text", to: "573001112233", text: "Hola" });

    expect(sendWhatsApp.execute).toHaveBeenCalledWith({ kind: "text", to: "573001112233", text: "Hola", carId: undefined, moment: undefined, date: undefined });
    expect(sendTelegram.execute).not.toHaveBeenCalled();
    expect(r.channel).toBe("whatsapp");
  });

  it("con canal Telegram envía por Telegram al chat configurado", async () => {
    const { uc, sendWhatsApp, sendTelegram } = build({ channel: "telegram", settings: { telegramChatId: "7911560495" } });
    const r = await uc.execute({ kind: "text", to: "573001112233", text: "Resumen" });

    expect(sendWhatsApp.execute).not.toHaveBeenCalled();
    expect(sendTelegram.execute).toHaveBeenCalledTimes(1);
    const arg = sendTelegram.execute.mock.calls[0][0];
    expect(arg.to).toBe("7911560495");
    expect(arg.text).toBe("Resumen");
    expect(arg.kind).toBe("text");
  });

  it("con canal Telegram usa el respaldo del entorno si Ajustes no tiene chat id", async () => {
    const { uc, sendTelegram } = build({ channel: "telegram", telegramChatId: "999888777" });
    await uc.execute({ kind: "text", text: "Resumen" });

    expect(sendTelegram.execute.mock.calls[0][0].to).toBe("999888777");
  });

  it("con canal Telegram sin chat id falla pidiendo configuración", async () => {
    const { uc } = build({ channel: "telegram", settings: { telegramChatId: "" } });
    await expect(uc.execute({ kind: "text", text: "Resumen" })).rejects.toThrow(/Chat ID de Telegram/);
  });

  it("con canal Telegram genera y envía el extracto (kind=statement)", async () => {
    const { uc, sendTelegram, statementUseCase } = build({
      channel: "telegram", settings: { telegramChatId: "7911560495" }, statementText: "EXTRACTO X",
    });
    await uc.execute({ kind: "statement", carId: "car1" });

    expect(statementUseCase.execute).toHaveBeenCalledWith({ carId: "car1" });
    expect(sendTelegram.execute.mock.calls[0][0].text).toBe("EXTRACTO X");
  });

  it("con canal Telegram genera y envía el recordatorio (kind=reminder)", async () => {
    const { uc, sendTelegram, remindersUseCase } = build({
      channel: "telegram", settings: { telegramChatId: "7911560495" }, reminderText: "RECORD Y",
    });
    await uc.execute({ kind: "reminder", moment: "morning" });

    expect(remindersUseCase.execute).toHaveBeenCalledWith({ moment: "morning", date: undefined });
    expect(sendTelegram.execute.mock.calls[0][0].text).toBe("RECORD Y");
  });

  it("con canal Telegram permite un mensaje de prueba (kind=test)", async () => {
    const { uc, sendTelegram } = build({ channel: "telegram", settings: { telegramChatId: "7911560495" } });
    const r = await uc.execute({ kind: "test" });

    expect(sendTelegram.execute.mock.calls[0][0].kind).toBe("test");
    expect(r.channel).toBe("telegram");
  });
});
