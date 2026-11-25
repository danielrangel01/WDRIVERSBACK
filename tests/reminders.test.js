import { describe, it, expect } from "vitest";
import { Car } from "../src/domain/entities/Car.js";
import { Payment, OffDay, VehicleDocument, PendingPayment } from "../src/domain/entities/index.js";
import { Refinance } from "../src/domain/entities/Refinance.js";
import { GetAgendaUseCase } from "../src/application/use-cases/agenda/index.js";
import { GetRemindersUseCase } from "../src/application/use-cases/reminders/index.js";

const TODAY = "2024-06-30";
const C1 = "000000000000000000000001";
const C2 = "000000000000000000000002";

function build({ cars = [], payments = [], offDays = [], refinances = [], documents = [], pendingPayments = [] } = {}) {
  const agenda = new GetAgendaUseCase({
    carRepository: { findAll: async () => cars },
    paymentRepository: { findAll: async () => payments },
    offDayRepository: { findAll: async () => offDays },
    refinanceRepository: { findAll: async () => refinances },
    documentRepository: { findAll: async () => documents },
    pendingPaymentRepository: { findAll: async () => pendingPayments },
  });
  const settingsRepository = { get: async () => ({ adminPhone: "", morningHour: 8, eveningHour: 20 }) };
  return new GetRemindersUseCase({ agendaUseCase: agenda, settingsRepository });
}

const porCobrar = () => new Car({ id: C1, plate: "ABC123", name: "Juan", rate: 100000, startDate: "2024-06-01" });

describe("🔔 Motor de Recordatorios", () => {
  it("mañana: incluye aviso de cobrar hoy y de atrasados", async () => {
    const uc = build({ cars: [porCobrar()] });
    const r = await uc.execute({ date: TODAY, moment: "morning" });

    expect(r.moment).toBe("morning");
    expect(r.counts.collect).toBe(1);
    expect(r.counts.overdue).toBe(1);
    const kinds = r.reminders.map((x) => x.kind);
    expect(kinds).toContain("collect");
    expect(kinds).toContain("overdue");
    expect(r.whatsappText).toContain("Buenos días");
    // El saludo de la mañana incluye el resumen (cierre) del día ANTERIOR.
    expect(r.whatsappText).toContain("Cierre del día");
  });

  it("media mañana: incluye aviso de cobrar hoy y el texto de 'aún estás a tiempo'", async () => {
    const uc = build({ cars: [porCobrar()] });
    const r = await uc.execute({ date: TODAY, moment: "lateMorning" });

    expect(r.moment).toBe("lateMorning");
    expect(r.counts.collect).toBe(1);
    expect(r.reminders.map((x) => x.kind)).toContain("collect");
    expect(r.whatsappText).toContain("Aún estás a tiempo");
    // El resumen del día anterior solo va en el saludo de la mañana.
    expect(r.whatsappText).not.toContain("Cierre del día");
  });

  it("tarde: última llamada reclama por nombre cada carro sin gestionar", async () => {
    const uc = build({ cars: [porCobrar()] });
    const r = await uc.execute({ date: TODAY, moment: "evening" });

    expect(r.counts.unregistered).toBe(1);
    expect(r.counts.pending).toBe(1);
    const un = r.reminders.find((x) => x.kind === "pending");
    expect(un).toBeTruthy();
    expect(un.level).toBe("critical");
    expect(un.title).toContain("ABC123");
    expect(r.whatsappText).toContain("Última llamada");
    expect(r.whatsappText).toContain("ABC123");
  });

  it("tarde: sin pendientes de registro cuando todos pagaron hoy", async () => {
    const car = new Car({ id: C2, plate: "DEF456", rate: 100000, startDate: "2024-06-30" });
    const pay = new Payment({ id: "p1", carId: C2, date: TODAY, amount: 100000 });
    const r = await build({ cars: [car], payments: [pay] }).execute({ date: TODAY, moment: "evening" });

    expect(r.counts.unregistered).toBe(0);
    expect(r.reminders.some((x) => x.kind === "unregistered")).toBe(false);
  });

  it("documento vencido genera aviso crítico", async () => {
    const car = new Car({ id: C1, plate: "ABC123" });
    const doc = new VehicleDocument({ id: "d1", carId: C1, type: "SOAT", expiry: "2024-06-20" });
    const r = await build({ cars: [car], documents: [doc] }).execute({ date: TODAY });

    const d = r.reminders.find((x) => x.kind === "docs");
    expect(d.level).toBe("critical");
    expect(r.counts.docs).toBe(1);
  });

  it("incluye aviso de pagos Nequi por conciliar y de refinanciaciones", async () => {
    const car = new Car({ id: C1, plate: "ABC123", rate: 50000, startDate: TODAY });
    const refi = new Refinance({ id: "r1", carId: C1, date: "2024-06-01", originalAmount: 500000, days: 50, active: true, paidToPlan: 100000 });
    const pending = new PendingPayment({ id: "n1", amount: 30000, detectedDate: TODAY, messageId: "m1", from: "Nequi" });
    const r = await build({ cars: [car], refinances: [refi], pendingPayments: [pending] }).execute({ date: TODAY });

    expect(r.counts.nequi).toBe(1);
    expect(r.counts.refinances).toBe(1);
    expect(r.reminders.some((x) => x.kind === "nequi")).toBe(true);
    expect(r.reminders.some((x) => x.kind === "refinance")).toBe(true);
  });

  it("flota sin pendientes → marcador de gestión al día", async () => {
    const car = new Car({ id: C1, plate: "ABC123", rate: 100000, startDate: TODAY });
    const r = await build({ cars: [car] }).execute({ date: TODAY });

    expect(r.counts.collect).toBe(0);
    expect(r.counts.covered).toBe(1);
    expect(r.counts.pending).toBe(0);
    expect(r.reminders).toHaveLength(1);
    expect(r.reminders[0].kind).toBe("checklist");
    expect(r.reminders[0].level).toBe("ok");
    expect(r.reminders[0].title).toContain("1/1");
  });

  it("momento inválido se normaliza a 'morning'", async () => {
    const r = await build({ cars: [porCobrar()] }).execute({ date: TODAY, moment: "xyz" });
    expect(r.moment).toBe("morning");
  });
});
