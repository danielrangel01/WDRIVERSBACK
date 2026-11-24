/**
 * Servicio de dominio PURO: interpreta los mensajes que el administrador
 * escribe por WhatsApp y los traduce a una intención estructurada.
 * Sin base de datos, sin red → 100% determinista y testeable.
 *
 * Gramática soportada (español, sin acentos):
 *   ABC123 pagó 90000   → registrar pago
 *   3 ya pagó           → pago del carro #3 de la lista de pendientes
 *   ABC123 taller       → marcar el día libre (taller/descanso/no trabajo/otro)
 *   estado / meta       → resumen y predicción del día
 *   pendientes          → lista numerada de lo que falta
 *   cierres             → cierres pendientes (días con carros sin gestionar)
 *   ABC123              → detalle de un carro
 *   ayuda               → guía de uso
 */

export const INTENT = {
  HELP: "help",
  STATUS: "status",
  PENDING: "pending",
  PAYMENT: "payment",
  OFFDAY: "offday",
  CHECKIN: "checkin",
  CLOSURES: "closures",
  CLOSE: "close",
  CAR: "car",
  UNKNOWN: "unknown",
};

// Palabras clave (raíces) por intención. El orden define la prioridad.
const OFFDAY_KEYS = ["taller", "mecanic", "reparac", "descans", "libre", "no trabajo", "no trabaja", "no laboro"];
const PAYMENT_KEYS = ["paga", "pago", "abon", "consign", "transfer", "transfir", "deposit"];
const CHECKIN_KEYS = ["revisar", "chequeo", "checkin", "iniciar", "empezar", "comenzar", "uno por uno", "paso a paso"];
// Cierres pendientes (plural/frases) va ANTES de CLOSE, que es el cierre del día.
const CLOSURES_KEYS = ["cierres", "cierre pendiente", "cierre incompleto", "cierre anterior", "cerrar pendiente", "cerrar pendientes", "pendientes anteriores"];
const CLOSE_KEYS = ["cierre", "cerrar", "close"];
const PENDING_KEYS = ["pendiente", "falta", "quien debe", "quienes deben", "por cobrar", "deudor"];
const STATUS_KEYS = ["estado", "resumen", "como va", "como vamos", "situacion", "reporte", "meta", "balance", "corte"];
const HELP_KEYS = ["ayuda", "help", "comando", "instruccion", "opciones", "que puedo"];

const MONEY_TOKEN = /^\$?(\d{1,3}(?:[.,]\d{3})+|\d+)(k)?$/;

/** Quita acentos, baja a minúsculas y colapsa espacios. */
export function normalizeText(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza una placa para comparar (solo alfanumérico en mayúsculas). */
export function normalizePlate(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/** Formatea un entero como pesos colombianos: 90000 → "$90.000". */
export function formatCOP(value) {
  const n = Math.round(Number(value) || 0);
  return "$" + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Nombre mostrable de quien hizo un pago: el del correo o "Nequi" si es una dirección. */
export function payerLabel({ payerName, from } = {}) {
  const name = String(payerName || "").trim();
  if (name) return name;
  const sender = String(from || "").trim();
  if (!sender || sender.includes("@")) return "Nequi";
  return sender;
}

/** Compara dos teléfonos por dígitos, tolerando el indicativo de país. */
export function samePhone(a, b) {
  const x = String(a || "").replace(/\D/g, "");
  const y = String(b || "").replace(/\D/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  return min >= 10 && (x.endsWith(y) || y.endsWith(x));
}

/** Devuelve el monto (entero) si el token es dinero, si no null. */
export function parseMoney(token) {
  const raw = String(token || "").trim();
  const m = MONEY_TOKEN.exec(raw);
  if (!m) return null;
  const hasSep = /[.,]/.test(m[1]);
  const hasDollar = raw.startsWith("$");
  const hasK = !!m[2];
  if (!hasSep && !hasDollar && !hasK) {
    const n = Number(m[1]);
    if (m[1].length <= 3 && n < 1000) return null; // es un índice, no un monto
  }
  let value = Number(m[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(value)) return null;
  if (hasK) value *= 1000;
  value = Math.round(value);
  return value > 0 ? value : null;
}

/** Devuelve el índice (≥1) si el token es un entero corto, si no null. */
export function parseIndex(token) {
  const t = String(token || "").trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** Devuelve una placa normalizada si el token tiene letras y dígitos. */
export function parsePlateToken(token) {
  const t = String(token || "").trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
  if (!/^[a-z0-9][a-z0-9-]{2,9}$/i.test(t)) return null;
  if (!/[a-z]/i.test(t) || !/\d/.test(t)) return null;
  return normalizePlate(t);
}

const hasKey = (text, keys) => keys.some((k) => text.includes(k));

function detectReason(text) {
  if (hasKey(text, ["taller", "mecanic", "reparac"])) return "taller";
  if (hasKey(text, ["descans", "libre"])) return "descanso";
  if (hasKey(text, ["no trabajo", "no trabaja", "no laboro"])) return "no_trabajo";
  if (text.includes("otro")) return "otro";
  return "";
}

/**
 * Traduce un mensaje libre a una intención estructurada.
 * @returns {{intent:string, amount:number|null, refs:Array<{kind:string,value:any}>, reason:string, detail:string, raw:string}}
 */
export function parseCommand(input) {
  const raw = normalizeText(input);
  const result = { intent: INTENT.UNKNOWN, amount: null, refs: [], reason: "", detail: "", raw };
  if (!raw) return result;

  const words = [];
  for (const token of raw.split(" ").filter(Boolean)) {
    const money = parseMoney(token);
    if (money != null && result.amount == null) { result.amount = money; continue; }
    const index = parseIndex(token);
    if (index != null && !result.refs.some((r) => r.kind === "index")) {
      result.refs.push({ kind: "index", value: index });
      continue;
    }
    const plate = parsePlateToken(token);
    if (plate) { result.refs.push({ kind: "plate", value: plate }); continue; }
    words.push(token);
  }

  if (hasKey(raw, OFFDAY_KEYS)) {
    result.intent = INTENT.OFFDAY;
    result.reason = detectReason(raw);
    result.detail = words.filter((w) => w !== "otro" && w !== "motivo" && w !== "razon").join(" ").trim();
  } else if (hasKey(raw, PAYMENT_KEYS)) {
    result.intent = INTENT.PAYMENT;
  } else if (hasKey(raw, CHECKIN_KEYS)) {
    result.intent = INTENT.CHECKIN;
  } else if (hasKey(raw, CLOSURES_KEYS)) {
    result.intent = INTENT.CLOSURES;
  } else if (hasKey(raw, CLOSE_KEYS)) {
    result.intent = INTENT.CLOSE;
  } else if (hasKey(raw, PENDING_KEYS)) {
    result.intent = INTENT.PENDING;
  } else if (hasKey(raw, STATUS_KEYS)) {
    result.intent = INTENT.STATUS;
  } else if (hasKey(raw, HELP_KEYS)) {
    result.intent = INTENT.HELP;
  }

  return result;
}
