import { ValidationError } from "../../../shared/errors.js";
import { buildBillableDays, allocatePayments, ageBuckets, AGING_BUCKETS, dayDiff } from "../../../domain/services/DebtAllocation.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayStr = () => new Date().toISOString().slice(0, 10);
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v) => Math.round(safeNum(v));
const cop = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n) || 0);

// Severidad de mora según el tramo más antiguo con deuda.
const SEVERITY_RANK = { critical: 3, high: 2, medium: 1, low: 0, ok: -1 };
const severityOf = (buckets) => {
  if (buckets.d30plus.amount > 0.001) return "critical";
  if (buckets.d16_30.amount > 0.001) return "high";
  if (buckets.d8_15.amount > 0.001) return "medium";
  if (buckets.current.amount > 0.001) return "low";
  return "ok";
};

/**
 * Motor de Cobranza y Mora.
 * Para cada carro activo calcula la antigüedad (aging) de su deuda de tarifa y
 * el atraso del plan de refinanciación, y prioriza a quién cobrar primero.
 * Reutiliza la asignación FIFO de `DebtAllocation` (misma que el detalle de deuda).
 */
export class GetCollectionsUseCase {
  constructor({ carRepository, paymentRepository, offDayRepository, refinanceRepository }) {
    this.cars = carRepository;
    this.payments = paymentRepository;
    this.offDays = offDayRepository;
    this.refinances = refinanceRepository;
  }

  async execute({ date } = {}) {
    const today = date || todayStr();
    if (!DATE_RE.test(today)) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");

    const [cars, payments, offDays, refinances] = await Promise.all([
      this.cars.findAll({ includeInactive: true }),
      this.payments.findAll(),
      this.offDays.findAll(),
      this.refinances.findAll(),
    ]);

    const activeCars = cars.filter((c) => c.active);
    const carById = {};
    cars.forEach((c) => { carById[String(c.id)] = c; });

    // Agrupaciones por carro
    const paymentsByCar = {};
    payments.forEach((p) => {
      const k = String(p.carId);
      (paymentsByCar[k] = paymentsByCar[k] || []).push({
        id: p.id, date: p.date, amount: safeNum(p.amount), note: p.note, createdAt: p.createdAt,
      });
    });
    const offByCar = {};
    offDays.forEach((o) => {
      const k = String(o.carId);
      (offByCar[k] = offByCar[k] || []).push(o);
    });
    const refiByCar = {};
    refinances.forEach((r) => {
      if (!r.active) return;
      const k = String(r.carId);
      (refiByCar[k] = refiByCar[k] || []).push(r);
    });

    const agg = {};
    AGING_BUCKETS.forEach((b) => { agg[b.key] = { amount: 0, days: 0, cars: 0 }; });

    let totalTariffDebt = 0;
    let totalPlanRemaining = 0;
    let totalPlanBehind = 0;
    let totalDebt = 0;
    let overdueAmount = 0;
    let upToDateCount = 0;

    const queue = [];

    activeCars.forEach((car) => {
      const cid = String(car.id);
      const rate = safeNum(car.rate);

      const carPayments = (paymentsByCar[cid] || []).sort(
        (a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0)
      );
      const carOff = offByCar[cid] || [];
      const offSet = new Set(carOff.map((o) => o.date));

      const billableDates = buildBillableDays(car.startDate, today, offSet);
      const rows = allocatePayments(billableDates, rate, carPayments);
      const unpaid = rows.filter((r) => r.remaining > 0.001);

      const buckets = ageBuckets(unpaid, today);
      const tariffDebt = round(unpaid.reduce((s, r) => s + safeNum(r.remaining), 0));

      // Plan de refinanciación: atraso esperado (cuotas diarias devengadas − abonado)
      let planRemaining = 0;
      let planDaily = 0;
      let planBehind = 0;
      (refiByCar[cid] || []).forEach((r) => {
        const remaining = safeNum(r.remaining);
        const daily = safeNum(r.dailyInstallment);
        const days = safeNum(r.days);
        const elapsed = Math.max(0, Math.min(days, dayDiff(r.date, today)));
        const expectedPaid = Math.min(safeNum(r.originalAmount), elapsed * daily);
        planRemaining += remaining;
        planDaily += daily;
        planBehind += Math.max(0, expectedPaid - safeNum(r.paidToPlan));
      });
      planRemaining = round(planRemaining);
      planBehind = round(planBehind);

      const debt = tariffDebt + planRemaining;

      const lastPaymentDate = carPayments.length ? carPayments[carPayments.length - 1].date : null;
      const oldestUnpaidDate = unpaid.length ? unpaid[0].date : null;
      const severity = severityOf(buckets);

      AGING_BUCKETS.forEach((b) => {
        agg[b.key].amount += buckets[b.key].amount;
        agg[b.key].days += buckets[b.key].days;
        if (buckets[b.key].amount > 0.001) agg[b.key].cars += 1;
      });
      totalTariffDebt += tariffDebt;
      totalPlanRemaining += planRemaining;
      totalPlanBehind += planBehind;
      totalDebt += debt;

      if (debt <= 0.001 && planBehind <= 0.001) {
        upToDateCount += 1;
        return;
      }

      if (unpaid.length) {
        overdueAmount += buckets.d8_15.amount + buckets.d16_30.amount + buckets.d30plus.amount;
      }

      queue.push({
        carId: cid,
        plate: car.plate,
        name: car.name,
        rate: round(rate),
        debt,
        tariffDebt,
        planRemaining,
        planBehind,
        planDaily: round(planDaily),
        dailyTotal: round(rate + planDaily),
        unpaidDays: unpaid.length,
        daysBehind: unpaid.length,
        oldestUnpaidDate,
        daysSinceOldest: oldestUnpaidDate ? dayDiff(oldestUnpaidDate, today) : null,
        lastPaymentDate,
        severity,
        buckets: {
          current: { amount: round(buckets.current.amount), days: buckets.current.days },
          d8_15: { amount: round(buckets.d8_15.amount), days: buckets.d8_15.days },
          d16_30: { amount: round(buckets.d16_30.amount), days: buckets.d16_30.days },
          d30plus: { amount: round(buckets.d30plus.amount), days: buckets.d30plus.days },
        },
      });
    });

    queue.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.debt - a.debt);

