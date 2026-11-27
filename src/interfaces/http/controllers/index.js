import { asyncHandler } from "../middleware/errorHandler.js";
import { config } from "../../../infrastructure/config/index.js";
import { ValidationError } from "../../../shared/errors.js";

// Canal de chat activo configurado en Ajustes (WhatsApp por defecto).
async function resolveActiveChannel(useCases) {
  const s = await useCases.getSettings.execute();
  return s && s.notifyChannel === "telegram" ? "telegram" : "whatsapp";
}

// Devuelve el destino del admin (teléfono WhatsApp o chat id de Telegram)
// según el canal, o falla con un 400 explicando qué configurar.
async function resolveAdminTarget(useCases, channel) {
  const s = await useCases.getSettings.execute();
  if (channel === "telegram") {
    const chatId = String((s && s.telegramChatId) || config.notifications.telegramAdminChatId || "").trim();
    if (!chatId) {
      throw new ValidationError("Configura el 'Chat ID de Telegram' en Ajustes para usar el bot");
    }
    return chatId;
  }
  const phone = (s && s.adminPhone) || "";
  if (!phone) {
    throw new ValidationError("Configura el 'Teléfono administrador' en Ajustes para usar el agente de WhatsApp");
  }
  return phone;
}

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
    refreshToken: asyncHandler(async (req, res) => {
      const result = await useCases.refreshToken.execute(req.body || {});
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

    // ── Push (Web Push / PWA + FCM nativo iOS/Android) ────────────────────
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
    registerDevice: asyncHandler(async (req, res) => {
      const body = req.body || {};
      const result = await useCases.registerDevice.execute({
        token: body.token,
        platform: body.platform,
        deviceName: body.deviceName,
      });
      // Saludo de bienvenida al push nativo: se envía al alta de un dispositivo
      // nuevo (primer login tras instalar) o cuando el cliente lo pide tras
      // iniciar sesión (`greet`). Sirve como prueba de extremo a extremo.
      const greet = !!body.greet;
      if (result.isNew || greet) {
        if (notify.fcmNotifier && notify.fcmNotifier.enabled) {
          const sent = await notify.fcmNotifier.send(body.token, {
            title: `¡Hola, ${req.user.username}!`,
            body: "Sesión iniciada en W Drivers. Las notificaciones push están activas.",
            data: { type: "welcome" },
          });
          if (!sent.ok) {
            console.warn("[push] saludo de bienvenida no enviado:", sent.code || sent.error || sent.reason);
          }
        } else {
          console.warn("[push] saludo no enviado: el canal FCM no está activo (¿FIREBASE_SERVICE_ACCOUNT?)");
        }
      }
      res.status(201).json(result);
    }),
    unregisterDevice: asyncHandler(async (req, res) => {
      res.json(await useCases.unregisterDevice.execute({ token: req.body && req.body.token }));
    }),

    // ── WhatsApp (Cloud API / Meta) ───────────────────────────────────────
    whatsappStatus: asyncHandler(async (req, res) => {
      const n = config.notifications;
      res.json({
        enabled: !!(notify.channels && notify.channels.whatsapp),
        template: n.whatsappTemplate || "",
        // Agente conversacional entrante: listo si hay token de verificación.
        webhook: {
          enabled: n.whatsappWebhookEnabled,
          path: "/api/whatsapp/webhook",
          signature: !!n.whatsappAppSecret,
        },
      });
    }),
    sendWhatsApp: asyncHandler(async (req, res) => {
      const result = await useCases.sendWhatsApp.execute(req.body || {});
      res.json(result);
    }),
    // Envío por el canal de chat activo (WhatsApp o Telegram). La app móvil/Web
    // lo usan sin conocer el canal; el backend enruta según Ajustes.
    sendNotification: asyncHandler(async (req, res) => {
      const result = await useCases.sendNotification.execute(req.body || {});
      res.json(result);
    }),
    // Disparo manual del agente: iniciar check-in o enviar el cierre del día.
    // Usa el canal de chat activo configurado en Ajustes (WhatsApp o Telegram).
    agentCheckin: asyncHandler(async (req, res) => {
      const channel = await resolveActiveChannel(useCases);
      const target = await resolveAdminTarget(useCases, channel);
      const out = await useCases.whatsAppAgent.proactiveCheckin(target, channel);
      res.json({ ok: true, channel, to: target, preview: out.text });
    }),
    agentClose: asyncHandler(async (req, res) => {
      const channel = await resolveActiveChannel(useCases);
      const target = await resolveAdminTarget(useCases, channel);
      const out = await useCases.whatsAppAgent.proactiveClose(target, channel);
      res.json({ ok: true, channel, to: target, preview: out.text });
    }),

    // ── Telegram (Bot API / canal alternativo) ────────────────────────────
    telegramStatus: asyncHandler(async (req, res) => {
      const n = config.notifications;
      const s = await useCases.getSettings.execute();
      res.json({
        enabled: !!(notify.channels && notify.channels.telegram),
        channel: s && s.notifyChannel === "telegram" ? "telegram" : "whatsapp",
        chatId: (s && s.telegramChatId) || "",
        webhook: {
          path: "/api/telegram/webhook",
          // Telegram devuelve este secreto en el header al llamar al webhook.
          secret: !!n.telegramWebhookSecret,
        },
      });
    }),
    // Registra el webhook de Telegram apuntando a este backend. Si no se pasa
    // `url`, se deduce del request. Telegram no requiere ventana ni plantillas.
    telegramSetup: asyncHandler(async (req, res) => {
      const n = config.notifications;
      if (!notify.telegramNotifier || !notify.telegramNotifier.enabled) {
        throw new ValidationError("Telegram no está configurado (falta TELEGRAM_BOT_TOKEN)");
      }
      const url = (req.body && req.body.url)
        || `${req.protocol}://${req.get("host")}/api/telegram/webhook`;
      const result = await notify.telegramNotifier.setWebhook({
        url,
        secretToken: n.telegramWebhookSecret,
      });
      res.json({ ok: true, url, result });
    }),
    // Envía un mensaje de prueba al chat configurado (o al pasado en `to`).
    telegramTest: asyncHandler(async (req, res) => {
      const s = await useCases.getSettings.execute();
      const to = String((req.body && req.body.to) || (s && s.telegramChatId) || config.notifications.telegramAdminChatId || "").trim();
      if (!to) {
        throw new ValidationError("Falta el 'Chat ID de Telegram' (configúralo en Ajustes o pásalo en 'to')");
      }
      const result = await useCases.sendTelegram.execute({ kind: "test", to });
      res.json({ ok: true, to, result });
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
