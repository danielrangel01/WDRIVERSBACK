// Parser de correos de Nequi (pagos recibidos).
// Módulo puro (sin red ni base de datos) para poder probarlo y ajustarlo con
// el primer correo real. Devuelve el monto y la fecha sugerida, o null.

const RECEIVED_RX = /(recibiste|recibido|recibimos|recibió|recibes|has recibido|te\s+(?:envi|mand|transfir|consign|lleg|deposit)\w*|abono|ingreso|transferencia recibida|pago recibido|entrada de dinero)/i;
const SENT_RX = /(enviaste|pagaste|realizaste|tu env[ií]o|saldo enviado|pago realizado|cobro generado)/i;
const MONEY_RX = /\$\s*([0-9][0-9.,]{0,20})/g;
// Monto anclado a una palabra clave de "recibido": funciona con o sin "$".
// Ej: "Recibiste 10.000 de Juan" (Nequi Bre-B) y "Recibiste un pago por $80.000 de Juan".
const RECEIVED_AMOUNT_RX = /(?:recibiste|recibido|recibimos|recibió|recibes|has recibido|te\s+(?:envi|mand|transfir|consign|lleg|deposit)\w*|abono|ingreso|transferencia recibida|pago recibido|entrada de dinero)[^0-9]{0,25}?([0-9][0-9.,]{0,20})/i;

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

// Hora del pago escrita en el cuerpo del correo ("… el 9 de noviembre de 2026
// a las 6:56 p.m"). Se normaliza a "6:56 p.m." (o "15:45" en formato 24 h) y
// se devuelve "" si el correo no la trae.
const TIME_RX = /\ba\s+las?\s+(\d{1,2})[:.](\d{2})\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i;

export function extractTime(text) {
  const m = TIME_RX.exec(String(text || ""));
  if (!m) return "";
  const hhmm = `${Number(m[1])}:${m[2]}`;
  const suffix = String(m[3] || "").toLowerCase().replace(/\s+/g, "");
  if (/^a\.?m/.test(suffix)) return `${hhmm} a.m.`;
  if (/^p\.?m/.test(suffix)) return `${hhmm} p.m.`;
  return hhmm;
}

// Extrae montos del texto. Prioriza el monto anclado a una palabra clave de
// "recibido" (sirve con o sin "$"); si no, usa el primer monto con "$".
export function extractAmount(text) {
  const hay = String(text || "");

  const anchored = RECEIVED_AMOUNT_RX.exec(hay);
  if (anchored) {
    const v = parseCoAmount(anchored[1]);
    if (isFinite(v) && v > 0) return v;
  }

  const amounts = [];
  let m;
  MONEY_RX.lastIndex = 0;
  while ((m = MONEY_RX.exec(hay)) !== null) {
    const value = parseCoAmount(m[1]);
    if (isFinite(value) && value > 0) amounts.push({ value, index: m.index });
  }
  return amounts.length ? amounts[0].value : NaN;
}

// Palabras que no forman parte del nombre del pagador (cortan la captura).
const NAME_STOP = new Set([
  "el", "la", "los", "las", "un", "una", "desde", "en", "y", "con", "para",
  "por", "del", "de", "al", "a", "su", "sus", "tu", "banco", "app", "nequi",
  "bre", "linea", "chat", "cuenta", "comprobante", "saldo", "mensaje",
]);
const MONTHS = new Set([
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
]);

// Nombre del pagador: aparece tras el monto recibido ("Recibiste 10.000 de JUAN PEREZ el 9 de…").
const PAYER_RX = /(?:recibiste|recibido|recibimos|recibió|recibes|has recibido|te\s+(?:envi|mand|transfir|consign|lleg|deposit)\w*|abono|ingreso|transferencia recibida|pago recibido|entrada de dinero)[^0-9]{0,30}?[0-9][0-9.,]*\s*(?:pesos)?\s*(?:de|del|por parte de)\s+([^\n.!?,;:]{3,80})/i;

// Variante inversa: nombre ANTES del verbo ("JUAN PEREZ te envió $240.000").
const PAYER_BEFORE_RX = /(?:^|[^A-Za-zÁÉÍÓÚÑáéíóúñ])([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’.-]+){0,4})\s+(?:te\s+)?(?:envió|enviaron|envio|mandó|mandaron|transfirió|consignó|depositó|abonó|pagó)\s+\$?\s*[0-9]/;

// Limpia la captura: corta en palabras de relleno, meses y números.
function cleanPayerName(raw) {
  const tokens = String(raw || "").replace(/["'()]/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of tokens) {
    const word = t.replace(/[.,;:]+$/, "");
    const key = word.toLowerCase();
    if (!key || /^\d/.test(word) || NAME_STOP.has(key) || MONTHS.has(key)) break;
    out.push(word);
    if (out.length >= 5) break;
  }
  const name = out.join(" ").trim();
  return name.length >= 3 ? name : "";
}

// Extrae el nombre de quien envía el pago (vacío si el correo no lo trae).
export function extractPayerName(text) {
  const hay = String(text || "").replace(/\s+/g, " ").trim();
  if (!hay) return "";
  const after = PAYER_RX.exec(hay);
  if (after) {
    const name = cleanPayerName(after[1]);
    if (name) return name;
  }
  const before = PAYER_BEFORE_RX.exec(hay);
  return before ? cleanPayerName(before[1]) : "";
}

// Parsea un correo. Devuelve { isPayment, amount, detectedDate, payerName, snippet } o null.
export function parseNequiEmail({ subject = "", text = "", html = "", date = new Date(), from = "" } = {}) {
  const body = (text && text.trim()) || stripHtml(html);
  const haystack = `${subject}\n${body}`;

  const amount = extractAmount(haystack);
  if (!isFinite(amount) || amount <= 0) return null;

  const looksReceived = RECEIVED_RX.test(haystack);
  const looksSent = SENT_RX.test(haystack);
  const isPayment = looksReceived && !looksSent;

  return {
    isPayment,
    amount,
    detectedDate: toBogotaDateStr(date),
    detectedTime: extractTime(haystack),
    payerName: extractPayerName(haystack),
    snippet: body.slice(0, 300).trim(),
    from: String(from || "").slice(0, 160),
  };
}
