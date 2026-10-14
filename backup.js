import dns from "dns";
try { dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]); } catch (_) {}

import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUPS_DIR = path.join(__dirname, "backups");

const DB_NAME = (process.env.DB_NAME || "wdrivers").trim();
const ONLY_CARS = process.argv.includes("--only-cars");
const PRETTY = !process.argv.includes("--compact");

const baseUri = process.env.MONGODB_URI || "";
if (!baseUri) {
  console.error("❌ Falta MONGODB_URI en server/.env");
  process.exit(1);
}

// Construye URI apuntando a una DB específica (ignora el nombre que venga en la URI)
const buildUri = (dbName) => {
  let u = baseUri.trim();
  let scheme = "";
  if (u.startsWith("mongodb+srv://")) { scheme = "mongodb+srv://"; u = u.slice("mongodb+srv://".length); }
  else if (u.startsWith("mongodb://")) { scheme = "mongodb://"; u = u.slice("mongodb://".length); }
  else throw new Error("MONGODB_URI invalida: no empieza por mongodb:// o mongodb+srv://");
  let hostPart = u;
  let queryPart = "";
  const q = u.indexOf("?");
  if (q >= 0) { hostPart = u.slice(0, q); queryPart = u.slice(q + 1); }
  const slash = hostPart.indexOf("/");
  if (slash >= 0) hostPart = hostPart.slice(0, slash);
  if (!queryPart) queryPart = "retryWrites=true&w=majority&serverSelectionTimeoutMS=15000";
  return scheme + hostPart + "/" + dbName + "?" + queryPart;
};

function mask(uri) {
  return uri.replace(/:([^:@]+)@/, ":***@");
}

// Serializa documentos Mongo a JSON limpio (ObjectId -> string, Date -> ISO, etc.)
function serialize(doc) {
  if (doc === null || doc === undefined) return doc;
  if (doc instanceof Date) return { $date: doc.toISOString() };
  if (typeof doc === "object") {
    if (doc._bsontype === "ObjectId") return { $oid: doc.toString() };
    if (doc._bsontype === "Long") return Number(doc.toString());
    if (doc._bsontype === "Decimal128") return Number(doc.toString());
    if (Array.isArray(doc)) return doc.map(serialize);
    const out = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === "__v") continue; // salta version key de mongoose
      out[k] = serialize(v);
    }
    return out;
  }
  return doc;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function run() {
  const uri = buildUri(DB_NAME);
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║             W DRIVERS — BACKUP DE BASE DE DATOS          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Base de datos : ${DB_NAME}`);
  console.log(`  URI (oculta)  : ${mask(uri)}`);
  console.log("");

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    family: 4,
  });
  console.log("✅ Conectado a MongoDB");

  const db = mongoose.connection.db;
  const allCollections = (await db.listCollections().toArray()).map((c) => c.name);
  console.log(`📦 Colecciones en la DB: ${allCollections.join(", ") || "(ninguna)"}`);

  const collections = ONLY_CARS
    ? ["cars"]
    : allCollections.filter((c) => !c.startsWith("system."));

  const stamp = timestamp();
  const backupDir = path.join(BACKUPS_DIR, stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    backupAt: new Date().toISOString(),
    database: DB_NAME,
    host: uri.match(/@([^/]+)/)?.[1] || "unknown",
    format: "json",
    version: 1,
    collections: {},
  };

  let totalDocs = 0;
  console.log("");
  for (const colName of collections) {
    const col = db.collection(colName);
    const docs = await col.find({}).toArray();
    const serialized = docs.map(serialize);
    const filePath = path.join(backupDir, `${colName}.json`);
    const content = PRETTY
      ? JSON.stringify(serialized, null, 2)
      : JSON.stringify(serialized);
    fs.writeFileSync(filePath, content, "utf-8");

    const sizeBytes = fs.statSync(filePath).size;
    const sizeKb = (sizeBytes / 1024).toFixed(1);
    totalDocs += docs.length;
    manifest.collections[colName] = {
      count: docs.length,
      file: `${colName}.json`,
      sizeBytes,
    };
    console.log(`  ✔ ${colName.padEnd(14)} ${String(docs.length).padStart(6)} docs   (${sizeKb} KB)`);
  }

  fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  // Crear un archivo README de restauración rápida
  const readme = `# Backup W Drivers — ${stamp}

- Base de datos: ${DB_NAME}
- Fecha: ${manifest.backupAt}
- Total documentos: ${totalDocs}
- Colecciones: ${Object.keys(manifest.collections).join(", ")}

## Cómo restaurar

Desde la carpeta \`server\` ejecuta:

\`\`\`bash
# Restaurar TODAS las colecciones de este backup
node restore.js backups/${stamp}

# Restaurar solo una colección (ej: cars)
node restore.js backups/${stamp} --only cars

# Dry-run (ver qué haría sin escribir)
node restore.js backups/${stamp} --dry-run
\`\`\`
`;
  fs.writeFileSync(path.join(backupDir, "README.md"), readme, "utf-8");

  await mongoose.disconnect();

  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`✅ BACKUP COMPLETADO`);
  console.log(`   Carpeta   : ${backupDir}`);
  console.log(`   Total docs: ${totalDocs}`);
  console.log(`   Archivos  : ${collections.length + 2} (${collections.length} JSON + manifest + README)`);
  console.log("══════════════════════════════════════════════════════════");
  console.log("");
  console.log("📝 Para restaurar:");
  console.log(`   node restore.js backups/${stamp}`);
}

run().catch((err) => {
  console.error("❌ Error en backup:", err.message);
  process.exit(1);
});
