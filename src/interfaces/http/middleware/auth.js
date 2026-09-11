import { UnauthorizedError } from "../../../shared/errors.js";

const TOKEN_RX = /^[A-Za-z0-9\-_=]+?\.[A-Za-z0-9\-_=]+?\.[A-Za-z0-9\-_=]+$/;

export function makeAuthMiddleware(tokenService) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token || !TOKEN_RX.test(token)) return next(new UnauthorizedError());
    try {
      const payload = tokenService.verify(token);
      if (!payload || typeof payload.id !== "string") {
        return next(new UnauthorizedError("Sesión inválida"));
      }
      req.user = { id: payload.id, username: String(payload.username || "") };
      next();
    } catch (err) {
      const msg =
        err?.name === "TokenExpiredError"
          ? "Sesión expirada. Vuelve a iniciar sesión"
          : "Sesión inválida o expirada";
      next(new UnauthorizedError(msg));
    }
  };
}
