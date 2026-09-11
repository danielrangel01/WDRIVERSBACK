import { Payment } from "../../../domain/entities/index.js";
import { NotFoundError, ValidationError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

export class AddPaymentUseCase {
  constructor({ paymentRepository, carRepository }) {
    this.payments = paymentRepository;
    this.cars = carRepository;
  }
  async execute({ carId, date, amount, note }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");
    const payment = new Payment({ carId, date, amount, note });
    return this.payments.create(payment);
  }
}

export class DeletePaymentUseCase {
  constructor({ paymentRepository }) {
    this.payments = paymentRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador inválido");
    await this.payments.delete(id);
    return { ok: true };
  }
}
