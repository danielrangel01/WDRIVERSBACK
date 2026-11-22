import { computeMetrics } from "../../../domain/services/MetricsService.js";
import { handoverForDate } from "../../../domain/services/DriverAttribution.js";

const DEFAULT_TODAY = () => new Date().toISOString().slice(0, 10);
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v) => Math.round(safeNum(v));
const dayDiff = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000);
const sum = (arr, key) => arr.reduce((s, i) => s + safeNum(i[key]), 0);

/**
 * Centro de Gestión del Día.
 * Reúne, para una fecha dada, todo lo que hay que hacer hoy:
 *   - A quién cobrar (carros con deuda pendiente).
 *   - Quién está atrasado (lleva 2+ días de deuda sin ponerse al día).
 *   - Planes de refinanciación por cobrar.
 *   - Documentos vehiculares por vencer/vencidos.
 *   - Pagos Nequi detectados por correo pendientes de conciliar.
 */
export class GetAgendaUseCase {
  constructor({ carRepository, paymentRepository, offDayRepository, refinanceRepository, documentRepository, pendingPaymentRepository, handoverRepository }) {
    this.cars = carRepository;
    this.payments = paymentRepository;
    this.offDays = offDayRepository;
    this.refinances = refinanceRepository;
    this.documents = documentRepository;
    this.pendingPayments = pendingPaymentRepository;
    this.handovers = handoverRepository;
  }

