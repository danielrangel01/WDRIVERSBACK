import bcrypt from "bcryptjs";
import { IPasswordHasher } from "../../domain/services/security.js";

export class BcryptHasher extends IPasswordHasher {
  async hash(plain) {
    return bcrypt.hash(plain, 10);
  }
  async compare(plain, hash) {
    return bcrypt.compare(plain, hash);
  }
}
