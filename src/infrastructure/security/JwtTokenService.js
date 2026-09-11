import jwt from "jsonwebtoken";
import { ITokenService } from "../../domain/services/security.js";

export class JwtTokenService extends ITokenService {
  constructor(secret, expiresIn = "7d") {
    super();
    this.secret = secret;
    this.expiresIn = expiresIn;
  }
  sign(payload) {
    return jwt.sign(payload, this.secret, { expiresIn: this.expiresIn });
  }
  verify(token) {
    return jwt.verify(token, this.secret);
  }
}
