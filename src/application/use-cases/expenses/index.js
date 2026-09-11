import { Expense } from "../../../domain/entities/index.js";
import { ValidationError } from "../../../shared/errors.js";

const validOid = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

export class AddExpenseUseCase {
  constructor({ expenseRepository }) {
    this.expenses = expenseRepository;
  }
  async execute({ date, amount, category, note }) {
    const expense = new Expense({ date, amount, category, note });
    return this.expenses.create(expense);
  }
}

export class DeleteExpenseUseCase {
  constructor({ expenseRepository }) {
    this.expenses = expenseRepository;
  }
  async execute({ id }) {
    if (!validOid(id)) throw new ValidationError("Identificador inválido");
    await this.expenses.delete(id);
    return { ok: true };
  }
}
