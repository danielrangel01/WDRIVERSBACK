import { VehicleDocument } from "../../../domain/entities/index.js";
import { NotFoundError, ValidationError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

export class AddDocumentUseCase {
  constructor({ documentRepository, carRepository }) {
    this.documents = documentRepository;
    this.cars = carRepository;
  }
  async execute({ carId, type, expiry, note }) {
    if (!validOid(carId)) throw new ValidationError("Identificador de carro inválido");
    const car = await this.cars.findById(carId);
    if (!car) throw new NotFoundError("El carro indicado no existe");
    const doc = new VehicleDocument({ carId, type, expiry, note });
    return this.documents.create(doc);
  }
}

export class DeleteDocumentUseCase {
  constructor({ documentRepository }) {
    this.documents = documentRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador inválido");
    await this.documents.delete(id);
    return { ok: true };
  }
}
