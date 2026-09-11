import mongoose from "mongoose";

const RECONNECT_INTERVAL_MS = 5000;

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
    console.error("❌ Error en conexión MongoDB:", err.message);
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
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        heartbeatFrequencyMS: 10000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        w: "majority",
      });
    } catch (err) {
      attempts++;
      console.error(`❌ Intento ${attempts} de conexión MongoDB falló:`, err.message);
      if (attempts < 10) {
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
  }, 10000).unref();
}
