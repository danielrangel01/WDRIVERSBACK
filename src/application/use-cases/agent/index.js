import {
  INTENT, parseCommand, normalizePlate, formatCOP, samePhone,
} from "../../../domain/services/AgentCommand.js";
import { buildDayCloseReport } from "../../../domain/services/DayCloseReport.js";

const STATUS_LABEL = {
  closed: "Meta cumplida 🎉",
  ahead: "Adelantado ✅",
  on_track: "En camino ✅",
  behind: "Atrasado ⚠️",
  critical: "Crítico 🔴",
  early: "Iniciando el día",
  unavailable: "Sin datos",
};

const OFF_REASONS = new Set(["descanso", "no_trabajo", "taller", "otro"]);

// Botones del check-in: verbo → etiqueta.
const BUTTONS = [
  { verb: "pay", title: "Ya pagó" },
  { verb: "off", title: "En taller" },
  { verb: "ok", title: "Sin novedad" },
];

// Botones de la plantilla de check-in (estáticos). Los usa el aviso proactivo
// cuando el canal no permite botones dinámicos (WhatsApp fuera de 24 h) y
// también Telegram (donde no hay ventana ni plantillas).
const CHECKIN_BUTTONS = [
  { id: "CHECKIN", title: "Revisar ahora" },
  { id: "CLOSE", title: "Ver cierre" },
  { id: "HELP", title: "Ayuda" },
];

// Texto libre interpretado como respuesta durante el check-in.
const PAY_WORDS = /\b(si|ya|listo|ok|pago|pagado|abono|consign|transfer|deposit)\b/;

// Normaliza la clave de sesión (dígitos WhatsApp; "tg:<id>" Telegram).
const agentKey = (v) => String(v || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "");

/**
 * Agente conversacional determinista (inbound) por WhatsApp o Telegram.
 * El administrador responde/escribe y el agente traduce el mensaje a acciones
 * REALES del backend (pago, día libre, consultas) y contesta. También puede
 * iniciar una revisión PASO A PASO con botones (check-in carro por carro) y
 * emitir el cierre del día. Todo se calcula con reglas: nunca se inventan montos.
 *
 * Canal: `sendWhatsApp`/`sendTelegram` comparten el mismo contrato, de modo que
 * el motor (comandos, acciones, check-in) es idéntico en ambos. El canal se
 * elige con el parámetro `channel` ("whatsapp" | "telegram").
 */
export class WhatsAppAgentUseCase {
  constructor({ getAgenda, getSettings, addPayment, toggleOffDay, sendWhatsApp, sendTelegram, agentSessionRepository, checkinTemplate, telegramChatId } = {}) {
    this.getAgenda = getAgenda;
    this.getSettings = getSettings;
    this.addPayment = addPayment;
    this.toggleOffDay = toggleOffDay;
    this.sendWhatsApp = sendWhatsApp;
    this.sendTelegram = sendTelegram;
    this.sessions = agentSessionRepository;
    this.checkinTemplate = checkinTemplate || "wdrivers_checkin_util";
    // Respaldo del chat id del admin (si no está en Ajustes).
    this.telegramChatId = telegramChatId || "";
  }

  /** Clave de sesión por canal (evita colisiones entre WhatsApp y Telegram). */
  sessionKey(channel, from) {
    const digits = String(from || "").replace(/\D/g, "");
    return channel === "telegram" ? `tg:${digits}` : digits;
  }

  /** Autoriza al remitente según el canal (teléfono admin o chat id admin). */
  isAuthorized(settings, from, channel) {
    if (!settings) return false;
    if (channel === "telegram") {
      const expected = String((settings && settings.telegramChatId) || this.telegramChatId || "").replace(/\D/g, "");
      const got = String(from || "").replace(/\D/g, "");
      return !!expected && !!got && expected === got;
    }
    return samePhone(from, settings.adminPhone);
  }

