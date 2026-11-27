import { config } from "../../infrastructure/config/index.js";

import {
  MongoUserRepository, MongoCarRepository, MongoPaymentRepository,
  MongoExpenseRepository, MongoDocumentRepository, MongoOffDayRepository, MongoSettingsRepository, MongoRefinanceRepository,
  MongoPendingPaymentRepository, MongoPushSubscriptionRepository, MongoReminderLogRepository,
  MongoHandoverRepository, MongoAgentSessionRepository, MongoTelegramUpdateRepository,
} from "../../infrastructure/database/repositories/index.js";

import { BcryptHasher } from "../../infrastructure/security/BcryptHasher.js";
import { JwtTokenService } from "../../infrastructure/security/JwtTokenService.js";
import { NequiMailReader } from "../../infrastructure/mail/NequiMailReader.js";
import { EmailNotifier } from "../../infrastructure/notify/EmailNotifier.js";
import { PushNotifier } from "../../infrastructure/notify/PushNotifier.js";
import { WhatsAppNotifier } from "../../infrastructure/notify/WhatsAppNotifier.js";
import { TelegramNotifier } from "../../infrastructure/notify/TelegramNotifier.js";
import { ReminderDispatcher } from "../../infrastructure/notify/ReminderDispatcher.js";

import { LoginUseCase, RefreshTokenUseCase, ChangeCredentialsUseCase } from "../../application/use-cases/auth/index.js";
import {
  ListCarsUseCase, AddCarUseCase, UpdateCarUseCase, DeactivateCarUseCase, ReactivateCarUseCase,
  GetCarDebtDetailUseCase,
} from "../../application/use-cases/cars/index.js";
import { AddPaymentUseCase, DeletePaymentUseCase } from "../../application/use-cases/payments/index.js";
import { AddExpenseUseCase, DeleteExpenseUseCase } from "../../application/use-cases/expenses/index.js";
import { AddDocumentUseCase, DeleteDocumentUseCase } from "../../application/use-cases/documents/index.js";
import { ToggleOffDayUseCase, BulkOffDayUseCase, ClearOffDayUseCase } from "../../application/use-cases/offdays/index.js";
import { GetSettingsUseCase, UpdateSettingsUseCase } from "../../application/use-cases/settings/index.js";
import { GetAllDataUseCase, ResetDataUseCase } from "../../application/use-cases/data/index.js";
import { GetAgendaUseCase } from "../../application/use-cases/agenda/index.js";
import { GetCollectionsUseCase } from "../../application/use-cases/collections/index.js";
import { GetAccountStatementUseCase } from "../../application/use-cases/statement/index.js";
import { GetRemindersUseCase } from "../../application/use-cases/reminders/index.js";
import { SendWhatsAppUseCase } from "../../application/use-cases/whatsapp/index.js";
import { SendTelegramUseCase } from "../../application/use-cases/telegram/index.js";
import { SendNotificationUseCase } from "../../application/use-cases/notify/index.js";
import { WhatsAppAgentUseCase } from "../../application/use-cases/agent/index.js";
import {
  RegisterHandoverUseCase, CloseHandoverUseCase, UpdateHandoverUseCase,
  ListHandoversUseCase, DeleteHandoverUseCase,
} from "../../application/use-cases/handovers/index.js";
import { SubscribePushUseCase, UnsubscribePushUseCase } from "../../application/use-cases/push/index.js";
import { CreateRefinanceUseCase, PayRefinanceUseCase, CancelRefinanceUseCase } from "../../application/use-cases/refinances/index.js";
import {
  SyncNequiUseCase, ListPendingPaymentsUseCase, ApprovePendingPaymentUseCase, DismissPendingPaymentUseCase,
} from "../../application/use-cases/nequi/index.js";

