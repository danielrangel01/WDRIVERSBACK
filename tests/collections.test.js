import { describe, it, expect, vi } from "vitest";
import { GetCollectionsUseCase } from "../src/application/use-cases/collections/index.js";

const CAR = {
  id: "a1", plate: "AAA111", name: "Conductor 1", rate: 100000, startDate: "2024-01-01", active: true,
};

function makeUc({ cars = [CAR], payments = [], offDays = [], refinances = [] } = {}) {
  return new GetCollectionsUseCase({
    carRepository: { findAll: vi.fn(async () => cars) },
    paymentRepository: { findAll: vi.fn(async () => payments) },
    offDayRepository: { findAll: vi.fn(async () => offDays) },
    refinanceRepository: { findAll: vi.fn(async () => refinances) },
  });
}

describe("📉 GetCollectionsUseCase — antigüedad (aging) y priorización de cobranza", () => {
  it("fecha inválida → ValidationError", async () => {
    await expect(makeUc().execute({ date: "15-02-2024" })).rejects.toThrow(/Fecha inválida/);
  });

  it("clasifica la deuda en tramos de antigüedad (0-7 / 8-15 / 16-30 / +30)", async () => {
    // startDate 2024-01-01 → 45 días cobrables hasta 2024-02-15, sin pagos
    const r = await makeUc().execute({ date: "2024-02-15" });

    expect(r.summary.fleetDebt).toBe(45 * 100000);
    expect(r.summary.moraCount).toBe(1);
    expect(r.summary.criticalCount).toBe(1);

    const b = r.cars[0].buckets;
    expect(b.d30plus).toEqual({ amount: 14 * 100000, days: 14 });
    expect(b.d16_30).toEqual({ amount: 15 * 100000, days: 15 });
    expect(b.d8_15).toEqual({ amount: 8 * 100000, days: 8 });
    expect(b.current).toEqual({ amount: 8 * 100000, days: 8 });

    expect(r.cars[0].severity).toBe("critical");
    expect(r.cars[0].daysSinceOldest).toBe(44); // 2024-01-02 → 2024-02-15
    expect(r.summary.overdueAmount).toBe((14 + 15 + 8) * 100000); // todo lo de +7 días
  });

  it("los pagos FIFO cubren los días más antiguos primero (baja el tramo viejo)", async () => {
    // Pago de 10 días → cubre 2024-01-02 … 2024-01-11
    const r = await makeUc({
      payments: [{ id: "p1", carId: "a1", date: "2024-01-02", amount: 1000000, note: "", createdAt: 1 }],
    }).execute({ date: "2024-02-15" });

    expect(r.cars[0].debt).toBe(35 * 100000);
    // El día impago más antiguo pasa a 2024-01-12 (4 días aún en +30)
    expect(r.cars[0].buckets.d30plus).toEqual({ amount: 4 * 100000, days: 4 });
  });

  it("prioriza por severidad y luego por monto", async () => {
    const recent = { id: "b1", plate: "BBB222", name: "Reciente", rate: 100000, startDate: "2024-02-10", active: true };
    const r = await makeUc({ cars: [recent, CAR] }).execute({ date: "2024-02-15" });

    expect(r.cars[0].plate).toBe("AAA111"); // crítica (+30) primero
    expect(r.cars[1].plate).toBe("BBB222"); // menor antigüedad después
    expect(r.cars[1].severity).toBe("low"); // sólo tramo 0-7
  });

  it("calcula el atraso del plan de refinanciación (cuotas devengadas − abonado)", async () => {
    const r = await makeUc({
      cars: [{ ...CAR, startDate: "2024-02-01" }],
      payments: [{ id: "p1", carId: "a1", date: "2024-02-02", amount: 100000, note: "", createdAt: 1 }],
      refinances: [{
        id: "r1", carId: "a1", date: "2024-02-05", originalAmount: 1000000, days: 20,
        paidToPlan: 0, active: true, dailyInstallment: 50000, remaining: 1000000,
      }],
    }).execute({ date: "2024-02-15" });

    const c = r.cars[0];
    // 10 días devengados × 50.000 = 500.000 esperado; abonado 0 → atraso 500.000
    expect(c.planBehind).toBe(500000);
    expect(c.planRemaining).toBe(1000000);
    expect(c.debt).toBe(c.tariffDebt + 1000000);
    expect(r.summary.planBehind).toBe(500000);
  });

  it("excluye a los carros al día y los cuenta en upToDateCount", async () => {
    const r = await makeUc({
      // startDate 2024-02-14 → 1 día cobrable (2024-02-15), pagado
      cars: [{ id: "c1", plate: "CCC333", name: "Al día", rate: 100000, startDate: "2024-02-14", active: true }],
      payments: [{ id: "p1", carId: "c1", date: "2024-02-15", amount: 100000, note: "", createdAt: 1 }],
    }).execute({ date: "2024-02-15" });

    expect(r.cars).toHaveLength(0);
    expect(r.summary.upToDateCount).toBe(1);
    expect(r.summary.fleetDebt).toBe(0);
  });

  it("genera el texto de WhatsApp con prioridad de cobro y montos", async () => {
    const r = await makeUc().execute({ date: "2024-02-15" });
    expect(r.whatsappText).toContain("Cobranza");
    expect(r.whatsappText).toContain("AAA111");
    expect(r.whatsappText).toContain("+30 días");
    expect(r.whatsappText).toContain("_W Drivers_");
  });
});
