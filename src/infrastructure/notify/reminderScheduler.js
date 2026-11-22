// Programador diario de recordatorios.
// Cada `everyMs` revisa si la hora local coincide con la mañana o la tarde
// configuradas y, de ser así, envía el recordatorio UNA sola vez por día
// (idempotencia vía ReminderLog con clave `fecha:momento`).

const localParts = (timeZone) => {
  const now = new Date();
  try {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    const hour = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", hour12: false,
    }).format(now));
    return { date, hour };
  } catch (_) {
    return { date: now.toISOString().slice(0, 10), hour: now.getUTCHours() };
  }
};

export function startReminderScheduler({
  useCase,
  dispatcher,
  settingsRepository,
  reminderLogRepository,
  timeZone = "America/Bogota",
  everyMs = 5 * 60 * 1000,
  log = console,
  initialDelayMs = 8000,
} = {}) {
  if (!useCase || !dispatcher || !settingsRepository || !(everyMs > 0)) return () => {};

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const settings = await settingsRepository.get();
      if (!settings.remindersEnabled) return;

      const { date, hour } = localParts(timeZone);
      const slots = [];
      if (hour === settings.morningHour) slots.push("morning");
      if (hour === settings.eveningHour) slots.push("evening");

      for (const moment of slots) {
        const key = `${date}:${moment}`;
        if (reminderLogRepository && (await reminderLogRepository.exists(key))) continue;
        const data = await useCase.execute({ date, moment });
        const channels = await dispatcher.dispatch({ ...data, settings });
        if (reminderLogRepository) await reminderLogRepository.record(key, { date, moment, channels });
        log.log(`[Reminders] ${moment} ${date} enviado →`, JSON.stringify(channels));
      }
    } catch (err) {
      log.error("[Reminders] Error:", err && err.message ? err.message : err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, everyMs);
  if (typeof timer.unref === "function") timer.unref();
  if (initialDelayMs > 0) {
    const boot = setTimeout(tick, initialDelayMs);
    if (typeof boot.unref === "function") boot.unref();
  }

  return () => clearInterval(timer);
}

export { localParts };
