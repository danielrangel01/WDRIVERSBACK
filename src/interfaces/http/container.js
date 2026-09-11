import { config } from "../../infrastructure/config/index.js";

import {
  MongoUserRepository, MongoCarRepository, MongoPaymentRepository,
  MongoExpenseRepository, MongoDocumentRepository, MongoOffDayRepository, MongoSettingsRepository, MongoRefinanceRepository,
} from "../../infrastructure/database/repositories/index.js";

import { BcryptHasher } from "../../infrastructure/security/BcryptHasher.js";
import { JwtTokenService } from "../../infrastructure/security/JwtTokenService.js";

import { LoginUseCase, ChangeCredentialsUseCase } from "../../application/use-cases/auth/index.js";
import {
  ListCarsUseCase, AddCarUseCase, UpdateCarUseCase, DeactivateCarUseCase, ReactivateCarUseCase,
} from "../../application/use-cases/cars/index.js";
import { AddPaymentUseCase, DeletePaymentUseCase } from "../../application/use-cases/payments/index.js";
import { AddExpenseUseCase, DeleteExpenseUseCase } from "../../application/use-cases/expenses/index.js";
import { AddDocumentUseCase, DeleteDocumentUseCase } from "../../application/use-cases/documents/index.js";
import { ToggleOffDayUseCase, BulkOffDayUseCase, ClearOffDayUseCase } from "../../application/use-cases/offdays/index.js";
import { GetSettingsUseCase, UpdateSettingsUseCase } from "../../application/use-cases/settings/index.js";
import { GetAllDataUseCase, ResetDataUseCase } from "../../application/use-cases/data/index.js";
import { CreateRefinanceUseCase, PayRefinanceUseCase, CancelRefinanceUseCase } from "../../application/use-cases/refinances/index.js";

export function buildContainer() {
  const userRepository = new MongoUserRepository();
  const carRepository = new MongoCarRepository();
  const paymentRepository = new MongoPaymentRepository();
  const expenseRepository = new MongoExpenseRepository();
  const documentRepository = new MongoDocumentRepository();
  const offDayRepository = new MongoOffDayRepository();
  const settingsRepository = new MongoSettingsRepository();
  const refinanceRepository = new MongoRefinanceRepository();

  const passwordHasher = new BcryptHasher();
  const tokenService = new JwtTokenService(config.jwtSecret, config.jwtExpiresIn);

  const useCases = {
    login: new LoginUseCase({ userRepository, passwordHasher, tokenService }),
    changeCredentials: new ChangeCredentialsUseCase({ userRepository, passwordHasher }),
    listCars: new ListCarsUseCase({ carRepository }),
    addCar: new AddCarUseCase({ carRepository }),
    updateCar: new UpdateCarUseCase({ carRepository }),
    deactivateCar: new DeactivateCarUseCase({ carRepository }),
    reactivateCar: new ReactivateCarUseCase({ carRepository }),
    addPayment: new AddPaymentUseCase({ paymentRepository, carRepository }),
    deletePayment: new DeletePaymentUseCase({ paymentRepository }),
    addExpense: new AddExpenseUseCase({ expenseRepository }),
    deleteExpense: new DeleteExpenseUseCase({ expenseRepository }),
    addDocument: new AddDocumentUseCase({ documentRepository, carRepository }),
    deleteDocument: new DeleteDocumentUseCase({ documentRepository }),
    toggleOffDay: new ToggleOffDayUseCase({ offDayRepository, carRepository }),
    bulkOffDay: new BulkOffDayUseCase({ offDayRepository, carRepository }),
    clearOffDay: new ClearOffDayUseCase({ offDayRepository }),
    getSettings: new GetSettingsUseCase({ settingsRepository }),
    updateSettings: new UpdateSettingsUseCase({ settingsRepository }),
    createRefinance: new CreateRefinanceUseCase({ refinanceRepository, carRepository }),
    payRefinance: new PayRefinanceUseCase({ refinanceRepository }),
    cancelRefinance: new CancelRefinanceUseCase({ refinanceRepository }),
    getAllData: new GetAllDataUseCase({
      carRepository, paymentRepository, expenseRepository,
      documentRepository, offDayRepository, settingsRepository, refinanceRepository,
    }),
    resetData: new ResetDataUseCase({ paymentRepository, expenseRepository, documentRepository, offDayRepository, refinanceRepository }),
  };

  return { useCases, tokenService, repositories: { userRepository, carRepository }, passwordHasher };
}
