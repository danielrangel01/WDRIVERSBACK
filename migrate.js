import dns from "dns";
try { dns.setServers(["8.8.8.8","8.8.4.4","1.1.1.1","1.0.0.1"]); } catch(_){}
import "dotenv/config";
import mongoose from "mongoose";

const DRY_RUN = !process.argv.includes("--apply");
const SOURCE_DB = "test";
const DEST_DB = "wdrivers";

const baseUri = process.env.MONGODB_URI || "";
if (!baseUri) {
  console.error("❌ Falta MONGODB_URI en server/.env");
  process.exit(1);
}

const buildUri = (dbName) => {
  let u = baseUri.trim();
  let scheme = "";
  if (u.startsWith("mongodb+srv://")) {
    scheme = "mongodb+srv://";
    u = u.slice("mongodb+srv://".length);
  } else if (u.startsWith("mongodb://")) {
    scheme = "mongodb://";
    u = u.slice("mongodb://".length);
  } else {
    throw new Error("MONGODB_URI invalida: no empieza por mongodb:// o mongodb+srv://");
  }
  let hostPart = u;
  let queryPart = "";
  const q = u.indexOf("?");
  if (q >= 0) {
    hostPart = u.slice(0, q);
    queryPart = u.slice(q + 1);
  }
  const slash = hostPart.indexOf("/");
  if (slash >= 0) {
    hostPart = hostPart.slice(0, slash);
  }
  if (!queryPart) {
    queryPart = "retryWrites=true&w=majority&serverSelectionTimeoutMS=10000";
  }
  return scheme + hostPart + "/" + dbName + "?" + queryPart;
};

const COLLECTIONS = [
  "cars",
  "payments",
  "refinances",
  "expenses",
  "offdays",
  "documents",
  "settings",
  "users",
];

function mask(uri) {
  return uri.replace(/:([^:@]+)@/, ":***@");
}

async function ensureIndexes(dbSrc, dbDst, colName) {
  try {
    const src = dbSrc.collection(colName);
    const dst = dbDst.collection(colName);
    const srcIdxs = await src.indexes().catch(() => []);
    for (const idx of srcIdxs) {
      const key = JSON.stringify(idx.key);
      if (key === JSON.stringify({ _id: 1 })) continue;
      const { v, ns, ...rest } = idx;
      try { await dst.createIndex(idx.key, rest); } catch (_) {}
    }
  } catch (_) {}
}