  /** Punto de entrada: valida al remitente, interpreta, ejecuta y responde. */
  async handleIncoming({ from, text, action, channel = "whatsapp" } = {}) {
    const settings = this.getSettings ? await this.getSettings.execute() : null;
    if (!this.isAuthorized(settings, from, channel)) {
      return { handled: false, reason: "unauthorized", from, channel };
    }

    const key = this.sessionKey(channel, from);
    const session = this.sessions ? await this.sessions.get(key) : null;

    let intent = INTENT.UNKNOWN;
    let out;
    if (action) {
      intent = "button";
      out = await this.handleAction(key, action, session);
    } else {
      const cmd = parseCommand(text);
      intent = cmd.intent;
      out = await this.handleCommand(cmd, key, session);
    }

    const reply = (out && out.text) || "";
    const canSend = channel === "telegram" ? this.sendTelegram : this.sendWhatsApp;
    let sent = false;
    if ((reply || (out && out.buttons && out.buttons.length)) && canSend) {
      try {
        await this.send(from, out, channel);
        sent = true;
      } catch (_) {
        sent = false;
      }
    }
    return { handled: true, intent, reply, sent, channel };
  }

  send(to, out, channel = "whatsapp") {
    const hasButtons = !!(out.buttons && out.buttons.length);
    if (channel === "telegram") {
      if (!this.sendTelegram) throw new Error("Telegram no está configurado");
      return hasButtons
        ? this.sendTelegram.execute({ kind: "buttons", to, text: out.text, buttons: out.buttons, footer: out.footer })
        : this.sendTelegram.execute({ kind: "text", to, text: out.text });
    }
    return hasButtons
      ? this.sendWhatsApp.execute({ kind: "buttons", to, text: out.text, buttons: out.buttons, footer: out.footer })
      : this.sendWhatsApp.execute({ kind: "text", to, text: out.text });
  }

  // ── Enrutado de comandos ────────────────────────────────────────────────
  async handleCommand(cmd, phone, session) {
    const agenda = await this.getAgenda.execute();
    const active = session && session.status === "active" && session.date === agenda.date;

    switch (cmd.intent) {
      case INTENT.HELP:
        return { text: this.helpText() };
      case INTENT.STATUS:
        return { text: this.statusText(agenda) };
      case INTENT.PENDING:
        return { text: this.pendingText(agenda) };
      case INTENT.CHECKIN:
        return this.startCheckin(phone, agenda);
      case INTENT.CLOSE:
        return { text: buildDayCloseReport(agenda) };
      case INTENT.PAYMENT:
      case INTENT.OFFDAY: {
        // Dentro de un check-in y sin carro explícito → aplica al carro actual.
        if (active && cmd.refs.length === 0) return this.answerCurrent(session, cmd, agenda);
        return cmd.intent === INTENT.PAYMENT
          ? this.runPayment(cmd, agenda)
          : this.runOffDay(cmd, agenda);
      }
      default: {
        if (active && cmd.refs.length === 0) return this.answerCurrent(session, cmd, agenda);
        const car = this.resolveCar(agenda, cmd.refs);
        return { text: car ? this.carText(car) : this.helpText() };
      }
    }
  }

  // ── Acciones puntuales ──────────────────────────────────────────────────
  async runPayment(cmd, agenda) {
    const car = this.resolveCar(agenda, cmd.refs);
    if (!car) return { text: this.askCarText("registrar el pago") };
    const line = await this.doPay(car, agenda.date, cmd.amount);
    const updated = await this.getAgenda.execute();
    return { text: [line, this.markerLine(updated)].join("\n") };
  }

  async runOffDay(cmd, agenda) {
    const car = this.resolveCar(agenda, cmd.refs);
    if (!car) return { text: this.askCarText("marcar el día libre") };
    const line = await this.doOff(car, agenda.date, cmd.reason);
    const updated = await this.getAgenda.execute();
    return { text: [line, this.markerLine(updated)].join("\n") };
  }

  async doPay(car, date, amount) {
    const value = amount || car.dailyTotal || car.rate;
    try {
      await this.addPayment.execute({ carId: car.carId, date, amount: value, note: "Registrado por WhatsApp" });
    } catch (err) {
      return `⚠️ *${car.plate}*: no pude registrar el pago (${err.message}).`;
    }
    return `✅ *${car.plate}*: pago de *${formatCOP(value)}* registrado.`;
  }

  async doOff(car, date, reason) {
    const r = OFF_REASONS.has(reason) ? reason : "otro";
    try {
      await this.toggleOffDay.execute({ carId: car.carId, date, reason: r });
    } catch (err) {
      return `⚠️ *${car.plate}*: no pude marcar el día (${err.message}).`;
    }
    return `🛠️ *${car.plate}*: marcado libre hoy (${r}).`;
  }

