import { Refinance } from "../../../domain/entities/Refinance.js";
import { NotFoundError, ValidationError, ConflictError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

export class CreateRefinanceUseCase {
  constructor({ refinanceRepository, carRepository }) {
    this.refinances = refinanceRepository;
    this.cars = carRepository;
  }
  async execute({ carId, date, originalAmount, days, note }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");
    const refi = new Refinance({ carId, date, originalAmount, days, note, active: true });
    return this.refinances.create(refi);
  }
}

export class PayRefinanceUseCase {
  constructor({ refinanceRepository }) {
    this.refinances = refinanceRepository;
  }
  async execute({ id, amount }) {
    if (!validOid(id)) throw new ValidationError("Identificador de refinanciamiento inválido");
    const abono = Number(amount);
    if (isNaN(abono) || !isFinite(abono) || abono <= 0) {
      throw new ValidationError("El abono debe ser mayor a 0");
    }
    const refi = await this.refinances.findById(id);
    if (!refi) throw new NotFoundError("Refinanciamiento no encontrado");
    if (!refi.active) throw new ConflictError("El refinanciamiento ya está cerrado");
    const nuevoPagado = Number(refi.paidToPlan) + abono;
    if (nuevoPagado > Number(refi.originalAmount) + 0.01) {
      throw new ValidationError("El abono excede el saldo pendiente");
    }
    refi.paidToPlan = nuevoPagado;
    if (refi.isSettled) {
      refi.active = false;
    }
    refi.validate();
    return this.refinances.update(refi);
  }
}

export class CancelRefinanceUseCase {
  constructor({ refinanceRepository }) {
    this.refinances = refinanceRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador inválido");
    await this.refinances.delete(id);
    return { ok: true };
  }
}
