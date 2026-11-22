/**
 * Atribución por conductor.
 *
 * Dado un conjunto de días cobrables (ya asignados FIFO por DebtAllocation) y el
 * historial de entregas de un carro, determina a qué conductor corresponde cada
 * día y agrupa los totales por conductor.
 *
 * Regla de negocio: la deuda del día se cobra al conductor que tenía el carro ese día.
 * Los días sin entrega registrada quedan a nombre de "Sin conductor".
 */

export const addDays = (dateStr, n) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Devuelve la entrega que cubre la fecha (la de inicio más reciente), o null.
 * @param {string} date YYYY-MM-DD
 * @param {Array} handovers lista de entregas del carro
 */
export function handoverForDate(date, handovers = []) {
  let found = null;
  for (const h of handovers) {
    if (date >= h.startDate && (!h.endDate || date <= h.endDate)) {
      if (!found || h.startDate > found.startDate) found = h;
    }
  }
  return found;
}

/**
 * Agrupa las filas (día a día) por conductor según las entregas.
 * @param {Array} rows filas de allocatePayments: {date, amount, paidAmount, remaining, ...}
 * @param {Array} handovers entregas del carro
 * @returns {Array} [{ key, driverName, driverPhone, handoverId, from, to, days, charged, paid, remaining, settled }]
 */
export function groupRowsByDriver(rows = [], handovers = []) {
  const groups = new Map();
  for (const row of rows) {
    const h = handoverForDate(row.date, handovers);
    const key = h ? h.id : "__none__";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        driverName: h ? h.driverName : "",
        driverPhone: h ? (h.driverPhone || "") : "",
        handoverId: h ? h.id : null,
        from: row.date,
        to: row.date,
        days: 0,
        charged: 0,
        paid: 0,
        remaining: 0,
      });
    }
    const g = groups.get(key);
    g.days += 1;
    g.charged += Number(row.amount) || 0;
    g.paid += Number(row.paidAmount) || 0;
    g.remaining += Number(row.remaining) || 0;
    if (row.date < g.from) g.from = row.date;
    if (row.date > g.to) g.to = row.date;
  }
  return Array.from(groups.values())
    .map((g) => ({
      ...g,
      charged: Math.round(g.charged),
      paid: Math.round(g.paid),
      remaining: Math.round(g.remaining),
      settled: g.remaining <= 0.001,
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
