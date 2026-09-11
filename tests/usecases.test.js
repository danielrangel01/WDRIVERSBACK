import { describe, it, expect, beforeEach, vi } from "vitest";
import { Car } from "../src/domain/entities/Car.js";
import { Refinance } from "../src/domain/entities/Refinance.js";
import { AddCarUseCase, UpdateCarUseCase, DeactivateCarUseCase } from "../src/application/use-cases/cars/index.js";
import { AddPaymentUseCase, DeletePaymentUseCase } from "../src/application/use-cases/payments/index.js";
import { AddDocumentUseCase, DeleteDocumentUseCase } from "../src/application/use-cases/documents/index.js";
import { AddExpenseUseCase, DeleteExpenseUseCase } from "../src/application/use-cases/expenses/index.js";
import { ToggleOffDayUseCase, BulkOffDayUseCase, ClearOffDayUseCase } from "../src/application/use-cases/offdays/index.js";
import { CreateRefinanceUseCase, PayRefinanceUseCase, CancelRefinanceUseCase } from "../src/application/use-cases/refinances/index.js";
import { UpdateSettingsUseCase, GetSettingsUseCase } from "../src/application/use-cases/settings/index.js";
import { ChangeCredentialsUseCase, LoginUseCase } from "../src/application/use-cases/auth/index.js";
import { ResetDataUseCase } from "../src/application/use-cases/data/index.js";
import { User, Settings } from "../src/domain/entities/index.js";

const OID = "000000000000000000000000";

function makeCarRepo(seedCars = []) {
  const cars = new Map(seedCars.map((c) => [String(c.id), c]));
  return {
    findAll: vi.fn(async ({ includeInactive } = {}) =>
      Array.from(cars.values()).filter((c) => includeInactive || c.active)
    ),
    findById: vi.fn(async (id) => cars.get(String(id)) || null),
    findByPlate: vi.fn(async (p) =>
      Array.from(cars.values()).find((c) => c.plate === p) || null
    ),
    create: vi.fn(async (car) => {
      const id = String(cars.size + 1).padStart(24, "0");
      const newCar = Object.assign(new Car({ ...car, id }), { id });
      cars.set(String(id), newCar);
      return newCar;
    }),
    update: vi.fn(async (car) => {
      cars.set(String(car.id), car);
      return car;
    }),
  };
}

describe("🚀 Use Cases: Cars — flujos principales + edge cases", () => {
  it("AddCar: crea carro nuevo correctamente", async () => {
    const repo = makeCarRepo();
    const uc = new AddCarUseCase({ carRepository: repo });
    const car = await uc.execute({ plate: "  abc 123  ", name: "Taxi", rate: 80000 });
    expect(car.plate).toBe("ABC123");
    expect(car.name).toBe("Taxi");
    expect(car.rate).toBe(80000);
    expect(car.active).toBe(true);
  });

  it("AddCar: al existir un carro INACTIVO con misma placa → lo REACTIVA", async () => {
    const inactive = new Car({ id: OID, plate: "ABC123", name: "viejo", rate: 50000, active: false });
    const repo = makeCarRepo([inactive]);
    const uc = new AddCarUseCase({ carRepository: repo });
    const result = await uc.execute({ plate: "ABC123", name: "nuevo", rate: 99999 });
    expect(result.active).toBe(true);
    expect(result.name).toBe("nuevo");
    expect(result.rate).toBe(99999);
  });

  it("AddCar: carro ACTIVO con misma placa → ConflictError", async () => {
    const active = new Car({ id: OID, plate: "ABC123", active: true });
    const repo = makeCarRepo([active]);
    const uc = new AddCarUseCase({ carRepository: repo });
    await expect(uc.execute({ plate: "ABC123" })).rejects.toThrow(/Ya existe un carro activo/);
  });

  it("UpdateCar: id inválido (no ObjectId hex 24) → ValidationError", async () => {
    const repo = makeCarRepo();
    const uc = new UpdateCarUseCase({ carRepository: repo });
    await expect(uc.execute({ id: "mal-id", plate: "DEF456" })).rejects.toThrow(/Identificador/);
  });

  it("UpdateCar: id que no existe → NotFoundError", async () => {
    const repo = makeCarRepo();
    const uc = new UpdateCarUseCase({ carRepository: repo });
    await expect(uc.execute({ id: "11".repeat(12), plate: "DEF456" })).rejects.toThrow(/Carro no encontrado/);
  });

  it("UpdateCar: cambiar a placa que ya usa otro carro → ConflictError", async () => {
    const c1 = new Car({ id: "000000000000000000000001", plate: "AAA111" });
    const c2 = new Car({ id: "000000000000000000000002", plate: "BBB222" });
    const repo = makeCarRepo([c1, c2]);
    const uc = new UpdateCarUseCase({ carRepository: repo });
    await expect(uc.execute({ id: c1.id, plate: "BBB222" })).rejects.toThrow(/Ya existe un carro con la placa/);
  });

  it("DeactivateCar: id inválido → ValidationError", async () => {
    const uc = new DeactivateCarUseCase({ carRepository: makeCarRepo() });
    await expect(uc.execute({ id: "zz" })).rejects.toThrow(/inválido/);
  });

  it("DeactivateCar: ok", async () => {
    const c = new Car({ id: OID, plate: "ABC123" });
    const repo = makeCarRepo([c]);
    const uc = new DeactivateCarUseCase({ carRepository: repo });
    const r = await uc.execute({ id: OID });
    expect(r.ok).toBe(true);
    expect((await repo.findById(OID)).active).toBe(false);
  });
});

