import { computeMetrics } from "../../../domain/services/MetricsService.js";

export class GetAllDataUseCase {
  constructor({ carRepository, paymentRepository, expenseRepository, documentRepository, offDayRepository, settingsRepository, refinanceRepository }) {
    this.cars = carRepository;
    this.payments = paymentRepository;
    this.expenses = expenseRepository;
    this.documents = documentRepository;
    this.offDays = offDayRepository;
    this.settings = settingsRepository;
    this.refinances = refinanceRepository;
  }

  async execute() {
    const [cars, payments, expenses, documents, offDays, settings, refinances] = await Promise.all([
      this.cars.findAll({ includeInactive: true }),
      this.payments.findAll(),
      this.expenses.findAll(),
      this.documents.findAll(),
      this.offDays.findAll(),
      this.settings.get(),
      this.refinances.findAll(),
    ]);

    const activeCars = cars.filter((c) => c.active);
    const metrics = computeMetrics({ cars: activeCars, payments, expenses, offDays, refinances });

    return {
      cars: cars.map((c) => c.toJSON()),
      payments: payments.map((p) => p.toJSON()),
      expenses: expenses.map((e) => e.toJSON()),
      documents: documents.map((d) => d.toJSON()),
      offDays: offDays.map((o) => o.toJSON()),
      refinances: refinances.map((r) => r.toJSON()),
      settings: settings.toJSON(),
      metrics,
    };
  }
}

export class ResetDataUseCase {
  constructor({ paymentRepository, expenseRepository, documentRepository, offDayRepository, refinanceRepository }) {
    this.payments = paymentRepository;
    this.expenses = expenseRepository;
    this.documents = documentRepository;
    this.offDays = offDayRepository;
    this.refinances = refinanceRepository;
  }
  async execute() {
    const results = await Promise.allSettled([
      typeof this.payments.deleteAll === "function" ? this.payments.deleteAll() : Promise.resolve(),
      typeof this.expenses.deleteAll === "function" ? this.expenses.deleteAll() : Promise.resolve(),
      typeof this.documents.deleteAll === "function" ? this.documents.deleteAll() : Promise.resolve(),
      typeof this.offDays.deleteAll === "function" ? this.offDays.deleteAll() : Promise.resolve(),
      typeof this.refinances?.deleteAll === "function" ? this.refinances.deleteAll() : Promise.resolve(),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    return { ok: failed === 0, skippedOrFailed: failed };
  }
}
