import { NotFoundError, ValidationError } from "../../../shared/errors.js";
import { buildBillableDays, allocatePayments } from "../../../domain/services/DebtAllocation.js";
import { groupRowsByDriver } from "../../../domain/services/DriverAttribution.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v) => Math.round(safeNum(v));
const todayStr = () => new Date().toISOString().slice(0, 10);
const cop = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n) || 0);
const dmy = (d) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const addDays = (dateStr, n) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Estado de cuenta por conductor (estilo extracto bancario):
 * saldo anterior + cargos del período − abonos del período = saldo actual.
 * Reutiliza la asignación FIFO de `DebtAllocation` (misma que el detalle de deuda
 * y el motor de cobranza). Por defecto el período es el mes en curso.
 */
export class GetAccountStatementUseCase {
  constructor({ carRepository, paymentRepository, offDayRepository, refinanceRepository, handoverRepository }) {
    this.cars = carRepository;
    this.payments = paymentRepository;
    this.offDays = offDayRepository;
    this.refinances = refinanceRepository;
    this.handovers = handoverRepository;
  }

  async execute({ carId, from, to, today } = {}) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    const t = today || todayStr();
    if (!DATE_RE.test(t)) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");

    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");

    const f = from && DATE_RE.test(from) ? from : `${t.slice(0, 7)}-01`;
    const end = to && DATE_RE.test(to) ? to : t;
    if (f > end) throw new ValidationError("Rango de fechas inválido (desde > hasta)");

    const [allPayments, allOffDays, allRefinances, allHandovers] = await Promise.all([
      this.payments.findAll(),
      this.offDays.findAll(),
      this.refinances.findAll(),
      this.handovers ? this.handovers.findByCar(car.id) : Promise.resolve([]),
    ]);

    const carPayments = allPayments
      .filter((p) => String(p.carId) === String(car.id))
      .map((p) => ({ id: p.id, date: p.date, amount: safeNum(p.amount), note: p.note, createdAt: p.createdAt }))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));

    const carOffDays = allOffDays.filter((o) => String(o.carId) === String(car.id));
    const offDaySet = new Set(carOffDays.map((o) => o.date));
    const offDayMap = new Map(carOffDays.map((o) => [o.date, o]));

    const rate = safeNum(car.rate);

    const dayBefore = addDays(f, -1);

    // Saldo anterior: deuda real al cierre del día previo al período
    // (usa solo los pagos registrados hasta esa fecha).
    const prevPayments = carPayments.filter((p) => p.date <= dayBefore);
    const prevDays = buildBillableDays(car.startDate, dayBefore, offDaySet);
    const prevRows = allocatePayments(prevDays, rate, prevPayments, offDayMap);
    const openingBalance = round(prevRows.reduce((s, r) => s + safeNum(r.remaining), 0));

    // Movimientos del período (cargos por día cobrable + abonos recibidos).
    const payablePayments = carPayments.filter((p) => p.date <= end);
    const billableDates = buildBillableDays(car.startDate, end, offDaySet);
    const rows = allocatePayments(billableDates, rate, payablePayments, offDayMap);

    const periodRows = rows.filter((r) => r.date >= f && r.date <= end);
    const chargesDays = periodRows.length;
    const charges = round(chargesDays * rate);

    const periodPayments = carPayments.filter((p) => p.date >= f && p.date <= end);
    const paymentsTotal = round(periodPayments.reduce((s, p) => s + p.amount, 0));

    const closingBalance = round(openingBalance + charges - paymentsTotal);
    const unpaidDays = periodRows.filter((r) => safeNum(r.remaining) > 0.001).length;

    // Deuda total vigente (a la fecha de hoy), informativa.
    const todayPayments = carPayments.filter((p) => p.date <= t);
    const todayRows = allocatePayments(buildBillableDays(car.startDate, t, offDaySet), rate, todayPayments, offDayMap);
    const currentDebt = round(todayRows.reduce((s, r) => s + safeNum(r.remaining), 0));

    // Plan de refinanciación activo del carro (si existe)
    const activeRefis = allRefinances.filter((r) => r.active && String(r.carId) === String(car.id));
    const plan = {
      active: activeRefis.length > 0,
      count: activeRefis.length,
      remaining: round(activeRefis.reduce((s, r) => s + safeNum(r.remaining), 0)),
      dailyInstallment: round(activeRefis.reduce((s, r) => s + safeNum(r.dailyInstallment), 0)),
      paidToPlan: round(activeRefis.reduce((s, r) => s + safeNum(r.paidToPlan), 0)),
      originalAmount: round(activeRefis.reduce((s, r) => s + safeNum(r.originalAmount), 0)),
      days: activeRefis.reduce((s, r) => s + safeNum(r.days), 0),
      installmentsPaid: activeRefis.reduce((s, r) => s + safeNum(r.installmentsPaid), 0),
    };

    const period = { from: f, to: end, label: `${dmy(f)} – ${dmy(end)}` };

    // Atribución por conductor: cargos del período agrupados por quién tuvo el carro.
    const drivers = groupRowsByDriver(periodRows, allHandovers || []);

    return {
      carId: car.id,
      plate: car.plate,
      name: car.name,
      rate,
      startDate: car.startDate,
      today: t,
      period,
      openingBalance,
      charges,
      chargesDays,
      payments: paymentsTotal,
      paymentsCount: periodPayments.length,
      closingBalance,
      currentDebt,
      unpaidDays,
      periodDays: periodRows,
      periodPayments,
      drivers,
      handovers: (allHandovers || []).map((h) => (h.toJSON ? h.toJSON() : h)),
      plan,
      whatsappText: this.buildText({ car, period, openingBalance, charges, chargesDays, paymentsTotal, closingBalance, unpaidDays, plan, drivers }),
    };
  }

  buildText({ car, period, openingBalance, charges, chargesDays, paymentsTotal, closingBalance, unpaidDays, plan, drivers = [] }) {
    const label = car.name ? `${car.plate} · ${car.name}` : car.plate;
    let t = `📄 *W Drivers — Estado de Cuenta*\n🚗 ${label}\n📅 Período: ${period.label}\n\n`;
    t += `Saldo anterior: ${cop(openingBalance)}\n`;
    t += `Cargos del período: ${cop(charges)}`;
    if (chargesDays > 0) t += ` (${chargesDays} día(s) × ${cop(chargesDays > 0 ? charges / chargesDays : 0)})`;
    t += `\nAbonos del período: −${cop(paymentsTotal)}\n`;
    t += `*Saldo actual: ${cop(closingBalance)}*\n`;
    if (unpaidDays > 0) t += `\n⚠️ ${unpaidDays} día(s) del período sin cubrir\n`;
    const withDebt = drivers.filter((d) => d.remaining > 0);
    if (withDebt.length > 0) {
      t += `\n👤 *Por conductor:*\n`;
      withDebt.forEach((d) => {
        const who = d.driverName || "Sin conductor";
        t += `• ${who}: ${cop(d.remaining)} (${d.days} día(s))\n`;
      });
    }
    if (plan.active) {
      t += `\n🔁 Plan de pago: ${cop(plan.dailyInstallment)}/día · abonado ${cop(plan.paidToPlan)} de ${cop(plan.originalAmount)}\n`;
    }
    t += `\n_W Drivers_`;
    return t;
  }
}
