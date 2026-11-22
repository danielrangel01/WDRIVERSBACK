import { describe, it, expect, vi } from "vitest";
import { Handover } from "../src/domain/entities/Handover.js";
import { Car } from "../src/domain/entities/Car.js";
import { Payment } from "../src/domain/entities/index.js";
import {
  RegisterHandoverUseCase, CloseHandoverUseCase, ListHandoversUseCase, DeleteHandoverUseCase,
} from "../src/application/use-cases/handovers/index.js";
import { groupRowsByDriver, handoverForDate, addDays } from "../src/domain/services/DriverAttribution.js";
import { GetAgendaUseCase } from "../src/application/use-cases/agenda/index.js";
import { GetCarDebtDetailUseCase } from "../src/application/use-cases/cars/GetCarDebtDetailUseCase.js";
import { GetAccountStatementUseCase } from "../src/application/use-cases/statement/index.js";

const CAR_ID = "a1a1a1a1a1a1a1a1a1a1a1a1";
const CAR_ID2 = "c1c1c1c1c1c1c1c1c1c1c1c1";
const H1 = "111111111111111111111111";
const TODAY = "2024-06-30";

const car = (over = {}) => new Car({ id: CAR_ID, plate: "AAA111", name: "Juan", rate: 100000, startDate: "2024-06-01", ...over });

function makeHandoverRepo(initial = []) {
  const store = [...initial];
  let seq = 100;
  return {
    findActiveByCar: vi.fn(async (carId) => store.find((h) => String(h.carId) === String(carId) && !h.endDate) || null),
    findByCar: vi.fn(async (carId) => store.filter((h) => String(h.carId) === String(carId))),
    findAll: vi.fn(async () => store),
    findById: vi.fn(async (id) => store.find((h) => h.id === id) || null),
    create: vi.fn(async (h) => { h.id = `h${seq++}`; store.push(h); return h; }),
    update: vi.fn(async (h) => h),
    delete: vi.fn(async (id) => { const i = store.findIndex((h) => h.id === id); if (i >= 0) store.splice(i, 1); }),
    deleteAll: vi.fn(async () => { store.length = 0; }),
  };
}

describe("🤝 Handover — entrega de carro a un conductor", () => {
  it("exige carro y nombre del conductor", () => {
    expect(() => new Handover({ carId: "", driverName: "Ana", startDate: "2024-06-01" })).toThrow(/carro/);
    expect(() => new Handover({ carId: CAR_ID, driverName: "  ", startDate: "2024-06-01" })).toThrow(/conductor/);
  });

  it("valida el formato de las fechas y el orden entrega/devolución", () => {
    expect(() => new Handover({ carId: CAR_ID, driverName: "Ana", startDate: "01-06-2024" })).toThrow(/entrega/);
    expect(() => new Handover({ carId: CAR_ID, driverName: "Ana", startDate: "2024-06-10", endDate: "2024-06-01" }))
      .toThrow(/devolución/);
  });

  it("covers/isActive/toJSON y limpieza del teléfono", () => {
    const h = new Handover({
      id: "h1", carId: CAR_ID, driverName: "Ana", driverPhone: "+57 300 123-45",
      startDate: "2024-06-01", endDate: "2024-06-10",
    });
    expect(h.isActive).toBe(false);
    expect(h.covers("2024-06-05")).toBe(true);
    expect(h.covers("2024-06-11")).toBe(false);
    expect(h.driverPhone).toBe("+5730012345");
    expect(h.toJSON().active).toBe(false);

    const vigente = new Handover({ id: "h2", carId: CAR_ID, driverName: "Beto", startDate: "2024-06-11" });
    expect(vigente.isActive).toBe(true);
    expect(vigente.covers("2030-01-01")).toBe(true);
  });
});

