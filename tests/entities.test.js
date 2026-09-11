import { describe, it, expect } from "vitest";
import { Car } from "../src/domain/entities/Car.js";
import { Payment, Expense, VehicleDocument, OffDay, Settings, User } from "../src/domain/entities/index.js";
import { Refinance } from "../src/domain/entities/Refinance.js";

describe("🔒 Entidades: Car — validaciones exhaustivas", () => {
  it("normaliza placa correctamente (mayúsculas, sin espacios)", () => {
    const p = Car.normalizePlate(" abc 123 ");
    expect(p).toBe("ABC123");
  });

  it("rechaza placa vacía / no string", () => {
    expect(() => Car.normalizePlate("")).toThrow();
    expect(() => Car.normalizePlate(null)).toThrow();
    expect(() => Car.normalizePlate(undefined)).toThrow();
    expect(() => Car.normalizePlate(123)).toThrow();
  });

  it("rechaza placa con caracteres inválidos (XSS, emojis, símbolos raros)", () => {
    expect(() => Car.normalizePlate("AB<CD")).toThrow(/inválido/);
    expect(() => Car.normalizePlate("AB;CD")).toThrow(/inválido/);
    expect(() => Car.normalizePlate("AB'CD")).toThrow(/inválido/);
    expect(() => Car.normalizePlate("AB_CD")).toThrow(/inválido/);
  });

  it("rechaza placa muy corta", () => {
    expect(() => Car.normalizePlate("AB")).toThrow(/entre 3 y 10/);
  });

  it("rechaza placa muy larga", () => {
    expect(() => Car.normalizePlate("ABCDEFGHIJKLM")).toThrow(/entre 3 y 10/);
  });

  it("trunca name a 100 caracteres", () => {
    const longName = "x".repeat(1000);
    const c = new Car({ plate: "ABC123", name: longName }).validate();
    expect(c.name.length).toBe(100);
  });

  it("rechaza tarifa negativa", () => {
    expect(() => new Car({ plate: "ABC123", rate: -1 }).validate()).toThrow(/negativa/);
  });

  it("rechaza tarifa excesiva (mayor a 1e11)", () => {
    expect(() => new Car({ plate: "ABC123", rate: 999e12 }).validate()).toThrow(/excesiva/);
  });

  it("rechaza fecha inicio mal formato", () => {
    expect(() => new Car({ plate: "ABC123", startDate: "31-12-2024" }).validate()).toThrow(/formato YYYY-MM-DD/);
    expect(() => new Car({ plate: "ABC123", startDate: "2024/01/01" }).validate()).toThrow();
    expect(() => new Car({ plate: "ABC123", startDate: "2024-1-1" }).validate()).toThrow();
  });

  it("acepta placa con guión (formato internacional)", () => {
    const c = new Car({ plate: "ABC-123" });
    expect(c.plate).toBe("ABC-123");
  });

  it("tarifa NaN → 0, luego valida ok", () => {
    const c = new Car({ plate: "ABC123", rate: "hola" });
    expect(c.rate).toBe(0);
    expect(() => c.validate()).not.toThrow();
  });

  it("desactivar carro pone active=false", () => {
    const c = new Car({ plate: "ABC123" });
    expect(c.active).toBe(true);
    c.deactivate();
    expect(c.active).toBe(false);
  });
});

describe("🔒 Entidades: Payment / Expense — validaciones", () => {
  it("Payment rechaza carId muy corto", () => {
    expect(() => new Payment({ carId: "x", date: "2024-01-01", amount: 1000 })).toThrow(/obligatorio/);
  });

  it("Payment rechaza carId numérico / no-string", () => {
    expect(() => new Payment({ carId: 123, date: "2024-01-01", amount: 1000 })).toThrow(/obligatorio/);
  });

  it("Payment rechaza fecha inválida", () => {
    expect(() => new Payment({ carId: "0".repeat(24), date: "01-01-2024", amount: 1000 })).toThrow(/Fecha/);
  });

  it("Payment rechaza monto cero", () => {
    expect(() => new Payment({ carId: "0".repeat(24), date: "2024-01-01", amount: 0 })).toThrow(/mayor a 0/);
  });

  it("Payment rechaza monto negativo", () => {
    expect(() => new Payment({ carId: "0".repeat(24), date: "2024-01-01", amount: -1000 })).toThrow(/mayor a 0/);
  });

  it("Payment rechaza monto NaN / Infinity", () => {
    expect(() => new Payment({ carId: "0".repeat(24), date: "2024-01-01", amount: NaN })).toThrow();
    expect(() => new Payment({ carId: "0".repeat(24), date: "2024-01-01", amount: Infinity })).toThrow();
  });

  it("Payment trunca note a 500 caracteres", () => {
    const p = new Payment({
      carId: "0".repeat(24),
      date: "2024-01-01",
      amount: 1000,
      note: "x".repeat(10000),
    });
    expect(p.note.length).toBe(500);
  });

  it("Expense categoria default 'Otro'", () => {
    const e = new Expense({ date: "2024-01-01", amount: 1000 });
    expect(e.category).toBe("Otro");
  });

  it("Expense trunca category a 60", () => {
    const e = new Expense({
      date: "2024-01-01", amount: 1000,
      category: "x".repeat(1000),
    });
    expect(e.category.length).toBe(60);
  });
});