describe("🚀 Use Cases: Payments / Expenses / Documents", () => {
  it("AddPayment: carId no ObjectId → ValidationError", async () => {
    const uc = new AddPaymentUseCase({ paymentRepository: {}, carRepository: makeCarRepo() });
    await expect(uc.execute({ carId: "abc", date: "2024-01-01", amount: 1000 })).rejects.toThrow(/inválido/);
  });

  it("AddPayment: carro no existe → NotFoundError", async () => {
    const uc = new AddPaymentUseCase({ paymentRepository: {}, carRepository: makeCarRepo() });
    await expect(uc.execute({ carId: OID, date: "2024-01-01", amount: 1000 })).rejects.toThrow(/no existe/);
  });

  it("DeletePayment: id inválido → ValidationError", async () => {
    const uc = new DeletePaymentUseCase({ paymentRepository: {} });
    await expect(uc.execute({ id: "zz" })).rejects.toThrow(/inválido/);
  });

  it("AddExpense: ok", async () => {
    const repo = { create: vi.fn(async (x) => x) };
    const uc = new AddExpenseUseCase({ expenseRepository: repo });
    await uc.execute({ date: "2024-01-01", amount: 5000, category: "Gasolina", note: "Shell" });
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("AddDocument: carro no existe → NotFoundError", async () => {
    const uc = new AddDocumentUseCase({ documentRepository: {}, carRepository: makeCarRepo() });
    await expect(uc.execute({
      carId: OID, type: "SOAT", expiry: "2024-12-31",
    })).rejects.toThrow(/no existe/);
  });
});

describe("🚀 Use Cases: OffDays (toggle / bulk / clear)", () => {
  it("ToggleOffDay: valida carId ObjectId", async () => {
    const uc = new ToggleOffDayUseCase({ offDayRepository: {}, carRepository: makeCarRepo() });
    await expect(uc.execute({ carId: "mal", date: "2024-01-01" })).rejects.toThrow(/inválido/);
  });

  it("ToggleOffDay: valida fecha formato", async () => {
    const uc = new ToggleOffDayUseCase({ offDayRepository: {}, carRepository: makeCarRepo() });
    await expect(uc.execute({ carId: OID, date: "01-01-2024" })).rejects.toThrow(/Fecha/);
  });

  it("BulkOffDay: carIds no es arreglo → error", async () => {
    const uc = new BulkOffDayUseCase({ offDayRepository: {}, carRepository: makeCarRepo() });
    await expect(uc.execute({ date: "2024-01-01", carIds: "no-array" })).rejects.toThrow(/arreglo/);
  });

  it("BulkOffDay: más de 200 carros → ValidationError", async () => {
    const uc = new BulkOffDayUseCase({ offDayRepository: {}, carRepository: makeCarRepo() });
    const manyIds = Array.from({ length: 201 }, () => OID);
    await expect(uc.execute({ date: "2024-01-01", carIds: manyIds })).rejects.toThrow(/Máximo 200/);
  });

  it("BulkOffDay: 0 carros retorna ok count 0 sin llamar repo", async () => {
    const repo = { upsertMany: vi.fn() };
    const uc = new BulkOffDayUseCase({ offDayRepository: repo, carRepository: makeCarRepo() });
    const r = await uc.execute({ date: "2024-01-01", carIds: [] });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
    expect(repo.upsertMany).not.toHaveBeenCalled();
  });

  it("BulkOffDay: solo Ids ObjectId válidos pasan, se filtran inválidos", async () => {
    const car = new Car({ id: OID, plate: "ABC123" });
    const carRepo = makeCarRepo([car]);
    const offRepo = { upsertMany: vi.fn(async () => {}) };
    const uc = new BulkOffDayUseCase({ offDayRepository: offRepo, carRepository: carRepo });
    const r = await uc.execute({
      date: "2024-01-01",
      carIds: [OID, "malo", "tambienmal"],
    });
    expect(r.count).toBe(1);
    expect(offRepo.upsertMany).toHaveBeenCalledWith("2024-01-01", [OID]);
  });

  it("ClearOffDay: fecha inválida → error", async () => {
    const uc = new ClearOffDayUseCase({ offDayRepository: {} });
    await expect(uc.execute({ date: "hoy" })).rejects.toThrow(/Fecha/);
  });
});

describe("🚀 Use Cases: Refinance — incluyendo bug crítico de PayRefinance", () => {
  it("CreateRefinance: carro no existe → NotFoundError", async () => {
    const uc = new CreateRefinanceUseCase({ refinanceRepository: {}, carRepository: makeCarRepo() });
    await expect(uc.execute({
      carId: OID, date: "2024-01-01", originalAmount: 500000, days: 15,
    })).rejects.toThrow(/no existe/);
  });

  it("PayRefinance: id inválido → error", async () => {
    const uc = new PayRefinanceUseCase({ refinanceRepository: {} });
    await expect(uc.execute({ id: "no", amount: 1000 })).rejects.toThrow(/inválido/);
  });

  it("PayRefinance: refinance no existe → NotFoundError", async () => {
    const repo = { findById: vi.fn(async () => null) };
    const uc = new PayRefinanceUseCase({ refinanceRepository: repo });
    await expect(uc.execute({ id: OID, amount: 1000 })).rejects.toThrow(/no encontrado/);
  });

  it("PayRefinance: refinance inactivo → ConflictError", async () => {
    const r = new Refinance({
      id: OID, carId: "1".repeat(24), date: "2024-01-01",
      originalAmount: 1000, days: 10, active: false,
    });
    const repo = { findById: vi.fn(async () => r) };
    const uc = new PayRefinanceUseCase({ refinanceRepository: repo });
    await expect(uc.execute({ id: OID, amount: 100 })).rejects.toThrow(/cerrado/);
  });

  it("PayRefinance: BUG FIX — al saldar total, ACTIVE pasa a FALSE y remaining=0", async () => {
    const r = new Refinance({
      id: OID, carId: "1".repeat(24), date: "2024-01-01",
      originalAmount: 1000, days: 10, active: true, paidToPlan: 0,
    });
    let updated = null;
    const repo = {
      findById: vi.fn(async () => r),
      update: vi.fn(async (x) => { updated = x; return x; }),
    };
    const uc = new PayRefinanceUseCase({ refinanceRepository: repo });
    const result = await uc.execute({ id: OID, amount: 1000 });
    expect(updated).not.toBeNull();
    expect(updated.active).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.isSettled).toBe(true);
  });

  it("PayRefinance: abono parcial NO cierra el plan", async () => {
    const r = new Refinance({
      id: OID, carId: "1".repeat(24), date: "2024-01-01",
      originalAmount: 1000, days: 10, active: true, paidToPlan: 0,
    });
    let updated = null;
    const repo = {
      findById: vi.fn(async () => r),
      update: vi.fn(async (x) => { updated = x; return x; }),
    };
    const uc = new PayRefinanceUseCase({ refinanceRepository: repo });
    await uc.execute({ id: OID, amount: 300 });
    expect(updated.active).toBe(true);
    expect(updated.paidToPlan).toBe(300);
    expect(updated.remaining).toBe(700);
  });

  it("PayRefinance: abono NEGATIVO o CERO → ValidationError", async () => {
    const repo = {};
    const uc = new PayRefinanceUseCase({ refinanceRepository: repo });
    await expect(uc.execute({ id: OID, amount: -1 })).rejects.toThrow(/mayor a 0/);
    await expect(uc.execute({ id: OID, amount: 0 })).rejects.toThrow(/mayor a 0/);
  });

  it("PayRefinance: abono excede saldo → ValidationError (antes actualizar)", async () => {
    const r = new Refinance({
      id: OID, carId: "1".repeat(24), date: "2024-01-01",
      originalAmount: 1000, days: 10, active: true, paidToPlan: 400,
    });
    const repo = { findById: vi.fn(async () => r) };
    const uc = new PayRefinanceUseCase({ refinanceRepository: repo });
    await expect(uc.execute({ id: OID, amount: 700 })).rejects.toThrow(/excede el saldo/);
  });

  it("CancelRefinance: id inválido → error", async () => {
    const uc = new CancelRefinanceUseCase({ refinanceRepository: {} });
    await expect(uc.execute({ id: "zz" })).rejects.toThrow(/inválido/);
  });
});

describe("🚀 Use Cases: Settings + ResetData", () => {
  it("UpdateSettings: preserva valores antiguos cuando input es undefined", async () => {
    const current = new Settings({ adminPhone: "123456", morningHour: 7, eveningHour: 19 });
    const repo = {
      get: vi.fn(async () => current),
      update: vi.fn(async (x) => x),
    };
    const uc = new UpdateSettingsUseCase({ settingsRepository: repo });
    const r = await uc.execute({ morningHour: 6 });
    expect(r.adminPhone).toBe("123456");
    expect(r.morningHour).toBe(6);
    expect(r.eveningHour).toBe(19);
  });

  it("ResetData: devuelve ok:true aunque no falle", async () => {
    const repo = {
      deleteAll: vi.fn(async () => {}),
    };
    const uc = new ResetDataUseCase({
      paymentRepository: repo, expenseRepository: repo,
      documentRepository: repo, offDayRepository: repo, refinanceRepository: repo,
    });
    const r = await uc.execute();
    expect(r.ok).toBe(true);
    expect(r.skippedOrFailed).toBe(0);
  });

  it("ResetData: si uno falla, devuelve ok:false y fallos contados", async () => {
    const good = { deleteAll: vi.fn(async () => {}) };
    const bad = { deleteAll: vi.fn(async () => { throw new Error("boom"); }) };
    const uc = new ResetDataUseCase({
      paymentRepository: good,
      expenseRepository: bad,
      documentRepository: good,
      offDayRepository: good,
      refinanceRepository: good,
    });
    const r = await uc.execute();
    expect(r.ok).toBe(false);
    expect(r.skippedOrFailed).toBe(1);
  });
});

describe("🚀 Use Cases: Auth — Login + ChangeCredentials", () => {
  async function setup() {
    const hasher = {
      hash: vi.fn(async (p) => `HASH_${p}`),
      compare: vi.fn(async (p, h) => h === `HASH_${p}`),
    };
    const u = new User({ id: OID, username: "admin", passwordHash: "HASH_S3creT0!" });
    const userRepo = {
      findByUsername: vi.fn(async (n) => (n === u.username ? u : null)),
      findById: vi.fn(async (id) => (String(id) === u.id ? u : null)),
      update: vi.fn(async (x) => x),
    };
    const tokenService = {
      sign: vi.fn((p) => `TOKEN_${JSON.stringify(p)}`),
      verify: vi.fn((t) => JSON.parse(t.replace("TOKEN_", ""))),
    };
    return { hasher, userRepo, tokenService, u };
  }

  it("Login: credenciales correctas → retorna token + username", async () => {
    const s = await setup();
    const uc = new LoginUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher, tokenService: s.tokenService,
    });
    const r = await uc.execute({ username: "  ADMIN  ", password: "S3creT0!" });
    expect(r.username).toBe("admin");
    expect(typeof r.token).toBe("string");
    expect(r.token.startsWith("TOKEN_")).toBe(true);
  });

  it("Login: usuario no existe → UnauthorizedError (y corre compare para timing attack)", async () => {
    const s = await setup();
    const uc = new LoginUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher, tokenService: s.tokenService,
    });
    await expect(uc.execute({ username: "nobody", password: "x" })).rejects.toThrow(/incorrectos/);
    expect(s.hasher.compare).toHaveBeenCalled();
  });

  it("Login: password incorrecta → UnauthorizedError", async () => {
    const s = await setup();
    const uc = new LoginUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher, tokenService: s.tokenService,
    });
    await expect(uc.execute({ username: "admin", password: "mal" })).rejects.toThrow(/incorrectos/);
  });

  it("Login: username undefined / vacío / null → ValidationError", async () => {
    const s = await setup();
    const uc = new LoginUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher, tokenService: s.tokenService,
    });
    await expect(uc.execute({ username: "", password: "x" })).rejects.toThrow(/requeridos/);
    await expect(uc.execute({ password: "x" })).rejects.toThrow(/requeridos/);
    await expect(uc.execute({ username: null, password: "x" })).rejects.toThrow(/requeridos/);
  });

  it("ChangeCredentials: contraseña actual incorrecta → UnauthorizedError", async () => {
    const s = await setup();
    const uc = new ChangeCredentialsUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher,
    });
    await expect(uc.execute({
      userId: OID, currentPassword: "mal", newPassword: "N3wP@ss12",
    })).rejects.toThrow(/incorrecta/);
  });

  it("ChangeCredentials: contraseña actual faltante → UnauthorizedError", async () => {
    const s = await setup();
    const uc = new ChangeCredentialsUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher,
    });
    await expect(uc.execute({
      userId: OID, newPassword: "N3wP@ss12",
    })).rejects.toThrow(/actual requerida/);
  });

  it("ChangeCredentials: nuevo username en uso por otro → ValidationError", async () => {
    const s = await setup();
    s.userRepo.findByUsername = vi.fn(async (n) =>
      n === "admin" ? s.u : (n === "otro" ? new User({ id: "22".repeat(12), username: "otro", passwordHash: "" }) : null)
    );
    const uc = new ChangeCredentialsUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher,
    });
    await expect(uc.execute({
      userId: OID, currentPassword: "S3creT0!", newUsername: "otro",
    })).rejects.toThrow(/ya está en uso/);
  });

  it("ChangeCredentials: password nueva débil en dev también requiere al menos 6", async () => {
    const s = await setup();
    const uc = new ChangeCredentialsUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher,
    });
    await expect(uc.execute({
      userId: OID, currentPassword: "S3creT0!", newPassword: "corto",
    })).rejects.toThrow(/al menos 6 caracteres/);
  });

  it("ChangeCredentials: sin cambios no llama update()", async () => {
    const s = await setup();
    const uc = new ChangeCredentialsUseCase({
      userRepository: s.userRepo, passwordHasher: s.hasher,
    });
    const r = await uc.execute({
      userId: OID, currentPassword: "S3creT0!",
    });
    expect(r.ok).toBe(true);
    expect(s.userRepo.update).not.toHaveBeenCalled();
  });
});
