// Programador simple para sincronizar los correos de Nequi cada cierto tiempo.
// Mantiene una única ejecución en curso (evita solapamientos).
export function startNequiSync({ useCase, everyMs, log = console, initialDelayMs = 5000 } = {}) {
  if (!useCase || !(everyMs > 0)) return () => {};

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await useCase.execute();
      if (r && r.ok && r.created > 0) {
        log.log(`[Nequi] ${r.created} pago(s) pendiente(s) nuevo(s) (correos escaneados: ${r.scanned})`);
      }
    } catch (err) {
      log.error("[Nequi] Error sincronizando correos:", err?.message || err);
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
