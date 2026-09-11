import { Car } from "../../../domain/entities/Car.js";
import { NotFoundError, ConflictError, ValidationError } from "../../../shared/errors.js";

const OID_LEN = 24;
const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

export class ListCarsUseCase {
  constructor({ carRepository }) {
    this.cars = carRepository;
  }
  async execute({ includeInactive = false } = {}) {
    return this.cars.findAll({ includeInactive: !!includeInactive });
  }
}

export class AddCarUseCase {
  constructor({ carRepository }) {
    this.cars = carRepository;
  }
  async execute({ plate, name, rate, startDate }) {
    const car = new Car({ plate, name, rate, startDate, active: true }).validate();
    const existing = await this.cars.findByPlate(car.plate);
    if (existing) {
      if (!existing.active) {
        existing.active = true;
        existing.name = car.name || existing.name;
        existing.rate = car.rate;
        existing.startDate = car.startDate;
        existing.validate();
        return this.cars.update(existing);
      }
      throw new ConflictError(`Ya existe un carro activo con la placa ${car.plate}`);
    }
    return this.cars.create(car);
  }
}

export class UpdateCarUseCase {
  constructor({ carRepository }) {
    this.cars = carRepository;
  }
  async execute({ id, plate, name, rate, startDate }) {
    if (!validOid(id)) throw new ValidationError("Identificador de carro inválido");
    const car = await this.cars.findById(id);
    if (!car) throw new NotFoundError("Carro no encontrado");

    if (plate !== undefined) {
      const newPlate = Car.normalizePlate(plate);
      if (newPlate !== car.plate) {
        const other = await this.cars.findByPlate(newPlate);
        if (other && String(other.id) !== String(car.id)) {
          throw new ConflictError(`Ya existe un carro con la placa ${newPlate}`);
        }
        car.plate = newPlate;
      }
    }
    if (name !== undefined) car.name = String(name || "").trim().slice(0, 100);
    if (rate !== undefined) {
      const r = Number(rate);
      if (isNaN(r)) throw new ValidationError("Tarifa inválida");
      car.rate = r;
    }
    if (startDate !== undefined) car.startDate = startDate || null;

    car.validate();
    return this.cars.update(car);
  }
}

export class DeactivateCarUseCase {
  constructor({ carRepository }) {
    this.cars = carRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador de carro inválido");
    const car = await this.cars.findById(id);
    if (!car) throw new NotFoundError("Carro no encontrado");
    car.deactivate();
    await this.cars.update(car);
    return { ok: true, id: car.id, plate: car.plate };
  }
}

export class ReactivateCarUseCase {
  constructor({ carRepository }) {
    this.cars = carRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador de carro inválido");
    const car = await this.cars.findById(id);
    if (!car) throw new NotFoundError("Carro no encontrado");
    car.active = true;
    await this.cars.update(car);
    return { ok: true, id: car.id, plate: car.plate };
  }
}
