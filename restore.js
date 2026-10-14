import dns from "dns";
try { dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]); } catch (_) {}

import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ObjectId } from "bson";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_NAME = (process.env.DB_NAME || "wdrivers").trim();
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_FLAG = process.argv.includes("--only");
const ONLY_VALUE = ONLY_FLAG
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;

const backupArg = process.argv.find((a) => a.startsWith("backups/") || a.includes("/backups/"));
if (!backupArg) {
  console.error("❌ Uso: node restore.js backups/<CARPETA_BACKUP> [--only cars] [--dry-run]");
  process.exit(1);
}

const backupDir = path.isAbsolute(backupArg)
  ? backupArg
  : path.join(__dirname, backupArg);

if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
  console.error(`❌ No existe la carpeta de backup: ${backupDir}`);
  process.exit(1);
}

const baseUri = process.env.MONGODB_URI || "";
if (!baseUri) {
  console.error("❌ Falta MONGODB_URI en server/.env");
  process.exit(1);
}

const buildUri = (dbName) => {
  let u = baseUri.trim();
  let scheme = "";
  if (u.startsWith("mongodb+srv://")) { scheme = "mongodb+srv://"; u = u.slice("mongodb+srv://".length); }
  else if (u.startsWith("mongodb://")) { scheme = "mongodb://"; u = u.slice("mongodb://".length); }
  else throw new Error("MONGODB_URI invalida");
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

// Deserializa JSON a documentos Mongo (reconstruye ObjectId y Date)
function deserialize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(deserialize);
  if (typeof value === "object") {
    if (value.$oid) return new ObjectId(value.$oid);
    if (value.$date) return new Date(value.$date);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deserialize(v);
    }
    return out;
  }
  return value;
}

async function run() {
  const manifestPath = path.join(backupDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
    : null;

  if (manifest) {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║            W DRIVERS — RESTAURACIÓN DE BACKUP            ║");
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  Backup      : ${manifest.backupAt}`);
    console.log(`  Base de datos origen: ${manifest.database}`);
    console.log(`  Base de datos destino: ${DB_NAME}`);
    console.log(`  Modo        : ${DRY_RUN ? "DRY-RUN (simulación, NO escribe)" : "REAL (escribe en DB)"}`);
    console.log("");
  }

  const files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  let collections = files.map((f) => f.replace(/\.json$/, ""));
  if (ONLY_VALUE) {
    collections = collections.filter((c) => c === ONLY_VALUE);
  }

  if (collections.length === 0) {
    console.error("❌ No se encontraron colecciones para restaurar.");
    process.exit(1);
  }

  const uri = buildUri(DB_NAME);
  console.log(`  URI destino (oculta): ${mask(uri)}`);
  console.log("");

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    family: 4,
  });
  console.log("✅ Conectado a MongoDB");

  const db = mongoose.connection.db;

  if (DRY_RUN) {
    console.log("\n📋 SIMULACIÓN (dry-run) — lo que se haría:\n");
  }

  let totalDocs = 0;
  for (const colName of collections) {
    const filePath = path.join(backupDir, `${colName}.json`);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const docs = raw.map(deserialize);
    totalDocs += docs.length;

    if (DRY_RUN) {
      console.log(`  • ${colName.padEnd(14)} ${String(docs.length).padStart(6)} docs → upsert por _id`);
      continue;
    }

    const col = db.collection(colName);
    let upserted = 0;
    let modified = 0;
    for (const doc of docs) {
      if (!doc._id) continue;
      const { _id, ...rest } = doc;
      const res = await col.updateOne(
        { _id },
        { $set: rest },
        { upsert: true }
      );
      if (res.upsertedCount) upserted++;
      if (res.modifiedCount) modified++;
    }
    console.log(`  ✔ ${colName.padEnd(14)} ${String(docs.length).padStart(6)} docs → ${upserted} nuevos, ${modified} actualizados`);
  }

  if (!DRY_RUN) {
    await mongoose.disconnect();
  } else {
    await mongoose.disconnect();
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(DRY_RUN ? "ℹ️  SIMULACIÓN completada (no se escribió nada)" : "✅ RESTAURACIÓN completada");
  console.log(`   Total docs: ${totalDocs}`);
  console.log("══════════════════════════════════════════════════════════");
}

run().catch((err) => {
  console.error("❌ Error en restore:", err.message);
  process.exit(1);
});
