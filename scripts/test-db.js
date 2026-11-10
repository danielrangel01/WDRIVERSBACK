/**
 * W DRIVERS — Gestor de la BASE DE DATOS DE PRUEBAS
 * ---------------------------------------------------------------------------
 * Permite preparar un entorno de pruebas SIN TOCAR la base de datos real.
 *
 * Modos:
 *   node scripts/test-db.js status     → muestra el conteo de docs en real y prueba
 *   node scripts/test-db.js clone      → copia la DB real a la DB de pruebas (la real solo se LEE)
 *   node scripts/test-db.js hybrid     → clona la DB real Y añade datos ficticios (recomendado)
 *   node scripts/test-db.js fixtures   → borra la DB de pruebas y crea datos ficticios
 *   node scripts/test-db.js drop       → vacía la DB de pruebas
 *
 * Variables:
 *   MONGODB_URI     (obligatoria, en server/.env)
 *   DB_NAME         base real (por defecto "wdrivers")   ← solo se lee
 *   TEST_DB_NAME    base de pruebas (por defecto "wdrivers_test")
 */
import dns from "dns";
try { dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]); } catch (_) {}

import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const SOURCE_DB = (process.env.DB_NAME || "wdrivers").trim();
const TEST_DB = (process.env.TEST_DB_NAME || "wdrivers_test").trim();
const MODE = (process.argv[2] || "status").toLowerCase();
const PROTECTED = new Set(["admin", "local", "config"]);
const baseUri = (process.env.MONGODB_URI || "").trim();

const APP_COLLECTIONS = [
  "users", "cars", "payments", "expenses", "documents",
  "offdays", "settings", "refinances", "pendingpayments",
];

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!baseUri) fail("Falta MONGODB_URI en server/.env");
if (PROTECTED.has(TEST_DB)) fail(`TEST_DB_NAME no puede ser una base protegida: "${TEST_DB}"`);
if (TEST_DB === SOURCE_DB) fail(`TEST_DB_NAME no puede ser igual a la base real (DB_NAME="${SOURCE_DB}")`);
if (!/test/i.test(TEST_DB)) fail(`Por seguridad, TEST_DB_NAME debe contener "test" (recibido: "${TEST_DB}")`);

function buildUri(dbName) {
  let u = baseUri;
  let scheme = "";
  if (u.startsWith("mongodb+srv://")) { scheme = "mongodb+srv://"; u = u.slice("mongodb+srv://".length); }
  else if (u.startsWith("mongodb://")) { scheme = "mongodb://"; u = u.slice("mongodb://".length); }
  else fail("MONGODB_URI inválida: no empieza por mongodb:// ni mongodb+srv://");
  let hostPart = u;
  let queryPart = "";
  const q = u.indexOf("?");
  if (q >= 0) { hostPart = u.slice(0, q); queryPart = u.slice(q + 1); }
  const slash = hostPart.indexOf("/");
  if (slash >= 0) hostPart = hostPart.slice(0, slash);
  if (!queryPart) queryPart = "retryWrites=true&w=majority&serverSelectionTimeoutMS=15000";
  return scheme + hostPart + "/" + dbName + "?" + queryPart;
}

const mask = (uri) => uri.replace(/:([^:@]+)@/, ":***@");

const OPTS = { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000, family: 4 };

async function open(dbName) {
  return mongoose.createConnection(buildUri(dbName), OPTS).asPromise();
}

