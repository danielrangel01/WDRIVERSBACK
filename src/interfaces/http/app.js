import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import { config } from "../../infrastructure/config/index.js";
import { buildContainer } from "./container.js";
import { buildControllers } from "./controllers/index.js";
import { buildRoutes } from "./routes/index.js";
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

  app.use(express.json({ limit: config.payloadLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.payloadLimit }));

  app.use(mongoSanitize({ allowDots: false, replaceWith: "_" }));

  const generalLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
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

  const { useCases, tokenService } = buildContainer();
  const controllers = buildControllers(useCases);
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
  api.get("/cars", controllers.listCars);
  api.post("/cars", controllers.addCar);
  api.put("/cars/:id", controllers.updateCar);
  api.delete("/cars/:id", controllers.deactivateCar);
  api.post("/cars/:id/reactivate", controllers.reactivateCar);
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
  return api;
}
