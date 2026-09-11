import { describe, it, expect } from "vitest";
import { totalBillableDays, computeMetrics } from "../src/domain/services/MetricsService.js";

const makeCar = (id, overrides = {}) => ({
  id, plate: id, name: "", rate: 100000,
  startDate: "2024-01-01", active: true,
  ...overrides,
});

describe("🧮 MetricsService: totalBillableDays", () => {
  it("si no hay fecha de inicio → 0 días cobrables", () => {
    expect(totalBillableDays(null, "2024-02-01")).toBe(0);
    expect(totalBillableDays(undefined, "2024-02-01")).toBe(0);
  });

  it("inicio hoy → 0 días (empieza a cobrar mañana)", () => {
    expect(totalBillableDays("2024-01-01", "2024-01-01")).toBe(0);
  });

  it("inicio ayer, hoy → 1 día cobrable", () => {
    expect(totalBillableDays("2024-01-01", "2024-01-02")).toBe(1);
  });

  it("inicio hace 7 días, hoy → 7 días cobrables", () => {
    expect(totalBillableDays("2024-01-01", "2024-01-08")).toBe(7);
  });

  it("fecha de inicio en el FUTURO → 0 días", () => {
    expect(totalBillableDays("2024-12-31", "2024-01-01")).toBe(0);
  });

  it("mes de 31 días correcto (diciembre 2024)", () => {
    expect(totalBillableDays("2024-12-01", "2025-01-01")).toBe(31);
  });

  it("año bisiesto febrero 2024 → 29 días contados bien", () => {
    expect(totalBillableDays("2024-02-01", "2024-03-01")).toBe(29);
  });
});

