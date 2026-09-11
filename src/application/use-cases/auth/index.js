import { UnauthorizedError, NotFoundError, ValidationError } from "../../../shared/errors.js";
import { config } from "../../../infrastructure/config/index.js";

function strongPassword(pw) {
  if (!pw || typeof pw !== "string") return false;
  if (pw.length < (config.isProd ? 10 : 6)) return false;
  if (config.isProd) {
    let score = 0;
    if (/[a-z]/.test(pw)) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score >= 3;
  }
  return true;
}

export class LoginUseCase {
  constructor({ userRepository, passwordHasher, tokenService }) {
    this.users = userRepository;
    this.hasher = passwordHasher;
    this.tokens = tokenService;
  }
  async execute({ username, password }) {
    if (!username || typeof username !== "string" || !password || typeof password !== "string") {
      throw new ValidationError("Usuario y contraseña requeridos");
    }
    const u = String(username).trim().toLowerCase().slice(0, 40);
    if (u.length < 1) throw new ValidationError("Usuario y contraseña requeridos");

    const user = await this.users.findByUsername(u);
    if (!user) {
      await this.hasher.compare(password, "$2a$10$CwTycUXWue0Thq9StjUM0uJ8I2LZ73.5eJv6X7w3vMvny2p0Q1Mey");
      throw new UnauthorizedError("Usuario o contraseña incorrectos");
    }

    const ok = await this.hasher.compare(String(password), user.passwordHash);
    if (!ok) throw new UnauthorizedError("Usuario o contraseña incorrectos");

    const token = this.tokens.sign({ id: user.id, username: user.username });
    return { token, username: user.username };
  }
}

export class ChangeCredentialsUseCase {
  constructor({ userRepository, passwordHasher }) {
    this.users = userRepository;
    this.hasher = passwordHasher;
  }
  async execute({ userId, currentPassword, newUsername, newPassword }) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError("Usuario no encontrado");

    if (typeof currentPassword !== "string" || currentPassword.length < 1) {
      throw new UnauthorizedError("Contraseña actual requerida");
    }
    const ok = await this.hasher.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedError("Contraseña actual incorrecta");

    let changed = false;

    if (newUsername !== undefined && typeof newUsername === "string") {
      const t = newUsername.trim().toLowerCase().slice(0, 40);
      if (t && t !== user.username) {
        if (t.length < 3) throw new ValidationError("El usuario debe tener al menos 3 caracteres");
        const other = await this.users.findByUsername(t);
        if (other && String(other.id) !== String(user.id)) {
          throw new ValidationError("El nombre de usuario ya está en uso");
        }
        user.username = t;
        changed = true;
      }
    }

    if (newPassword !== undefined && typeof newPassword === "string" && newPassword.length > 0) {
      if (!strongPassword(newPassword)) {
        const min = config.isProd ? 10 : 6;
        throw new ValidationError(
          config.isProd
            ? "La contraseña es débil: mínimo 10 caracteres, combina mayúsculas, minúsculas, números y símbolos"
            : `La contraseña debe tener al menos ${min} caracteres`
        );
      }
      user.passwordHash = await this.hasher.hash(newPassword);
      changed = true;
    }

    if (changed) await this.users.update(user);
    return { ok: true, username: user.username };
  }
}
