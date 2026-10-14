import { NotFoundError, ValidationError } from "../../../shared/errors.js";
import { totalBillableDays } from "../../../domain/services/MetricsService.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Genera la lista de días cobrables para un carro:
 *   - Desde startDate + 1 hasta today (inclusive)
 *   - Excluye los días no trabajados (offDays)
 */
function buildBillableDays(startDate, today, offDaySet) {
  if (!startDate) return [];
  const days = [];
  const cursor = new Date(startDate);
  cursor.setDate(cursor.getDate() + 1); // el día de inicio NO cobra
  const end = new Date(today);
  while (cursor <= end) {
    const ymd = cursor.toISOString().slice(0, 10);
    if (!offDaySet.has(ymd)) days.push(ymd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Detalle de deuda de un carro: desglose día por día.
 *
 * Asignación de pagos (FIFO cronológico):
 *   - Ordenamos los pagos por fecha ascendente.
 *   - Cada pago cubre días consecutivos a partir del primer día impago.
 *   - Un día se marca como pagado si el acumulado de pagos cubre su tarifa.
 *   - Si un pago es parcial respecto al costo del día, el día queda "parcial".
 */
export class GetCarDebtDetailUseCase {
  constructor({ carRepository, paymentRepository, offDayRepository }) {
    this.cars = carRepository;
    this.payments = paymentRepository;
    this.offDays = offDayRepository;
  }

  async execute({ carId, today }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    const t = today || todayStr();
    if (!DATE_RE.test(t)) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");

    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");

    const [payments, offDays] = await Promise.all([
      this.payments.findAll(),
      this.offDays.findAll(),
    ]);

    const carPayments = payments
      .filter((p) => String(p.carId) === String(car.id))
      .map((p) => ({ id: p.id, date: p.date, amount: safeNum(p.amount), note: p.note }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

    const carOffDays = offDays.filter((o) => String(o.carId) === String(car.id));
    const offDaySet = new Set(carOffDays.map((o) => o.date));
    const offDayMap = new Map(carOffDays.map((o) => [o.date, o]));

    const rate = safeNum(car.rate);
    const billableDates = buildBillableDays(car.startDate, t, offDaySet);

    // Asignación FIFO de pagos a días
    let payIdx = 0;
    let payRemaining = 0;
    const dayRows = billableDates.map((date) => {
      const row = {
        date,
        amount: rate,
        paid: false,
        partial: false,
        paidAmount: 0,
        offDayReason: offDayMap.get(date)?.reason || null,
      };
      // Consumir pagos hasta cubrir el día
      let needed = rate;
      while (needed > 0 && payIdx < carPayments.length) {
        if (payRemaining <= 0) {
          payRemaining = carPayments[payIdx].amount;
          payIdx += 1;
        }
        const take = Math.min(payRemaining, needed);
        row.paidAmount += take;
        payRemaining -= take;
        needed -= take;
      }
      if (row.paidAmount >= rate - 0.001) {
        row.paid = true;
      } else if (row.paidAmount > 0) {
        row.partial = true;
      }
      row.remaining = Math.max(0, rate - row.paidAmount);
      return row;
    });

    const totalExpected = billableDates.length * rate;
    const totalPaid = carPayments.reduce((s, p) => s + p.amount, 0);
    const totalDebt = Math.max(0, totalExpected - totalPaid);
    const unpaidDays = dayRows.filter((d) => !d.paid);
    const paidDays = dayRows.filter((d) => d.paid);

    return {
      carId: car.id,
      plate: car.plate,
      name: car.name,
      rate,
      startDate: car.startDate,
      today: t,
      billableDays: billableDates.length,
      paidDays: paidDays.length,
      unpaidDays: unpaidDays.length,
      totalExpected,
      totalPaid,
      totalDebt,
      payments: carPayments,
      offDays: carOffDays.map((o) => ({ date: o.date, reason: o.reason, detail: o.detail })),
      days: dayRows,
    };
  }
}
