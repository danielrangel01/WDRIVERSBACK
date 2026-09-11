// Errores de dominio con un código HTTP sugerido.
// La capa de interfaces los traduce a respuestas HTTP.

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autenticado") {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado") {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message, 409);
  }
}
