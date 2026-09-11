/**
 * Servicio de dominio: cálculo de métricas y deuda de la flota.
 * Lógica de negocio PURA (sin DB, sin Express). Reutilizable y testeable.
 *
 * MODELO DE DEUDA (acumulada):
 *   - El día de inicio NO cuenta; el cobro arranca al día siguiente.
 *   - Días cobrables = (días desde inicio+1 hasta hoy) − días no trabajados
 *   - Esperado = días cobrables × tarifa
 *   - Deuda de tarifa = esperado − pagos de tarifa − deuda congelada (refinanciada)
 *
 * REFINANCIAMIENTO (congelar):
 *   - Al refinanciar, la deuda de ese momento se "congela" y sale de la cuenta
 *     normal (se resta como crédito). Pasa a un plan de cuotas aparte.
 *   - La deuda TOTAL que el conductor debe hoy = deuda de tarifa + saldo del plan.
 */

const DEFAULT_TODAY = () => new Date().toISOString().slice(0, 10);

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function totalBillableDays(startDate, today = DEFAULT_TODAY()) {
  if (!startDate) return 0;
  const startNext = new Date(startDate);
  startNext.setDate(startNext.getDate() + 1);
  const t = new Date(today);
  if (startNext > t) return 0;
  return Math.floor((t - startNext) / 86400000) + 1;
}

export function computeMetrics({ cars = [], payments = [], expenses = [], offDays = [], refinances = [], today = DEFAULT_TODAY() }) {
  const ym = today.slice(0, 7);

  const totalPaid = payments.reduce((s, p) => s + safeNum(p.amount), 0);
  const totalExp = expenses.reduce((s, e) => s + safeNum(e.amount), 0);
  const profit = totalPaid - totalExp;

  const paidByCar = {};
  const monthPaidByCar = {};
  payments.forEach((p) => {
    const amt = safeNum(p.amount);
    paidByCar[p.carId] = (paidByCar[p.carId] || 0) + amt;
    if (typeof p.date === "string" && p.date.slice(0, 7) === ym) {
      monthPaidByCar[p.carId] = (monthPaidByCar[p.carId] || 0) + amt;
    }
  });

  const offByCar = {};
  offDays.forEach((o) => {
    offByCar[o.carId] = (offByCar[o.carId] || 0) + 1;
  });

  const frozenByCar = {};
  const planRemainingByCar = {};
  const planDailyByCar = {};
  refinances.forEach((r) => {
    if (!r.active) return;
    frozenByCar[r.carId] = (frozenByCar[r.carId] || 0) + safeNum(r.originalAmount);
    planRemainingByCar[r.carId] = (planRemainingByCar[r.carId] || 0) + safeNum(r.remaining);
    planDailyByCar[r.carId] = (planDailyByCar[r.carId] || 0) + safeNum(r.dailyInstallment);
  });

  const perCar = {};
  let totalExpected = 0;
  let totalDebt = 0;
  let totalTariffDebt = 0;
  let totalPlanRemaining = 0;
  let totalBillable = 0;

  cars.forEach((car) => {
    if (!car.active) return;

    const base = totalBillableDays(car.startDate, today);
    const off = offByCar[car.id] || 0;
    const billable = Math.max(0, base - off);
    const rate = safeNum(car.rate);
    const expected = billable * rate;
    const paid = paidByCar[car.id] || 0;
    const frozen = frozenByCar[car.id] || 0;

    const tariffDebt = expected - paid - frozen;
    const planRemaining = planRemainingByCar[car.id] || 0;
    const planDaily = planDailyByCar[car.id] || 0;
    const debt = tariffDebt + planRemaining;

    perCar[car.id] = {
      carId: car.id,
      plate: car.plate,
      name: car.name,
      rate,
      startDate: car.startDate,
      elapsedDays: base,
      offDays: off,
      billableDays: billable,
      expected,
      paid,
      frozen,
      tariffDebt,
      planRemaining,
      planDaily,
      dailyTotal: rate + planDaily,
      debt,
      monthPaid: monthPaidByCar[car.id] || 0,
    };

    totalExpected += expected;
    totalBillable += billable;
    totalPlanRemaining += planRemaining;
    if (tariffDebt > 0) totalTariffDebt += tariffDebt;
    if (debt > 0) totalDebt += debt;
  });

  const monthPaid = Object.values(monthPaidByCar).reduce((s, v) => s + v, 0);
  const monthExp = expenses.reduce(
    (s, e) => (typeof e.date === "string" && e.date.slice(0, 7) === ym ? s + safeNum(e.amount) : s),
    0
  );

  return {
    ym,
    totalPaid, totalExp, profit,
    totalExpected, totalDebt, totalTariffDebt, totalPlanRemaining, totalBillable,
    monthPaid, monthExp,
    perCar,
  };
}
