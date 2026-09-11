import { config } from "../infrastructure/config/index.js";
import { connectDB } from "../infrastructure/database/connection.js";
import { MongoUserRepository } from "../infrastructure/database/repositories/index.js";
import { BcryptHasher } from "../infrastructure/security/BcryptHasher.js";
import { User } from "../domain/entities/index.js";

function scorePassword(pw) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (/[a-z]/.test(pw)) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

async function run() {
  const argUser = process.argv[2];
  const argPass = process.argv[3];
  const username = (argUser || config.admin.username).toLowerCase().trim();
  const password = argPass || config.admin.password;
  const minLen = config.admin.passwordMin;

  if (!username) {
    console.error("\n❌ El nombre de usuario no puede ser vacío.\n");
    process.exit(1);
  }
  if (password.length < minLen) {
    console.error(`\n❌ La contraseña es demasiado corta (mínimo ${minLen} caracteres).\n`);
    process.exit(1);
  }
  if (config.isProd && scorePassword(password) < 4) {
    console.error(
      "\n❌ En producción usa una contraseña fuerte: mayúsculas, minúsculas, números y símbolos, mínimo 10 caracteres.\n"
    );
    process.exit(1);
  }
  if (argPass) {
    for (const [k, v] of Object.entries(process.argv)) {
      if (Number(k) >= 3) process.argv[k] = "***";
    }
  }

  await connectDB(config.mongoUri);

  const users = new MongoUserRepository();
  const hasher = new BcryptHasher();

  const existing = await users.findByUsername(username);
  const passwordHash = await hasher.hash(password);

  if (existing) {
    existing.passwordHash = passwordHash;
    await users.update(existing);
    console.log(`\n✓ El usuario "${username}" ya existía: se actualizó su contraseña.`);
  } else {
    await users.create(new User({ username, passwordHash }));
    console.log(`\n✓ Usuario admin creado exitosamente.`);
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`  Usuario:    ${username}`);
  console.log(`  Contraseña: ${config.isProd ? "(oculta en producción)" : password}`);
  console.log(`  Longitud:   ${password.length} caracteres`);
  console.log(`  Entorno:    ${config.env}`);
  console.log(`──────────────────────────────────────────`);
  console.log(`\n✅ Listo. Inicia sesión en W Drivers y agrega tus carros por placa desde la app.\n`);

  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌ Error:", err.message, "\n");
  process.exit(1);
});
