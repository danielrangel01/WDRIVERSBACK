import jwt from "jsonwebtoken";
import { ITokenService } from "../../domain/services/security.js";

export class JwtTokenService extends ITokenService {
  constructor(secret, expiresIn = "7d", refreshExpiresIn = "90d") {
    super();
    this.secret = secret;
    this.expiresIn = expiresIn;
    this.refreshExpiresIn = refreshExpiresIn;
  }
  sign(payload) {
    return jwt.sign({ ...payload, tokenUse: "access" }, this.secret, { expiresIn: this.expiresIn });
  }
  signRefresh(payload) {
    return jwt.sign({ ...payload, tokenUse: "refresh" }, this.secret, { expiresIn: this.refreshExpiresIn });
  }
  verify(token) {
    return jwt.verify(token, this.secret);
  }
  verifyRefresh(token) {
    const payload = this.verify(token);
    if (payload?.tokenUse !== "refresh") {
      throw new Error("Token de renovación inválido");
    }
    return payload;
  }
}