  // ── Check-in paso a paso ────────────────────────────────────────────────
  /** Inicia (o reinicia) la revisión carro por carro. Usable también de forma proactiva. */
  async startCheckin(phone, agendaParam) {
    const agenda = agendaParam || (await this.getAgenda.execute());
    const pending = agenda.pendingCars || [];
    if (pending.length === 0) {
      return { text: ["🏆 ¡Todo se ve gestionado hoy!", "", buildDayCloseReport(agenda)].join("\n") };
    }
    const session = {
      phone: agentKey(phone),
      date: agenda.date,
      queue: pending.map((c) => c.carId),
      index: 0,
      answers: [],
      status: "active",
    };
    if (this.sessions) await this.sessions.save(session);
    const out = await this.askCurrent(session);
    out.text = `📋 *Revisión paso a paso* — ${pending.length} carro(s) por gestionar.\n\n${out.text}`;
    return out;
  }

  /** Arranca el check-in y lo ENVÍA (usado proactivamente por el scheduler). */
  async proactiveCheckin(phone, channel = "whatsapp") {
    const out = await this.startCheckin(this.sessionKey(channel, phone));
    try {
      await this.send(phone, out, channel);
    } catch (_) {
      // WhatsApp fuera de la ventana de 24 h: cae a la plantilla UTILITY.
      await this.sendCheckinTemplate(phone, channel);
    }
    return out;
  }

  /** Envía el cierre del día y limpia la sesión (usado proactivamente). */
  async proactiveClose(phone, channel = "whatsapp") {
    const agenda = await this.getAgenda.execute();
    if (this.sessions) await this.sessions.clear(this.sessionKey(channel, phone));
    const out = { text: buildDayCloseReport(agenda) };
    try {
      await this.send(phone, out, channel);
    } catch (_) {
      await this.sendCheckinTemplate(phone, channel);
    }
    return out;
  }

  /**
   * Envía el cierre del día ANTERIOR (D-1) como mensaje aparte. Se usa
   * proactivamente en la mañana del día D: los conductores pueden pagar a
   * cualquier hora, así que cerrar el día D la misma noche interferiría con
   * pagos tardíos → el cierre de D se gestiona en la mañana de D+1.
   */
  async proactiveClosePreviousDay(phone, channel = "whatsapp", date) {
    const agenda = await this.getAgenda.execute(date ? { date } : {});
    const out = { text: buildDayCloseReport(agenda) };
    try {
      await this.send(phone, out, channel);
    } catch (_) {
      await this.sendCheckinTemplate(phone, channel);
    }
    return out;
  }

  /**
   * Insistencia de media tarde: si el check-in del mediodía quedó SIN respuesta
   * (nadie avanzó la revisión) y aún hay carros pendientes, reenvía el aviso de
   * check-in (plantilla con botones en WhatsApp; mensaje con botones en
   * Telegram). Devuelve true si se envió la insistencia.
   */
  async nagCheckin(phone, channel = "whatsapp") {
    const agenda = await this.getAgenda.execute();
    const pending = agenda.pendingCars || [];
    if (pending.length === 0) return false; // todo gestionado: no molestar
    const session = this.sessions ? await this.sessions.get(this.sessionKey(channel, phone)) : null;
    const today = session && session.date === agenda.date;
    const progressed = today && ((session.answers || []).length > 0 || session.index > 0);
    if (progressed) return false; // el admin ya está respondiendo
    await this.sendCheckinTemplate(phone, channel);
    return true;
  }

  /**
   * Envía el aviso de check-in que "abre" la conversación:
   *  - WhatsApp: plantilla UTILITY con botones (única forma de escribir fuera de
   *    la ventana de 24 h; al tocar un botón se reabre la ventana).
   *  - Telegram: mensaje normal con botones inline (no hay ventana ni plantillas).
   */
  async sendCheckinTemplate(phone, channel = "whatsapp") {
    const agenda = await this.getAgenda.execute();
    const n = (agenda.pendingCars || []).length;
    if (channel === "telegram") {
      if (!this.sendTelegram) return null;
      return this.sendTelegram.execute({
        kind: "buttons",
        to: phone,
        text: `📋 *W Drivers* — Actualización de tu cuenta: hoy quedan *${n}* vehículo(s) con el pago pendiente de registrar.`,
        buttons: CHECKIN_BUTTONS.map((b) => ({ id: b.id, title: b.title })),
      });
    }
    return this.sendWhatsApp.execute({
      kind: "template",
      to: phone,
      template: {
        name: this.checkinTemplate,
        components: [{ type: "body", parameters: [{ type: "text", text: String(n) }] }],
      },
    });
  }

