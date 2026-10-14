import { describe, it, expect, vi } from "vitest";
import { Car } from "../src/domain/entities/Car.js";
import { GetCarDebtDetailUseCase } from "../src/application/use-cases/cars/GetCarDebtDetailUseCase.js";

const OID = "000000000000000000000000";

function makeCar(overrides = {}) {
  return new Car({
    id: OID,
    plate: "ABC123",
    name: "Conductor 1",
    rate: 100000,
    startDate: "2024-01-01",
    active: true,
    ...overrides,
  });
}

describe("📊 GetCarDebtDetailUseCase — desglose día a día de la deuda", () => {
  it("carId inválido → ValidationError", async () => {
    const uc = new GetCarDebtDetailUseCase({
      carRepository: { findById: vi.fn() },
      paymentRepository: {},
      offDayRepository: {},
    });
    await expect(uc.execute({ carId: "malo" })).rejects.toThrow(/inválido/);
  });

  it("carro no existe → NotFoundError", async () => {
    const uc = new GetCarDebtDetailUseCase({
      carRepository: { findById: vi.fn(async () => null) },
      paymentRepository: {},
      offDayRepository: {},
    });
    await expect(uc.execute({ carId: OID })).rejects.toThrow(/no existe/);
  });

  it("calcula días cobrables: startDate+1 hasta today, excluye offDays", async () => {
    // startDate 2024-01-01 → cobran desde 2024-01-02 hasta 2024-01-05 = 4 días
    const car = makeCar({ startDate: "2024-01-01" });
    const offDayRepo = {
      findAll: vi.fn(async () => [
        { id: "1", carId: OID, date: "2024-01-03", reason: "descanso", detail: "" },
      ]),
    };
    const paymentRepo = { findAll: vi.fn(async () => []) };
    const carRepo = { findById: vi.fn(async () => car) };
    const uc = new GetCarDebtDetailUseCase({
      carRepository: carRepo, paymentRepository: paymentRepo, offDayRepository: offDayRepo,
    });

    const d = await uc.execute({ carId: OID, today: "2024-01-05" });
    expect(d.billableDays).toBe(3); // 4 días - 1 offDay
    expect(d.days.map((x) => x.date)).toEqual(["2024-01-02", "2024-01-04", "2024-01-05"]);
    expect(d.totalExpected).toBe(3 * 100000);
    expect(d.totalDebt).toBe(3 * 100000);
    expect(d.unpaidDays).toBe(3);
  });

  it("asigna pagos FIFO: los primeros días se marcan pagados primero", async () => {
    const car = makeCar({ startDate: "2024-01-01", rate: 100000 });
    const offDayRepo = { findAll: vi.fn(async () => []) };
    // 2 pagos de 100000 → cubren 2 de los 3 días
    const paymentRepo = {
      findAll: vi.fn(async () => [
        { id: "p1", carId: OID, date: "2024-01-02", amount: 100000, note: "", createdAt: 1 },
        { id: "p2", carId: OID, date: "2024-01-03", amount: 100000, note: "", createdAt: 2 },
      ]),
    };
    const carRepo = { findById: vi.fn(async () => car) };
    const uc = new GetCarDebtDetailUseCase({
      carRepository: carRepo, paymentRepository: paymentRepo, offDayRepository: offDayRepo,
    });

    const d = await uc.execute({ carId: OID, today: "2024-01-04" });
    expect(d.billableDays).toBe(3);
    expect(d.days[0].paid).toBe(true);
    expect(d.days[1].paid).toBe(true);
    expect(d.days[2].paid).toBe(false);
    expect(d.paidDays).toBe(2);
    expect(d.unpaidDays).toBe(1);
    expect(d.totalPaid).toBe(200000);
    expect(d.totalDebt).toBe(100000);
  });

  it("pago parcial: un día queda con 'partial' si el abono no cubre la tarifa completa", async () => {
    const car = makeCar({ startDate: "2024-01-01", rate: 100000 });
    const offDayRepo = { findAll: vi.fn(async () => []) };
    const paymentRepo = {
      findAll: vi.fn(async () => [
        { id: "p1", carId: OID, date: "2024-01-02", amount: 75000, note: "", createdAt: 1 },
      ]),
    };
    const carRepo = { findById: vi.fn(async () => car) };
    const uc = new GetCarDebtDetailUseCase({
      carRepository: carRepo, paymentRepository: paymentRepo, offDayRepository: offDayRepo,
    });

    const d = await uc.execute({ carId: OID, today: "2024-01-02" });
    expect(d.days[0].paid).toBe(false);
    expect(d.days[0].partial).toBe(true);
    expect(d.days[0].paidAmount).toBe(75000);
    expect(d.days[0].remaining).toBe(25000);
  });

  it("incluye offDays y payments en la respuesta", async () => {
    const car = makeCar({ startDate: "2024-01-01" });
    const offDayRepo = {
      findAll: vi.fn(async () => [
        { id: "1", carId: OID, date: "2024-01-02", reason: "otro", detail: "Reparación" },
      ]),
    };
    const paymentRepo = {
      findAll: vi.fn(async () => [
        { id: "p1", carId: OID, date: "2024-01-03", amount: 100000, note: "abono", createdAt: 1 },
      ]),
    };
    const carRepo = { findById: vi.fn(async () => car) };
    const uc = new GetCarDebtDetailUseCase({
      carRepository: carRepo, paymentRepository: paymentRepo, offDayRepository: offDayRepo,
    });

    const d = await uc.execute({ carId: OID, today: "2024-01-03" });
    expect(d.offDays).toHaveLength(1);
    expect(d.offDays[0].reason).toBe("otro");
    expect(d.offDays[0].detail).toBe("Reparación");
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0].amount).toBe(100000);
  });
});
