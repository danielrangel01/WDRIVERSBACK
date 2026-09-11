import dns from "dns";
try {
  if (dns.setDefaultResultOrder) dns.setDefaultResultOrder("ipv4first");
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]);
} catch (_) {}
import "dotenv/config";

const getIsProd = () => {
  const v = (process.env.NODE_ENV || "").toLowerCase().trim();
  if (v === "production" || v === "prod") return true;
  if (process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_SERVICE_ID) return true;
  return false;
};
const getIsTest = () => process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const fail = (name, hard = true) => {
  const msg = `\n❌ Variable de entorno obligatoria faltante: ${name}\n`;
  const isTestNow = getIsTest();
  if (hard && !isTestNow) {
    console.error(msg);
    process.exit(1);
  } else if (isTestNow) {
  } else {
    console.warn(msg);
  }
};

const jwtSecret = process.env.JWT_SECRET;
if (getIsProd() && (!jwtSecret || jwtSecret.length < 32)) {
  console.error("\n❌ En producción JWT_SECRET debe tener al menos 32 caracteres y no puede ser vacío.\n");
  if (!getIsTest()) process.exit(1);
}

function normalizeMongoUri(raw) {
  if (!raw) return raw;
  let u = String(raw).trim();
  if (!u.startsWith("mongodb://") && !u.startsWith("mongodb+srv://")) return u;
  try {
    const scheme = u.startsWith("mongodb+srv://") ? "mongodb+srv://" : "mongodb://";
    const rest = u.slice(scheme.length);
    const at = rest.lastIndexOf("@");
    if (at <= 0) return u;
    const userinfo = rest.slice(0, at);
    let hostdbquery = rest.slice(at + 1);
    let user = userinfo;
    let pass = "";
    const colon = userinfo.indexOf(":");
    if (colon >= 0) {
      user = userinfo.slice(0, colon);
      pass = userinfo.slice(colon + 1);
    }
    if (pass) {
      try {
        const decoded = decodeURIComponent(pass);
        const reEncoded = encodeURIComponent(decoded);
        pass = reEncoded;
      } catch (_) {
        pass = encodeURIComponent(pass);
      }
    }
    if (user) {
      try {
        const decoded = decodeURIComponent(user);
        user = encodeURIComponent(decoded);
      } catch (_) {
        user = encodeURIComponent(user);
      }
    }
    let query = "";
    let hostdb = hostdbquery;
    const q = hostdbquery.indexOf("?");
    if (q >= 0) {
      hostdb = hostdbquery.slice(0, q);
      query = hostdbquery.slice(q + 1);
    }
    let host = hostdb;
    let db = "";
    const slash = hostdb.indexOf("/");
    if (slash >= 0) {
      host = hostdb.slice(0, slash);
      db = hostdb.slice(slash + 1);
    }
    const params = new URLSearchParams(query || "");
    if (!params.has("retryWrites")) params.set("retryWrites", "true");
    if (!params.has("w")) params.set("w", "majority");
    if (!params.has("authSource")) params.set("authSource", "admin");
    if (!params.has("serverSelectionTimeoutMS")) params.set("serverSelectionTimeoutMS", "15000");
    if (!params.has("connectTimeoutMS")) params.set("connectTimeoutMS", "15000");
    if (!params.has("socketTimeoutMS")) params.set("socketTimeoutMS", "60000");
    if (!params.has("heartbeatFrequencyMS")) params.set("heartbeatFrequencyMS", "10000");
    if (!params.has("tls") && scheme === "mongodb+srv://") params.set("tls", "true");
    if (!params.has("appName")) params.set("appName", "wdrivers-server");
    params.delete("?");
    query = params.toString();
    const dbPart = db ? "/" + encodeURIComponent(db) : "";
    return scheme + user + (pass ? ":" + pass : "") + "@" + host + dbPart + "?" + query;
  } catch (_) {
    return raw;
  }
}

let mongoUri = process.env.MONGODB_URI;
try {
  mongoUri = normalizeMongoUri(mongoUri);
} catch (_) {}

if (mongoUri && mongoUri.includes("@")) {
  try {
    let u = mongoUri;
    const scheme = u.startsWith("mongodb+srv://") ? "mongodb+srv://" : "mongodb://";
    const rest = u.slice(scheme.length);
    const at = rest.lastIndexOf("@");
    if (at > 0) {
      let hostdbquery = rest.slice(at + 1);
      let hostdb = hostdbquery;
      const q = hostdbquery.indexOf("?");
      if (q >= 0) hostdb = hostdbquery.slice(0, q);
      const slash = hostdb.indexOf("/");
      if (slash < 0) {
        mongoUri = normalizeMongoUri(
          scheme + rest.slice(0, at + 1) + hostdb + "/wdrivers" + (q >= 0 ? hostdbquery.slice(q) : "")
        );
      } else {
        const dbName = hostdb.slice(slash + 1);
        if (!dbName || dbName === "admin" || dbName === "local" || dbName === "config") {
          mongoUri = normalizeMongoUri(
            scheme + rest.slice(0, at + 1) + hostdb.slice(0, slash) + "/wdrivers" + (q >= 0 ? hostdbquery.slice(q) : "")
          );
        }
      }
    }
  } catch (_) {}
}

if (!mongoUri) fail("MONGODB_URI", !getIsTest());

const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD;
if (getIsProd() && !adminPassword) fail("ADMIN_PASSWORD");

if (getIsProd()) {
  process.env.NODE_ENV = "production";
}

export const config = {
  get env() { return getIsProd() ? "production" : (process.env.NODE_ENV || "development"); },
  get isProd() { return getIsProd(); },
  get isTest() { return getIsTest(); },
  port: Number(process.env.PORT) || 4000,
  mongoUri,
  jwtSecret: jwtSecret || "dev_secret_change_me_ONLY_FOR_LOCAL_DEV_never_use_in_prod_0123456789",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  clientOrigin: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  allowAnyOrigin: (process.env.CLIENT_ORIGIN || "").trim() === "*",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 200),
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 8),
  payloadLimit: process.env.PAYLOAD_LIMIT || "100kb",
  get admin() {
    const isProdNow = getIsProd();
    return {
      username: adminUser.toLowerCase().trim(),
      password: adminPassword || "Admin2024!",
      passwordMin: isProdNow ? 10 : 4,
    };
  },
  security: {
    noteMaxLength: 500,
    nameMaxLength: 100,
    phoneMaxLength: 30,
    plateMaxLength: 10,
    documentTypeMaxLength: 60,
    categoryMaxLength: 60,
    bulkOffDayMaxCars: 200,
  },
};
