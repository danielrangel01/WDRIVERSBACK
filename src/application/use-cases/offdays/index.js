import { OffDay, OFF_DAY_REASONS } from "../../../domain/entities/index.js";
import { config } from "../../../infrastructure/config/index.js";
import { NotFoundError, ValidationError } from "../../../shared/errors.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

function normalizeReason(reason, detail) {
  const r = (reason || "").trim().toLowerCase();
  const d = typeof detail === "string" ? detail.trim().slice(0, 200) : "";
  if (!r) throw new ValidationError("El motivo del día no trabajado es obligatorio");
  if (!OFF_DAY_REASONS.includes(r)) throw new ValidationError("Motivo inválido");
  if (r === "otro" && !d) throw new ValidationError("Debes especificar el detalle cuando el motivo es 'otro'");
  return { reason: r, detail: d };
}

export class ToggleOffDayUseCase {
  constructor({ offDayRepository, carRepository }) {
    this.offDays = offDayRepository;
    this.cars = carRepository;
  }
  async execute({ carId, date, reason, detail }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    if (!DATE_RE.test(date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");
    const existing = await this.offDays.findOne(carId, date);
    if (existing) {
      await this.offDays.delete(existing.id);
      return { active: false };
    }
    const { reason: r, detail: d } = normalizeReason(reason, detail);
    const offDay = new OffDay({ carId, date, reason: r, detail: d });
    await this.offDays.create(offDay);
    return { active: true, offDay: offDay.toJSON() };
  }
}

export class BulkOffDayUseCase {
  constructor({ offDayRepository, carRepository }) {
    this.offDays = offDayRepository;
    this.cars = carRepository;
  }
  async execute({ date, carIds, reason, detail }) {
    if (!DATE_RE.test(date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
    if (!Array.isArray(carIds)) throw new ValidationError("carIds debe ser un arreglo");
    const MAX = config.security.bulkOffDayMaxCars;
    if (carIds.length > MAX) {
      throw new ValidationError(`Máximo ${MAX} carros por operación masiva`);
    }
    if (carIds.length === 0) return { ok: true, count: 0 };
    const uniqueIds = Array.from(new Set(carIds.filter((id) => validOid(id))));
    if (uniqueIds.length === 0) throw new ValidationError("Ningún carro válido seleccionado");
    const cars = await Promise.all(uniqueIds.map((id) => this.cars.findById(id)));
    const existingIds = cars.filter(Boolean).map((c) => String(c.id));
    if (existingIds.length === 0) throw new NotFoundError("Ninguno de los carros existe");
    const { reason: r, detail: d } = normalizeReason(reason, detail);
    await this.offDays.upsertMany(date, existingIds, { reason: r, detail: d });
    return { ok: true, count: existingIds.length, reason: r, detail: d };
  }
}

export class ClearOffDayUseCase {
  constructor({ offDayRepository }) {
    this.offDays = offDayRepository;
  }
  async execute({ date }) {
    if (!DATE_RE.test(date || "")) throw new ValidationError("Fecha inválida (YYYY-MM-DD)");
    await this.offDays.deleteByDate(date);
    return { ok: true };
  }
}
