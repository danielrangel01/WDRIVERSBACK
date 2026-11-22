import { asyncHandler } from "../middleware/errorHandler.js";

/**
 * Controllers: capa delgada que traduce HTTP ↔ casos de uso.
 * No contienen lógica de negocio, solo extraen datos del request,
 * llaman al caso de uso y devuelven la respuesta.
 */
export function buildControllers(useCases, { notify = {} } = {}) {
  return {
    // ── Auth ──────────────────────────────────────────────────────────────
    login: asyncHandler(async (req, res) => {
      const result = await useCases.login.execute(req.body);
      res.json(result);
    }),
    changeCredentials: asyncHandler(async (req, res) => {
      const result = await useCases.changeCredentials.execute({
        userId: req.user.id,
        ...req.body,
      });
      res.json(result);
    }),
    me: asyncHandler(async (req, res) => {
      res.json({ username: req.user.username });
    }),

    // ── Cars ──────────────────────────────────────────────────────────────
    listCars: asyncHandler(async (req, res) => {
      const includeInactive = req.query.includeInactive === "true";
      const cars = await useCases.listCars.execute({ includeInactive });
      res.json(cars.map((c) => c.toJSON()));
    }),
    addCar: asyncHandler(async (req, res) => {
      const car = await useCases.addCar.execute(req.body);
      res.status(201).json(car.toJSON());
    }),
    updateCar: asyncHandler(async (req, res) => {
      const car = await useCases.updateCar.execute({ id: req.params.id, ...req.body });
      res.json(car.toJSON());
    }),
    deactivateCar: asyncHandler(async (req, res) => {
      const result = await useCases.deactivateCar.execute({ id: req.params.id });
      res.json(result);
    }),
    reactivateCar: asyncHandler(async (req, res) => {
      const result = await useCases.reactivateCar.execute({ id: req.params.id });
      res.json(result);
    }),
    getCarDebtDetail: asyncHandler(async (req, res) => {
      const detail = await useCases.getCarDebtDetail.execute({
        carId: req.params.id,
        today: req.query.today,
      });
      res.json(detail);
    }),
    getAccountStatement: asyncHandler(async (req, res) => {
      const statement = await useCases.getAccountStatement.execute({
        carId: req.params.id,
        from: req.query.from,
        to: req.query.to,
        today: req.query.today,
      });
      res.json(statement);
    }),

    // ── Handovers (entregas / conductores) ────────────────────────────────
    registerHandover: asyncHandler(async (req, res) => {
      const h = await useCases.registerHandover.execute({ carId: req.params.id, ...req.body });
      res.status(201).json(h.toJSON());
    }),
    listHandovers: asyncHandler(async (req, res) => {
      const list = await useCases.listHandovers.execute({ carId: req.params.id || req.query.carId });
      res.json(list.map((h) => h.toJSON()));
    }),
    closeHandover: asyncHandler(async (req, res) => {
      const h = await useCases.closeHandover.execute({ id: req.params.id, ...req.body });
      res.json(h.toJSON());
    }),
    updateHandover: asyncHandler(async (req, res) => {
      const h = await useCases.updateHandover.execute({ id: req.params.id, ...req.body });
      res.json(h.toJSON());
    }),
    deleteHandover: asyncHandler(async (req, res) => {
      res.json(await useCases.deleteHandover.execute({ id: req.params.id }));
    }),

    // ── Payments ──────────────────────────────────────────────────────────
    addPayment: asyncHandler(async (req, res) => {
      const p = await useCases.addPayment.execute(req.body);
      res.status(201).json(p.toJSON());
    }),
    deletePayment: asyncHandler(async (req, res) => {
      res.json(await useCases.deletePayment.execute({ id: req.params.id }));
    }),

    // ── Expenses ──────────────────────────────────────────────────────────
    addExpense: asyncHandler(async (req, res) => {
      const e = await useCases.addExpense.execute(req.body);
      res.status(201).json(e.toJSON());
    }),
    deleteExpense: asyncHandler(async (req, res) => {
      res.json(await useCases.deleteExpense.execute({ id: req.params.id }));
    }),

    // ── Documents ─────────────────────────────────────────────────────────
    addDocument: asyncHandler(async (req, res) => {
      const d = await useCases.addDocument.execute(req.body);
      res.status(201).json(d.toJSON());
    }),
    deleteDocument: asyncHandler(async (req, res) => {
      res.json(await useCases.deleteDocument.execute({ id: req.params.id }));
    }),

    // ── OffDays ───────────────────────────────────────────────────────────
    toggleOffDay: asyncHandler(async (req, res) => {
      res.json(await useCases.toggleOffDay.execute(req.body));
    }),
    bulkOffDay: asyncHandler(async (req, res) => {
      res.json(await useCases.bulkOffDay.execute(req.body));
    }),
    clearOffDay: asyncHandler(async (req, res) => {
      res.json(await useCases.clearOffDay.execute({ date: req.params.date }));
    }),

    // ── Settings ──────────────────────────────────────────────────────────
    updateSettings: asyncHandler(async (req, res) => {
      const s = await useCases.updateSettings.execute(req.body);
      res.json(s.toJSON());
    }),

    // ── Refinances ────────────────────────────────────────────────────────
    createRefinance: asyncHandler(async (req, res) => {
      const r = await useCases.createRefinance.execute(req.body);
      res.status(201).json(r.toJSON());
    }),
    payRefinance: asyncHandler(async (req, res) => {
      const r = await useCases.payRefinance.execute({ id: req.params.id, ...req.body });
      res.json(r.toJSON());
    }),
    cancelRefinance: asyncHandler(async (req, res) => {
      res.json(await useCases.cancelRefinance.execute({ id: req.params.id }));
    }),

    // ── Data ──────────────────────────────────────────────────────────────
    getAllData: asyncHandler(async (req, res) => {
      res.json(await useCases.getAllData.execute());
    }),
    getAgenda: asyncHandler(async (req, res) => {
      res.json(await useCases.getAgenda.execute({ date: req.query.date }));
    }),
    getCollections: asyncHandler(async (req, res) => {
      res.json(await useCases.getCollections.execute({ date: req.query.date }));
    }),
    getReminders: asyncHandler(async (req, res) => {
      res.json(await useCases.getReminders.execute({ date: req.query.date, moment: req.query.moment }));
    }),

    // ── Push (Web Push / PWA) ─────────────────────────────────────────────
    getPushPublicKey: asyncHandler(async (req, res) => {
      res.json({ publicKey: notify.publicKey || "", enabled: !!(notify.channels && notify.channels.push) });
    }),
    subscribePush: asyncHandler(async (req, res) => {
      const result = await useCases.subscribePush.execute({
        subscription: req.body && req.body.subscription ? req.body.subscription : req.body,
        userAgent: req.headers["user-agent"] || "",
      });
      res.status(201).json(result);
    }),
    unsubscribePush: asyncHandler(async (req, res) => {
      res.json(await useCases.unsubscribePush.execute({ endpoint: req.body && req.body.endpoint }));
    }),
    resetData: asyncHandler(async (req, res) => {
      res.json(await useCases.resetData.execute());
    }),

    // ── Nequi (pagos entrantes detectados por correo) ──────────────────────
    syncNequi: asyncHandler(async (req, res) => {
      res.json(await useCases.syncNequi.execute());
    }),
    listPendingNequi: asyncHandler(async (req, res) => {
      const status = req.query.status === "all" ? "all" : "pending";
      res.json(await useCases.listPendingPayments.execute({ status }));
    }),
    approvePendingNequi: asyncHandler(async (req, res) => {
      const result = await useCases.approvePendingPayment.execute({ id: req.params.id, ...req.body });
      res.json(result);
    }),
    dismissPendingNequi: asyncHandler(async (req, res) => {
      res.json(await useCases.dismissPendingPayment.execute({ id: req.params.id }));
    }),
  };
}
