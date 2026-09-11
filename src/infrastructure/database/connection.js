import mongoose from "mongoose";

const RECONNECT_INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 20;

export async function connectDB(uri) {
  if (!uri) {
    console.error("❌ Falta MONGODB_URI en las variables de entorno.");
    process.exit(1);
  }
  mongoose.set("strictQuery", true);
  mongoose.set("sanitizeFilter", true);

  mongoose.connection.on("connected", () => {
    console.log("✓ Conectado a MongoDB");
  });
  mongoose.connection.on("error", (err) => {
    const m = (err && err.message) || String(err);
    console.error("❌ Error en conexión MongoDB:", m);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️  Desconectado de MongoDB. Reintentando...");
  });
  mongoose.connection.on("reconnected", () => {
    console.log("✓ Reconexión exitosa a MongoDB");
  });
  mongoose.connection.on("close", () => {
    console.warn("⚠️  Conexión MongoDB cerrada");
  });

  let attempts = 0;
  const tryConnect = async () => {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
        heartbeatFrequencyMS: 10000,
        socketTimeoutMS: 60000,
        retryWrites: true,
        w: "majority",
        wtimeoutMS: 10000,
        authSource: "admin",
        family: 4,
        autoCreate: true,
        autoIndex: true,
        maxPoolSize: 25,
        minPoolSize: 5,
      });
    } catch (err) {
      attempts++;
      const m = (err && err.message) || String(err);
      console.error(`❌ Intento ${attempts}/${MAX_ATTEMPTS} conexión MongoDB falló: ${m}`);
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(tryConnect, RECONNECT_INTERVAL_MS);
      } else {
        console.error("❌ No se pudo conectar a MongoDB después de múltiples intentos. Saliendo.");
        process.exit(1);
      }
    }
  };

  await tryConnect();
}

export function gracefulShutdown(signal, server) {
  console.log(`\n${signal} recibido. Apagado seguro...`);
  server.close(async () => {
    try {
      await mongoose.connection.close(false);
      console.log("✓ Conexión MongoDB cerrada correctamente");
    } catch (_) {}
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forzando apagado por timeout");
    process.exit(1);
  }, 15000).unref();
}