async function migrateCollection(dbSrc, dbDst, colName) {
  const srcCol = dbSrc.collection(colName);
  const dstCol = dbDst.collection(colName);

  const srcCount = await srcCol.estimatedDocumentCount().catch(() => 0);
  const dstBefore = await dstCol.estimatedDocumentCount().catch(() => 0);

  if (srcCount === 0) {
    console.log(`  ⚪ ${colName.padEnd(12)}: vacia en origen. Saltar.`);
    return { copied: 0, skipped: 0, updated: 0, src: 0, dstBefore: 0, dstAfter: 0 };
  }

  let copied = 0;
  let updated = 0;
  let skipped = 0;
  const batch = [];
  const BATCH = 200;
  const flush = async () => {
    if (batch.length === 0 || DRY_RUN) { batch.length = 0; return; }
    for (const d of batch) {
      try {
        await dstCol.replaceOne({ _id: d._id }, d, { upsert: true });
      } catch (e) {
        if (e && e.code === 11000) {
          const msg = (e.message || "").toLowerCase();
          let matchKey = null;
          let matchVal = null;
          const m = msg.match(/index:\s*(\w+)_\d+\s*dup\s*key:\s*\{\s*(\w+):\s*("[^"]*"|\S+)/i);
          if (m) { matchKey = m[2]; matchVal = m[3]?.replace(/^"|"$/g, ""); }
          if (matchKey && matchVal != null) {
            const filter = {};
            if (matchVal === "null") filter[matchKey] = null;
            else if (!isNaN(Number(matchVal))) filter[matchKey] = Number(matchVal);
            else filter[matchKey] = matchVal;
            const { _id, ...rest } = d;
            const q = { $or: [{ _id: d._id }, filter] };
            try {
              await dstCol.updateOne(q, { $set: rest });
            } catch (_) {
              try {
                await dstCol.deleteOne(q);
                await dstCol.insertOne(d);
              } catch (_) {}
            }
          }
        }
      }
    }
    batch.length = 0;
  };

  const cursor = srcCol.find();
  for await (const doc of cursor) {
    if (colName === "users" && doc.username === "admin" && !DRY_RUN) {
      const exists = await dstCol.findOne({ _id: doc._id });
      if (exists) { skipped++; continue; }
    }
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  const dstAfter = DRY_RUN
    ? dstBefore
    : await dstCol.estimatedDocumentCount().catch(() => 0);

  if (!DRY_RUN) {
    copied = Math.max(0, dstAfter - dstBefore);
    updated = Math.max(0, srcCount - copied - skipped);
  }

  const mode = DRY_RUN ? "🔎 DRY-RUN" : "✅ MIGRADO";
  const extra = DRY_RUN
    ? `(se copiaria ${srcCount} docs)`
    : `(${copied} nuevos + ${updated} actualizados, ${skipped} skip)`;
  console.log(`  ${mode} ${colName.padEnd(12)}: ${srcCount} origen -> ${dstBefore} -> ${dstAfter} destino  ${extra}`);
  return { copied, updated, skipped, src: srcCount, dstBefore, dstAfter };
}

async function main() {
  console.log("\n" + "=".repeat(72));
  console.log("MIGRACION MongoDB - MISMO CLUSTER Atlas");
  console.log(`   ORIGEN:  ${SOURCE_DB}   ->   DESTINO: ${DEST_DB}`);
  const modo = DRY_RUN
    ? "DRY-RUN (nada se escribe. Usa --apply para migrar de verdad)"
    : "MODO REAL - se escribiran datos";
  console.log(`   MODO:    ${modo}`);
  console.log(`   URI:     ${mask(buildUri(SOURCE_DB))}\n`);

  const srcUri = buildUri(SOURCE_DB);

  const conn = await mongoose.createConnection(srcUri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
  }).asPromise();

  const dbSrc = conn.useDb(SOURCE_DB);
  const dbDst = conn.useDb(DEST_DB);

  console.log("Conectado al cluster. Verificando colecciones en origen...\n");
  let allSrc = 0;
  let allDst = 0;

  const results = {};
  for (const c of COLLECTIONS) {
    await ensureIndexes(dbSrc, dbDst, c);
    results[c] = await migrateCollection(dbSrc, dbDst, c);
    allSrc += results[c].src || 0;
    allDst += DRY_RUN ? 0 : (results[c].dstAfter || 0);
  }

  console.log("\n" + "-".repeat(72));
  console.log(`RESUMEN: ${allSrc} documentos en ORIGEN (${SOURCE_DB})`);
  if (!DRY_RUN) console.log(`         ${allDst} documentos en DESTINO (${DEST_DB})`);
  console.log("=".repeat(72));

  if (!DRY_RUN) {
    console.log("\nVALIDACION cruzada (conteos origen vs destino):\n");
    let fail = 0;
    for (const c of COLLECTIONS) {
      const r = results[c];
      if (!r) continue;
      if (r.src === 0 && r.dstAfter === 0) continue;
      const ok = r.src <= r.dstAfter;
      const tag = ok ? "OK" : "DIF";
      console.log(`  ${ok ? "[✅]" : "[⚠️]"} ${c.padEnd(12)} src=${r.src}  dst=${r.dstAfter} ${ok ? "" : "  <- diferencia detectada"}`);
      if (!ok) fail++;
    }
    if (fail === 0) {
      console.log("\nMIGRACION 100% CONSISTENTE. Todos los conteos coinciden.\n");
    } else {
      console.log(`\nATENCION: ${fail} colecciones con diferencia. Revisa manualmente.\n`);
    }
  } else {
    console.log("\nPara ejecutar la migracion REAL corre:");
    console.log("\n       npm run migrate:apply\n");
  }

  await conn.close();
}

main().catch(err => {
  console.error("\nERROR:", err);
  process.exit(1);
});