  /** Traduce el token de un botón (interactivo o de plantilla) a una acción. */
  async handleAction(phone, action, session) {
    if (/^(pay|off|ok):(.+)$/.test(String(action || ""))) {
      return this.handleButton(phone, action, session);
    }
    const flat = String(action || "").trim().toUpperCase().replace(/[\s_-]/g, "");
    if (flat === "CHECKIN" || flat === "REVISAR" || flat === "REVISARAHORA" || flat === "INICIAR" || flat.includes("REVISAR")) {
      return this.startCheckin(phone);
    }
    if (flat === "CLOSE" || flat === "CIERRE" || flat === "VERCIERRE" || flat.includes("CIERRE")) {
      return { text: buildDayCloseReport(await this.getAgenda.execute()) };
    }
    if (flat === "HELP" || flat === "AYUDA" || flat.includes("AYUDA")) {
      return { text: this.helpText() };
    }
    return this.handleCommand(parseCommand(action), phone, session);
  }

  /** Aplica la acción recibida por botón y avanza al siguiente carro. */
  async handleButton(phone, action, session) {
    const m = /^(pay|off|ok):(.+)$/.exec(String(action || ""));
    if (!m) return { text: this.helpText() };
    const verb = m[1];
    const carId = m[2];

    if (!session || session.status !== "active") {
      return { text: "ℹ️ No hay una revisión activa. Escribe *revisar* para iniciarla." };
    }

    const agenda = await this.getAgenda.execute();
    // La sesión debe ser del día actual: un botón viejo (de ayer) no debe
    // actuar sobre la agenda de hoy. Se descarta la sesión obsoleta.
    if (session.date && session.date !== agenda.date) {
      if (this.sessions) await this.sessions.clear(session.phone);
      return { text: "ℹ️ Esa revisión es de otro día. Escribe *revisar* para iniciar la de hoy." };
    }
    const car = this.findCar(agenda, carId);
    if (!car) return this.advance(session, agenda, "");

    let line;
    if (verb === "pay") line = await this.doPay(car, agenda.date);
    else if (verb === "off") line = await this.doOff(car, agenda.date, "taller");
    else line = `➖ *${car.plate}*: sin novedad.`;

    const answers = [...(session.answers || []), { carId, action: verb, at: new Date() }];

    // Si responde por otro carro de la lista, no avanza el paso actual.
    if (carId !== session.queue[session.index]) {
      const next = { ...session, answers };
      if (this.sessions) await this.sessions.save(next);
      const out = await this.askCurrent(next);
      out.text = `${line}\n\n${out.text}`;
      return out;
    }

    return this.advance({ ...session, answers }, agenda, line);
  }

  /** Interpreta un mensaje de texto libre como respuesta del carro actual. */
  async answerCurrent(session, cmd, agenda) {
    const carId = session.queue[session.index];
    if (!carId) return this.finishCheckin(session, "");
    let verb = "ok";
    if (cmd.intent === INTENT.OFFDAY) verb = "off";
    else if (cmd.intent === INTENT.PAYMENT || PAY_WORDS.test(cmd.raw)) verb = "pay";
    void agenda;
    return this.handleButton(session.phone, `${verb}:${carId}`, session);
  }

  /** Avanza el índice y pregunta el siguiente carro; si terminó, cierra el día. */
  async advance(session, agenda, line) {
    const index = session.index + 1;
    const updated = { ...session, index };
    if (index >= session.queue.length) return this.finishCheckin(updated, line);
    if (this.sessions) await this.sessions.save(updated);
    const out = await this.askCurrent(updated, agenda);
    if (line) out.text = `${line}\n\n${out.text}`;
    return out;
  }

  /** Pregunta el carro actual con botones (Ya pagó / En taller / Sin novedad). */
  async askCurrent(session, agendaParam) {
    const agenda = agendaParam || (await this.getAgenda.execute());
    const carId = session.queue[session.index];
    const car = this.findCar(agenda, carId);
    if (!car) return this.finishCheckin(session, "");

    const n = session.index + 1;
    const total = session.queue.length;
    const text = [
      `🚗 *${n}/${total}* · *${car.plate}*${car.name ? ` — ${car.name}` : ""}`,
      car.driverName ? `Conductor: ${car.driverName}` : "Sin conductor asignado",
      `Debe ${formatCOP(car.debt)}${car.daysBehind >= 2 ? ` · ${car.daysBehind} días atrasado` : ""}`,
      "¿Ya pagó hoy?",
    ].join("\n");

    return {
      text,
      footer: "También puedes escribir la placa o un monto.",
      buttons: BUTTONS.map((b) => ({ id: `${b.verb}:${car.carId}`, title: b.title })),
    };
  }

