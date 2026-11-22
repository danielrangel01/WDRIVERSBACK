import { NotFoundError, ValidationError } from "../../../shared/errors.js";
import { buildBillableDays, allocatePayments } from "../../../domain/services/DebtAllocation.js";
import { groupRowsByDriver } from "../../../domain/services/DriverAttribution.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const round = (v) => Math.round(safeNum(v));

/**
 * Detalle de deuda de un carro: desglose día por día.
 * La asignación de pagos (FIFO cronológico) y el armado de días cobrables
 * viven en `domain/services/DebtAllocation.js` (compartidos con el motor de cobranza).
 */
export class GetCarDebtDetailUseCase {
  constructor({ carRepository, paymentRepository, offDayRepository, handoverRepository }) {
    this.cars = carRepository;
    this.payments = paymentRepository;
    this.offDays = offDayRepository;
    this.handovers = handoverRepository;
  }

  async execute({ carId, today }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    const t = today || todayStr();
    if (!DATE_RE.test(t)) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");

    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");

    const [payments, offDays, handovers] = await Promise.all([
      this.payments.findAll(),
      this.offDays.findAll(),
      this.handovers ? this.handovers.findByCar(carId) : Promise.resolve([]),
    ]);

    const carPayments = payments
      .filter((p) => String(p.carId) === String(car.id))
      .map((p) => ({ id: p.id, date: p.date, amount: safeNum(p.amount), note: p.note, createdAt: p.createdAt }))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));

    const carOffDays = offDays.filter((o) => String(o.carId) === String(car.id));
    const offDaySet = new Set(carOffDays.map((o) => o.date));
    const offDayMap = new Map(carOffDays.map((o) => [o.date, o]));

    const rate = safeNum(car.rate);
    const billableDates = buildBillableDays(car.startDate, t, offDaySet);
    const dayRows = allocatePayments(billableDates, rate, carPayments, offDayMap);

    const totalExpected = billableDates.length * rate;
    const totalPaid = carPayments.reduce((s, p) => s + p.amount, 0);
    const totalDebt = Math.max(0, totalExpected - totalPaid);
    const unpaidDays = dayRows.filter((d) => !d.paid);
    const paidDays = dayRows.filter((d) => d.paid);

    // Atribución por conductor: la deuda del día se cobra a quien tenía el carro.
    const drivers = groupRowsByDriver(dayRows, handovers || []);
    const driverDebt = round(drivers.reduce((s, d) => s + d.remaining, 0));

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
      driverDebt,
      handovers: (handovers || []).map((h) => (h.toJSON ? h.toJSON() : h)),
      drivers,
      payments: carPayments,
      offDays: carOffDays.map((o) => ({ date: o.date, reason: o.reason, detail: o.detail })),
      days: dayRows,
    };
  }
}
