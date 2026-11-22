import { describe, it, expect } from "vitest";
import { Car } from "../src/domain/entities/Car.js";
import { Payment } from "../src/domain/entities/index.js";
import { OffDay, VehicleDocument, PendingPayment } from "../src/domain/entities/index.js";
import { Refinance } from "../src/domain/entities/Refinance.js";
import { GetAgendaUseCase } from "../src/application/use-cases/agenda/index.js";

const TODAY = "2024-06-30";

const C1 = "000000000000000000000001";
const C2 = "000000000000000000000002";
const C3 = "000000000000000000000003";

function build({ cars = [], payments = [], offDays = [], refinances = [], documents = [], pendingPayments = [] }) {
  const carRepository = { findAll: async () => cars };
  const paymentRepository = { findAll: async () => payments };
  const offDayRepository = { findAll: async () => offDays };
  const refinanceRepository = { findAll: async () => refinances };
  const documentRepository = { findAll: async () => documents };
  const pendingPaymentRepository = { findAll: async () => pendingPayments };
  return new GetAgendaUseCase({
    carRepository, paymentRepository, offDayRepository,
    refinanceRepository, documentRepository, pendingPaymentRepository,
  });
}

describe("📅 Agenda (Centro de Gestión del Día)", () => {
  it("carro con deuda entra en 'por cobrar' y cuenta días de atraso", async () => {
    const car = new Car({ id: C1, plate: "ABC123", name: "Juan", rate: 100000, startDate: "2024-06-01" });
    const uc = build({ cars: [car] });
    const r = await uc.execute({ date: TODAY });

    expect(r.summary.collectTodayCount).toBe(1);
    expect(r.collectToday[0].carId).toBe(C1);
    // 06-01 inicio (no cobra) → 06-02..06-30 = 29 días × 100.000
    expect(r.collectToday[0].debt).toBe(2900000);
    expect(r.collectToday[0].daysBehind).toBe(29);
    expect(r.summary.overdueCount).toBe(1);
    expect(r.summary.overdueAmount).toBe(2900000);
  });

  it("carro que pagó completo queda 'al día' y NO aparece en por cobrar", async () => {
    const car = new Car({ id: C2, plate: "DEF456", rate: 100000, startDate: "2024-06-01" });
    const pay = new Payment({ id: "p1", carId: C2, date: "2024-06-29", amount: 2900000 });
    const uc = build({ cars: [car], payments: [pay] });
    const r = await uc.execute({ date: TODAY });

    expect(r.collectToday).toHaveLength(0);
    expect(r.overdue).toHaveLength(0);
    expect(r.summary.upToDateCount).toBe(1);
    expect(r.upToDate[0].carId).toBe(C2);
    expect(r.upToDate[0].lastPaymentDate).toBe("2024-06-29");
  });

  it("pago parcial: sigue en por cobrar pero NO como atrasado grave (<2 días)", async () => {
    const car = new Car({ id: C3, plate: "GHI789", rate: 100000, startDate: "2024-06-28" });
    const uc = build({ cars: [car] });
    const r = await uc.execute({ date: TODAY });

    // 06-29 y 06-30 = 2 días = 200.000 → daysBehind 2 → sí atrasado
    expect(r.collectToday[0].debt).toBe(200000);
    expect(r.summary.overdueCount).toBe(1);

    // Con un pago de 1 día, deuda = 100.000 → daysBehind 1 → no atrasado grave
    const pay = new Payment({ id: "p2", carId: C3, date: TODAY, amount: 100000 });
    const r2 = await build({ cars: [car], payments: [pay] }).execute({ date: TODAY });
    expect(r2.collectToday[0].debt).toBe(100000);
    expect(r2.summary.overdueCount).toBe(0);
    expect(r2.collectToday[0].paidToday).toBe(100000);
  });

  it("día no trabajado descuenta el día (no cobra)", async () => {
    const car = new Car({ id: C1, plate: "ABC123", rate: 100000, startDate: "2024-06-27" });
    const off = new OffDay({ id: "o1", carId: C1, date: "2024-06-29", reason: "descanso" });
    const uc = build({ cars: [car], offDays: [off] });
    const r = await uc.execute({ date: TODAY });

    // 06-28,06-29,06-30 = 3 días − 1 descanso = 2 días = 200.000
    expect(r.collectToday[0].debt).toBe(200000);
    expect(r.collectToday[0].offToday).toBe(false);
  });

  it("agenda incluye refinanciaciones activas con saldo", async () => {
    const car = new Car({ id: C1, plate: "ABC123", name: "Pedro", rate: 50000, startDate: TODAY });
    const refi = new Refinance({
      id: "r1", carId: C1, date: "2024-06-01", originalAmount: 500000, days: 50, active: true, paidToPlan: 100000,
    });
    const uc = build({ cars: [car], refinances: [refi] });
    const r = await uc.execute({ date: TODAY });

    expect(r.summary.refinanceCount).toBe(1);
    expect(r.refinances[0].remaining).toBe(400000);
    expect(r.refinances[0].dailyInstallment).toBe(10000);
    expect(r.refinances[0].plate).toBe("ABC123");
  });

  it("documentos por vencer (<=30 días) con su nivel; ignora los lejanos", async () => {
    const car = new Car({ id: C1, plate: "ABC123" });
    const vencido = new VehicleDocument({ id: "d1", carId: C1, type: "SOAT", expiry: "2024-06-20" });
    const urgente = new VehicleDocument({ id: "d2", carId: C1, type: "Tecno", expiry: "2024-07-10" });
    const lejano = new VehicleDocument({ id: "d3", carId: C1, type: "Otro", expiry: "2025-01-01" });
    const uc = build({ cars: [car], documents: [vencido, urgente, lejano] });
    const r = await uc.execute({ date: TODAY });

    expect(r.summary.docsAlertCount).toBe(2);
    expect(r.summary.docsExpiredCount).toBe(1);
    expect(r.documents[0].level).toBe("vencido");
    expect(r.documents[0].daysLeft).toBe(-10);
    expect(r.documents[1].level).toBe("urgente");
  });

  it("lista los pagos Nequi pendientes de conciliar con su total", async () => {
    const pending = [
      new PendingPayment({ id: "n1", amount: 10000, detectedDate: TODAY, messageId: "m1", from: "Nequi" }),
      new PendingPayment({ id: "n2", amount: 25000, detectedDate: TODAY, messageId: "m2", from: "Nequi" }),
    ];
    const uc = build({ pendingPayments: pending });
    const r = await uc.execute({ date: TODAY });

    expect(r.summary.nequiPendingCount).toBe(2);
    expect(r.summary.nequiPendingAmount).toBe(35000);
  });

  it("ordena 'por cobrar' de mayor a menor deuda", async () => {
    const small = new Car({ id: C1, plate: "AAA111", rate: 10000, startDate: "2024-06-29" });
    const big = new Car({ id: C2, plate: "BBB222", rate: 100000, startDate: "2024-06-01" });
    const uc = build({ cars: [small, big] });
    const r = await uc.execute({ date: TODAY });

    expect(r.collectToday[0].carId).toBe(C2);
    expect(r.collectToday[1].carId).toBe(C1);
  });
});
