import { Router } from "express";

export function buildRoutes(controllers, authMiddleware) {
  const router = Router();

  // ── Auth (login es público) ───────────────────────────────────────────────
  const auth = Router();
  auth.post("/login", controllers.login);
  auth.post("/refresh", controllers.refreshToken);
  auth.post("/change", authMiddleware, controllers.changeCredentials);
  auth.get("/me", authMiddleware, controllers.me);
  router.use("/auth", auth);

  // ── Todo lo demás requiere autenticación ──────────────────────────────────
  const api = Router();
  api.use(authMiddleware);

  // data
  api.get("/data", controllers.getAllData);
  api.post("/reset", controllers.resetData);

  // agenda (centro de gestión del día)
  api.get("/agenda", controllers.getAgenda);
  api.get("/collections", controllers.getCollections);
  api.get("/reminders", controllers.getReminders);

  // push (Web Push / PWA)
  api.get("/push/public-key", controllers.getPushPublicKey);
  api.post("/push/subscribe", controllers.subscribePush);
  api.post("/push/unsubscribe", controllers.unsubscribePush);

  // cars
  api.get("/cars", controllers.listCars);
  api.post("/cars", controllers.addCar);
  api.put("/cars/:id", controllers.updateCar);
  api.delete("/cars/:id", controllers.deactivateCar);       // soft delete
  api.post("/cars/:id/reactivate", controllers.reactivateCar);
  api.get("/cars/:id/debt-detail", controllers.getCarDebtDetail);
  api.get("/cars/:id/statement", controllers.getAccountStatement);
  api.post("/cars/:id/handover", controllers.registerHandover);
  api.get("/cars/:id/handovers", controllers.listHandovers);

  // handovers (entregas / conductores)
  api.get("/handovers", controllers.listHandovers);
  api.put("/handovers/:id", controllers.updateHandover);
  api.post("/handovers/:id/close", controllers.closeHandover);
  api.delete("/handovers/:id", controllers.deleteHandover);

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

  // nequi (pagos entrantes detectados por correo)
  api.get("/nequi/pending", controllers.listPendingNequi);
  api.post("/nequi/sync", controllers.syncNequi);
  api.post("/nequi/pending/:id/approve", controllers.approvePendingNequi);
  api.delete("/nequi/pending/:id", controllers.dismissPendingNequi);

  router.use("/", api);

  return router;
}
