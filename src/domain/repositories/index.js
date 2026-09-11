/**
 * Interfaces (contratos) de repositorios.
 *
 * En JavaScript no hay interfaces nativas, así que usamos clases base que
 * documentan los métodos esperados. La capa de infraestructura las implementa
 * con Mongoose. Las capas de aplicación dependen SOLO de estos contratos,
 * nunca de Mongoose directamente (regla de Clean Architecture).
 */

export class IUserRepository {
  async findByUsername(_username) { throw new Error("No implementado"); }
  async findById(_id) { throw new Error("No implementado"); }
  async create(_user) { throw new Error("No implementado"); }
  async update(_user) { throw new Error("No implementado"); }
}

export class ICarRepository {
  async findAll({ includeInactive } = {}) { throw new Error("No implementado"); }
  async findById(_id) { throw new Error("No implementado"); }
  async findByPlate(_plate) { throw new Error("No implementado"); }
  async create(_car) { throw new Error("No implementado"); }
  async update(_car) { throw new Error("No implementado"); }
}

export class IPaymentRepository {
  async findAll() { throw new Error("No implementado"); }
  async countByCar(_carId) { throw new Error("No implementado"); }
  async create(_payment) { throw new Error("No implementado"); }
  async delete(_id) { throw new Error("No implementado"); }
  async deleteAll() { throw new Error("No implementado"); }
}

export class IExpenseRepository {
  async findAll() { throw new Error("No implementado"); }
  async create(_expense) { throw new Error("No implementado"); }
  async delete(_id) { throw new Error("No implementado"); }
  async deleteAll() { throw new Error("No implementado"); }
}

export class IDocumentRepository {
  async findAll() { throw new Error("No implementado"); }
  async countByCar(_carId) { throw new Error("No implementado"); }
  async create(_doc) { throw new Error("No implementado"); }
  async delete(_id) { throw new Error("No implementado"); }
  async deleteAll() { throw new Error("No implementado"); }
}

export class IOffDayRepository {
  async findAll() { throw new Error("No implementado"); }
  async findOne(_carId, _date) { throw new Error("No implementado"); }
  async create(_offDay) { throw new Error("No implementado"); }
  async delete(_id) { throw new Error("No implementado"); }
  async deleteByDate(_date) { throw new Error("No implementado"); }
  async deleteAll() { throw new Error("No implementado"); }
  async upsertMany(_date, _carIds) { throw new Error("No implementado"); }
}

export class ISettingsRepository {
  async get() { throw new Error("No implementado"); }
  async update(_settings) { throw new Error("No implementado"); }
}

export class IRefinanceRepository {
  async findAll() { throw new Error("No implementado"); }
  async findById(_id) { throw new Error("No implementado"); }
  async create(_refinance) { throw new Error("No implementado"); }
  async update(_refinance) { throw new Error("No implementado"); }
  async delete(_id) { throw new Error("No implementado"); }
  async deleteAll() { throw new Error("No implementado"); }
}