    const summary = {
      date: today,
      fleetDebt: round(totalDebt),
      tariffDebt: round(totalTariffDebt),
      planRemaining: round(totalPlanRemaining),
      planBehind: round(totalPlanBehind),
      overdueAmount: round(overdueAmount),
      moraCount: queue.length,
      criticalCount: queue.filter((c) => c.severity === "critical").length,
      upToDateCount,
      buckets: Object.fromEntries(
        AGING_BUCKETS.map((b) => [b.key, { label: b.label, amount: round(agg[b.key].amount), days: agg[b.key].days, cars: agg[b.key].cars }])
      ),
    };

    return {
      date: today,
      summary,
      buckets: AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label })),
      cars: queue,
      whatsappText: this.buildWhatsAppText(today, summary, queue),
    };
  }

  buildWhatsAppText(date, s, queue) {
    const [y, mo, d] = date.split("-");
    const dl = `${d}/${mo}/${y}`;
    let t = `📉 *W Drivers — Cobranza ${dl}*\n\n`;
    const b = s.buckets;
    if (b.d30plus.amount > 0) t += `🚨 +30 días: ${cop(b.d30plus.amount)} (${b.d30plus.cars} carro(s))\n`;
    if (b.d16_30.amount > 0) t += `⚠️ 16-30 días: ${cop(b.d16_30.amount)} (${b.d16_30.cars} carro(s))\n`;
    if (b.d8_15.amount > 0) t += `🟠 8-15 días: ${cop(b.d8_15.amount)} (${b.d8_15.cars} carro(s))\n`;
    if (b.current.amount > 0) t += `🔵 0-7 días: ${cop(b.current.amount)} (${b.current.cars} carro(s))\n`;
    if (s.planBehind > 0) t += `🔁 Planes atrasados: ${cop(s.planBehind)}\n`;

    if (queue.length) {
      t += `\n*Prioridad de cobro:*\n`;
      queue.slice(0, 8).forEach((c, i) => {
        const age = c.daysSinceOldest != null ? `${c.daysSinceOldest}d` : "—";
        t += `${i + 1}. ${c.plate} — ${cop(c.debt)} (${age})\n`;
      });
      if (queue.length > 8) t += `… y ${queue.length - 8} más\n`;
    } else {
      t += `\n✅ Flota al día, sin deudas por cobrar.\n`;
    }

    t += `\nDeuda total flota: ${cop(s.fleetDebt)}\n_W Drivers_`;
    return t;
  }
}
