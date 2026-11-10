import { describe, it, expect } from "vitest";
import { parseCoAmount, extractAmount, parseNequiEmail, toBogotaDateStr } from "../src/infrastructure/mail/NequiEmailParser.js";

describe("parseCoAmount", () => {
  it("interpreta el formato colombiano de miles", () => {
    expect(parseCoAmount("80.000")).toBe(80000);
    expect(parseCoAmount("1.234.567")).toBe(1234567);
  });
  it("interpreta decimales con coma", () => {
    expect(parseCoAmount("1.234.567,89")).toBe(1234567.89);
    expect(parseCoAmount("12,50")).toBe(12.5);
  });
  it("interpreta el formato US", () => {
    expect(parseCoAmount("80,000.00")).toBe(80000);
  });
  it("acepta enteros", () => {
    expect(parseCoAmount("50000")).toBe(50000);
  });
  it("devuelve NaN con entradas inválidas", () => {
    expect(Number.isNaN(parseCoAmount(""))).toBe(true);
    expect(Number.isNaN(parseCoAmount(null))).toBe(true);
  });
});

describe("extractAmount", () => {
  it("prioriza el monto tras la palabra 'recibiste'", () => {
    const t = "Tu saldo es $1.000.000 y recibiste un pago por $80.000 de JUAN";
    expect(extractAmount(t)).toBe(80000);
  });
  it("usa el primer monto si no hay palabra clave", () => {
    expect(extractAmount("Movimiento por $250.000")).toBe(250000);
  });
});

describe("parseNequiEmail", () => {
  const date = new Date("2026-03-10T15:30:00Z");

  it("detecta un pago recibido", () => {
    const r = parseNequiEmail({
      subject: "Recibiste un pago",
      text: "Recibiste un pago por $80.000 de Carlos Pérez. ¡Ya está disponible!",
      date,
      from: "Notificaciones Nequi <no-responder@nequi.com.co>",
    });
    expect(r.isPayment).toBe(true);
    expect(r.amount).toBe(80000);
    expect(r.detectedDate).toBe("2026-03-10");
  });

  it("ignora un envío de dinero", () => {
    const r = parseNequiEmail({
      subject: "Enviaste dinero",
      text: "Enviaste $80.000 a Carlos Pérez.",
      date,
    });
    expect(r.isPayment).toBe(false);
  });

  it("detecta el correo real de Nequi Bre-B (monto sin '$')", () => {
    const r = parseNequiEmail({
      subject: "¡Recibiste plata por Bre-B!",
      text: "¡Hola, JANETH MARIA VERDOOREN DEGOMEZ! Recibiste 10.000 de DANIEL FARID RANGEL LLANOS el 9 de noviembre de 2026 a las 6:56 p.m, desde el banco Falabella. Revisa el detalle en los movimientos de tu app o descarga el comprobante si lo necesitas. Si no fuiste tú, escríbenos al chat: www.nequi.com.co o llama a la línea: (+57) 300 600 0100",
      date,
      from: "Nequi <no-responder@nequi.com.co>",
    });
    expect(r).not.toBeNull();
    expect(r.isPayment).toBe(true);
    expect(r.amount).toBe(10000);
  });

  it("devuelve null si no hay monto", () => {
    expect(parseNequiEmail({ subject: "Hola", text: "Sin montos" })).toBeNull();
  });
});

describe("toBogotaDateStr", () => {
  it("convierte a fecha de Colombia (UTC-5)", () => {
    // 2026-03-11 02:00 UTC = 2026-03-10 21:00 en Bogotá
    expect(toBogotaDateStr(new Date("2026-03-11T02:00:00Z"))).toBe("2026-03-10");
  });
});
