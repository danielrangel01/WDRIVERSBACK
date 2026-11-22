import { config } from "./infrastructure/config/index.js";
import { connectDB, gracefulShutdown } from "./infrastructure/database/connection.js";
import { createApp } from "./interfaces/http/app.js";
import { startNequiSync } from "./infrastructure/mail/nequiScheduler.js";
import { startReminderScheduler } from "./infrastructure/notify/reminderScheduler.js";

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

  // Sincronización automática de correos de Nequi (solo si hay credenciales IMAP).
  if (config.nequi.enabled && config.nequi.syncEveryMs > 0) {
    startNequiSync({ useCase: app.locals.useCases.syncNequi, everyMs: config.nequi.syncEveryMs });
    console.log(`✓ Sincronización Nequi activa cada ${Math.round(config.nequi.syncEveryMs / 60000)} min`);
  }

  // Recordatorios automáticos (correo / push), idempotentes por día y momento.
  if (config.notifications.enabled) {
    startReminderScheduler({
      useCase: app.locals.useCases.getReminders,
      dispatcher: app.locals.notify.reminderDispatcher,
      settingsRepository: app.locals.repositories.settingsRepository,
      reminderLogRepository: app.locals.repositories.reminderLogRepository,
      timeZone: config.notifications.timezone,
      everyMs: config.notifications.checkEveryMs,
    });
    console.log(`✓ Recordatorios activos (${config.notifications.timezone}) cada ${Math.round(config.notifications.checkEveryMs / 60000)} min`);
  } else {
    console.log("· Recordatorios en pausa (sin SMTP ni claves VAPID configuradas)");
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
  process.on("SIGINT", () => gracefulShutdown("SIGINT", server));
}

main();
