import { config } from "./infrastructure/config/index.js";
import { connectDB, gracefulShutdown } from "./infrastructure/database/connection.js";
import { createApp } from "./interfaces/http/app.js";

process.on("uncaughtException", (err) => {
  console.error("💀 Uncaught Exception:", err.name, err.message);
  if (config.isProd) {
    console.error("Stack:", err.stack);
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection en:", promise, "\nRazón:", reason);
  if (config.isProd) {
    setTimeout(() => process.exit(1), 1000);
  }
});

async function main() {
  await connectDB(config.mongoUri);
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`✓ Servidor W Drivers en puerto ${config.port} [${config.env}]`);
    if (config.isProd) {
      console.log(`✓ Producción: seguridad activada (helmet, rate-limit, sanitize)`);
    }
  });

  server.on("clientError", (err, socket) => {
    if (err.code === "ECONNRESET" || !socket.writable) return;
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
  process.on("SIGINT", () => gracefulShutdown("SIGINT", server));
}

main();