  /** Cierra la revisión: limpia la sesión y envía el reporte del día. */
  async finishCheckin(session, line) {
    if (this.sessions) await this.sessions.clear(session.phone);
    const agenda = await this.getAgenda.execute();
    const head = line ? `${line}\n\n` : "";
    return { text: head + buildDayCloseReport(agenda) };
  }

  // ── Resolución de carro ────────────────────────────────────────────────
  findCar(agenda, carId) {
    if (!carId) return null;
    return (agenda.checklist || []).find((i) => i.carId === carId)
      || (agenda.pendingCars || []).find((i) => i.carId === carId)
      || null;
  }

  resolveCar(agenda, refs = []) {
    const byPlate = new Map(agenda.checklist.map((i) => [normalizePlate(i.plate), i]));
    for (const ref of refs) {
      if (ref.kind === "plate") {
        const hit = byPlate.get(ref.value);
        if (hit) return hit;
      }
    }
    for (const ref of refs) {
      if (ref.kind === "index") {
        const pending = agenda.pendingCars;
        if (ref.value >= 1 && ref.value <= pending.length) return pending[ref.value - 1];
      }
    }
    return null;
  }

  // ── Textos ──────────────────────────────────────────────────────────────
  markerLine(agenda) {
    const s = agenda.summary || {};
    return `📌 Marcador del día: *${s.coveredCount || 0}/${s.fleetTotal || 0}* carros`;
  }

  askCarText(action) {
    return [
      `🤔 ¿Para qué carro quieres ${action}?`,
      "Mándame la placa (ej. *ABC123*) o el número de la lista de *pendientes*.",
      "_Escribe *pendientes* para ver la lista numerada._",
    ].join("\n");
  }

  carText(car) {
    return [
      `🚗 *${car.plate}*${car.name ? ` — ${car.name}` : ""}`,
      car.driverName ? `Conductor: ${car.driverName}` : "Sin conductor asignado hoy",
      `Deuda: ${formatCOP(car.debt)}`,
      `Pagado hoy: ${formatCOP(car.paidToday)}`,
      `Estado: ${car.covered ? "gestionado ✅" : "pendiente ⚠️"}`,
    ].join("\n");
  }

  pendingText(agenda) {
    const pending = agenda.pendingCars || [];
    if (pending.length === 0) return "🎉 *¡Flota completa!* No falta ningún carro por gestionar hoy.";
    const lines = pending.map((c, i) =>
      `${i + 1}. *${c.plate}*${c.name ? ` — ${c.name}` : ""} — debe ${formatCOP(c.debt)}`
    );
    return [`📋 *Pendientes de hoy (${pending.length})*`, ...lines].join("\n");
  }

  statusText(agenda) {
    const s = agenda.summary || {};
    const f = agenda.forecast;
    const lines = [
      `📊 *Estado del día* — ${agenda.date}`,
      `Marcador: *${s.coveredCount || 0}/${s.fleetTotal || 0}* carros gestionados`,
      `Por cobrar: ${formatCOP(s.collectTodayAmount)} en ${s.pendingCarsCount || 0} carros`,
    ];
    if (f) {
      lines.push(
        `💰 Predicción: *${f.probability}%* (${STATUS_LABEL[f.status] || f.status})`,
        `Meta ${formatCOP(f.target)} · llevas ${formatCOP(f.collected)}`
      );
    }
    if (s.nequiPendingCount) {
      lines.push(`🏦 Nequi por conciliar: ${s.nequiPendingCount} (${formatCOP(s.nequiPendingAmount)})`);
    }
    return lines.join("\n");
  }

  helpText() {
    return [
      "🤖 *Asistente W Drivers*",
      "Escríbeme así:",
      "• revisar — revisión paso a paso, carro por carro",
      "• cierre — resumen completo del día",
      "• ABC123 pagó 90000 — registra un pago",
      "• 3 ya pagó — pago del carro #3 de la lista",
      "• ABC123 taller — marca el carro libre hoy",
      "• estado — resumen y predicción del día",
      "• pendientes — lista numerada de lo que falta",
      "• ABC123 — detalle de un carro",
      "",
      "Puedes usar la *placa* o el *número* de la lista de pendientes.",
    ].join("\n");
  }
}
