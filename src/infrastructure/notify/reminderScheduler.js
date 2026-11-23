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

// Resta un día a una fecha YYYY-MM-DD (aritmética sobre el string, sin zona).
const prevDate = (dateStr) => {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
};

// Dispara el check-in (mediodía), la insistencia (media tarde) o el cierre del
// día ANTERIOR (mañana) del agente por el canal de chat activo (WhatsApp o
// Telegram). Devuelve true si se envió algo. Tolerante a fallos: fuera de la
// ventana de 24 h Meta rechaza los botones y simplemente se registra el error
// (el recordatorio con plantilla ya salió).
async function runAgentMoment(agent, target, moment, log, channel = "whatsapp", date) {
  if (!agent || !target) return false;
  try {
    if (moment === "midday" && typeof agent.proactiveCheckin === "function") {
      await agent.proactiveCheckin(target, channel);
      return true;
    }
    if (moment === "afternoon" && typeof agent.nagCheckin === "function") {
      return (await agent.nagCheckin(target, channel)) === true;
    }
    if (moment === "morningClose" && typeof agent.proactiveClosePreviousDay === "function") {
      await agent.proactiveClosePreviousDay(target, channel, date ? prevDate(date) : undefined);
      return true;
    }
  } catch (err) {
    log.error("[Agent] Error en", moment, err && err.message ? err.message : err);
  }
  return false;
}

export function startReminderScheduler({
  useCase,
  dispatcher,
  settingsRepository,
  reminderLogRepository,
  agent,
  telegramChatId = "",
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
      // En la mañana van DOS mensajes: el recordatorio de gestión de HOY y, como
      // mensaje aparte, el cierre del día ANTERIOR. Los conductores pueden pagar
      // a cualquier hora, así que cerrar el día D la misma noche interferiría con
      // pagos tardíos: el cierre de D se gestiona en la mañana de D+1.
      if (hour === settings.morningHour) slots.push("morning", "morningClose");
      if (settings.lateMorningHour !== undefined && hour === settings.lateMorningHour) slots.push("lateMorning");
      if (settings.middayHour !== undefined && hour === settings.middayHour) slots.push("midday");
      if (settings.afternoonHour !== undefined && hour === settings.afternoonHour) slots.push("afternoon");
      if (hour === settings.eveningHour) slots.push("evening");

      const channelsEnabled = (dispatcher.channels) || {};
      // Canal de chat activo: WhatsApp o Telegram (uno a la vez).
      const channel = dispatcher.activeChatChannel
        ? dispatcher.activeChatChannel(settings)
        : (settings.notifyChannel === "telegram" ? "telegram" : "whatsapp");
      const target = channel === "telegram"
        ? String(settings.telegramChatId || telegramChatId || "").trim()
        : settings.adminPhone;

      for (const moment of slots) {
        const key = `${date}:${moment}`;
        if (reminderLogRepository && (await reminderLogRepository.exists(key))) continue;

        // Cierre del día ANTERIOR: mensaje aparte en la mañana, solo por el canal
        // de chat (ni correo ni push). No toca la sesión de check-in de hoy.
        if (moment === "morningClose") {
          const sent = await runAgentMoment(agent, target, moment, log, channel, date);
          if (reminderLogRepository) await reminderLogRepository.record(key, { date, moment, channels: { [channel]: sent } });
          log.log(`[Reminders] ${moment} ${date} cierre de ayer →`, JSON.stringify({ [channel]: sent }));
          continue;
        }

        // Insistencia de media tarde: no hay recordatorio general (ni correo ni
        // push); solo se re-avisa por el canal de chat si el check-in quedó a medias.
        if (moment === "afternoon") {
          const nagged = await runAgentMoment(agent, target, moment, log, channel);
          if (reminderLogRepository) await reminderLogRepository.record(key, { date, moment, channels: { [channel]: nagged } });
          log.log(`[Reminders] ${moment} ${date} insistencia →`, JSON.stringify({ [channel]: nagged }));
          continue;
        }

        const data = await useCase.execute({ date, moment });
        // En mediodía el agente se encarga del canal de chat (check-in paso a
        // paso), así que el dispatcher solo envía correo y push para no duplicar.
        // La tarde ya NO cierra: solo avisa (última llamada) por todos los canales.
        const agentHandlesChat = !!agent && !!channelsEnabled[channel] && moment === "midday";
        const channels = await dispatcher.dispatch({ ...data, settings, skipWhatsApp: agentHandlesChat });
        if (reminderLogRepository) await reminderLogRepository.record(key, { date, moment, channels });
        log.log(`[Reminders] ${moment} ${date} enviado →`, JSON.stringify(channels));
        // Check-in proactivo (mediodía).
        if (agentHandlesChat) await runAgentMoment(agent, target, moment, log, channel, date);
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
