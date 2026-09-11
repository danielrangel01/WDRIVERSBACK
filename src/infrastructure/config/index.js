import "dotenv/config";

const getIsProd = () => process.env.NODE_ENV === "production";
const getIsTest = () => process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const fail = (name, hard = true) => {
  const msg = `\n❌ Variable de entorno obligatoria faltante: ${name}\n`;
  const isTestNow = getIsTest();
  if (hard && !isTestNow) {
    console.error(msg);
    process.exit(1);
  } else if (isTestNow) {
    // En entorno de test, no salimos: usamos placeholders.
  } else {
    console.warn(msg);
  }
};

const jwtSecret = process.env.JWT_SECRET;
if (getIsProd() && (!jwtSecret || jwtSecret.length < 32)) {
  console.error("\n❌ En producción JWT_SECRET debe tener al menos 32 caracteres y no puede ser vacío.\n");
  if (!getIsTest()) process.exit(1);
}

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) fail("MONGODB_URI", !getIsTest());

const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD;
if (getIsProd() && !adminPassword) fail("ADMIN_PASSWORD");

export const config = {
  get env() { return process.env.NODE_ENV || "development"; },
  get isProd() { return getIsProd(); },
  get isTest() { return getIsTest(); },
  port: process.env.PORT || 4000,
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
