import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeAuthMiddleware } from "../src/interfaces/http/middleware/auth.js";
import { errorHandler } from "../src/interfaces/http/middleware/errorHandler.js";
import { AppError, ValidationError, UnauthorizedError, NotFoundError, ConflictError } from "../src/shared/errors.js";

function mockReq(overrides = {}) {
  return { headers: {}, method: "GET", path: "/api/test", ...overrides };
}
function mockRes() {
  const r = { status: vi.fn(function (s) { this._status = s; return this; }) };
  r.json = vi.fn(function (data) { this._json = data; return this; });
  return r;
}

describe("🛡️ Auth Middleware", () => {
  const tokenService = {
    verify: vi.fn((t) => {
      if (t === "good") return { id: "1".repeat(24), username: "admin" };
      if (t === "expired") {
        const e = new Error("expired");
        e.name = "TokenExpiredError";
        throw e;
      }
      throw new Error("bad");
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin Authorization header → UnauthorizedError", () => {
    const mw = makeAuthMiddleware(tokenService);
    const next = vi.fn();
    mw(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });

  it("con Bearer pero token vacío → UnauthorizedError", () => {
    const mw = makeAuthMiddleware(tokenService);
    const next = vi.fn();
    const req = mockReq({ headers: { authorization: "Bearer  " } });
    mw(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });

  it("token no tiene formato JWT (regex fail) → UnauthorizedError sin llamar verify", () => {
    const mw = makeAuthMiddleware(tokenService);
    const next = vi.fn();
    const req = mockReq({ headers: { authorization: "Bearer not-a-jwt" } });
    mw(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(tokenService.verify).not.toHaveBeenCalled();
  });

  it("token válido formato JWT + verify ok → asigna req.user y llama next() sin error", () => {
    const mw = makeAuthMiddleware(tokenService);
    const next = vi.fn();
    const req = mockReq({ headers: { authorization: "Bearer aaa.bbb.ccc" } });
    tokenService.verify.mockReturnValueOnce({ id: "1".repeat(24), username: "admin" });
    mw(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: "1".repeat(24), username: "admin" });
  });

  it("verify lanza TokenExpiredError → mensaje específico", () => {
    const mw = makeAuthMiddleware(tokenService);
    const next = vi.fn();
    const req = mockReq({ headers: { authorization: "Bearer aaa.bbb.expired" } });
    tokenService.verify.mockImplementationOnce(() => {
      const e = new Error("jwt expired");
      e.name = "TokenExpiredError";
      throw e;
    });
    mw(req, mockRes(), next);
    expect(next.mock.calls[0][0].message).toMatch(/Sesión expirada/);
  });

  it("payload sin id string → UnauthorizedError", () => {
    const mw = makeAuthMiddleware(tokenService);
    const next = vi.fn();
    const req = mockReq({ headers: { authorization: "Bearer aaa.bbb.ccc" } });
    tokenService.verify.mockReturnValueOnce({ mal: "formed" });
    mw(req, mockRes(), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
  });
});

describe("🛡️ Error Handler: tipos de error mapeados a HTTP correcto", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  it("AppError → status del error, con errorId", () => {
    const err = new ValidationError("placa mala");
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(400);
    expect(res._json.error).toBe("placa mala");
    expect(typeof res._json.errorId).toBe("string");
  });

  it("AppError tipos: Unauthorized 401, NotFound 404, Conflict 409", () => {
    const cases = [
      [new UnauthorizedError(), 401],
      [new NotFoundError(), 404],
      [new ConflictError("dup"), 409],
    ];
    for (const [err, expected] of cases) {
      const res = mockRes();
      errorHandler(err, mockReq(), res, () => {});
      expect(res._status).toBe(expected);
    }
  });

  it("Mongo duplicate code 11000 → 409 Registro duplicado", () => {
    const err = new Error("dupe");
    err.code = 11000;
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(409);
    expect(res._json.error).toMatch(/duplicado/);
  });

  it("CastError (Mongo ObjectId mal) → 400 Identificador inválido", () => {
    const err = new Error("cast");
    err.name = "CastError";
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/Identificador/);
  });

  it("Mongoose ValidationError (name) → 400 mensajes unidos", () => {
    const err = new Error("validation");
    err.name = "ValidationError";
    err.errors = {
      plate: { message: "Placa mala" },
      rate: { message: "Tarifa negativa" },
    };
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(400);
    expect(res._json.error).toContain("Placa mala");
    expect(res._json.error).toContain("Tarifa negativa");
  });

  it("entity.parse.failed (body-parser JSON malo) → 400", () => {
    const err = new Error("parse");
    err.type = "entity.parse.failed";
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/JSON malformado/);
  });

  it("ERR_PAYLOAD_TOO_LARGE → 413", () => {
    const err = new Error("big");
    err.code = "ERR_PAYLOAD_TOO_LARGE";
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(413);
  });

  it("error desconocido en PROD → mensaje genérico sin leak stack", () => {
    process.env.NODE_ENV = "production";
    const err = new Error("fuga de datos sensibles: clave DB = xyz");
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(500);
    expect(res._json.error).not.toContain("xyz");
    expect(res._json.error).toMatch(/equipo fue notificado/);
    expect(typeof res._json.errorId).toBe("string");
  });

  it("error desconocido en DEV → incluye el mensaje", () => {
    process.env.NODE_ENV = "development";
    const err = new Error("detalle técnico");
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    expect(res._status).toBe(500);
    expect(res._json.error).toContain("detalle técnico");
  });
});

describe("🛡️ AppError: jerarquía correcta", () => {
  it("ValidationError extends AppError extends Error", () => {
    const e = new ValidationError("hola");
    expect(e instanceof AppError).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.status).toBe(400);
    expect(e.message).toBe("hola");
    expect(e.name).toBe("ValidationError");
  });
});