describe("🔒 Entidades: VehicleDocument / OffDay / Settings", () => {
  it("VehicleDocument requiere carId y tipo", () => {
    expect(() => new VehicleDocument({ carId: "x", type: "", expiry: "2024-01-01" })).toThrow();
    expect(() => new VehicleDocument({ carId: "0".repeat(24), type: "", expiry: "2024-01-01" })).toThrow(/tipo/);
  });

  it("VehicleDocument trunca type a 60", () => {
    const d = new VehicleDocument({
      carId: "0".repeat(24),
      type: "x".repeat(1000),
      expiry: "2024-12-31",
    });
    expect(d.type.length).toBe(60);
  });

  it("OffDay rechaza fecha inválida", () => {
    expect(() => new OffDay({ carId: "0".repeat(24), date: "ayer" })).toThrow();
  });

  it("OffDay rechaza carId inválido", () => {
    expect(() => new OffDay({ carId: "malo", date: "2024-01-01" })).toThrow(/obligatorio/);
  });

  it("Settings ajusta horas fuera de rango a fallback", () => {
    const s = new Settings({ morningHour: -5, eveningHour: 99 });
    expect(s.morningHour).toBe(8);
    expect(s.eveningHour).toBe(20);
  });

  it("Settings adminPhone se trunca a 30 caracteres", () => {
    const s = new Settings({ adminPhone: "1".repeat(200) });
    expect(s.adminPhone.length).toBe(30);
  });

  it("User normaliza username a minúsculas y trim", () => {
    const u = new User({ username: "  ADMIN@EXAMPLE.COM  " });
    expect(u.username).toBe("admin@example.com".slice(0, 40));
  });
});

describe("🔒 Entidades: Refinance — validaciones + calculos", () => {
  it("cuota diaria calculada correctamente", () => {
    const r = new Refinance({
      carId: "0".repeat(24),
      date: "2024-01-01",
      originalAmount: 1000,
      days: 10,
    });
    expect(r.dailyInstallment).toBe(100);
  });

  it("remaining = original - paidToPlan", () => {
    const r = new Refinance({
      carId: "0".repeat(24),
      date: "2024-01-01",
      originalAmount: 1000,
      days: 10,
      paidToPlan: 300,
    });
    expect(r.remaining).toBe(700);
  });

  it("remaining nunca es negativo — constructor lanza si paid > original", () => {
    expect(() => new Refinance({
      carId: "0".repeat(24),
      date: "2024-01-01",
      originalAmount: 1000,
      days: 10,
      paidToPlan: 1500,
    })).toThrow(/Abono excede/);
  });

  it("isSettled cuando paid == original", () => {
    const r = new Refinance({
      carId: "0".repeat(24),
      date: "2024-01-01",
      originalAmount: 1000,
      days: 10,
      paidToPlan: 1000,
    });
    expect(r.isSettled).toBe(true);
  });

  it("installmentsPaid cuenta cuotas completas", () => {
    const r = new Refinance({
      carId: "0".repeat(24),
      date: "2024-01-01",
      originalAmount: 1000,
      days: 10,
      paidToPlan: 350,
    });
    expect(r.installmentsPaid).toBe(3);
  });

  it("days no puede ser cero o negativo", () => {
    expect(() => new Refinance({
      carId: "0".repeat(24), date: "2024-01-01", originalAmount: 1000, days: 0,
    })).toThrow(/al menos 1 día/);
    expect(() => new Refinance({
      carId: "0".repeat(24), date: "2024-01-01", originalAmount: 1000, days: -5,
    })).toThrow(/al menos 1 día/);
  });

  it("days excesivo (más de 10 años) se rechaza", () => {
    expect(() => new Refinance({
      carId: "0".repeat(24), date: "2024-01-01", originalAmount: 1000, days: 365 * 11,
    })).toThrow(/Plazo excesivo/);
  });

  it("note se trunca a 500 chars", () => {
    const r = new Refinance({
      carId: "0".repeat(24), date: "2024-01-01",
      originalAmount: 1000, days: 5, note: "x".repeat(10000),
    });
    expect(r.note.length).toBe(500);
  });

  it("calcula cuota con decimales correctamente", () => {
    const r = new Refinance({
      carId: "0".repeat(24), date: "2024-01-01",
      originalAmount: 100, days: 3,
    });
    expect(typeof r.dailyInstallment).toBe("number");
    expect(r.dailyInstallment).toBeCloseTo(33.33, 2);
  });
});
