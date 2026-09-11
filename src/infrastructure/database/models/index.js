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
  },
  { timestamps: true }
);
offDaySchema.index({ carId: 1, date: 1 }, { unique: true });

const settingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    adminPhone: { type: String, default: "" },
    morningHour: { type: Number, default: 8 },
    eveningHour: { type: Number, default: 20 },
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

export const UserModel = mongoose.model("User", userSchema);
export const CarModel = mongoose.model("Car", carSchema);
export const PaymentModel = mongoose.model("Payment", paymentSchema);
export const ExpenseModel = mongoose.model("Expense", expenseSchema);
export const DocumentModel = mongoose.model("Document", documentSchema);
export const OffDayModel = mongoose.model("OffDay", offDaySchema);
export const SettingsModel = mongoose.model("Settings", settingsSchema);
export const RefinanceModel = mongoose.model("Refinance", refinanceSchema);
