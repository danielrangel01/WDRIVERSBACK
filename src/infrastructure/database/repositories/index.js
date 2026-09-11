import {
  IUserRepository, ICarRepository, IPaymentRepository,
  IExpenseRepository, IDocumentRepository, IOffDayRepository, ISettingsRepository, IRefinanceRepository,
} from "../../../domain/repositories/index.js";
import { User, Payment, Expense, VehicleDocument, OffDay, Settings } from "../../../domain/entities/index.js";
import { Refinance } from "../../../domain/entities/Refinance.js";
import { Car } from "../../../domain/entities/Car.js";
import {
  UserModel, CarModel, PaymentModel, ExpenseModel, DocumentModel, OffDayModel, SettingsModel, RefinanceModel,
} from "../models/index.js";

const id = (doc) => doc._id.toString();

// ── Users ─────────────────────────────────────────────────────────────────────
export class MongoUserRepository extends IUserRepository {
  async findByUsername(username) {
    const d = await UserModel.findOne({ username });
    return d ? new User({ id: id(d), username: d.username, passwordHash: d.passwordHash }) : null;
  }
  async findById(userId) {
    const d = await UserModel.findById(userId);
    return d ? new User({ id: id(d), username: d.username, passwordHash: d.passwordHash }) : null;
  }
  async create(user) {
    const d = await UserModel.create({ username: user.username, passwordHash: user.passwordHash });
    return new User({ id: id(d), username: d.username, passwordHash: d.passwordHash });
  }
  async update(user) {
    await UserModel.findByIdAndUpdate(user.id, { username: user.username, passwordHash: user.passwordHash });
    return user;
  }
}

// ── Cars ──────────────────────────────────────────────────────────────────────
function toCar(d) {
  return new Car({
    id: id(d), plate: d.plate, name: d.name, rate: d.rate,
    startDate: d.startDate, active: d.active, createdAt: d.createdAt,
  });
}

export class MongoCarRepository extends ICarRepository {
  async findAll({ includeInactive = false } = {}) {
    const filter = includeInactive ? {} : { active: true };
    const docs = await CarModel.find(filter).sort({ createdAt: 1 });
    return docs.map(toCar);
  }
  async findById(carId) {
    const d = await CarModel.findById(carId).catch(() => null);
    return d ? toCar(d) : null;
  }
  async findByPlate(plate) {
    const d = await CarModel.findOne({ plate });
    return d ? toCar(d) : null;
  }
  async create(car) {
    const d = await CarModel.create({
      plate: car.plate, name: car.name, rate: car.rate,
      startDate: car.startDate, active: car.active,
    });
    return toCar(d);
  }
  async update(car) {
    const d = await CarModel.findByIdAndUpdate(
      car.id,
      { plate: car.plate, name: car.name, rate: car.rate, startDate: car.startDate, active: car.active },
      { new: true }
    );
    return toCar(d);
  }
}

// ── Payments ──────────────────────────────────────────────────────────────────
const toPayment = (d) => new Payment({
  id: id(d), carId: d.carId.toString(), date: d.date, amount: d.amount, note: d.note, createdAt: d.createdAt,
});

export class MongoPaymentRepository extends IPaymentRepository {
  async findAll() {
    const docs = await PaymentModel.find().sort({ date: -1 });
    return docs.map(toPayment);
  }
  async countByCar(carId) {
    return PaymentModel.countDocuments({ carId });
  }
  async create(payment) {
    const d = await PaymentModel.create({ carId: payment.carId, date: payment.date, amount: payment.amount, note: payment.note });
    return toPayment(d);
  }
  async delete(paymentId) {
    await PaymentModel.findByIdAndDelete(paymentId);
  }
  async deleteAll() {
    await PaymentModel.deleteMany({});
  }
}

// ── Expenses ──────────────────────────────────────────────────────────────────
const toExpense = (d) => new Expense({
  id: id(d), date: d.date, amount: d.amount, category: d.category, note: d.note, createdAt: d.createdAt,
});

export class MongoExpenseRepository extends IExpenseRepository {
  async findAll() {
    const docs = await ExpenseModel.find().sort({ date: -1 });
    return docs.map(toExpense);
  }
  async create(expense) {
    const d = await ExpenseModel.create({ date: expense.date, amount: expense.amount, category: expense.category, note: expense.note });
    return toExpense(d);
  }
  async delete(expenseId) {
    await ExpenseModel.findByIdAndDelete(expenseId);
  }
  async deleteAll() {
    await ExpenseModel.deleteMany({});
  }
}

