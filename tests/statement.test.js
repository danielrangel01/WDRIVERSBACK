import { describe, it, expect, vi } from "vitest";
import { GetAccountStatementUseCase } from "../src/application/use-cases/statement/index.js";

const CAR_ID = "a1a1a1a1a1a1a1a1a1a1a1a1"; // 24 hex
const OTHER_ID = "b1b1b1b1b1b1b1b1b1b1b1b1";

const CAR = {
  id: CAR_ID, plate: "AAA111", name: "Conductor 1", rate: 100000, startDate: "2024-01-01", active: true,
};

function makeUc({ car = CAR, payments = [], offDays = [], refinances = [] } = {}) {
  return new GetAccountStatementUseCase({
    carRepository: { findById: vi.fn(async (id) => (car && car.id === id ? car : null)) },
    paymentRepository: { findAll: vi.fn(async () => payments) },
    offDayRepository: { findAll: vi.fn(async () => offDays) },
    refinanceRepository: { findAll: vi.fn(async () => refinances) },
  });
}

describe("📄 GetAccountStatementUseCase — estado de cuenta por conductor", () => {
  it("identificador inválido → ValidationError", async () => {
    await expect(makeUc().execute({ carId: "xyz" })).rejects.toThrow(/inválido/);
  });

  it("fecha inválida → ValidationError", async () => {
    await expect(makeUc().execute({ carId: CAR_ID, today: "15-02-2024" })).rejects.toThrow(/Fecha inválida/);
  });

  it("rango invertido (desde > hasta) → ValidationError", async () => {
    await expect(
      makeUc().execute({ carId: CAR_ID, from: "2024-03-01", to: "2024-02-01" })
    ).rejects.toThrow(/Rango de fechas/);
  });

  it("carro inexistente → NotFoundError", async () => {
    await expect(makeUc().execute({ carId: OTHER_ID })).rejects.toThrow(/no existe/);
  });

  it("período por defecto = mes en curso (cargos del mes + saldo anterior)", async () => {
    const r = await makeUc().execute({ carId: CAR_ID, today: "2024-02-15" });

    expect(r.period.from).toBe("2024-02-01");
    expect(r.period.to).toBe("2024-02-15");
    // Enero: 2024-01-02 … 2024-01-31 = 30 días cobrables → saldo anterior
    expect(r.openingBalance).toBe(30 * 100000);
    // Febrero: 2024-02-01 … 2024-02-15 = 15 días
    expect(r.chargesDays).toBe(15);
    expect(r.charges).toBe(15 * 100000);
    expect(r.payments).toBe(0);
    expect(r.closingBalance).toBe(45 * 100000);
    expect(r.currentDebt).toBe(45 * 100000);
    expect(r.unpaidDays).toBe(15);
  });

  it("un abono dentro del período reduce el saldo actual", async () => {
    const r = await makeUc({
      payments: [{ id: "p1", carId: CAR_ID, date: "2024-02-10", amount: 500000, note: "", createdAt: 1 }],
    }).execute({ carId: CAR_ID, today: "2024-02-15" });

    expect(r.openingBalance).toBe(30 * 100000); // saldo anterior intacto
    expect(r.charges).toBe(15 * 100000);
    expect(r.payments).toBe(500000);
    expect(r.paymentsCount).toBe(1);
    expect(r.closingBalance).toBe(30 * 100000 + 15 * 100000 - 500000); // 4.000.000
    expect(r.currentDebt).toBe(40 * 100000);
  });

  it("un abono del período anterior se refleja en el saldo anterior", async () => {
    const r = await makeUc({
      payments: [{ id: "p1", carId: CAR_ID, date: "2024-01-15", amount: 1000000, note: "", createdAt: 1 }],
    }).execute({ carId: CAR_ID, today: "2024-02-15" });

    // Pago de 10 días → cubre 2024-01-02 … 2024-01-11 → quedan 20 días de enero
    expect(r.openingBalance).toBe(20 * 100000);
    expect(r.payments).toBe(0);
    expect(r.closingBalance).toBe(35 * 100000);
    expect(r.currentDebt).toBe(35 * 100000);
  });

  it("acepta un rango explícito (mes de enero completo)", async () => {
    const r = await makeUc().execute({ carId: CAR_ID, from: "2024-01-01", to: "2024-01-31" });

    expect(r.chargesDays).toBe(30); // 2024-01-02 … 2024-01-31
    expect(r.openingBalance).toBe(0);
    expect(r.charges).toBe(30 * 100000);
    expect(r.closingBalance).toBe(30 * 100000);
  });

  it("incluye el plan de refinanciación activo", async () => {
    const r = await makeUc({
      refinances: [{
        id: "r1", carId: CAR_ID, date: "2024-02-01", originalAmount: 1000000, days: 20,
        paidToPlan: 200000, active: true, dailyInstallment: 50000, remaining: 800000, installmentsPaid: 4,
      }],
    }).execute({ carId: CAR_ID, today: "2024-02-15" });

    expect(r.plan.active).toBe(true);
    expect(r.plan.remaining).toBe(800000);
    expect(r.plan.dailyInstallment).toBe(50000);
    expect(r.plan.paidToPlan).toBe(200000);
    expect(r.whatsappText).toContain("Plan de pago");
  });

  it("genera el texto con placa, período y saldo", async () => {
    const r = await makeUc().execute({ carId: CAR_ID, today: "2024-02-15" });
    expect(r.whatsappText).toContain("Estado de Cuenta");
    expect(r.whatsappText).toContain("AAA111");
    expect(r.whatsappText).toContain("01/02/2024");
    expect(r.whatsappText).toContain("Saldo actual");
    expect(r.whatsappText).toContain("_W Drivers_");
  });
});
