import { Handover } from "../../../domain/entities/Handover.js";
import { addDays } from "../../../domain/services/DriverAttribution.js";
import { NotFoundError, ValidationError, ConflictError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Registra una NUEVA entrega: el conductor indicado toma el carro a partir de `date`.
 * Cierra automáticamente la entrega vigente (el conductor anterior cubre hasta el día anterior).
 */
export class RegisterHandoverUseCase {
  constructor({ handoverRepository, carRepository }) {
    this.handovers = handoverRepository;
    this.cars = carRepository;
  }

  async execute({ carId, driverName, driverPhone, date, note }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    if (!DATE_RE.test(date || "")) throw new ValidationError("Fecha de entrega inválida (YYYY-MM-DD)");
    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");

    // Validar la NUEVA entrega antes de tocar la vigente (si la nueva es inválida,
    // no debe cerrarse la entrega actual y dejar el carro sin conductor).
    const handover = new Handover({
      carId, driverName, driverPhone, startDate: date, endDate: null, note,
    });

    const active = await this.handovers.findActiveByCar(carId);
    if (active) {
      if (date <= active.startDate) {
        throw new ValidationError("La fecha de la nueva entrega debe ser posterior al inicio de la entrega vigente");
      }
      active.endDate = addDays(date, -1);
      active.validate();
      await this.handovers.update(active);
    }

    return this.handovers.create(handover);
  }
}

/**
 * Cierra la entrega vigente (el conductor devuelve el carro) sin reemplazo.
 * El conductor cubre hasta `date` (inclusive).
 */
export class CloseHandoverUseCase {
  constructor({ handoverRepository }) {
    this.handovers = handoverRepository;
  }
  async execute({ id, date }) {
    if (!validOid(id)) throw new ValidationError("Identificador de entrega inválido");
    if (!DATE_RE.test(date || "")) throw new ValidationError("Fecha de devolución inválida (YYYY-MM-DD)");
    const h = await this.handovers.findById(id);
    if (!h) throw new NotFoundError("Entrega no encontrada");
    if (h.endDate) throw new ConflictError("La entrega ya está cerrada");
    if (date < h.startDate) throw new ValidationError("La devolución no puede ser anterior a la entrega");
    h.endDate = date;
    h.validate();
    return this.handovers.update(h);
  }
}

/** Corrige los datos del conductor (nombre/teléfono/nota) de una entrega. */
export class UpdateHandoverUseCase {
  constructor({ handoverRepository }) {
    this.handovers = handoverRepository;
  }
  async execute({ id, driverName, driverPhone, note }) {
    if (!validOid(id)) throw new ValidationError("Identificador de entrega inválido");
    const h = await this.handovers.findById(id);
    if (!h) throw new NotFoundError("Entrega no encontrada");
    if (driverName !== undefined) h.driverName = driverName;
    if (driverPhone !== undefined) h.driverPhone = driverPhone;
    if (note !== undefined) h.note = note;
    h.validate();
    return this.handovers.update(h);
  }
}

export class ListHandoversUseCase {
  constructor({ handoverRepository }) {
    this.handovers = handoverRepository;
  }
  async execute({ carId } = {}) {
    if (carId) {
      if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
      return this.handovers.findByCar(carId);
    }
    return this.handovers.findAll();
  }
}

export class DeleteHandoverUseCase {
  constructor({ handoverRepository }) {
    this.handovers = handoverRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador de entrega inválido");
    await this.handovers.delete(id);
    return { ok: true };
  }
}
