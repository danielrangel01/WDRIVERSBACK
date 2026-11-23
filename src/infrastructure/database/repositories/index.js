import {
  IUserRepository, ICarRepository, IPaymentRepository,
  IExpenseRepository, IDocumentRepository, IOffDayRepository, ISettingsRepository, IRefinanceRepository,
  IPendingPaymentRepository, IPushSubscriptionRepository, IReminderLogRepository, IHandoverRepository,
  IAgentSessionRepository,
} from "../../../domain/repositories/index.js";
import { User, Payment, Expense, VehicleDocument, OffDay, Settings, PendingPayment } from "../../../domain/entities/index.js";
import { Refinance } from "../../../domain/entities/Refinance.js";
import { Car } from "../../../domain/entities/Car.js";
import { Handover } from "../../../domain/entities/Handover.js";
import {
  UserModel, CarModel, PaymentModel, ExpenseModel, DocumentModel, OffDayModel, SettingsModel, RefinanceModel,
  PendingPaymentModel, PushSubscriptionModel, ReminderLogModel, HandoverModel, AgentSessionModel,
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
  async deleteByUsername(username) {
    const r = await UserModel.deleteMany({ username });
    return (r && r.deletedCount) || 0;
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
const toOffDay = (d) => new OffDay({
  id: id(d),
  carId: d.carId.toString(),
  date: d.date,
  reason: d.reason || "descanso",
  detail: d.detail || "",
});

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
    const d = await OffDayModel.create({ carId: offDay.carId, date: offDay.date, reason: offDay.reason, detail: offDay.detail });
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
  async upsertMany(date, carIds, payload = {}) {
    await Promise.all(
      carIds.map((carId) =>
        OffDayModel.findOneAndUpdate(
          { carId, date },
          { carId, date, reason: payload.reason || "descanso", detail: payload.detail || "" },
          { upsert: true, new: true }
        )
      )
    );
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
export class MongoSettingsRepository extends ISettingsRepository {
  async get() {
    let d = await SettingsModel.findOne({ key: "global" });
    if (!d) d = await SettingsModel.create({ key: "global" });
    return new Settings({
      adminPhone: d.adminPhone, adminEmail: d.adminEmail,
      remindersEnabled: d.remindersEnabled, morningHour: d.morningHour,
      lateMorningHour: d.lateMorningHour, middayHour: d.middayHour,
      afternoonHour: d.afternoonHour, eveningHour: d.eveningHour,
      notifyChannel: d.notifyChannel, telegramChatId: d.telegramChatId,
    });
  }
  async update(settings) {
    const d = await SettingsModel.findOneAndUpdate(
      { key: "global" },
      {
        key: "global", adminPhone: settings.adminPhone, adminEmail: settings.adminEmail,
        remindersEnabled: settings.remindersEnabled, morningHour: settings.morningHour,
        lateMorningHour: settings.lateMorningHour, middayHour: settings.middayHour,
        afternoonHour: settings.afternoonHour, eveningHour: settings.eveningHour,
        notifyChannel: settings.notifyChannel, telegramChatId: settings.telegramChatId,
      },
      { upsert: true, new: true }
    );
    return new Settings({
      adminPhone: d.adminPhone, adminEmail: d.adminEmail,
      remindersEnabled: d.remindersEnabled, morningHour: d.morningHour,
      lateMorningHour: d.lateMorningHour, middayHour: d.middayHour,
      afternoonHour: d.afternoonHour, eveningHour: d.eveningHour,
      notifyChannel: d.notifyChannel, telegramChatId: d.telegramChatId,
    });
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

// ── PendingPayments (pagos entrantes detectados por correo) ────────────────────
const toPendingPayment = (d) => new PendingPayment({
  id: id(d), amount: d.amount, detectedDate: d.detectedDate, source: d.source,
  from: d.from, subject: d.subject, snippet: d.snippet, messageId: d.messageId,
  status: d.status, approvedPaymentId: d.approvedPaymentId, createdAt: d.createdAt,
});

export class MongoPendingPaymentRepository extends IPendingPaymentRepository {
  async findAll({ status } = {}) {
    const filter = status ? { status } : {};
    const docs = await PendingPaymentModel.find(filter).sort({ detectedDate: -1, createdAt: -1 });
    return docs.map(toPendingPayment);
  }
  async findById(pendingId) {
    const d = await PendingPaymentModel.findById(pendingId).catch(() => null);
    return d ? toPendingPayment(d) : null;
  }
  async insertMany(pending) {
    if (!Array.isArray(pending) || pending.length === 0) return 0;
    const docs = pending.map((p) => ({
      amount: p.amount, detectedDate: p.detectedDate, source: p.source,
      from: p.from, subject: p.subject, snippet: p.snippet, messageId: p.messageId, status: p.status,
    }));
    try {
      const inserted = await PendingPaymentModel.insertMany(docs, { ordered: false });
      return inserted.length;
    } catch (err) {
      // Duplicados por messageId (correo ya procesado) se ignoran sin romper la sincronización.
      if (err && Array.isArray(err.insertedDocs)) return err.insertedDocs.length;
      if (err && (err.code === 11000 || err.name === "MongoBulkWriteError")) return 0;
      throw err;
    }
  }
  async update(pending) {
    const d = await PendingPaymentModel.findByIdAndUpdate(
      pending.id,
      { status: pending.status, approvedPaymentId: pending.approvedPaymentId || null },
      { new: true }
    );
    return d ? toPendingPayment(d) : null;
  }
  async deleteAll() {
    await PendingPaymentModel.deleteMany({});
  }
}

// ── PushSubscriptions (Web Push / PWA) ────────────────────────────────────────
const toSubscription = (d) => ({
  endpoint: d.endpoint,
  subscription: { endpoint: d.endpoint, keys: { p256dh: d.keys?.p256dh || "", auth: d.keys?.auth || "" }, expirationTime: d.expirationTime ?? null },
});

// ── ReminderLog (idempotencia de recordatorios enviados) ──────────────────────
export class MongoPushSubscriptionRepository extends IPushSubscriptionRepository {
  async findAll() {
    const docs = await PushSubscriptionModel.find().sort({ createdAt: -1 });
    return docs.map(toSubscription);
  }
  async upsert(subscription, meta = {}) {
    if (!subscription || !subscription.endpoint) return null;
    await PushSubscriptionModel.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys?.p256dh || "", auth: subscription.keys?.auth || "" },
        expirationTime: subscription.expirationTime ?? null,
        userAgent: (meta.userAgent || "").slice(0, 300),
      },
      { upsert: true, new: true }
    );
    return toSubscription({ endpoint: subscription.endpoint, keys: subscription.keys, expirationTime: subscription.expirationTime });
  }
  async removeByEndpoint(endpoint) {
    if (!endpoint) return 0;
    const r = await PushSubscriptionModel.deleteOne({ endpoint });
    return r.deletedCount || 0;
  }
  async deleteAll() {
    await PushSubscriptionModel.deleteMany({});
  }
}

export class MongoReminderLogRepository extends IReminderLogRepository {
  async exists(key) {
    if (!key) return false;
    const d = await ReminderLogModel.exists({ key });
    return !!d;
  }
  async record(key, payload = {}) {
    if (!key) return null;
    try {
      await ReminderLogModel.findOneAndUpdate(
        { key },
        { key, date: payload.date || "", moment: payload.moment || "", channels: payload.channels || {} },
        { upsert: true, new: true }
      );
    } catch (err) {
      if (err && err.code === 11000) return null;
      throw err;
    }
    return { key };
  }
}

// ── AgentSession (estado del check-in paso a paso del asistente) ──────────────
// La clave "phone" identifica la conversación: solo dígitos para WhatsApp y
// "tg:<chatId>" para Telegram (así no colisionan entre canales).
const agentKey = (v) => String(v || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "");

export class MongoAgentSessionRepository extends IAgentSessionRepository {
  async get(phone) {
    const key = agentKey(phone);
    if (!key) return null;
    const d = await AgentSessionModel.findOne({ phone: key });
    if (!d) return null;
    return {
      phone: d.phone,
      date: d.date || "",
      queue: d.queue || [],
      index: d.index || 0,
      answers: (d.answers || []).map((a) => ({ carId: a.carId, action: a.action, at: a.at })),
      status: d.status || "active",
    };
  }
  async save(session) {
    const key = agentKey(session && session.phone);
    if (!key) return null;
    await AgentSessionModel.findOneAndUpdate(
      { phone: key },
      {
        phone: key,
        date: (session && session.date) || "",
        queue: (session && session.queue) || [],
        index: (session && session.index) || 0,
        answers: (session && session.answers) || [],
        status: (session && session.status) || "active",
      },
      { upsert: true, new: true }
    );
    return { ...session, phone: key };
  }
  async clear(phone) {
    const key = agentKey(phone);
    if (!key) return null;
    await AgentSessionModel.deleteOne({ phone: key });
    return { ok: true };
  }
  async deleteAll() {
    await AgentSessionModel.deleteMany({});
  }
}

// ── Handovers (entregas: conductor que tuvo el carro y desde/hasta cuándo) ─────
const toHandover = (d) => new Handover({
  id: id(d), carId: d.carId.toString(), driverName: d.driverName, driverPhone: d.driverPhone,
  startDate: d.startDate, endDate: d.endDate, note: d.note, createdAt: d.createdAt,
});

export class MongoHandoverRepository extends IHandoverRepository {
  async findAll() {
    const docs = await HandoverModel.find().sort({ carId: 1, startDate: -1 });
    return docs.map(toHandover);
  }
  async findByCar(carId) {
    const docs = await HandoverModel.find({ carId }).sort({ startDate: -1 });
    return docs.map(toHandover);
  }
  async findById(handoverId) {
    const d = await HandoverModel.findById(handoverId).catch(() => null);
    return d ? toHandover(d) : null;
  }
  async findActiveByCar(carId) {
    const d = await HandoverModel.findOne({ carId, endDate: null }).sort({ startDate: -1 });
    return d ? toHandover(d) : null;
  }
  async create(handover) {
    const d = await HandoverModel.create({
      carId: handover.carId, driverName: handover.driverName, driverPhone: handover.driverPhone,
      startDate: handover.startDate, endDate: handover.endDate, note: handover.note,
    });
    return toHandover(d);
  }
  async update(handover) {
    const d = await HandoverModel.findByIdAndUpdate(
      handover.id,
      { driverName: handover.driverName, driverPhone: handover.driverPhone, startDate: handover.startDate, endDate: handover.endDate, note: handover.note },
      { new: true }
    );
    return d ? toHandover(d) : null;
  }
  async delete(handoverId) {
    await HandoverModel.findByIdAndDelete(handoverId);
  }
  async deleteAll() {
    await HandoverModel.deleteMany({});
  }
}