export function buildContainer() {
  const userRepository = new MongoUserRepository();
  const carRepository = new MongoCarRepository();
  const paymentRepository = new MongoPaymentRepository();
  const expenseRepository = new MongoExpenseRepository();
  const documentRepository = new MongoDocumentRepository();
  const offDayRepository = new MongoOffDayRepository();
  const settingsRepository = new MongoSettingsRepository();
  const refinanceRepository = new MongoRefinanceRepository();
  const pendingPaymentRepository = new MongoPendingPaymentRepository();
  const pushSubscriptionRepository = new MongoPushSubscriptionRepository();
  const reminderLogRepository = new MongoReminderLogRepository();
  const handoverRepository = new MongoHandoverRepository();
  const agentSessionRepository = new MongoAgentSessionRepository();
  const telegramUpdateRepository = new MongoTelegramUpdateRepository();

  const passwordHasher = new BcryptHasher();
  const tokenService = new JwtTokenService(config.jwtSecret, config.jwtExpiresIn, config.jwtRefreshExpiresIn);
  const mailReader = new NequiMailReader(config.nequi);

  // Notificadores (correo SMTP + Web Push). Quedan inactivos si faltan credenciales.
  const emailNotifier = new EmailNotifier({
    host: config.notifications.smtpHost,
    port: config.notifications.smtpPort,
    secure: config.notifications.smtpSecure,
    user: config.notifications.smtpUser,
    pass: config.notifications.smtpPass,
    from: config.notifications.emailFrom,
  });
  const pushNotifier = new PushNotifier({
    publicKey: config.notifications.vapidPublicKey,
    privateKey: config.notifications.vapidPrivateKey,
    subject: config.notifications.vapidSubject,
  });
  const whatsappNotifier = new WhatsAppNotifier({
    token: config.notifications.whatsappToken,
    phoneNumberId: config.notifications.whatsappPhoneNumberId,
    apiVersion: config.notifications.whatsappApiVersion,
    template: config.notifications.whatsappTemplate,
    templateLang: config.notifications.whatsappTemplateLang,
  });
  const telegramNotifier = new TelegramNotifier({
    token: config.notifications.telegramBotToken,
  });
  const reminderDispatcher = new ReminderDispatcher({
    emailNotifier, pushNotifier, whatsappNotifier, telegramNotifier, pushSubscriptionRepository,
    telegramChatId: config.notifications.telegramAdminChatId,
  });

  const addPayment = new AddPaymentUseCase({ paymentRepository, carRepository });
  const toggleOffDay = new ToggleOffDayUseCase({ offDayRepository, carRepository });
  const getSettings = new GetSettingsUseCase({ settingsRepository });

  const getAgenda = new GetAgendaUseCase({
    carRepository, paymentRepository, offDayRepository, refinanceRepository, documentRepository, pendingPaymentRepository,
    handoverRepository, timeZone: config.notifications.timezone,
  });

  const getReminders = new GetRemindersUseCase({ agendaUseCase: getAgenda, settingsRepository });
  const getAccountStatement = new GetAccountStatementUseCase({
    carRepository, paymentRepository, offDayRepository, refinanceRepository, handoverRepository,
  });
  const sendWhatsApp = new SendWhatsAppUseCase({
    whatsappNotifier, statementUseCase: getAccountStatement, remindersUseCase: getReminders, settingsRepository,
  });
  const sendTelegram = new SendTelegramUseCase({ telegramNotifier });
  const sendNotification = new SendNotificationUseCase({
    sendWhatsApp, sendTelegram, getSettings, statementUseCase: getAccountStatement, remindersUseCase: getReminders,
    telegramChatId: config.notifications.telegramAdminChatId,
  });

  // Pagos Nequi (conciliación de los detectados por correo).
  const listPendingPayments = new ListPendingPaymentsUseCase({ pendingPaymentRepository });
  const approvePendingPayment = new ApprovePendingPaymentUseCase({ pendingPaymentRepository, addPaymentUseCase: addPayment });
  const dismissPendingPayment = new DismissPendingPaymentUseCase({ pendingPaymentRepository });
  const getCarDebtDetail = new GetCarDebtDetailUseCase({ carRepository, paymentRepository, offDayRepository, handoverRepository });

  // Agente conversacional determinista (inbound por WhatsApp o Telegram).
  const whatsAppAgent = new WhatsAppAgentUseCase({
    getAgenda, getSettings, addPayment, toggleOffDay, sendWhatsApp, sendTelegram, agentSessionRepository,
    listPendingPayments, approvePendingPayment, dismissPendingPayment, getCarDebtDetail,
    checkinTemplate: config.notifications.whatsappCheckinTemplate,
    telegramChatId: config.notifications.telegramAdminChatId,
  });

  const useCases = {
    login: new LoginUseCase({ userRepository, passwordHasher, tokenService }),
    refreshToken: new RefreshTokenUseCase({ userRepository, tokenService }),
    changeCredentials: new ChangeCredentialsUseCase({ userRepository, passwordHasher }),
    listCars: new ListCarsUseCase({ carRepository }),
    addCar: new AddCarUseCase({ carRepository }),
    updateCar: new UpdateCarUseCase({ carRepository }),
    deactivateCar: new DeactivateCarUseCase({ carRepository }),
    reactivateCar: new ReactivateCarUseCase({ carRepository }),
    getCarDebtDetail,
    addPayment,
    deletePayment: new DeletePaymentUseCase({ paymentRepository }),
    addExpense: new AddExpenseUseCase({ expenseRepository }),
    deleteExpense: new DeleteExpenseUseCase({ expenseRepository }),
    addDocument: new AddDocumentUseCase({ documentRepository, carRepository }),
    deleteDocument: new DeleteDocumentUseCase({ documentRepository }),
    toggleOffDay,
    bulkOffDay: new BulkOffDayUseCase({ offDayRepository, carRepository }),
    clearOffDay: new ClearOffDayUseCase({ offDayRepository }),
    getSettings,
    updateSettings: new UpdateSettingsUseCase({ settingsRepository }),
    createRefinance: new CreateRefinanceUseCase({ refinanceRepository, carRepository }),
    payRefinance: new PayRefinanceUseCase({ refinanceRepository }),
    cancelRefinance: new CancelRefinanceUseCase({ refinanceRepository }),
    getAllData: new GetAllDataUseCase({
      carRepository, paymentRepository, expenseRepository,
      documentRepository, offDayRepository, settingsRepository, refinanceRepository,
      pendingPaymentRepository, handoverRepository,
    }),
    resetData: new ResetDataUseCase({ paymentRepository, expenseRepository, documentRepository, offDayRepository, refinanceRepository, pendingPaymentRepository, handoverRepository }),
    getAgenda,
    getCollections: new GetCollectionsUseCase({ carRepository, paymentRepository, offDayRepository, refinanceRepository }),
    getAccountStatement,
    registerHandover: new RegisterHandoverUseCase({ handoverRepository, carRepository }),
    closeHandover: new CloseHandoverUseCase({ handoverRepository }),
    updateHandover: new UpdateHandoverUseCase({ handoverRepository }),
    listHandovers: new ListHandoversUseCase({ handoverRepository }),
    deleteHandover: new DeleteHandoverUseCase({ handoverRepository }),
    getReminders,
    sendWhatsApp,
    sendTelegram,
    sendNotification,
    whatsAppAgent,
    subscribePush: new SubscribePushUseCase({ pushSubscriptionRepository }),
    unsubscribePush: new UnsubscribePushUseCase({ pushSubscriptionRepository }),
    syncNequi: new SyncNequiUseCase({
      pendingPaymentRepository, mailReader, sendTelegram, getSettings,
      telegramChatId: config.notifications.telegramAdminChatId,
    }),
    listPendingPayments,
    approvePendingPayment,
    dismissPendingPayment,
  };

  return {
    useCases,
    tokenService,
    mailReader,
    passwordHasher,
    repositories: {
      userRepository, carRepository, pendingPaymentRepository,
      settingsRepository, reminderLogRepository, pushSubscriptionRepository,
      handoverRepository, agentSessionRepository, telegramUpdateRepository,
    },
    notify: {
      emailNotifier, pushNotifier, whatsappNotifier, telegramNotifier, reminderDispatcher,
      publicKey: config.notifications.vapidPublicKey,
      channels: reminderDispatcher.channels,
    },
  };
}
