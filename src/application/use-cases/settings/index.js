import { Settings } from "../../../domain/entities/index.js";

export class GetSettingsUseCase {
  constructor({ settingsRepository }) {
    this.settings = settingsRepository;
  }
  async execute() {
    return this.settings.get();
  }
}

export class UpdateSettingsUseCase {
  constructor({ settingsRepository }) {
    this.settings = settingsRepository;
  }
  async execute({ adminPhone, adminEmail, remindersEnabled, morningHour, eveningHour }) {
    const current = await this.settings.get();
    const merged = new Settings({
      adminPhone: adminPhone !== undefined ? adminPhone : current.adminPhone,
      adminEmail: adminEmail !== undefined ? adminEmail : current.adminEmail,
      remindersEnabled: remindersEnabled !== undefined ? remindersEnabled : current.remindersEnabled,
      morningHour: morningHour !== undefined ? morningHour : current.morningHour,
      eveningHour: eveningHour !== undefined ? eveningHour : current.eveningHour,
    });
    merged.validate();
    return this.settings.update(merged);
  }
}