describe("🤝 Casos de uso de entregas", () => {
  it("registrar una nueva entrega cierra la vigente el día anterior", async () => {
    const h1 = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01" });
    const repo = makeHandoverRepo([h1]);
    const uc = new RegisterHandoverUseCase({
      handoverRepository: repo,
      carRepository: { findById: async (id) => (id === CAR_ID ? car() : null) },
    });

    const created = await uc.execute({ carId: CAR_ID, driverName: "Beto", date: "2024-06-15" });

    expect(h1.endDate).toBe("2024-06-14");
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(created.driverName).toBe("Beto");
    expect(created.startDate).toBe("2024-06-15");
    expect(created.endDate).toBe(null);
  });

  it("no permite una entrega con fecha no posterior a la vigente", async () => {
    const h1 = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", startDate: "2024-06-10" });
    const repo = makeHandoverRepo([h1]);
    const uc = new RegisterHandoverUseCase({ handoverRepository: repo, carRepository: { findById: async () => car() } });

    await expect(uc.execute({ carId: CAR_ID, driverName: "Beto", date: "2024-06-10" })).rejects.toThrow(/posterior/);
  });

  it("una entrega inválida NO cierra la vigente (el carro no queda sin conductor)", async () => {
    const h1 = new Handover({ id: H1, carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01" });
    const repo = makeHandoverRepo([h1]);
    const uc = new RegisterHandoverUseCase({ handoverRepository: repo, carRepository: { findById: async () => car() } });

    await expect(uc.execute({ carId: CAR_ID, driverName: "   ", date: "2024-06-15" })).rejects.toThrow(/conductor/);

    expect(h1.endDate).toBe(null);
    expect(h1.isActive).toBe(true);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("valida identificador, fecha y existencia del carro", async () => {
    const uc = new RegisterHandoverUseCase({
      handoverRepository: makeHandoverRepo([]),
      carRepository: { findById: async () => null },
    });
    await expect(uc.execute({ carId: "xx", driverName: "X", date: "2024-06-01" })).rejects.toThrow(/inválido/);
    await expect(uc.execute({ carId: CAR_ID, driverName: "X", date: "mal" })).rejects.toThrow(/Fecha de entrega/);
    await expect(uc.execute({ carId: CAR_ID, driverName: "X", date: "2024-06-01" })).rejects.toThrow(/no existe/);
  });

  it("cerrar la vigente fija la devolución y no permite repetir", async () => {
    const h1 = new Handover({ id: H1, carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01" });
    const uc = new CloseHandoverUseCase({ handoverRepository: makeHandoverRepo([h1]) });

    const r = await uc.execute({ id: H1, date: "2024-06-20" });
    expect(r.endDate).toBe("2024-06-20");
    await expect(uc.execute({ id: H1, date: "2024-06-21" })).rejects.toThrow(/cerrada/);
  });

  it("lista todas las entregas o las de un carro", async () => {
    const h1 = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01" });
    const h2 = new Handover({ id: "h2", carId: CAR_ID2, driverName: "Beto", startDate: "2024-06-01" });
    const uc = new ListHandoversUseCase({ handoverRepository: makeHandoverRepo([h1, h2]) });

    expect((await uc.execute()).length).toBe(2);
    expect((await uc.execute({ carId: CAR_ID })).length).toBe(1);
  });

  it("elimina una entrega", async () => {
    const h1 = new Handover({ id: H1, carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01" });
    const repo = makeHandoverRepo([h1]);
    const uc = new DeleteHandoverUseCase({ handoverRepository: repo });
    await uc.execute({ id: H1 });
    expect(repo.delete).toHaveBeenCalledWith(H1);
  });
});

describe("👤 Atribución por conductor (DriverAttribution)", () => {
  it("addDays y handoverForDate resuelven la entrega que cubre la fecha", () => {
    expect(addDays("2024-06-01", -1)).toBe("2024-05-31");
    expect(addDays("2024-06-30", 1)).toBe("2024-07-01");

    const h1 = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01", endDate: "2024-06-10" });
    const h2 = new Handover({ id: "h2", carId: CAR_ID, driverName: "Beto", startDate: "2024-06-11" });

    expect(handoverForDate("2024-06-05", [h1, h2]).driverName).toBe("Ana");
    expect(handoverForDate("2024-06-15", [h1, h2]).driverName).toBe("Beto");
    expect(handoverForDate("2024-05-20", [h1, h2])).toBe(null);
  });

  it("agrupa los días por entrega (cobro al conductor que lo tuvo)", () => {
    const rows = [
      { date: "2024-06-01", amount: 100000, paidAmount: 100000, remaining: 0 },
      { date: "2024-06-02", amount: 100000, paidAmount: 0, remaining: 100000 },
      { date: "2024-06-03", amount: 100000, paidAmount: 0, remaining: 100000 },
    ];
    const h1 = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01", endDate: "2024-06-01" });
    const h2 = new Handover({ id: "h2", carId: CAR_ID, driverName: "Beto", startDate: "2024-06-02" });

    const g = groupRowsByDriver(rows, [h1, h2]);

    expect(g).toHaveLength(2);
    expect(g[0].driverName).toBe("Ana");
    expect(g[0].days).toBe(1);
    expect(g[0].charged).toBe(100000);
    expect(g[0].settled).toBe(true);
    expect(g[1].driverName).toBe("Beto");
    expect(g[1].days).toBe(2);
    expect(g[1].remaining).toBe(200000);
    expect(g[1].from).toBe("2024-06-02");
    expect(g[1].to).toBe("2024-06-03");
  });

  it("los días sin entrega quedan como 'Sin conductor'", () => {
    const rows = [{ date: "2024-06-01", amount: 100000, paidAmount: 0, remaining: 100000 }];
    const g = groupRowsByDriver(rows, []);
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe("__none__");
    expect(g[0].driverName).toBe("");
    expect(g[0].remaining).toBe(100000);
  });
});

describe("🎯 Agenda — marcador 12/12 y conductor del día", () => {
  const buildAgenda = ({ cars, payments = [], offDays = [], handovers = [] }) => new GetAgendaUseCase({
    carRepository: { findAll: async () => cars },
    paymentRepository: { findAll: async () => payments },
    offDayRepository: { findAll: async () => offDays },
    refinanceRepository: { findAll: async () => [] },
    documentRepository: { findAll: async () => [] },
    pendingPaymentRepository: { findAll: async () => [] },
    handoverRepository: { findAll: async () => handovers },
  });

  it("cuenta cobertura y atribuye el conductor vigente a cada carro", async () => {
    const cars = [car(), new Car({ id: CAR_ID2, plate: "BBB222", name: "Pedro", rate: 100000, startDate: "2024-06-01" })];
    const h = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", driverPhone: "3001112233", startDate: "2024-06-01" });
    const offDays = [{ carId: CAR_ID2, date: TODAY, reason: "descanso" }];

    const r = await buildAgenda({ cars, offDays, handovers: [h] }).execute({ date: TODAY });

    expect(r.summary.fleetTotal).toBe(2);
    expect(r.summary.coveredCount).toBe(1); // el segundo está libre hoy
    expect(r.summary.pendingCarsCount).toBe(1);
    expect(r.summary.allCovered).toBe(false);

    const pending = r.pendingCars[0];
    expect(pending.carId).toBe(CAR_ID);
    expect(pending.driverName).toBe("Ana");
    expect(pending.driverPhone).toBe("3001112233");
    expect(pending.covered).toBe(false);

    const libre = r.checklist.find((c) => c.carId === CAR_ID2);
    expect(libre.covered).toBe(true);
    expect(libre.offToday).toBe(true);
  });

  it("un pago registrado hoy cubre el carro (queda gestionado)", async () => {
    const cars = [car()];
    const payments = [new Payment({ id: "p1", carId: CAR_ID, date: TODAY, amount: 2900000 })];

    const r = await buildAgenda({ cars, payments }).execute({ date: TODAY });

    expect(r.summary.coveredCount).toBe(1);
    expect(r.summary.pendingCarsCount).toBe(0);
    expect(r.summary.allCovered).toBe(true);
    expect(r.checklist[0].covered).toBe(true);
    expect(r.checklist[0].paidToday).toBe(2900000);
  });

  it("carro sin entrega registrada queda 'sin conductor'", async () => {
    const r = await buildAgenda({ cars: [car()] }).execute({ date: TODAY });
    expect(r.checklist[0].handoverId).toBe(null);
    expect(r.checklist[0].driverName).toBe("");
    expect(r.summary.carsWithoutDriverCount).toBe(1);
  });
});

describe("🧾 Detalle de deuda y estado de cuenta con entregas", () => {
  it("el detalle de deuda desglosa la deuda por conductor", async () => {
    const h1 = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", startDate: "2024-06-01", endDate: "2024-06-15" });
    const h2 = new Handover({ id: "h2", carId: CAR_ID, driverName: "Beto", startDate: "2024-06-16" });
    const uc = new GetCarDebtDetailUseCase({
      carRepository: { findById: async (id) => (id === CAR_ID ? car() : null) },
      paymentRepository: { findAll: async () => [] },
      offDayRepository: { findAll: async () => [] },
      handoverRepository: { findByCar: async () => [h1, h2] },
    });

    const r = await uc.execute({ carId: CAR_ID, today: TODAY });

    expect(r.drivers).toHaveLength(2);
    expect(r.drivers[0].driverName).toBe("Ana");
    expect(r.drivers[0].days).toBe(14); // 06-02 … 06-15 (el inicio no cobra)
    expect(r.drivers[1].driverName).toBe("Beto");
    expect(r.drivers[1].from).toBe("2024-06-16");
    expect(r.driverDebt).toBe(r.totalDebt);
    expect(r.handovers).toHaveLength(2);
  });

  it("el estado de cuenta incluye el desglose por conductor en el texto", async () => {
    const h = new Handover({ id: "h1", carId: CAR_ID, driverName: "Ana", startDate: "2024-01-01" });
    const uc = new GetAccountStatementUseCase({
      carRepository: { findById: async (id) => (id === CAR_ID ? car({ startDate: "2024-01-01" }) : null) },
      paymentRepository: { findAll: async () => [] },
      offDayRepository: { findAll: async () => [] },
      refinanceRepository: { findAll: async () => [] },
      handoverRepository: { findByCar: async () => [h] },
    });

    const r = await uc.execute({ carId: CAR_ID, today: "2024-02-15" });

    expect(r.drivers).toHaveLength(1);
    expect(r.drivers[0].driverName).toBe("Ana");
    expect(r.whatsappText).toContain("Por conductor");
    expect(r.whatsappText).toContain("Ana");
  });
});
