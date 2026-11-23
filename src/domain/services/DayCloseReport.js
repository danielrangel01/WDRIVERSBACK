import { formatCOP } from "./AgentCommand.js";

/**
 * Servicio de dominio PURO: arma el texto del "cierre del día" a partir del
 * Centro de Gestión del Día (agenda). Sin DB → testeable y determinista.
 */

const dmy = (date) => {
  const [y, m, d] = String(date || "").split("-");
  return `${d}/${m}/${y}`;
};

const cop = (n) => formatCOP(n);

function carLine(c) {
  const quien = c.name ? ` (${c.name})` : c.driverName ? ` (${c.driverName})` : "";
  if (c.offToday) return `${c.plate}${quien} — libre hoy`;
  if (c.paidToday > 0) return `${c.plate}${quien} — pagó ${cop(c.paidToday)}`;
  if (c.debt <= 0) return `${c.plate}${quien} — al día`;
  return `${c.plate}${quien} — debe ${cop(c.debt)}`;
}

export function buildDayCloseReport(agenda) {
  const s = (agenda && agenda.summary) || {};
  const f = agenda && agenda.forecast;
  const checklist = (agenda && agenda.checklist) || [];
  const pending = (agenda && agenda.pendingCars) || [];
  const covered = checklist.filter((c) => c.covered);
  const offDays = checklist.filter((c) => c.offToday);

  const lines = [];
  lines.push(`🌙 *Cierre del día — ${dmy(agenda && agenda.date)}*`);
  lines.push("");
  lines.push(`📋 Gestión: *${s.coveredCount || 0}/${s.fleetTotal || 0}* carros${pending.length === 0 ? " ✅" : ` — faltan ${pending.length}`}`);
  if (f) lines.push(`💰 Recaudo: ${cop(f.collected)} de ${cop(f.target)} (${f.probability}%)`);
  lines.push(`🏦 Deuda total flota: ${cop(s.fleetDebt)}`);

  if (covered.length) {
    lines.push("");
    lines.push("✅ *Gestionados hoy*");
    covered.forEach((c) => lines.push(`• ${carLine(c)}`));
  }

  if (pending.length) {
    lines.push("");
    lines.push("⛔ *Sin gestionar*");
    pending.forEach((c) => lines.push(`• ${carLine(c)}`));
  }

  if (offDays.length) {
    lines.push("");
    lines.push("🛠️ *Novedades (día libre)*");
    offDays.forEach((c) => lines.push(`• ${c.plate}${c.name ? ` — ${c.name}` : ""}`));
  }

  const extras = [];
  if (s.overdueCount > 0) extras.push(`🚨 Atrasados: ${s.overdueCount} — ${cop(s.overdueAmount)}`);
  if (s.refinanceCount > 0) extras.push(`🔁 Refinanciaciones: ${s.refinanceCount} — ${cop(s.refinanceRemaining)}`);
  if (s.docsAlertCount > 0) extras.push(`📄 Docs por vencer: ${s.docsAlertCount} (${s.docsExpiredCount || 0} vencidos)`);
  if (s.nequiPendingCount > 0) extras.push(`🏦 Nequi por conciliar: ${s.nequiPendingCount} — ${cop(s.nequiPendingAmount)}`);
  if (extras.length) {
    lines.push("");
    lines.push(...extras);
  }

  lines.push("");
  lines.push("_W Drivers_");
  return lines.join("\n");
}
