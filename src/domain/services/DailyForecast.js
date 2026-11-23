/**
 * Servicio de dominio: predicción de recaudo del día (inteligencia operativa).
 * Lógica PURA (sin DB). Estima si el día va en camino a cerrar la meta de
 * recaudo, comparando lo que llevas contra la fracción que históricamente ya
 * suele estar cobrada a esta misma hora del día.
 *
 *   meta (X)       = recaudo esperado del día (suma de cuotas diarias de los
 *                    carros con obligación hoy).
 *   llevas (Y)     = suma de los pagos registrados hoy.
 *   faltan (Z)     = carros sin gestionar hoy.
 *   esperado(hora) = fracción histórica F(hora) que a esta hora ya está cobrada.
 *   ritmo (pace)   = (Y / X) / esperado(hora)  →  1.0 = justo en tiempo.
 *   probabilidad   = ritmo, acotado a 0..100 (100 = meta ya cumplida).
 */

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Curva por defecto (fracción acumulada de recaudo por hora del día).
 * Se usa como "arranque en frío" cuando aún no hay historial suficiente.
 */
export const DEFAULT_CURVE = [
  [0, 0], [6, 0.04], [8, 0.12], [10, 0.24], [12, 0.38],
  [14, 0.52], [16, 0.64], [18, 0.78], [20, 0.9], [22, 0.97], [24, 1],
];

/** Hora local fraccionaria (0..24) en la zona horaria dada. */
export function hourFraction(date, timeZone = "America/Bogota") {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const h = Number((parts.find((p) => p.type === "hour") || {}).value || 0) % 24;
    const m = Number((parts.find((p) => p.type === "minute") || {}).value || 0);
    return h + m / 60;
  } catch (_) {
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  }
}

/** Fecha local YYYY-MM-DD en la zona horaria dada. */
export function localDate(date, timeZone = "America/Bogota") {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch (_) {
    return d.toISOString().slice(0, 10);
  }
}

/** Interpola linealmente una curva [[hora, fracción], ...]. */
function interp(points, h) {
  if (!points || points.length === 0) return 0;
  if (h <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [h1, f1] = points[i];
    if (h <= h1) {
      const [h0, f0] = points[i - 1];
      const t = h1 === h0 ? 1 : (h - h0) / (h1 - h0);
      return f0 + (f1 - f0) * t;
    }
  }
  return points[points.length - 1][1];
}

/**
 * Construye la curva histórica de recaudo a partir del `createdAt` de los pagos
 * (la hora real a la que se registró el pago). Agrupa el monto por hora del día
 * dentro de la ventana y devuelve la fracción acumulada.
 * Si hay menos de `minDays` días de historial, cae a la curva por defecto.
 */
export function buildRevenueCurve(payments = [], {
  timeZone = "America/Bogota", lookbackDays = 45, minDays = 12, now = new Date(),
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const cutoff = new Date(nowDate.getTime() - lookbackDays * 86400000);
  const todayLocal = localDate(nowDate, timeZone);
  const byHour = new Array(24).fill(0);
  const days = new Set();
  let total = 0;

  payments.forEach((p) => {
    const amt = safeNum(p && p.amount);
    if (amt <= 0 || !p || !p.createdAt) return;
    const created = new Date(p.createdAt);
    if (isNaN(created.getTime()) || created < cutoff) return;
    if (localDate(created, timeZone) === todayLocal) return; // el día en curso está incompleto
    const h = Math.min(23, Math.max(0, Math.floor(hourFraction(created, timeZone))));
    byHour[h] += amt;
    total += amt;
    days.add(localDate(created, timeZone));
  });

  if (days.size < minDays || total <= 0) {
    return { source: "default", sampleDays: days.size, points: DEFAULT_CURVE };
  }

  const points = [[0, 0]];
  let cum = 0;
  for (let h = 0; h < 24; h += 1) {
    cum += byHour[h];
    points.push([h + 1, cum / total]);
  }
  return { source: "history", sampleDays: days.size, points };
}

/**
 * Calcula la predicción del día. Devuelve montos, ritmo, probabilidad y estado.
 * `status`: closed | early | ahead | on_track | behind | critical.
 */
export function computeDailyForecast({
  target = 0, collected = 0, pendingCars = 0, at = new Date(),
  timeZone = "America/Bogota", curve = null,
} = {}) {
  const t = Math.max(0, safeNum(target));
  const y = Math.max(0, safeNum(collected));
  const c = curve && curve.points ? curve : { source: "default", sampleDays: 0, points: DEFAULT_CURVE };

  const hour = hourFraction(at, timeZone);
  const expectedByNow = clamp01(interp(c.points, hour));
  const progress = t > 0 ? Math.min(1.2, y / t) : (y > 0 ? 1 : 0);

  // Antes de que se espere recaudo (madrugada), el ritmo es neutral.
  const epsilon = 0.05;
  const pace = expectedByNow <= epsilon
    ? (progress > 0 ? 1.2 : 1)
    : progress / expectedByNow;

  const probability = progress >= 1 ? 100 : Math.max(0, Math.min(100, Math.round(pace * 100)));

  let status;
  if (t <= 0 || y >= t) status = "closed";
  else if (hour < 10.5) status = "early";
  else if (pace >= 1.05) status = "ahead";
  else if (pace >= 0.85) status = "on_track";
  else if (pace >= 0.6) status = "behind";
  else status = "critical";

  const totalMin = Math.round(hour * 60);
  const hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;

  return {
    target: Math.round(t),
    collected: Math.round(y),
    remaining: Math.max(0, Math.round(t - y)),
    pendingCars: Math.max(0, Math.round(safeNum(pendingCars))),
    expectedByNow: Math.round(expectedByNow * 1000) / 1000,
    paceIndex: Math.round(pace * 100) / 100,
    probability,
    status,
    hour: Math.round(hour * 100) / 100,
    hourLabel: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    curveSource: c.source,
    sampleDays: c.sampleDays || 0,
  };
}