// ── Documents ─────────────────────────────────────────────────────────────────
const toDoc = (d) => new VehicleDocument({
  id: id(d), carId: d.carId.toString(), type: d.type, expiry: d.expiry, note: d.note, createdAt: d.createdAt,
});

export class MongoDocumentRepository extends IDocumentRepository {
  async findAll() {
    const docs = await DocumentModel.find().sort({ expiry: 1 });
    return docs.map(toDoc);
  }
  async countByCar(carId) {
    return DocumentModel.countDocuments({ carId });
  }
  async create(doc) {
    const d = await DocumentModel.create({ carId: doc.carId, type: doc.type, expiry: doc.expiry, note: doc.note });
    return toDoc(d);
  }
  async delete(docId) {
    await DocumentModel.findByIdAndDelete(docId);
  }
  async deleteAll() {
    await DocumentModel.deleteMany({});
  }
}

// ── OffDays ───────────────────────────────────────────────────────────────────
const toOffDay = (d) => new OffDay({ id: id(d), carId: d.carId.toString(), date: d.date });

export class MongoOffDayRepository extends IOffDayRepository {
  async findAll() {
    const docs = await OffDayModel.find();
    return docs.map(toOffDay);
  }
  async findOne(carId, date) {
    const d = await OffDayModel.findOne({ carId, date });
    return d ? toOffDay(d) : null;
  }
  async create(offDay) {
    const d = await OffDayModel.create({ carId: offDay.carId, date: offDay.date });
    return toOffDay(d);
  }
  async delete(offDayId) {
    await OffDayModel.findByIdAndDelete(offDayId);
  }
  async deleteByDate(date) {
    await OffDayModel.deleteMany({ date });
  }
  async deleteAll() {
    await OffDayModel.deleteMany({});
  }
  async upsertMany(date, carIds) {
    await Promise.all(
      carIds.map((carId) =>
        OffDayModel.findOneAndUpdate({ carId, date }, { carId, date }, { upsert: true })
      )
    );
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
export class MongoSettingsRepository extends ISettingsRepository {
  async get() {
    let d = await SettingsModel.findOne({ key: "global" });
    if (!d) d = await SettingsModel.create({ key: "global" });
    return new Settings({ adminPhone: d.adminPhone, morningHour: d.morningHour, eveningHour: d.eveningHour });
  }
  async update(settings) {
    const d = await SettingsModel.findOneAndUpdate(
      { key: "global" },
      { key: "global", adminPhone: settings.adminPhone, morningHour: settings.morningHour, eveningHour: settings.eveningHour },
      { upsert: true, new: true }
    );
    return new Settings({ adminPhone: d.adminPhone, morningHour: d.morningHour, eveningHour: d.eveningHour });
  }
}

// ── Refinances ────────────────────────────────────────────────────────────────
const toRefinance = (d) => new Refinance({
  id: id(d), carId: d.carId.toString(), date: d.date,
  originalAmount: d.originalAmount, days: d.days, paidToPlan: d.paidToPlan,
  note: d.note, active: d.active, createdAt: d.createdAt,
});

export class MongoRefinanceRepository extends IRefinanceRepository {
  async findAll() {
    const docs = await RefinanceModel.find().sort({ createdAt: -1 });
    return docs.map(toRefinance);
  }
  async findById(refiId) {
    const d = await RefinanceModel.findById(refiId).catch(() => null);
    return d ? toRefinance(d) : null;
  }
  async create(refi) {
    const d = await RefinanceModel.create({
      carId: refi.carId, date: refi.date, originalAmount: refi.originalAmount,
      days: refi.days, paidToPlan: refi.paidToPlan, note: refi.note, active: refi.active,
    });
    return toRefinance(d);
  }
  async update(refi) {
    const d = await RefinanceModel.findByIdAndUpdate(
      refi.id,
      { paidToPlan: refi.paidToPlan, active: refi.active, note: refi.note },
      { new: true }
    );
    return toRefinance(d);
  }
  async delete(refiId) {
    await RefinanceModel.findByIdAndDelete(refiId);
  }
  async deleteAll() {
    await RefinanceModel.deleteMany({});
  }
}