function banner(title) {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║  W DRIVERS — ${title.padEnd(44)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Base real   (solo lectura) : ${SOURCE_DB}`);
  console.log(`  Base prueba (destino)      : ${TEST_DB}`);
  console.log(`  URI prueba (oculta)        : ${mask(buildUri(TEST_DB))}`);
  console.log("");
}

// ── STATUS ───────────────────────────────────────────────────────────────────
async function status() {
  banner("ESTADO DEL ENTORNO DE PRUEBAS");
  const src = await open(SOURCE_DB);
  const dst = await open(TEST_DB);
  let srcTotal = 0, dstTotal = 0;
  console.log(`  ${"Colección".padEnd(16)} ${"REAL".padStart(10)} ${"PRUEBA".padStart(10)}`);
  console.log("  " + "-".repeat(38));
  for (const name of APP_COLLECTIONS) {
    const a = await src.db.collection(name).countDocuments().catch(() => 0);
    const b = await dst.db.collection(name).countDocuments().catch(() => 0);
    srcTotal += a; dstTotal += b;
    console.log(`  ${name.padEnd(16)} ${String(a).padStart(10)} ${String(b).padStart(10)}`);
  }
  console.log("  " + "-".repeat(38));
  console.log(`  ${"TOTAL".padEnd(16)} ${String(srcTotal).padStart(10)} ${String(dstTotal).padStart(10)}`);
  console.log("");
  await src.close();
  await dst.close();
}

// ── CLONE (real → prueba, la real solo se lee) ───────────────────────────────
async function clone() {
  banner("CLONANDO BASE REAL → BASE DE PRUEBAS");
  const src = await open(SOURCE_DB);
  const dst = await open(TEST_DB);
  let total = 0;
  for (const name of APP_COLLECTIONS) {
    const docs = await src.db.collection(name).find({}).toArray(); // solo lectura
    await dst.db.collection(name).drop().catch(() => {});
    if (docs.length) await dst.db.collection(name).insertMany(docs);
    total += docs.length;
    console.log(`  ✔ ${name.padEnd(16)} ${String(docs.length).padStart(6)} docs copiados`);
  }
  await src.close();
  await dst.close();
  console.log("");
  console.log(`✅ Copiados ${total} documentos a "${TEST_DB}". La base real NO fue modificada.`);
  console.log(`   Puedes iniciar sesión con tus credenciales reales (se copió la colección "users").`);
}

// ── FIXTURES (datos ficticios deterministas) ─────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAhead(n) { return daysAgo(-n); }

/** Construye las colecciones ficticias (aditivas: no pisan datos reales clonados). */
function buildFixtures() {
  const oid = () => new mongoose.Types.ObjectId();

  const cars = [
    { _id: oid(), plate: "TST001", name: "Juan Prueba", rate: 80000, startDate: daysAgo(30), active: true, createdAt: new Date() },
    { _id: oid(), plate: "TST002", name: "María Prueba", rate: 90000, startDate: daysAgo(15), active: true, createdAt: new Date() },
    { _id: oid(), plate: "TST003", name: "Carlos Prueba", rate: 75000, startDate: daysAgo(60), active: false, createdAt: new Date() },
  ];

  const payments = [
    { _id: oid(), carId: cars[0]._id, date: daysAgo(5), amount: 400000, note: "Abono prueba", createdAt: new Date() },
    { _id: oid(), carId: cars[1]._id, date: daysAgo(3), amount: 250000, note: "", createdAt: new Date() },
    { _id: oid(), carId: cars[0]._id, date: daysAgo(1), amount: 100000, note: "Pago parcial", createdAt: new Date() },
  ];

  const expenses = [
    { _id: oid(), date: daysAgo(7), amount: 120000, category: "Combustible", note: "Prueba", createdAt: new Date() },
    { _id: oid(), date: daysAgo(2), amount: 90000, category: "Mantenimiento", note: "", createdAt: new Date() },
  ];

  const documents = [
    { _id: oid(), carId: cars[0]._id, type: "SOAT", expiry: daysAhead(10), note: "Por vencer", createdAt: new Date() },
    { _id: oid(), carId: cars[1]._id, type: "Tecnomecánica", expiry: daysAgo(5), note: "VENCIDO", createdAt: new Date() },
    { _id: oid(), carId: cars[0]._id, type: "Seguro Todo Riesgo", expiry: daysAhead(120), note: "Vigente", createdAt: new Date() },
  ];

  const offdays = [
    { _id: oid(), carId: cars[0]._id, date: daysAgo(4), reason: "descanso", detail: "", createdAt: new Date() },
    { _id: oid(), carId: cars[1]._id, date: daysAgo(2), reason: "otro", detail: "Reparación de prueba", createdAt: new Date() },
  ];

  const refinances = [
    { _id: oid(), carId: cars[0]._id, date: daysAgo(10), originalAmount: 500000, days: 50, paidToPlan: 150000, note: "Plan de prueba", active: true, createdAt: new Date() },
  ];

  const pendingpayments = [
    { _id: oid(), amount: 80000, detectedDate: daysAgo(1), source: "nequi", from: "Nequi <notificaciones@nequi.com.co>", subject: "Recibiste un pago", snippet: "Recibiste un pago por $80.000 de JUAN PRUEBA.", messageId: "test-msg-001@prueba", status: "pending", approvedPaymentId: null, createdAt: new Date() },
    { _id: oid(), amount: 120000, detectedDate: daysAgo(2), source: "nequi", from: "Nequi <notificaciones@nequi.com.co>", subject: "Recibiste un pago", snippet: "Recibiste un pago por $120.000 de MARÍA PRUEBA.", messageId: "test-msg-002@prueba", status: "pending", approvedPaymentId: null, createdAt: new Date() },
  ];

  return { cars, payments, expenses, documents, offdays, refinances, pendingpayments };
}

const TEST_ADMIN = { username: "test_admin", password: "Test1234!" };

async function insertFixtures(dst) {
  const fx = buildFixtures();
  for (const [name, docs] of Object.entries(fx)) {
    if (docs.length) await dst.db.collection(name).insertMany(docs);
  }
  return fx;
}

async function fixtures() {
  banner("GENERANDO DATOS FICTICIOS EN LA BASE DE PRUEBAS");
  const dst = await open(TEST_DB);

  for (const name of APP_COLLECTIONS) {
    await dst.db.collection(name).drop().catch(() => {});
  }

  await insertFixtures(dst);

  await dst.db.collection("settings").insertOne({
    _id: new mongoose.Types.ObjectId(), key: "global", adminPhone: "573001112233", morningHour: 8, eveningHour: 20, createdAt: new Date(),
  });

  const passwordHash = await bcrypt.hash(TEST_ADMIN.password, 10);
  await dst.db.collection("users").insertOne({
    _id: new mongoose.Types.ObjectId(), username: TEST_ADMIN.username, passwordHash, createdAt: new Date(), updatedAt: new Date(),
  });

  await dst.close();
  console.log("✅ Datos ficticios creados en la base de pruebas.");
  console.log("");
  console.log(`   Usuario de prueba:  ${TEST_ADMIN.username}`);
  console.log(`   Contraseña:         ${TEST_ADMIN.password}`);
  console.log("   (Carros TST001–TST003, pagos, gastos, docs, offdays, refinance y 1 pendiente Nequi)");
}

// ── ADMIN DE PRUEBA (usuario dedicado, no colisiona con el "admin" real) ─────
async function ensureTestAdmin(dst) {
  const passwordHash = await bcrypt.hash(TEST_ADMIN.password, 10);
  await dst.db.collection("users").updateOne(
    { username: TEST_ADMIN.username },
    {
      $set: { passwordHash, updatedAt: new Date() },
      $setOnInsert: { _id: new mongoose.Types.ObjectId(), username: TEST_ADMIN.username, createdAt: new Date() },
    },
    { upsert: true }
  );
}

async function admin() {
  banner("CREANDO/ACTUALIZANDO USUARIO DE PRUEBA");
  const dst = await open(TEST_DB);
  await ensureTestAdmin(dst);
  await dst.close();
  console.log("");
  console.log("✅ Usuario de prueba disponible en la base de prueba:");
  console.log(`   Usuario    : ${TEST_ADMIN.username}`);
  console.log(`   Contraseña : ${TEST_ADMIN.password}`);
  console.log("   (La base real NO fue modificada.)");
}

// ── HYBRID (clonar real + añadir ficticios) ──────────────────────────────────
async function hybrid() {
  banner("CLONANDO BASE REAL + AÑADIENDO DATOS FICTICIOS");
  const src = await open(SOURCE_DB);
  const dst = await open(TEST_DB);
  let total = 0;
  for (const name of APP_COLLECTIONS) {
    const docs = await src.db.collection(name).find({}).toArray(); // solo lectura
    await dst.db.collection(name).drop().catch(() => {});
    if (docs.length) await dst.db.collection(name).insertMany(docs);
    total += docs.length;
    console.log(`  ✔ ${name.padEnd(16)} ${String(docs.length).padStart(6)} docs clonados`);
  }
  await src.close();

  await insertFixtures(dst);
  console.log("  ✔ datos ficticios añadidos (TST001–TST003, refinance, pendiente Nequi)");

  await ensureTestAdmin(dst);

  await dst.close();
  console.log("");
  console.log(`✅ Clonados ${total} documentos reales + datos ficticios en "${TEST_DB}". La base real NO fue modificada.`);
  console.log("   Puedes iniciar sesión con tus credenciales reales y también con " +
    `${TEST_ADMIN.username} / ${TEST_ADMIN.password}.`);
}

// ── DROP ─────────────────────────────────────────────────────────────────────
async function drop() {
  banner("VACIANDO LA BASE DE PRUEBAS");
  const dst = await open(TEST_DB);
  for (const name of APP_COLLECTIONS) {
    await dst.db.collection(name).drop().catch(() => {});
    console.log(`  ✔ ${name} vaciada`);
  }
  await dst.close();
  console.log(`\n✅ Base de pruebas "${TEST_DB}" vaciada. La base real NO fue modificada.`);
}

async function run() {
  switch (MODE) {
    case "status": return status();
    case "clone": return clone();
    case "fixtures":
    case "reset": return fixtures();
    case "hybrid":
    case "clone+fixtures": return hybrid();
    case "admin":
    case "user": return admin();
    case "drop": return drop();
    default:
      console.log("Uso: node scripts/test-db.js [status|clone|fixtures|hybrid|admin|drop]");
      process.exit(1);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err.message, "\n");
    process.exit(1);
  });
