// Parser de correos de Nequi (pagos recibidos).
// Módulo puro (sin red ni base de datos) para poder probarlo y ajustarlo con
// el primer correo real. Devuelve el monto y la fecha sugerida, o null.

const RECEIVED_RX = /(recibiste|recibido|recibimos|has recibido|te\s+(?:envi|mand|transfir|consign)\w*|te\s+lleg\w*|abono|ingreso|transferencia recibida|pago recibido|entrada de dinero)/i;
const SENT_RX = /(enviaste|pagaste|realizaste|tu env[ií]o|saldo enviado|pago realizado|cobro generado)/i;
const MONEY_RX = /\$\s*([0-9][0-9.,]{0,20})/g;

// Convierte un monto con formato colombiano/US a número.
// "80.000" -> 80000 | "1.234.567,89" -> 1234567.89 | "80,000.00" -> 80000 | "12,50" -> 12.5
export function parseCoAmount(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/\s+/g, "").replace(/[^\d.,]/g, "");
  if (!s) return NaN;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) {
      s = parts.join("");
    } else {
      const dec = parts[1] || "";
      s = dec.length === 3 ? parts.join("") : `${parts[0]}.${dec}`;
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length > 2) {
      s = parts.join("");
    } else {
      const dec = parts[1] || "";
      s = dec.length === 3 ? parts.join("") : `${parts[0]}.${dec}`;
    }
  }

  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Fecha en zona horaria de Colombia -> "YYYY-MM-DD"
export function toBogotaDateStr(date) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Extrae montos del texto. Prioriza el monto que aparece tras una palabra clave
// de "recibido"; si no, usa el primero encontrado.
export function extractAmount(text) {
  const hay = String(text || "");
  const amounts = [];
  let m;
  MONEY_RX.lastIndex = 0;
  while ((m = MONEY_RX.exec(hay)) !== null) {
    const value = parseCoAmount(m[1]);
    if (isFinite(value) && value > 0) amounts.push({ value, index: m.index });
  }
  if (amounts.length === 0) return NaN;

  const kw = RECEIVED_RX.exec(hay);
  if (kw) {
    const after = amounts.find((a) => a.index >= kw.index);
    if (after) return after.value;
  }
  return amounts[0].value;
}

// Parsea un correo. Devuelve { isPayment, amount, detectedDate, snippet } o null.
export function parseNequiEmail({ subject = "", text = "", html = "", date = new Date(), from = "" } = {}) {
  const body = (text && text.trim()) || stripHtml(html);
  const haystack = `${subject}\n${body}`;

  const hasMoney = /\$\s*[0-9]/.test(haystack);
  if (!hasMoney) return null;

  const looksReceived = RECEIVED_RX.test(haystack);
  const looksSent = SENT_RX.test(haystack);
  const isPayment = looksReceived && !looksSent;

  const amount = extractAmount(haystack);
  if (!isFinite(amount) || amount <= 0) return null;

  return {
    isPayment,
    amount,
    detectedDate: toBogotaDateStr(date),
    snippet: body.slice(0, 300).trim(),
    from: String(from || "").slice(0, 160),
  };
}