describe("🧮 MetricsService: computeMetrics — casos extremos y bugs", () => {
  it("sin datos → métricas vacías, no NaN ni undefined", () => {
    const m = computeMetrics({});
    expect(m.totalPaid).toBe(0);
    expect(m.totalExp).toBe(0);
    expect(m.profit).toBe(0);
    expect(m.totalExpected).toBe(0);
    expect(m.totalDebt).toBe(0);
    expect(m.totalTariffDebt).toBe(0);
    expect(m.totalPlanRemaining).toBe(0);
    expect(m.totalBillable).toBe(0);
    expect(m.perCar).toEqual({});
  });

  it("carros inactivos no se incluyen en cálculos (solo activos)", () => {
    const cars = [
      makeCar("A", { plate: "AAA", startDate: "2024-01-01", active: true }),
      makeCar("B", { plate: "BBB", startDate: "2024-01-01", active: false }),
    ];
    const today = "2024-01-11";
    const m = computeMetrics({ cars, payments: [], expenses: [], offDays: [], refinances: [], today });
    expect(Object.keys(m.perCar).length).toBe(1);
    expect(m.perCar.A).toBeDefined();
    expect(m.perCar.B).toBeUndefined();
    expect(m.perCar.A.elapsedDays).toBe(totalBillableDays("2024-01-01", today));
  });

  it("días no trabajados se restan de los cobrables", () => {
    const cars = [makeCar("A", { plate: "AAA", startDate: "2024-01-01", active: true, rate: 100 })];
    const offDays = [
      { carId: "A", date: "2024-01-02" },
      { carId: "A", date: "2024-01-03" },
    ];
    const today = "2024-01-11";
    const m = computeMetrics({ cars, payments: [], expenses: [], offDays, refinances: [], today });
    const base = totalBillableDays("2024-01-01", today);
    expect(base).toBe(10);
    expect(m.perCar.A.offDays).toBe(2);
    expect(m.perCar.A.billableDays).toBe(8);
    expect(m.perCar.A.expected).toBe(8 * 100);
  });

  it("pagos reducen la deuda correctamente", () => {
    const cars = [makeCar("A", { startDate: "2024-01-01", rate: 100, active: true })];
    const payments = [{ carId: "A", date: "2024-01-05", amount: 500 }];
    const today = "2024-01-11";
    const m = computeMetrics({ cars, payments, expenses: [], offDays: [], refinances: [], today });
    expect(m.perCar.A.paid).toBe(500);
    expect(m.totalPaid).toBe(500);
    const expected = totalBillableDays("2024-01-01", today) * 100;
    expect(m.perCar.A.tariffDebt).toBe(expected - 500);
  });

  it("utilidad = total pagado - gastos", () => {
    const m = computeMetrics({
      cars: [],
      payments: [{ carId: "x", date: "2024-01-05", amount: 1000 }],
      expenses: [{ date: "2024-01-05", amount: 300 }],
      offDays: [],
      refinances: [],
    });
    expect(m.totalPaid).toBe(1000);
    expect(m.totalExp).toBe(300);
    expect(m.profit).toBe(700);
  });

  it("deuda no se vuelve negativa (si el conductor paga de más)", () => {
    const cars = [makeCar("A", { startDate: "2024-01-01", rate: 100, active: true })];
    const payments = [{ carId: "A", date: "2024-01-05", amount: 99999999 }];
    const m = computeMetrics({ cars, payments, expenses: [], offDays: [], refinances: [] });
    expect(m.totalTariffDebt).toBe(0);
    expect(m.totalDebt).toBe(0);
  });

  it("refinanciamiento activo: suma frozen, planDaily y planRemaining correctos", () => {
    const cars = [makeCar("A", { startDate: "2024-01-01", rate: 100, active: true })];
    const refinances = [{
      id: "r1", carId: "A", date: "2024-01-01",
      originalAmount: 1000, days: 10, paidToPlan: 200,
      get remaining() { return 1000 - 200; },
      get dailyInstallment() { return 100; },
      active: true,
    }];
    const today = "2024-01-11";
    const m = computeMetrics({ cars, payments: [], expenses: [], offDays: [], refinances, today });
    expect(m.perCar.A.frozen).toBe(1000);
    expect(m.perCar.A.planRemaining).toBe(800);
    expect(m.perCar.A.planDaily).toBe(100);
    expect(m.perCar.A.dailyTotal).toBe(100 + 100);
    const expected = totalBillableDays("2024-01-01", today) * 100;
    expect(m.perCar.A.tariffDebt).toBe(expected - 0 - 1000);
    expect(m.perCar.A.debt).toBe(Math.max(0, expected - 1000) + 800);
  });

  it("refinanciamiento INACTIVO: no se incluye", () => {
    const cars = [makeCar("A", { startDate: "2024-01-01", rate: 100, active: true })];
    const refinances = [{
      id: "r1", carId: "A", date: "2024-01-01",
      originalAmount: 1000, days: 10, paidToPlan: 200,
      get remaining() { return 1000 - 200; },
      get dailyInstallment() { return 100; },
      active: false,
    }];
    const today = "2024-01-11";
    const m = computeMetrics({ cars, payments: [], expenses: [], offDays: [], refinances, today });
    expect(m.perCar.A.frozen).toBe(0);
    expect(m.perCar.A.planRemaining).toBe(0);
    expect(m.perCar.A.planDaily).toBe(0);
    expect(m.totalPlanRemaining).toBe(0);
  });

  it("monthPaid / monthExp filtran por mes actual correctamente", () => {
    const payments = [
      { carId: "A", date: "2024-01-15", amount: 100 },
      { carId: "A", date: "2024-01-20", amount: 200 },
      { carId: "A", date: "2023-12-20", amount: 9999 },
    ];
    const expenses = [
      { date: "2024-01-10", amount: 50 },
      { date: "2024-02-10", amount: 9999 },
    ];
    const today = "2024-01-25";
    const m = computeMetrics({
      cars: [], payments, expenses, offDays: [], refinances: [], today,
    });
    expect(m.monthPaid).toBe(300);
    expect(m.monthExp).toBe(50);
    expect(m.totalPaid).toBe(100 + 200 + 9999);
    expect(m.totalExp).toBe(50 + 9999);
  });

  it("pagos NaN / montos corruptos → no rompen (no son NaN, Number('corrupto')=NaN -> reduce suma)", () => {
    const payments = [
      { carId: "A", date: "2024-01-01", amount: NaN },
      { carId: "A", date: "2024-01-01", amount: "corrupto" },
      { carId: "A", date: "2024-01-01", amount: 100 },
    ];
    const m = computeMetrics({ cars: [], payments, expenses: [], offDays: [], refinances: [], today: "2024-01-15" });
    expect(Number.isNaN(m.totalPaid)).toBe(false);
  });
});
