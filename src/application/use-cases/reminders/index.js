const cop = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n) || 0);

const MOMENTS = ["morning", "evening"];

/**
 * Motor de Recordatorios.
 * A partir del Centro de Gestión del Día (agenda), produce la lista de avisos
 * accionables para un momento dado (mañana/tarde) y el texto listo para WhatsApp.
 * Es agnóstico del canal: el scheduler lo reutiliza para correo y push.
 */
export class GetRemindersUseCase {
  constructor({ agendaUseCase, settingsRepository }) {
    this.agenda = agendaUseCase;
    this.settings = settingsRepository;
  }

  async execute({ date, moment } = {}) {
    const m = MOMENTS.includes(moment) ? moment : "morning";
    const agenda = await this.agenda.execute({ date });
    const s = agenda.summary;
    const unregistered = agenda.collectToday.filter((i) => i.paidToday <= 0);
    const total = s.fleetTotal || 0;
    const covered = s.coveredCount || 0;
    const pending = agenda.pendingCars || [];
    const label = (i) => `${i.plate}${i.driverName ? ` (${i.driverName})` : " (sin conductor)"}`;

    const reminders = [];
    const add = (r) => reminders.push(r);

    // Marcador 12/12 — progreso de la gestión del día carro por carro.
    if (total > 0) {
      add({
        id: "checklist", kind: "checklist",
        level: pending.length === 0 ? "ok" : (m === "evening" ? "critical" : "warn"),
        icon: pending.length === 0 ? "🏆" : "📋",
        title: `Gestión del día: ${covered}/${total}`,
        body: pending.length === 0
          ? "Todos los carros gestionados. ¡Flota en orden!"
          : `Faltan ${pending.length}: ${pending.slice(0, 6).map(label).join(", ")}${pending.length > 6 ? "…" : ""}`,
      });
    }

    if (s.overdueCount > 0) {
      add({
        id: "overdue", kind: "overdue", level: "critical", icon: "🚨",
        title: `${s.overdueCount} carro(s) atrasado(s)`,
        body: `Deben ${cop(s.overdueAmount)} en total. Prioriza el cobro.`,
      });
    }

    if (m === "evening" && pending.length > 0) {
      // Cierre agresivo: cada carro sin gestionar el día se reclama por nombre.
      pending.slice(0, 8).forEach((i) => {
        add({
          id: `pending-${i.carId}`, kind: "pending", level: "critical", icon: "⛔",
          title: `${i.plate} sin gestionar`,
          body: i.offToday
            ? "Libre hoy pero sin marcar/registrar."
            : `${i.driverName || "Sin conductor"} · debe ${cop(i.debt)}${i.daysBehind >= 2 ? ` · ${i.daysBehind} días atrasado` : ""}.`,
          carId: i.carId,
        });
      });
    } else if (m === "morning" && s.collectTodayCount > 0) {
      add({
        id: "collect", kind: "collect", level: "warn", icon: "🎯",
        title: `Cobrar hoy a ${s.collectTodayCount} carro(s)`,
        body: `Total por cobrar: ${cop(s.collectTodayAmount)}.`,
      });
    } else if (m === "evening" && unregistered.length > 0) {
      add({
        id: "unregistered", kind: "unregistered", level: "warn", icon: "📝",
        title: `Falta registrar el pago de ${unregistered.length} carro(s)`,
        body: unregistered.slice(0, 5).map((i) => i.plate).join(", ") + (unregistered.length > 5 ? "…" : ""),
      });
    }

    if (s.refinanceCount > 0) {
      add({
        id: "refinance", kind: "refinance", level: "info", icon: "🔁",
        title: `${s.refinanceCount} refinanciación(es) activa(s)`,
        body: `Saldo total del plan: ${cop(s.refinanceRemaining)}.`,
      });
    }

    if (s.docsAlertCount > 0) {
      add({
        id: "docs", kind: "docs", level: s.docsExpiredCount > 0 ? "critical" : "urgent", icon: "📄",
        title: `${s.docsAlertCount} documento(s) por vencer`,
        body: s.docsExpiredCount > 0 ? `${s.docsExpiredCount} ya vencido(s).` : "Vencen en 30 días o menos.",
      });
    }

    if (s.nequiPendingCount > 0) {
      add({
        id: "nequi", kind: "nequi", level: "warn", icon: "🏦",
        title: `${s.nequiPendingCount} pago(s) Nequi por conciliar`,
        body: `Monto detectado: ${cop(s.nequiPendingAmount)}.`,
      });
    }

    if (reminders.length === 0) {
      add({ id: "ok", kind: "ok", level: "ok", icon: "✅", title: "Todo al día", body: "No hay pendientes urgentes." });
    }

    const counts = {
      collect: s.collectTodayCount,
      overdue: s.overdueCount,
      unregistered: m === "evening" ? unregistered.length : 0,
      refinances: s.refinanceCount,
      docs: s.docsAlertCount,
      nequi: s.nequiPendingCount,
      fleetTotal: total,
      covered,
      pending: pending.length,
    };

    return {
      date: agenda.date,
      moment: m,
      generatedAt: new Date().toISOString(),
      counts,
      reminders,
      whatsappText: this.buildWhatsAppText(agenda, m),
    };
  }

  buildWhatsAppText(agenda, m) {
    const s = agenda.summary;
    const [y, mo, d] = agenda.date.split("-");
    const dl = `${d}/${mo}/${y}`;
    const total = s.fleetTotal || 0;
    const covered = s.coveredCount || 0;
    const pending = agenda.pendingCars || [];
    let t = "";
    if (m === "morning") {
      t += `🌅 *W Drivers — Buenos días ${dl}*\n\n`;
      t += `📋 Gestión del día: ${covered}/${total}\n`;
      t += `🎯 Cobrar hoy: ${s.collectTodayCount} carro(s) — ${cop(s.collectTodayAmount)}\n`;
    } else {
      t += `🌙 *W Drivers — Cierre ${dl}*\n\n`;
      t += `📋 Gestión del día: ${covered}/${total}${pending.length === 0 ? " ✅" : ` — faltan ${pending.length}`}\n`;
      if (pending.length > 0) {
        t += pending.slice(0, 8).map((i) => `⛔ ${i.plate}${i.driverName ? ` (${i.driverName})` : ""}`).join("\n");
        t += "\n";
      }
    }
    if (s.overdueCount > 0) t += `🚨 Atrasados: ${s.overdueCount} — ${cop(s.overdueAmount)}\n`;
    if (s.docsAlertCount > 0) t += `📄 Docs por vencer: ${s.docsAlertCount} (${s.docsExpiredCount} vencidos)\n`;
    if (s.nequiPendingCount > 0) t += `🏦 Nequi por conciliar: ${s.nequiPendingCount} — ${cop(s.nequiPendingAmount)}\n`;
    if (s.refinanceCount > 0) t += `🔁 Refinanciaciones: ${s.refinanceCount} — ${cop(s.refinanceRemaining)}\n`;
    t += `\nDeuda total flota: ${cop(s.fleetDebt)}\n_W Drivers_`;
    return t;
  }
}
