import { Router } from "express";

export function buildRoutes(controllers, authMiddleware) {
  const router = Router();

  // ── Auth (login es público) ───────────────────────────────────────────────
  const auth = Router();
  auth.post("/login", controllers.login);
  auth.post("/change", authMiddleware, controllers.changeCredentials);
  auth.get("/me", authMiddleware, controllers.me);
  router.use("/auth", auth);

  // ── Todo lo demás requiere autenticación ──────────────────────────────────
  const api = Router();
  api.use(authMiddleware);

  // data
  api.get("/data", controllers.getAllData);
  api.post("/reset", controllers.resetData);

  // cars
  api.get("/cars", controllers.listCars);
  api.post("/cars", controllers.addCar);
  api.put("/cars/:id", controllers.updateCar);
  api.delete("/cars/:id", controllers.deactivateCar);       // soft delete
  api.post("/cars/:id/reactivate", controllers.reactivateCar);

  // payments
  api.post("/payments", controllers.addPayment);
  api.delete("/payments/:id", controllers.deletePayment);

  // expenses
  api.post("/expenses", controllers.addExpense);
  api.delete("/expenses/:id", controllers.deleteExpense);

  // documents
  api.post("/documents", controllers.addDocument);
  api.delete("/documents/:id", controllers.deleteDocument);

  // offdays
  api.post("/offdays/toggle", controllers.toggleOffDay);
  api.post("/offdays/bulk", controllers.bulkOffDay);
  api.delete("/offdays/:date", controllers.clearOffDay);

  // refinances
  api.post("/refinances", controllers.createRefinance);
  api.post("/refinances/:id/pay", controllers.payRefinance);
  api.delete("/refinances/:id", controllers.cancelRefinance);

  // settings
  api.put("/settings", controllers.updateSettings);

  router.use("/", api);

  return router;
}
