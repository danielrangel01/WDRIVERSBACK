import {
  INTENT, parseCommand, normalizePlate, formatCOP, samePhone, payerLabel,
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

// Menú de opciones iniciales: se adjunta a los avisos del bot para que el
// administrador vea qué puede hacer sin tener que aprenderse los comandos.
// El id de cada botón coincide con una intención del parser (AgentCommand).
// Telegram admite hasta 6 botones inline; WhatsApp solo 3 (y únicamente dentro
// de la ventana de 24 h), por eso el menú se recorta por canal.
const MENU_BUTTONS = [
  { id: "CHECKIN", title: "📋 Revisar" },
  { id: "STATUS", title: "📊 Estado" },
  { id: "PENDING", title: "⏳ Pendientes" },
  { id: "CLOSURES", title: "🗂️ Cierres" },
  { id: "HELP", title: "❓ Ayuda" },
];
const MENU_MAX = { whatsapp: 3, telegram: 6 };
const MENU_FOOTER = "Escribe *ayuda* para el detalle de cada comando.";

// Texto libre interpretado como respuesta durante el check-in.
const PAY_WORDS = /\b(si|ya|listo|ok|pago|pagado|abono|consign|transfer|deposit)\b/;
// Respuesta que significa "sin novedad" en el check-in (equivale al botón).
const OK_WORDS = /\b(sin novedad|novedad|nada|ninguna|ninguno|normal|todo bien|limpio)\b/;

// Normaliza la clave de sesión (dígitos WhatsApp; "tg:<id>" Telegram).
const agentKey = (v) => String(v || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "");

// dd/mm/aaaa a partir de "aaaa-mm-dd".
const dmy = (iso) => {
  const [y, m, d] = String(iso || "").split("-");
  return d ? `${d}/${m}/${y}` : String(iso || "");
};

// Suma (o resta) días a una fecha "aaaa-mm-dd" (aritmética sobre el string).
const addDays = (iso, delta) => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
};

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
  constructor({ getAgenda, getSettings, addPayment, toggleOffDay, sendWhatsApp, sendTelegram, agentSessionRepository, listPendingPayments, approvePendingPayment, dismissPendingPayment, checkinTemplate, telegramChatId, closureLookbackDays } = {}) {
    this.getAgenda = getAgenda;
    this.getSettings = getSettings;
    this.addPayment = addPayment;
    this.toggleOffDay = toggleOffDay;
    this.sendWhatsApp = sendWhatsApp;
    this.sendTelegram = sendTelegram;
    this.sessions = agentSessionRepository;
    // Conciliación de pagos Nequi desde el chat (botones del aviso).
    this.listPendingPayments = listPendingPayments;
    this.approvePendingPayment = approvePendingPayment;
    this.dismissPendingPayment = dismissPendingPayment;
    this.checkinTemplate = checkinTemplate || "wdrivers_checkin_util";
    // Respaldo del chat id del admin (si no está en Ajustes).
    this.telegramChatId = telegramChatId || "";
    // Cuántos días atrás se buscan cierres pendientes/incompletos.
    this.closureLookbackDays = Number(closureLookbackDays) > 0 ? Number(closureLookbackDays) : 30;
  }

  /** Clave de sesión por canal (evita colisiones entre WhatsApp y Telegram). */
  sessionKey(channel, from) {
    const digits = String(from || "").replace(/\D/g, "");
    return channel === "telegram" ? `tg:${digits}` : digits;
  }

  /** Botones del menú de opciones para el canal (Telegram 6, WhatsApp 3). */
  menuButtons(channel = "whatsapp") {
    const max = MENU_MAX[channel] || MENU_MAX.whatsapp;
    return MENU_BUTTONS.slice(0, max).map((b) => ({ id: b.id, title: b.title }));
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

    // El menú de opciones solo se adjunta donde aporta: las respuestas de
    // "no entendí" se marcan con `menu` y aquí se les añaden los botones del
    // canal. Nunca se pega a cada respuesta (estado, pendientes, cierre…).
    if (out && out.menu && !(out.buttons && out.buttons.length)) {
      out = { ...out, buttons: this.menuButtons(channel), footer: MENU_FOOTER };
    }

    const reply = (out && out.text) || "";
    const canSend = channel === "telegram" ? this.sendTelegram : this.sendWhatsApp;
    let sent = false;
    if ((reply || (out && out.buttons && out.buttons.length)) && canSend) {
      try {
        await this.send(from, out, channel);
        sent = true;
      } catch (_) {
        // WhatsApp: si el mensaje con botones interactivos no pasó (p. ej. fuera
        // de la ventana de 24 h), reintenta como texto para no dejar al usuario
        // sin respuesta.
        if (channel !== "telegram" && out && out.buttons && out.buttons.length) {
          try {
            await this.sendWhatsApp.execute({ kind: "text", to: from, text: out.text });
            sent = true;
          } catch (_2) {
            sent = false;
          }
        } else {
          sent = false;
        }
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
    const todayAgenda = await this.getAgenda.execute();
    const active = session && session.status === "active";
    const selecting = session && session.status === "closures";
    // El mensaje puede ser la respuesta (placa o número) de una conciliación
    // Nequi en curso: en ese caso se asigna el pago al carro elegido.
    if (session && session.status === "nequi" && this.isNequiReply(cmd)) {
      return this.pickNequiCar(session, cmd, todayAgenda);
    }
    // Durante una revisión activa (de hoy o de una fecha anterior elegida) las
    // acciones aplican al día de la SESIÓN, no necesariamente a hoy.
    const sessionAgenda = active ? await this.agendaFor(session) : todayAgenda;

    switch (cmd.intent) {
      case INTENT.HELP:
        return { text: this.helpText() };
      case INTENT.STATUS:
        return { text: this.statusText(todayAgenda) };
      case INTENT.PENDING:
        return { text: this.pendingText(todayAgenda) };
      case INTENT.CHECKIN:
        return this.startCheckin(phone, todayAgenda);
      case INTENT.CLOSURES:
        return this.startClosures(phone, todayAgenda);
      case INTENT.CLOSE:
        return { text: buildDayCloseReport(todayAgenda) };
      case INTENT.PAYMENT:
      case INTENT.OFFDAY: {
        // Dentro de un check-in y sin carro explícito → aplica al carro actual.
        if (active && cmd.refs.length === 0) return this.answerCurrent(session, cmd, sessionAgenda);
        return cmd.intent === INTENT.PAYMENT
          ? this.runPayment(cmd, sessionAgenda)
          : this.runOffDay(cmd, sessionAgenda);
      }
      default: {
        // Elegir un día de la lista de cierres pendientes (responder con número).
        if (selecting) {
          const picked = await this.pickClosure(session, cmd);
          if (picked) return picked;
          return { text: "🗂️ Responde con el *número* del día que quieres gestionar, o escribe *cierres* para ver la lista." };
        }
        if (active && cmd.refs.length === 0) return this.answerCurrent(session, cmd, sessionAgenda);
        const car = this.resolveCar(sessionAgenda, cmd.refs);
        return car ? { text: this.carText(car) } : this.notUnderstood();
      }
    }
  }

  /** Agenda de la fecha de la sesión (o de hoy si no hay sesión). */
  async agendaFor(session) {
    const date = session && session.date;
    return date ? this.getAgenda.execute({ date }) : this.getAgenda.execute();
  }

  // ── Cierres pendientes ──────────────────────────────────────────────────
  /**
   * Lista los cierres pendientes/incompletos: días recientes (dentro de la
   * ventana configurada) que quedaron con carros sin gestionar. Guarda una
   * sesión de selección para poder elegir el día por número.
   */
  async startClosures(phone, todayAgenda) {
    const today = todayAgenda.date;
    const dates = [];
    for (let i = 1; i <= this.closureLookbackDays; i += 1) dates.push(addDays(today, -i));
    const agendas = await Promise.all(dates.map((d) => this.getAgenda.execute({ date: d })));
    const items = agendas
      .filter((a) => (a.pendingCars || []).length > 0)
      .map((a) => ({
        date: a.date,
        pending: (a.pendingCars || []).length,
        amount: (a.summary && a.summary.collectTodayAmount) || 0,
      }));

    if (items.length === 0) {
      if (this.sessions) await this.sessions.clear(agentKey(phone));
      return { text: `✅ No hay cierres pendientes en los últimos ${this.closureLookbackDays} días. Todo está al día.` };
    }

    const session = {
      phone: agentKey(phone),
      date: today,
      queue: items.map((i) => i.date),
      index: 0,
      answers: [],
      status: "closures",
    };
    if (this.sessions) await this.sessions.save(session);

    const lines = [`🗂️ *Cierres pendientes* (últimos ${this.closureLookbackDays} días)`, ""];
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${dmy(it.date)} — ${it.pending} sin gestionar · ${formatCOP(it.amount)}`);
    });
    lines.push("", "Responde con el *número* del día que quieres gestionar.");
    lines.push("_Escribe *revisar* para gestionar el día de hoy._");
    return { text: lines.join("\n") };
  }

  /** Arranca la revisión de un día elegido de la lista de cierres pendientes. */
  async pickClosure(session, cmd) {
    const ref = (cmd.refs || []).find((r) => r.kind === "index");
    if (!ref) return null;
    const date = (session.queue || [])[ref.value - 1];
    if (!date) {
      return { text: `⚠️ No hay un día con el número *${ref.value}*. Escribe *cierres* para ver la lista.` };
    }
    return this.startCheckin(session.phone, await this.getAgenda.execute({ date }));
  }

  // ── Acciones puntuales ──────────────────────────────────────────────────
  async runPayment(cmd, agenda) {
    const car = this.resolveCar(agenda, cmd.refs);
    if (!car) return { text: this.askCarText("registrar el pago") };
    const line = await this.doPay(car, agenda.date, cmd.amount);
    const updated = await this.getAgenda.execute({ date: agenda.date });
    return { text: [line, this.markerLine(updated)].join("\n") };
  }

  async runOffDay(cmd, agenda) {
    const car = this.resolveCar(agenda, cmd.refs);
    if (!car) return { text: this.askCarText("marcar el día libre") };
    const line = await this.doOff(car, agenda.date, cmd.reason);
    const updated = await this.getAgenda.execute({ date: agenda.date });
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
      return { text: [`🏆 ¡Todo se ve gestionado! (${dmy(agenda.date)})`, "", buildDayCloseReport(agenda)].join("\n") };
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
    const out = await this.askCurrent(session, agenda);
    out.text = `📋 *Revisión paso a paso* — ${dmy(agenda.date)}\n${pending.length} carro(s) por gestionar.\n\n${out.text}`;
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
    const out = this.closeNotice(agenda, channel);
    try {
      await this.send(phone, out, channel);
    } catch (_) {
      await this.sendCheckinTemplate(phone, channel);
    }
    return out;
  }

  /**
   * Mensaje de cierre + menú de opciones. Telegram no tiene ventana de 24 h ni
   * plantillas → siempre lleva botones inline. WhatsApp depende de la ventana:
   * fuera de ella Meta rechaza los botones interactivos, así que se manda el
   * cierre como texto (y si ni el texto pasa, el llamador cae a la plantilla).
   */
  closeNotice(agenda, channel = "whatsapp") {
    const text = buildDayCloseReport(agenda);
    return channel === "telegram"
      ? { text, buttons: this.menuButtons("telegram"), footer: MENU_FOOTER }
      : { text };
  }

  /**
   * Envía el cierre del día ANTERIOR (D-1) como mensaje aparte. Se usa
   * proactivamente en la mañana del día D: los conductores pueden pagar a
   * cualquier hora, así que cerrar el día D la misma noche interferiría con
   * pagos tardíos → el cierre de D se gestiona en la mañana de D+1.
   */
  async proactiveClosePreviousDay(phone, channel = "whatsapp", date) {
    const agenda = await this.getAgenda.execute(date ? { date } : {});
    const out = this.closeNotice(agenda, channel);
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
        buttons: this.menuButtons("telegram"),
        footer: MENU_FOOTER,
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

  /** Traduce el token de un botón (interactivo, de menú o de plantilla) a una acción. */
  async handleAction(phone, action, session) {
    const raw = String(action || "");
    // Botones del aviso de pagos Nequi (✅ conciliar / 🚫 descartar).
    const nequi = await this.handleNequiAction(phone, raw);
    if (nequi) return nequi;
    if (/^(pay|off|ok):(.+)$/.test(raw)) {
      return this.handleButton(phone, raw, session);
    }
    // Aplana el texto del botón ("📋 Revisar" → "REVISAR") para enrutarlo por su
    // intención. El orden importa: *cierres pendientes* antes que *cierre*.
    const flat = raw.trim().toUpperCase().replace(/[\s_-]/g, "");
    if (/REVISAR|CHECKIN|INICIAR/.test(flat)) return this.startCheckin(phone);
    if (/CIERRES|CLOSURES/.test(flat)) return this.startClosures(phone, await this.getAgenda.execute());
    if (/CIERRE|CLOSE/.test(flat)) return { text: buildDayCloseReport(await this.getAgenda.execute()) };
    if (/ESTADO|STATUS|RESUMEN/.test(flat)) return { text: this.statusText(await this.getAgenda.execute()) };
    if (/PENDIENTE|PENDING/.test(flat)) return { text: this.pendingText(await this.getAgenda.execute()) };
    if (/AYUDA|HELP/.test(flat)) return { text: this.helpText() };
    return this.handleCommand(parseCommand(raw), phone, session);
  }

  /** Aplica la acción recibida por botón y avanza al siguiente carro. */
  async handleButton(phone, action, session) {
    const m = /^(pay|off|ok):(.+)$/.exec(String(action || ""));
    if (!m) return this.notUnderstood();
    const verb = m[1];
    const carId = m[2];

    if (!session || session.status !== "active") {
      return { text: "ℹ️ No hay una revisión activa. Escribe *revisar* para iniciarla." };
    }

    // La acción aplica al día de la sesión (hoy, o la fecha anterior elegida
    // desde *cierres*). Así un botón de una revisión antigua afecta a SU día.
    const agenda = await this.agendaFor(session);
    const car = this.findCar(agenda, carId);
    if (!car) {
      // Botón de un carro que no está en la agenda de la sesión (p. ej. de otra
      // revisión): no se avanza por error; se re-pregunta el carro actual.
      const out = await this.askCurrent(session, agenda);
      out.text = `ℹ️ Ese botón no aplica a esta revisión.\n\n${out.text}`;
      return out;
    }

    // Anti-duplicados: si este carro ya se respondió igual en esta revisión
    // (p. ej. un doble toque del botón), no se repite la acción → no duplica
    // pagos ni alterna el día libre. Solo se re-pregunta el carro actual.
    const repeated = (session.answers || []).some((a) => a.carId === carId && a.action === verb);
    if (repeated) {
      const out = await this.askCurrent(session, agenda);
      out.text = `ℹ️ *${car.plate}*: esa respuesta ya quedó registrada.\n\n${out.text}`;
      return out;
    }

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
    let verb = "";
    if (cmd.intent === INTENT.OFFDAY) verb = "off";
    else if (cmd.intent === INTENT.PAYMENT || PAY_WORDS.test(cmd.raw)) verb = "pay";
    else if (OK_WORDS.test(cmd.raw)) verb = "ok";
    if (!verb) {
      // Mensaje no reconocido: se re-pregunta el MISMO carro SIN avanzar, para
      // no saltarse un carro por un texto que el bot no entendió.
      const out = await this.askCurrent(session, agenda);
      out.text = `🤔 No te entendí.\n\n${out.text}`;
      return out;
    }
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
    const agenda = agendaParam || (await this.agendaFor(session));
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
    const agenda = await this.agendaFor(session);
    const head = line ? `${line}\n\n` : "";
    return { text: head + buildDayCloseReport(agenda) };
  }

  // ── Conciliación de pagos Nequi ─────────────────────────────────────────
  /**
   * Atiende los botones del aviso de pagos Nequi. `nq:ok:<id>` concilia el pago
   * (asignándolo al carro cuyo conductor coincide con quien pagó; si no hay
   * coincidencia, pregunta a qué carro) y `nq:no:<id>` lo descarta.
   * Devuelve null cuando la acción no es de Nequi.
   */
  async handleNequiAction(phone, action) {
    const m = /^nq:(ok|no):([0-9a-fA-F]{24})$/.exec(String(action || ""));
    if (!m) return null;
    const [, verb, id] = m;

    if (verb === "no") {
      if (!this.dismissPendingPayment) return { text: "⚠️ No puedo descartar pagos ahora mismo." };
      try {
        await this.dismissPendingPayment.execute({ id });
      } catch (err) {
        return { text: `⚠️ No pude descartar el pago (${err.message}).` };
      }
      return { text: "🚫 Pago descartado. No se registró nada." };
    }

    const pending = await this.findPending(id);
    if (!pending) return { text: "ℹ️ Ese pago ya no está pendiente de conciliar." };

    const agenda = await this.getAgenda.execute();
    const car = this.matchCarByPayer(pending.payerName, agenda);
    if (car) {
      if (this.sessions) await this.sessions.clear(agentKey(phone));
      return { text: await this.approveNequi(pending, car) };
    }
    return this.startNequiConciliation(phone, pending, agenda);
  }

  /** Busca un pago pendiente por id (solo devuelve los que siguen "pending"). */
  async findPending(id) {
    if (!this.listPendingPayments) return null;
    const list = await this.listPendingPayments.execute({ status: "pending" });
    return (list || []).find((p) => p.id === id) || null;
  }

  /** Registra el pago real asignado al carro. Devuelve el texto de respuesta. */
  async approveNequi(pending, car) {
    if (!this.approvePendingPayment) return "⚠️ No puedo conciliar pagos ahora mismo.";
    try {
      await this.approvePendingPayment.execute({
        id: pending.id, carId: car.carId, date: pending.detectedDate,
      });
    } catch (err) {
      return `⚠️ No pude conciliar el pago (${err.message}).`;
    }
    return `✅ *${formatCOP(pending.amount)}* de ${payerLabel(pending)} asignado a *${car.plate}* (${dmy(pending.detectedDate)}).`;
  }

  /** Guarda la sesión de conciliación y pregunta a qué carro asignar el pago. */
  async startNequiConciliation(phone, pending, agenda) {
    const session = {
      phone: agentKey(phone),
      date: pending.detectedDate,
      status: "nequi",
      pendingId: pending.id,
      queue: (agenda.checklist || []).map((c) => c.carId),
      index: 0,
      answers: [],
    };
    if (this.sessions) await this.sessions.save(session);
    return this.nequiAskText(session, pending, agenda);
  }

  /** Pregunta a qué carro asignar el pago, con la lista numerada de la flota. */
  nequiAskText(session, pending, agenda) {
    const cars = (session.queue || [])
      .map((carId) => this.findCar(agenda, carId))
      .filter(Boolean);
    const lines = cars.map((c, i) =>
      `${i + 1}. *${c.plate}*${c.driverName ? ` — ${c.driverName}` : ""}`
    );
    return {
      text: [
        `🏦 Pago Nequi de *${formatCOP(pending.amount)}* — ${payerLabel(pending)}`,
        `Fecha: ${dmy(pending.detectedDate)}`,
        "",
        "¿A qué carro lo asigno?",
        ...lines,
      ].join("\n"),
      footer: "Responde con el número o con la placa (ej. ABC123).",
    };
  }

  /** ¿El mensaje responde a una conciliación Nequi (trae placa o número)? */
  isNequiReply(cmd) {
    if (!(cmd.refs || []).length) return false;
    const ignore = [
      INTENT.HELP, INTENT.STATUS, INTENT.PENDING,
      INTENT.CHECKIN, INTENT.CLOSURES, INTENT.CLOSE,
    ];
    return !ignore.includes(cmd.intent);
  }

  /** Carro elegido por placa o por el número de la lista de la sesión. */
  resolveNequiCar(session, cmd, agenda) {
    const byPlate = new Map((agenda.checklist || []).map((i) => [normalizePlate(i.plate), i]));
    for (const ref of cmd.refs || []) {
      if (ref.kind === "plate") {
        const hit = byPlate.get(ref.value);
        if (hit) return hit;
      }
    }
    const idx = (cmd.refs || []).find((r) => r.kind === "index");
    if (idx) {
      const carId = (session.queue || [])[idx.value - 1];
      if (carId) return this.findCar(agenda, carId);
    }
    return null;
  }

  /** Asigna el pago pendiente al carro respondido; si no lo resuelve, re-pregunta. */
  async pickNequiCar(session, cmd, agenda) {
    const pending = await this.findPending(session.pendingId);
    if (!pending) {
      if (this.sessions) await this.sessions.clear(session.phone);
      return { text: "ℹ️ Ese pago ya no está pendiente de conciliar." };
    }
    const car = this.resolveNequiCar(session, cmd, agenda);
    if (!car) {
      const out = this.nequiAskText(session, pending, agenda);
      out.text = `🤔 No encontré ese carro.\n\n${out.text}`;
      return out;
    }
    if (this.sessions) await this.sessions.clear(session.phone);
    return { text: await this.approveNequi(pending, car) };
  }

  /** Tokens comparables de un nombre (sin tildes, en mayúsculas, ≥3 letras). */
  nameTokens(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 3);
  }

  /**
   * Carro cuyo conductor coincide con quien pagó. Se exige coincidencia de 2+
   * tokens y sin empate: ante la duda es mejor preguntar que asignar mal.
   */
  matchCarByPayer(payerName, agenda) {
    const payer = new Set(this.nameTokens(payerName));
    if (payer.size === 0) return null;
    let best = null;
    let bestScore = 0;
    let tie = false;
    for (const car of agenda.checklist || []) {
      const shared = this.nameTokens(car.driverName).filter((t) => payer.has(t)).length;
      if (shared === 0) continue;
      if (shared > bestScore) { best = car; bestScore = shared; tie = false; }
      else if (shared === bestScore) { tie = true; }
    }
    return bestScore >= 2 && !tie ? best : null;
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

  /**
   * Respuesta para un mensaje que el bot no entiende (saludo, texto suelto…):
   * texto corto + el menú de opciones. Se marca con `menu` y el canal añade los
   * botones en `handleIncoming` (Telegram 5, WhatsApp 3).
   */
  notUnderstood() {
    return { menu: true, text: "🤔 No entendí ese mensaje. Estas son las cosas que puedo hacer 👇" };
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
      "Toca los botones del mensaje o escríbeme. Esto hace cada comando:",
      "",
      "📋 *revisar* — revisión paso a paso, carro por carro. Te muestra cada pendiente con botones (Ya pagó / En taller / Sin novedad) y registra la respuesta.",
      "Ejemplo: _revisar_",
      "📊 *estado* — resumen del día: marcador (gestionados/total), lo que falta por cobrar y la probabilidad de cumplir la meta.",
      "Ejemplo: _estado_",
      "⏳ *pendientes* — lista numerada de los carros que aún faltan hoy.",
      "Ejemplo: _pendientes_",
      "🗂️ *cierres* — cierres pendientes: días recientes con carros sin gestionar. Eliges el día por su número y revisas ESA fecha.",
      "Ejemplo: _cierres_ y luego _1_",
      "🧾 *cierre* — reporte completo del día (marcador, totales y carros sin gestionar).",
      "Ejemplo: _cierre_",
      "💰 *pago* — registra un pago por placa o por el número de la lista de pendientes.",
      "Ejemplos: _ABC123 pagó 90000_ · _3 ya pagó_",
      "🛠️ *día libre* — marca un carro como libre (taller/descanso); ese día no paga.",
      "Ejemplo: _ABC123 taller_",
      "🚗 *detalle* — ficha de un carro: deuda, pagado hoy y estado.",
      "Ejemplo: _ABC123_",
      "🏦 *Nequi* — cuando entra plata te aviso con el nombre de quien pagó. Toca ✅ para conciliarlo (si no reconozco el carro, te lo pregunto) o 🚫 para descartarlo.",
      "",
      "Puedes usar la *placa* o el *número* de la lista de *pendientes*.",
    ].join("\n");
  }
}
