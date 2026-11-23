import { describe, it, expect } from "vitest";
import { Car } from "../src/domain/entities/Car.js";
import { Payment } from "../src/domain/entities/index.js";
import { GetAgendaUseCase } from "../src/application/use-cases/agenda/index.js";
import {
  hourFraction, localDate, buildRevenueCurve, computeDailyForecast, DEFAULT_CURVE,
} from "../src/domain/services/DailyForecast.js";

const TODAY = "2024-06-30";
const C1 = "000000000000000000000001";

// 19:00 UTC = 14:00 en America/Bogota (UTC-5).
const AT_14 = new Date("2024-06-30T19:00:00Z");
// 13:00 UTC = 08:00 en America/Bogota.
const AT_08 = new Date("2024-06-30T13:00:00Z");

describe("📈 Predicción de recaudo del día", () => {
  it("hora y fecha locales en la zona horaria dada", () => {
    expect(hourFraction(AT_14, "America/Bogota")).toBe(14);
    expect(hourFraction(AT_14, "UTC")).toBe(19);
    expect(localDate(AT_14, "America/Bogota")).toBe("2024-06-30");
  });

  it("curva por defecto cuando no hay historial suficiente (arranque en frío)", () => {
    const curve = buildRevenueCurve([], { now: AT_14 });
    expect(curve.source).toBe("default");
    expect(curve.points).toBe(DEFAULT_CURVE);
  });

  it("construye la curva histórica desde el createdAt de los pagos", () => {
    // 15 días con pagos registrados a las 10:00 (Bogotá).
    const payments = Array.from({ length: 15 }, (_, i) => new Payment({
      id: `p${i}`,
      carId: C1,
      date: `2024-06-${String(i + 1).padStart(2, "0")}`,
      amount: 100000,
      createdAt: new Date(`2024-06-${String(i + 1).padStart(2, "0")}T15:00:00Z`),
    }));
    const curve = buildRevenueCurve(payments, { now: AT_14, minDays: 12 });
    expect(curve.source).toBe("history");
    expect(curve.sampleDays).toBe(15);
    expect(curve.points[curve.points.length - 1][1]).toBeCloseTo(1, 5);
  });

  it("probabilidad = ritmo vs. curva esperada (en tiempo → 100%)", () => {
    const f = computeDailyForecast({ target: 100000, collected: 52000, at: AT_14, timeZone: "America/Bogota" });
    expect(f.expectedByNow).toBeCloseTo(0.52, 2);
    expect(f.probability).toBe(100);
    expect(f.status).toBe("on_track");
    expect(f.hourLabel).toBe("14:00");
    expect(f.curveSource).toBe("default");
  });

  it("marca 'critical' cuando el avance está muy por debajo de lo esperado", () => {
    const f = computeDailyForecast({ target: 100000, collected: 26000, at: AT_14, timeZone: "America/Bogota" });
    expect(f.paceIndex).toBeCloseTo(0.5, 2);
    expect(f.probability).toBe(50);
    expect(f.status).toBe("critical");
  });

  it("meta ya cumplida → 100% y estado 'closed'", () => {
    const f = computeDailyForecast({ target: 100000, collected: 100000, at: AT_14, timeZone: "America/Bogota" });
    expect(f.probability).toBe(100);
    expect(f.status).toBe("closed");
    expect(f.remaining).toBe(0);
  });

  it("temprano en el día el estado es 'early'", () => {
    const f = computeDailyForecast({ target: 100000, collected: 0, at: AT_08, timeZone: "America/Bogota" });
    expect(f.status).toBe("early");
  });
});

const build = ({ cars = [], payments = [], now = () => AT_14 } = {}) => new GetAgendaUseCase({
  carRepository: { findAll: async () => cars },
  paymentRepository: { findAll: async () => payments },
  offDayRepository: { findAll: async () => [] },
  refinanceRepository: { findAll: async () => [] },
  documentRepository: { findAll: async () => [] },
  pendingPaymentRepository: { findAll: async () => [] },
  handoverRepository: { findAll: async () => [] },
  timeZone: "America/Bogota",
  now,
});

describe("📅 Agenda incluye la predicción del día", () => {
  it("expone el bloque forecast para la fecha en curso", async () => {
    const car = new Car({ id: C1, plate: "ABC123", rate: 100000, startDate: "2024-06-01" });
    const r = await build({ cars: [car] }).execute({ date: TODAY });

    expect(r.forecast).toBeTruthy();
    expect(r.forecast.target).toBe(100000);
    expect(r.forecast.collected).toBe(0);
    expect(r.forecast.status).toBe("critical");
    expect(r.summary.forecastTarget).toBe(100000);
    expect(r.summary.forecastStatus).toBe("critical");
  });

  it("no calcula forecast cuando se consulta una fecha distinta a hoy", async () => {
    const car = new Car({ id: C1, plate: "ABC123", rate: 100000, startDate: "2024-06-01" });
    const r = await build({ cars: [car] }).execute({ date: "2024-06-29" });

    expect(r.forecast).toBeNull();
    expect(r.summary.forecastStatus).toBe("unavailable");
  });
});
