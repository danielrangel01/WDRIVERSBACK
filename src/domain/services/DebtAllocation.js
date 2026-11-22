/**
 * Servicio de dominio: asignación FIFO de pagos a días cobrables y antigüedad (aging).
 * Lógica PURA (sin DB). Lo comparten el detalle de deuda por carro y el motor de cobranza.
 *
 * Modelo:
 *   - El día de inicio NO cobra; los días cobrables van de (startDate + 1) a hoy,
 *     excluyendo los días no trabajados (offDays).
 *   - Los pagos se aplican en orden cronológico (FIFO): cada pago cubre los días
 *     más antiguos primero. Un día queda "pagado" si el acumulado cubre su tarifa,
 *     "parcial" si cubre una parte, o "sin pagar" si no recibe nada.
 */

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const dayDiff = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000);

/** Días cobrables de un carro: startDate+1 → today, sin los días no trabajados. */
export function buildBillableDays(startDate, today, offDaySet = new Set()) {
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
 * Reparte los pagos (FIFO cronológico) sobre los días cobrables.
 * `payments` debe venir ordenado ascendente por fecha (y createdAt como desempate).
 * Devuelve una fila por día con: paid, partial, paidAmount, remaining.
 */
export function allocatePayments(billableDates, rate, payments = [], offDayMap = new Map()) {
  let payIdx = 0;
  let payRemaining = 0;

  return billableDates.map((date) => {
    const off = offDayMap.get(date);
    const row = {
      date,
      amount: rate,
      paid: false,
      partial: false,
      paidAmount: 0,
      remaining: rate,
      offDayReason: (off && off.reason) || null,
      offDayDetail: (off && off.detail) || null,
    };
    let needed = rate;
    // El bucle debe seguir mientras quede saldo del pago en curso (payRemaining),
    // aunque ya no queden más pagos por consumir. Si no, un pago de varios días
    // solo cubriría el primer día.
    while (needed > 0 && (payRemaining > 0.001 || payIdx < payments.length)) {
      if (payRemaining <= 0.001) {
        payRemaining = safeNum(payments[payIdx].amount);
        payIdx += 1;
      } else {
        const take = Math.min(payRemaining, needed);
        row.paidAmount += take;
        payRemaining -= take;
        needed -= take;
      }
    }
    if (rate > 0 && row.paidAmount >= rate - 0.001) row.paid = true;
    else if (row.paidAmount > 0) row.partial = true;
    row.remaining = Math.max(0, rate - row.paidAmount);
    return row;
  });
}

/** Tramos de antigüedad de la deuda (mora). */
export const AGING_BUCKETS = [
  { key: "current", label: "0-7 días", minDays: 0, maxDays: 7 },
  { key: "d8_15", label: "8-15 días", minDays: 8, maxDays: 15 },
  { key: "d16_30", label: "16-30 días", minDays: 16, maxDays: 30 },
  { key: "d30plus", label: "+30 días", minDays: 31, maxDays: Infinity },
];

/**
 * Agrupa los días impagos por antigüedad (días transcurridos desde la fecha del día).
 * Usa `remaining` para que un día parcial aporte solo lo que falta.
 */
export function ageBuckets(unpaidRows, today) {
  const out = {};
  AGING_BUCKETS.forEach((b) => { out[b.key] = { amount: 0, days: 0 }; });
  unpaidRows.forEach((row) => {
    const age = dayDiff(row.date, today);
    const b = AGING_BUCKETS.find((x) => age >= x.minDays && age <= x.maxDays) || AGING_BUCKETS[0];
    out[b.key].amount += safeNum(row.remaining);
    out[b.key].days += 1;
  });
  return out;
}

export { dayDiff };
