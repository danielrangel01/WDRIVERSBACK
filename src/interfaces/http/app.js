import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import { config } from "../../infrastructure/config/index.js";
import { buildContainer } from "./container.js";
import { buildControllers } from "./controllers/index.js";
import { buildRoutes } from "./routes/index.js";
import { buildWhatsAppWebhook } from "./routes/whatsappWebhook.js";
import { buildTelegramWebhook } from "./routes/telegramWebhook.js";
import { makeAuthMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "https:"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    frameguard: { action: "deny" },
    xssFilter: true,
    noSniff: true,
    hidePoweredBy: true,
  }));

  app.use(
    cors({
      origin: (origin, cb) => {
        if (config.allowAnyOrigin) return cb(null, true);
        if (!origin) {
          return cb(null, true);
        }
        if (config.clientOrigin.includes(origin)) {
          return cb(null, true);
        }
        cb(new Error("Origen no permitido por CORS"));
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      maxAge: 86400,
    })
  );

  app.use(express.json({
    limit: config.payloadLimit,
    // Guardamos el cuerpo crudo para validar la firma del webhook de WhatsApp.
    verify: (req, _res, buf) => { if (buf && buf.length) req.rawBody = buf; },
  }));
  app.use(express.urlencoded({ extended: false, limit: config.payloadLimit }));

  const { useCases, tokenService, repositories, notify } = buildContainer();
  app.locals.useCases = useCases;
  app.locals.repositories = repositories;
  app.locals.notify = notify;

  // Webhook público de WhatsApp (Meta). Se monta ANTES de mongoSanitize: este
  // reemplaza los puntos de las claves (hub.mode → hub_mode) y rompería la
  // verificación del webhook. Tampoco lleva JWT (Meta no envía Bearer).
  app.use("/api/whatsapp/webhook", buildWhatsAppWebhook({ useCases }));
  // Webhook público de Telegram. Igual que el de WhatsApp: antes de mongoSanitize
  // y sin JWT (Telegram no envía Bearer).
  app.use("/api/telegram/webhook", buildTelegramWebhook({ useCases }));

  app.use(mongoSanitize({ allowDots: false, replaceWith: "_" }));

  const generalLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    // Los webhooks públicos los llaman Meta/Telegram desde muchas IPs: no se limitan.
    skip: (req) => req.originalUrl.startsWith("/api/whatsapp/webhook")
      || req.originalUrl.startsWith("/api/telegram/webhook"),
    message: { error: "Demasiadas solicitudes desde esta IP, intenta de nuevo en unos minutos" },
  });
  app.use("/api", generalLimiter);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    message: { error: "Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos" },
  });

  app.get("/", (req, res) =>
    res.json({ status: "ok", service: "W Drivers API", architecture: "clean", secure: true })
  );
  app.get("/api/health", (req, res) => res.json({ status: "ok", env: config.env }));
  app.get("/robots.txt", (req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /\n"));

  const controllers = buildControllers(useCases, { notify });
  const authMiddleware = makeAuthMiddleware(tokenService);

  const authRouter = buildAuthRoutes(controllers, authMiddleware, loginLimiter);
  app.use("/api/auth", authRouter);

  const apiRouter = buildApiRoutes(controllers, authMiddleware);
  app.use("/api", apiRouter);

  app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada" }));
  app.use(errorHandler);

  return app;
}

function buildAuthRoutes(controllers, authMiddleware, loginLimiter) {
  const { Router } = express;
  const auth = Router();
  auth.post("/login", loginLimiter, controllers.login);
  auth.post("/change", authMiddleware, controllers.changeCredentials);
  auth.get("/me", authMiddleware, controllers.me);
  return auth;
}

function buildApiRoutes(controllers, authMiddleware) {
  const { Router } = express;
  const api = Router();
  api.use(authMiddleware);
  api.get("/data", controllers.getAllData);
  api.post("/reset", controllers.resetData);
  api.get("/agenda", controllers.getAgenda);
  api.get("/collections", controllers.getCollections);
  api.get("/reminders", controllers.getReminders);
  api.get("/push/public-key", controllers.getPushPublicKey);
  api.post("/push/subscribe", controllers.subscribePush);
  api.post("/push/unsubscribe", controllers.unsubscribePush);
  api.get("/whatsapp/status", controllers.whatsappStatus);
  api.post("/whatsapp/send", controllers.sendWhatsApp);
  // Envío por el canal activo (WhatsApp o Telegram).
  api.post("/notify/send", controllers.sendNotification);
  // Disparo manual del agente (check-in carro por carro / cierre del día).
  api.post("/whatsapp/agent/checkin", controllers.agentCheckin);
  api.post("/whatsapp/agent/close", controllers.agentClose);
  api.get("/telegram/status", controllers.telegramStatus);
  api.post("/telegram/setup", controllers.telegramSetup);
  api.post("/telegram/test", controllers.telegramTest);
  api.get("/cars", controllers.listCars);
  api.post("/cars", controllers.addCar);
  api.put("/cars/:id", controllers.updateCar);
  api.delete("/cars/:id", controllers.deactivateCar);
  api.post("/cars/:id/reactivate", controllers.reactivateCar);
  api.get("/cars/:id/debt-detail", controllers.getCarDebtDetail);
  api.get("/cars/:id/statement", controllers.getAccountStatement);
  api.post("/cars/:id/handover", controllers.registerHandover);
  api.get("/cars/:id/handovers", controllers.listHandovers);
  api.get("/handovers", controllers.listHandovers);
  api.put("/handovers/:id", controllers.updateHandover);
  api.post("/handovers/:id/close", controllers.closeHandover);
  api.delete("/handovers/:id", controllers.deleteHandover);
  api.post("/payments", controllers.addPayment);
  api.delete("/payments/:id", controllers.deletePayment);
  api.post("/expenses", controllers.addExpense);
  api.delete("/expenses/:id", controllers.deleteExpense);
  api.post("/documents", controllers.addDocument);
  api.delete("/documents/:id", controllers.deleteDocument);
  api.post("/offdays/toggle", controllers.toggleOffDay);
  api.post("/offdays/bulk", controllers.bulkOffDay);
  api.delete("/offdays/:date", controllers.clearOffDay);
  api.post("/refinances", controllers.createRefinance);
  api.post("/refinances/:id/pay", controllers.payRefinance);
  api.delete("/refinances/:id", controllers.cancelRefinance);
  api.put("/settings", controllers.updateSettings);
  api.get("/nequi/pending", controllers.listPendingNequi);
  api.post("/nequi/sync", controllers.syncNequi);
  api.post("/nequi/pending/:id/approve", controllers.approvePendingNequi);
  api.delete("/nequi/pending/:id", controllers.dismissPendingNequi);
  return api;
}