  async execute({ date } = {}) {
    const today = date || DEFAULT_TODAY();

    const [cars, payments, offDays, refinances, documents, pendingPayments, handovers] = await Promise.all([
      this.cars.findAll({ includeInactive: true }),
      this.payments.findAll(),
      this.offDays.findAll(),
      this.refinances.findAll(),
      this.documents.findAll(),
      this.pendingPayments ? this.pendingPayments.findAll({ status: "pending" }) : Promise.resolve([]),
      this.handovers ? this.handovers.findAll() : Promise.resolve([]),
    ]);

    const activeCars = cars.filter((c) => c.active);
    const metrics = computeMetrics({ cars: activeCars, payments, expenses: [], offDays, refinances, today });

    const carById = {};
    cars.forEach((c) => { carById[c.id] = c; });

    const lastPayByCar = {};
    const paidTodayByCar = {};
    payments.forEach((p) => {
      const cid = String(p.carId);
      const d = p.date;
      if (d && (!lastPayByCar[cid] || d > lastPayByCar[cid])) lastPayByCar[cid] = d;
      if (d === today) paidTodayByCar[cid] = (paidTodayByCar[cid] || 0) + safeNum(p.amount);
    });

    const offToday = new Set(offDays.filter((o) => o.date === today).map((o) => String(o.carId)));

    // Entregas por carro (para saber quién tiene el carro hoy).
    const handoversByCar = {};
    handovers.forEach((h) => {
      const cid = String(h.carId);
      if (!handoversByCar[cid]) handoversByCar[cid] = [];
      handoversByCar[cid].push(h);
    });

    const collectToday = [];
    const overdue = [];
    const upToDate = [];
    const checklist = [];

    activeCars.forEach((car) => {
      const m = metrics.perCar[car.id];
      if (!m) return;
      const cid = car.id;
      const lastPay = lastPayByCar[cid] || null;
      const dailyTotal = m.dailyTotal || m.rate || 0;
      const daysBehind = dailyTotal > 0 ? Math.floor(m.debt / dailyTotal) : 0;
      const paidToday = round(paidTodayByCar[cid]);
      const isOff = offToday.has(cid);
      const driver = handoverForDate(today, handoversByCar[cid] || []);

      const item = {
        carId: cid,
        plate: car.plate,
        name: car.name,
        rate: round(m.rate),
        debt: round(m.debt),
        tariffDebt: round(m.tariffDebt),
        planRemaining: round(m.planRemaining),
        dailyTotal: round(dailyTotal),
        lastPaymentDate: lastPay,
        daysSinceLastPayment: lastPay ? dayDiff(lastPay, today) : null,
        daysBehind,
        paidToday,
        offToday: isOff,
        driverName: driver ? driver.driverName : "",
        driverPhone: driver ? (driver.driverPhone || "") : "",
        handoverId: driver ? driver.id : null,
      };

      // "Cubierto" = la gestión del día para ese carro está resuelta:
      // está libre hoy, ya se registró pago hoy, o no debe nada.
      const covered = isOff || paidToday > 0 || item.debt <= 0;
      checklist.push({ ...item, covered });

      if (m.debt > 0) {
        collectToday.push(item);
        if (daysBehind >= 2) overdue.push(item);
      } else {
        upToDate.push(item);
      }
    });

    collectToday.sort((a, b) => b.debt - a.debt);
    overdue.sort((a, b) => b.daysBehind - a.daysBehind || b.debt - a.debt);
    checklist.sort((a, b) => Number(a.covered) - Number(b.covered) || b.debt - a.debt);

    const coveredCount = checklist.filter((c) => c.covered).length;
    const pendingCars = checklist.filter((c) => !c.covered);

    const refinancesActive = refinances
      .filter((r) => r.active && safeNum(r.remaining) > 0.001)
      .map((r) => {
        const c = carById[String(r.carId)];
        const daily = safeNum(r.dailyInstallment);
        const remaining = safeNum(r.remaining);
        return {
          id: r.id,
          carId: String(r.carId),
          plate: c ? c.plate : "",
          name: c ? c.name : "",
          date: r.date,
          originalAmount: round(r.originalAmount),
          days: r.days,
          paidToPlan: round(r.paidToPlan),
          remaining: round(remaining),
          dailyInstallment: daily,
          estimatedDays: daily > 0 ? Math.ceil(remaining / daily) : null,
        };
      })
      .sort((a, b) => b.remaining - a.remaining);

    const docsAlert = documents
      .map((d) => {
        const c = carById[String(d.carId)];
        const daysLeft = d.expiry ? dayDiff(today, d.expiry) : null;
        const level = daysLeft === null ? "info" : daysLeft < 0 ? "vencido" : daysLeft <= 15 ? "urgente" : "proximo";
        return {
          id: d.id,
          carId: String(d.carId),
          plate: c ? c.plate : "",
          name: c ? c.name : "",
          type: d.type,
          expiry: d.expiry,
          daysLeft,
          level,
        };
      })
      .filter((d) => d.daysLeft !== null && d.daysLeft <= 30)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const nequiPending = pendingPayments.map((p) => ({
      id: p.id,
      amount: round(p.amount),
      detectedDate: p.detectedDate,
      from: p.from,
      subject: p.subject,
      snippet: p.snippet,
    }));

    const summary = {
      date: today,
      fleetDebt: round(metrics.totalDebt),
      collectTodayCount: collectToday.length,
      collectTodayAmount: round(sum(collectToday, "debt")),
      overdueCount: overdue.length,
      overdueAmount: round(sum(overdue, "debt")),
      upToDateCount: upToDate.length,
      bouncedTodayCount: collectToday.filter((i) => i.paidToday > 0).length,
      refinanceCount: refinancesActive.length,
      refinanceRemaining: round(sum(refinancesActive, "remaining")),
      docsAlertCount: docsAlert.length,
      docsExpiredCount: docsAlert.filter((d) => d.level === "vencido").length,
      nequiPendingCount: nequiPending.length,
      nequiPendingAmount: round(sum(nequiPending, "amount")),
      // Marcador 12/12: progreso de la gestión del día carro por carro.
      fleetTotal: checklist.length,
      coveredCount,
      coveredTodayCount: coveredCount,
      pendingCarsCount: pendingCars.length,
      carsWithoutDriverCount: checklist.filter((c) => !c.handoverId).length,
      allCovered: checklist.length > 0 && pendingCars.length === 0,
    };

    return {
      date: today,
      summary,
      collectToday,
      overdue,
      upToDate,
      checklist,
      pendingCars,
      refinances: refinancesActive,
      documents: docsAlert,
      nequiPending,
    };
  }
}
