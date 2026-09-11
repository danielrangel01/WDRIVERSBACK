/**
 * Puertos (interfaces) de servicios de seguridad.
 * La infraestructura los implementa con bcrypt y jsonwebtoken.
 */

export class IPasswordHasher {
  async hash(_plain) { throw new Error("No implementado"); }
  async compare(_plain, _hash) { throw new Error("No implementado"); }
}

export class ITokenService {
  sign(_payload) { throw new Error("No implementado"); }
  verify(_token) { throw new Error("No implementado"); }
}
