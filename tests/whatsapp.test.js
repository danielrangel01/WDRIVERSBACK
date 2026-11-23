import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WhatsAppNotifier } from "../src/infrastructure/notify/WhatsAppNotifier.js";
import { SendWhatsAppUseCase } from "../src/application/use-cases/whatsapp/index.js";

const okJson = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const errJson = (status, error) => ({
  ok: false,
  status,
  json: async () => ({ error }),
});

describe("🟢 WhatsAppNotifier (Cloud API)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const make = (over = {}) =>
    new WhatsAppNotifier({ token: "TOKEN", phoneNumberId: "123456", ...over });

  it("queda deshabilitado sin token/número y no llama a la API", async () => {
    const n = new WhatsAppNotifier({});
    expect(n.enabled).toBe(false);
    const r = await n.sendText({ to: "573001112233", text: "hola" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("whatsapp_disabled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normaliza el teléfono eliminando caracteres no numéricos", () => {
    const n = make();
    expect(n.normalizePhone("+57 300-111 22 33")).toBe("573001112233");
    expect(n.normalizePhone("")).toBe("");
  });

  it("sendText construye la petición correcta a Graph API", async () => {
    fetch.mockResolvedValueOnce(okJson({ messages: [{ id: "wamid.1" }] }));
    const n = make({ apiVersion: "v21.0" });
    const r = await n.sendText({ to: "+57 300 111 2233", text: "  hola  " });

    expect(r.ok).toBe(true);
    expect(r.messages[0].id).toBe("wamid.1");

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/123456/messages");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer TOKEN");
    const payload = JSON.parse(opts.body);
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.to).toBe("573001112233");
    expect(payload.type).toBe("text");
    expect(payload.text.body).toBe("hola");
  });

  it("sendText sin destinatario o sin texto no llama a la API", async () => {
    const n = make();
    expect((await n.sendText({ to: "", text: "x" })).reason).toBe("no_recipient");
    expect((await n.sendText({ to: "57300", text: "   " })).reason).toBe("empty_message");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lanza error con statusCode y code cuando la API rechaza", async () => {
    fetch.mockResolvedValueOnce(errJson(400, { code: 999, message: "bad request" }));
    const n = make();
    await expect(n.sendText({ to: "573001112233", text: "hola" })).rejects.toMatchObject({
      statusCode: 400,
      code: 999,
      message: "bad request",
    });
  });

  it("send reintenta con la plantilla UTILITY usando los componentes provistos (131047)", async () => {
    fetch
      .mockResolvedValueOnce(errJson(400, { code: 131047, message: "re-engagement" }))
      .mockResolvedValueOnce(okJson({ messages: [{ id: "wamid.tpl" }] }));
    const n = make({ template: "wdrivers_recordatorio" });
    const components = [{
      type: "body",
      parameters: [
        { type: "text", text: "3" },
        { type: "text", text: "$450.000" },
        { type: "text", text: "$1.200.000" },
      ],
    }];
    const r = await n.send({ to: "573001112233", text: "hola", components });

    expect(r.messages[0].id).toBe("wamid.tpl");
    const payload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("wdrivers_recordatorio");
    expect(payload.template.language.code).toBe("es");
    expect(payload.template.components[0].type).toBe("body");
    expect(payload.template.components[0].parameters).toHaveLength(3);
  });

  it("send permite sobreescribir el nombre de la plantilla con `template`", async () => {
    fetch
      .mockResolvedValueOnce(errJson(400, { code: 470, message: "window" }))
      .mockResolvedValueOnce(okJson({ messages: [{ id: "wamid.tpl.ov" }] }));
    const n = make();
    const components = [{ type: "body", parameters: [{ type: "text", text: "x" }] }];
    const r = await n.send({ to: "573001112233", text: "hola", template: "otra", components });

    expect(r.messages[0].id).toBe("wamid.tpl.ov");
    const payload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.template.name).toBe("otra");
  });

  it("send NO reintenta con plantilla si el llamador no aporta componentes", async () => {
    fetch.mockResolvedValueOnce(errJson(400, { code: 131047, message: "re-engagement" }));
    const n = make({ template: "wdrivers_recordatorio" });
    await expect(n.send({ to: "573001112233", text: "hola" })).rejects.toMatchObject({ code: 131047 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("send NO reintenta si no hay plantilla configurada", async () => {
    fetch.mockResolvedValueOnce(errJson(400, { code: 131047, message: "re-engagement" }));
    const n = make();
    await expect(n.send({ to: "573001112233", text: "hola" })).rejects.toMatchObject({ code: 131047 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sendTemplate exige nombre de plantilla", async () => {
    const n = make();
    await expect(n.sendTemplate({ to: "573001112233" })).rejects.toMatchObject({ code: 131047 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("🟢 SendWhatsAppUseCase", () => {
  const fakeNotifier = (over = {}) => ({
    enabled: true,
    normalizePhone: (p) => String(p || "").replace(/\D/g, ""),
    send: vi.fn(async ({ to, text }) => ({ ok: true, to, sent: text })),
    ...over,
  });

  it("lanza ValidationError si WhatsApp no está configurado", async () => {
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: { enabled: false } });
    await expect(uc.execute({ to: "57300", text: "hi" })).rejects.toThrow(/no está configurado/i);
  });

  it("kind=test envía un mensaje por defecto", async () => {
    const notifier = fakeNotifier();
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: notifier });
    const r = await uc.execute({ kind: "test", to: "+57 300 111 2233" });
    expect(r.ok).toBe(true);
    expect(r.to).toBe("573001112233");
    expect(r.kind).toBe("test");
    expect(notifier.send.mock.calls[0][0].text).toMatch(/Prueba de WhatsApp/i);
  });

  it("kind=text envía el texto provisto", async () => {
    const notifier = fakeNotifier();
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: notifier });
    await uc.execute({ kind: "text", to: "57300", text: "Cobro pendiente" });
    expect(notifier.send.mock.calls[0][0].text).toBe("Cobro pendiente");
  });

  it("kind=statement usa el caso de uso de extracto", async () => {
    const notifier = fakeNotifier();
    const statementUseCase = { execute: vi.fn(async () => ({ whatsappText: "EXTRACTO CARRO" })) };
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: notifier, statementUseCase });
    const r = await uc.execute({ kind: "statement", to: "57300", carId: "aaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(statementUseCase.execute).toHaveBeenCalledWith({ carId: "aaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(notifier.send.mock.calls[0][0].text).toBe("EXTRACTO CARRO");
    expect(r.kind).toBe("statement");
  });

  it("kind=statement exige carId", async () => {
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: fakeNotifier() });
    await expect(uc.execute({ kind: "statement", to: "57300" })).rejects.toThrow(/carId/i);
  });

  it("kind=reminder usa el teléfono de settings si no se indica destinatario", async () => {
    const notifier = fakeNotifier();
    const remindersUseCase = { execute: vi.fn(async () => ({ whatsappText: "RECORDATORIO" })) };
    const settingsRepository = { get: async () => ({ adminPhone: "573009998877" }) };
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: notifier, remindersUseCase, settingsRepository });
    const r = await uc.execute({ kind: "reminder", moment: "morning" });
    expect(remindersUseCase.execute).toHaveBeenCalledWith({ moment: "morning", date: undefined });
    expect(r.to).toBe("573009998877");
    expect(notifier.send.mock.calls[0][0].text).toBe("RECORDATORIO");
  });

  it("exige destinatario y mensaje no vacío", async () => {
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: fakeNotifier() });
    await expect(uc.execute({ to: "", text: "x" })).rejects.toThrow(/número destino/i);
    await expect(uc.execute({ to: "57300", text: "   " })).rejects.toThrow(/vacío/i);
  });

  it("trunca el mensaje al límite de la Cloud API (4096)", async () => {
    const notifier = fakeNotifier();
    const uc = new SendWhatsAppUseCase({ whatsappNotifier: notifier });
    await uc.execute({ kind: "text", to: "57300", text: "A".repeat(5000) });
    expect(notifier.send.mock.calls[0][0].text).toHaveLength(4096);
  });
});
