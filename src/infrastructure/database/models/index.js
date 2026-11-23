import mongoose from "mongoose";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

const carSchema = new Schema(
  {
    plate: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, default: "" },
    rate: { type: Number, default: 80000 },
    startDate: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const paymentSchema = new Schema(
  {
    carId: { type: Schema.Types.ObjectId, ref: "Car", required: true },
    date: { type: String, required: true },
    amount: { type: Number, required: true },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

const expenseSchema = new Schema(
  {
    date: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, default: "Otro" },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

const documentSchema = new Schema(
  {
    carId: { type: Schema.Types.ObjectId, ref: "Car", required: true },
    type: { type: String, required: true },
    expiry: { type: String, required: true },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

const offDaySchema = new Schema(
  {
    carId: { type: Schema.Types.ObjectId, ref: "Car", required: true },
    date: { type: String, required: true },
    reason: { type: String, required: true, enum: ["descanso", "no_trabajo", "taller", "otro"], default: "descanso" },
    detail: { type: String, default: "" },
  },
  { timestamps: true }
);
offDaySchema.index({ carId: 1, date: 1 }, { unique: true });

const settingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    adminPhone: { type: String, default: "" },
    adminEmail: { type: String, default: "" },
    remindersEnabled: { type: Boolean, default: true },
    morningHour: { type: Number, default: 8 },
    lateMorningHour: { type: Number, default: 11 },
    middayHour: { type: Number, default: 14 },
    afternoonHour: { type: Number, default: 16 },
    eveningHour: { type: Number, default: 20 },
    notifyChannel: { type: String, enum: ["whatsapp", "telegram"], default: "whatsapp" },
    telegramChatId: { type: String, default: "" },
  },
  { timestamps: true }
);

// Pagos entrantes detectados desde correo (Nequi), pendientes de conciliar.
const pendingPaymentSchema = new Schema(
  {
    amount: { type: Number, required: true },
    detectedDate: { type: String, required: true },          // YYYY-MM-DD sugerida
    source: { type: String, default: "nequi" },
    from: { type: String, default: "" },                     // remitente del correo
    subject: { type: String, default: "" },
    snippet: { type: String, default: "" },                  // texto crudo (para ajustar el parser)
    messageId: { type: String, required: true, unique: true }, // idempotencia por correo
    status: { type: String, enum: ["pending", "approved", "dismissed"], default: "pending" },
    approvedPaymentId: { type: Schema.Types.ObjectId, ref: "Payment", default: null },
  },
  { timestamps: true }
);

const refinanceSchema = new Schema(
  {
    carId: { type: Schema.Types.ObjectId, ref: "Car", required: true },
    date: { type: String, required: true },
    originalAmount: { type: Number, required: true },
    days: { type: Number, required: true },
    paidToPlan: { type: Number, default: 0 },
    note: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Suscripciones de Web Push (PWA) para enviar recordatorios al navegador.
const pushSubscriptionSchema = new Schema(
  {
    endpoint: { type: String, required: true, unique: true },
    keys: { p256dh: { type: String, default: "" }, auth: { type: String, default: "" } },
    expirationTime: { type: Number, default: null },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

// Registro idempotente de recordatorios enviados (clave `fecha:momento`).
const reminderLogSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    date: { type: String, default: "" },
    moment: { type: String, default: "" },
    channels: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Entregas (conductor que tuvo un carro y desde/hasta cuándo).
const handoverSchema = new Schema(
  {
    carId: { type: Schema.Types.ObjectId, ref: "Car", required: true },
    driverName: { type: String, required: true, default: "" },
    driverPhone: { type: String, default: "" },
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);
handoverSchema.index({ carId: 1, startDate: 1 });

// Sesión del asistente conversacional (check-in paso a paso por WhatsApp).
const agentSessionSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true },
    date: { type: String, default: "" },
    queue: { type: [String], default: [] },
    index: { type: Number, default: 0 },
    answers: { type: [{ carId: String, action: String, at: Date }], default: [] },
    status: { type: String, default: "active" },
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("User", userSchema);
export const CarModel = mongoose.model("Car", carSchema);
export const PaymentModel = mongoose.model("Payment", paymentSchema);
export const ExpenseModel = mongoose.model("Expense", expenseSchema);
export const DocumentModel = mongoose.model("Document", documentSchema);
export const OffDayModel = mongoose.model("OffDay", offDaySchema);
export const SettingsModel = mongoose.model("Settings", settingsSchema);
export const RefinanceModel = mongoose.model("Refinance", refinanceSchema);
export const PendingPaymentModel = mongoose.model("PendingPayment", pendingPaymentSchema);
export const PushSubscriptionModel = mongoose.model("PushSubscription", pushSubscriptionSchema);
export const ReminderLogModel = mongoose.model("ReminderLog", reminderLogSchema);
export const HandoverModel = mongoose.model("Handover", handoverSchema);
export const AgentSessionModel = mongoose.model("AgentSession", agentSessionSchema);
