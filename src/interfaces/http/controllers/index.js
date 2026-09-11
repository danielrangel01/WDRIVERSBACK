import { asyncHandler } from "../middleware/errorHandler.js";

/**
 * Controllers: capa delgada que traduce HTTP ↔ casos de uso.
 * No contienen lógica de negocio, solo extraen datos del request,
 * llaman al caso de uso y devuelven la respuesta.
 */
export function buildControllers(useCases) {
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
    resetData: asyncHandler(async (req, res) => {
      res.json(await useCases.resetData.execute());
    }),
  };
}
