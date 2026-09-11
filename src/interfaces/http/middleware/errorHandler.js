import { AppError } from "../../../shared/errors.js";
import { config } from "../../../infrastructure/config/index.js";

export function errorHandler(err, req, res, _next) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (err instanceof AppError) {
    if (!config.isProd) {
      console.warn(`[${id}] AppError ${err.status}:`, err.message, "→", req.method, req.path);
    }
    return res.status(err.status).json({ error: err.message, errorId: id });
  }

  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON malformado en el cuerpo de la solicitud", errorId: id });
  }

  if (err && err.code === "ERR_PAYLOAD_TOO_LARGE") {
    return res.status(413).json({ error: "Cuerpo de solicitud demasiado grande", errorId: id });
  }

  if (err && err.code === 11000) {
    return res.status(409).json({ error: "Registro duplicado. Verifica los datos e intenta de nuevo", errorId: id });
  }

  if (err && err.name === "CastError") {
    return res.status(400).json({ error: "Identificador o dato inválido", errorId: id });
  }

  if (err && err.name === "ValidationError") {
    const messages = Object.values(err.errors || {}).map((e) => e.message).join("; ");
    return res.status(400).json({ error: messages || "Error de validación", errorId: id });
  }

  console.error(`[${id}] Error no controlado ${req.method} ${req.path}:\n`, err);

  const publicMsg = config.isProd
    ? "Error interno del servidor. Nuestro equipo fue notificado"
    : `Error interno del servidor: ${err.message || String(err)}`;
  res.status(500).json({ error: publicMsg, errorId: id });
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
