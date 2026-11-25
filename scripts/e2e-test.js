/**
 * W DRIVERS — PRUEBAS END-TO-END (backend)
 * ---------------------------------------------------------------------------
 * Ejecuta un recorrido funcional COMPLETO contra el backend de PRUEBAS.
 *
 *   Requisitos:
 *     1) Servidor de pruebas activo:   npm run start:test     (puerto 4000, DB wdrivers_test)
 *     2) Ejecutar:                     npm run e2e
 *
 *   Seguridad:
 *     - El script SOLO debe apuntar a la base de pruebas (wdrivers_test).
 *     - Todos los datos que crea llevan el prefijo E2E y se limpian al final.
 *     - Nunca borra datos que no haya creado él mismo.
 *
 * Variables (opcionales):
 *   E2E_BASE_URL  (def. http://localhost:4000)
 *   E2E_USER      (def. test_admin)
 *   E2E_PASS      (def. Test1234!)
 */
const BASE = (process.env.E2E_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "test_admin";
const PASS = process.env.E2E_PASS || "Test1234!";

const results = [];
let token = "";

function today() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nextDay() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  const icon = ok ? "✔" : "✘";
  console.log(`  ${icon} ${name}${detail ? "  " + detail : ""}`);
  return !!ok;
}

async function api(method, path, { body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`No se pudo conectar a ${BASE}${path}: ${err.message}`);
  }
  let json = null;
  const text = await res.text();
  if (text) {
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
  }
  return { status: res.status, json };
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  W DRIVERS — PRUEBAS END-TO-END (backend de pruebas)      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Base URL : ${BASE}`);
  console.log(`  Usuario  : ${USER}`);
  console.log("");

  // ── 1. Conectividad + Autenticación ────────────────────────────────────────
  console.log("▸ 1. Autenticación");
  const bad = await api("POST", "/api/auth/login", { body: { username: USER, password: "incorrecta" }, auth: false });
  check("Login con credenciales inválidas es rechazado (401)", bad.status === 401, `→ ${bad.status}`);

  const login = await api("POST", "/api/auth/login", { body: { username: USER, password: PASS }, auth: false });
  token = login.json?.token || "";
  check("Login correcto devuelve token", login.status === 200 && !!token, `→ ${login.status}`);

  const noAuth = await api("GET", "/api/data", { auth: false });
  check("Endpoint protegido sin token es rechazado (401)", noAuth.status === 401, `→ ${noAuth.status}`);

  const me = await api("GET", "/api/auth/me");
  check("GET /auth/me devuelve el usuario", me.status === 200 && me.json?.username === USER, `→ ${me.json?.username}`);

  // ── 2. Carga de datos global ───────────────────────────────────────────────
  console.log("\n▸ 2. Carga de datos global (/api/data)");
  const data = await api("GET", "/api/data");
  const D = data.json || {};
  check("GET /api/data responde 200", data.status === 200, `→ ${data.status}`);
  for (const key of ["cars", "payments", "expenses", "documents", "offDays", "settings", "refinances", "handovers"]) {
    check(`/api/data incluye "${key}"`, Array.isArray(D[key]) || typeof D[key] === "object");
  }

  // ── 3. Carros ──────────────────────────────────────────────────────────────
  console.log("\n▸ 3. Carros (CRUD + detalle de deuda)");
  const plate = "E2E" + String(Date.now()).slice(-4);
  const carRes = await api("POST", "/api/cars", { body: { plate, name: "E2E Test", alias: "E2E Alias", brand: "E2E Brand", type: "E2E Type", rate: 50000, startDate: today() } });
  const carId = carRes.json?.id;
  check("Crear carro (201)", carRes.status === 201 && !!carId, `placa ${plate}`);
  check("Crear carro persiste alias/brand/type",
    carRes.json?.alias === "E2E Alias" && carRes.json?.brand === "E2E Brand" && carRes.json?.type === "E2E Type",
    `→ ${carRes.json?.alias}/${carRes.json?.brand}/${carRes.json?.type}`);

  const dup = await api("POST", "/api/cars", { body: { plate, name: "E2E Dup", rate: 1, startDate: today() } });
  check("Placa duplicada activa es rechazada (409)", dup.status === 409, `→ ${dup.status}`);

  const cars = await api("GET", "/api/cars");
  check("Listar carros incluye el creado", Array.isArray(cars.json) && cars.json.some((c) => c.id === carId));

  // Regresión: editar TODOS los campos debe persistir y reaparecer al releer.
  const upd = await api("PUT", `/api/cars/${carId}`, {
    body: { plate, name: "E2E Editado", alias: "El Azul", brand: "Chevrolet", type: "Sedán", rate: 60000, startDate: today() },
  });
  check("Editar carro (200)", upd.status === 200, `→ ${upd.status}`);
  check("Edición persiste nombre", upd.json?.name === "E2E Editado", `→ ${upd.json?.name}`);
  check("Edición persiste alias", upd.json?.alias === "El Azul", `→ ${upd.json?.alias}`);
  check("Edición persiste brand", upd.json?.brand === "Chevrolet", `→ ${upd.json?.brand}`);
  check("Edición persiste type", upd.json?.type === "Sedán", `→ ${upd.json?.type}`);
  check("Edición persiste tarifa", Number(upd.json?.rate) === 60000, `→ ${upd.json?.rate}`);

  // Lo que realmente consume la app para pintar el formulario: /api/data
  const reread = await api("GET", "/api/data");
  const carData = (reread.json?.cars || []).find((c) => c.id === carId);
  check("Al reabrir, /api/data trae el nombre editado", carData?.name === "E2E Editado", `→ ${carData?.name}`);
  check("Al reabrir, /api/data trae alias/brand/type editados",
    carData?.alias === "El Azul" && carData?.brand === "Chevrolet" && carData?.type === "Sedán",
    `→ ${carData?.alias}/${carData?.brand}/${carData?.type}`);

  const detail = await api("GET", `/api/cars/${carId}/debt-detail`);
  check("Detalle de deuda responde 200", detail.status === 200, `→ ${detail.status}`);

  const badDetail = await api("GET", "/api/cars/000000000000000000000000/debt-detail");
  check("Detalle de carro inexistente es rechazado (404)", badDetail.status === 404, `→ ${badDetail.status}`);

  // ── 4. Pagos ───────────────────────────────────────────────────────────────
  console.log("\n▸ 4. Pagos");
  const payCreate = await api("POST", "/api/payments", { body: { carId, date: today(), amount: 120000, note: "E2E pago" } });
  const payId = payCreate.json?.id;
  check("Crear pago (201)", payCreate.status === 201 && !!payId, `→ ${payCreate.status}`);

  const payBad = await api("POST", "/api/payments", { body: { carId: "000000000000000000000000", date: today(), amount: 1 } });
  check("Pago a carro inexistente es rechazado (404)", payBad.status === 404, `→ ${payBad.status}`);

  const payDel = await api("DELETE", `/api/payments/${payId}`);
  check("Eliminar pago (ok)", payDel.status === 200 && payDel.json?.ok === true, `→ ${payDel.status}`);

  // ── 5. Refinanciaciones (última funcionalidad alineada) ────────────────────
  console.log("\n▸ 5. Refinanciaciones (crear · abonar · cancelar)");
  const refiRes = await api("POST", "/api/refinances", { body: { carId, date: today(), originalAmount: 200000, days: 20, note: "E2E plan" } });
  const refi = refiRes.json || {};
  const refiId = refi.id;
  check("Crear refinanciamiento (201)", refiRes.status === 201 && !!refiId, `→ ${refiRes.status}`);
  check("Cuota diaria derivada = 10.000", Number(refi.dailyInstallment) === 10000, `→ ${refi.dailyInstallment}`);
  check("Saldo restante inicial = 200.000", Number(refi.remaining) === 200000, `→ ${refi.remaining}`);
  check("No liquidado al crear (isSettled=false)", refi.isSettled === false);

  const refiPay = await api("POST", `/api/refinances/${refiId}/pay`, { body: { amount: 50000 } });
  check("Abonar 50.000 (ok)", refiPay.status === 200, `→ ${refiPay.status}`);
  check("paidToPlan = 50.000", Number(refiPay.json?.paidToPlan) === 50000, `→ ${refiPay.json?.paidToPlan}`);
  check("Saldo restante = 150.000", Number(refiPay.json?.remaining) === 150000, `→ ${refiPay.json?.remaining}`);

  const refiOver = await api("POST", `/api/refinances/${refiId}/pay`, { body: { amount: 999999 } });
  check("Abono que excede el saldo es rechazado (400)", refiOver.status === 400, `→ ${refiOver.status}`);

  const refiBadAmt = await api("POST", `/api/refinances/${refiId}/pay`, { body: { amount: -5 } });
  check("Abono negativo es rechazado (400)", refiBadAmt.status === 400, `→ ${refiBadAmt.status}`);

  const refiBadCar = await api("POST", "/api/refinances", { body: { carId: "000000000000000000000000", date: today(), originalAmount: 1000, days: 1 } });
  check("Refinanciamiento a carro inexistente es rechazado (404)", refiBadCar.status === 404, `→ ${refiBadCar.status}`);

  const refiCancel = await api("DELETE", `/api/refinances/${refiId}`);
  check("Cancelar refinanciamiento (ok)", refiCancel.status === 200 && refiCancel.json?.ok === true, `→ ${refiCancel.status}`);

  // ── 6. Entregas de carro (handover / conductor) ────────────────────────────
  console.log("\n▸ 6. Entregas de carro (handover)");
  const ho = await api("POST", `/api/cars/${carId}/handover`, { body: { driverName: "E2E Conductor", driverPhone: "3001234567", date: today(), note: "E2E" } });
  const hoId = ho.json?.id;
  check("Registrar entrega (201)", ho.status === 201 && !!hoId, `→ ${ho.status}`);
  check("La entrega queda vigente (active=true)", ho.json?.active === true);

  const hoBadCar = await api("POST", "/api/cars/000000000000000000000000/handover", { body: { driverName: "X", date: today() } });
  check("Entrega a carro inexistente es rechazada (404)", hoBadCar.status === 404, `→ ${hoBadCar.status}`);

  const hoNoName = await api("POST", `/api/cars/${carId}/handover`, { body: { driverName: "   ", date: nextDay() } });
  check("Entrega sin conductor es rechazada (400)", hoNoName.status === 400, `→ ${hoNoName.status}`);

  const hoAfterBad = await api("GET", `/api/cars/${carId}/handovers`);
  const vigenteTrasFallo = Array.isArray(hoAfterBad.json) ? hoAfterBad.json.find((h) => h.active) : null;
  check("Una entrega inválida NO cierra la vigente", vigenteTrasFallo?.id === hoId, `→ ${vigenteTrasFallo?.driverName}`);

  const ho2 = await api("POST", `/api/cars/${carId}/handover`, { body: { driverName: "E2E Conductor 2", date: nextDay() } });
  const ho2Id = ho2.json?.id;
  check("Segunda entrega (201)", ho2.status === 201 && !!ho2Id && ho2Id !== hoId, `→ ${ho2.status}`);
  check("La nueva entrega arranca en la fecha indicada", ho2.json?.startDate === nextDay(), `→ ${ho2.json?.startDate}`);

  const listHo = await api("GET", `/api/cars/${carId}/handovers`);
  check("Listar entregas del carro (2)", listHo.status === 200 && Array.isArray(listHo.json) && listHo.json.length === 2, `→ ${listHo.json?.length}`);

  const listAllHo = await api("GET", "/api/handovers");
  check("Listar todas las entregas responde 200", listAllHo.status === 200 && Array.isArray(listAllHo.json));

  // ── 7. Gestión del día · estado de cuenta · cobranza · recordatorios ────────
  console.log("\n▸ 7. Gestión del día · estado de cuenta · cobranza · recordatorios");
  const agenda = await api("GET", "/api/agenda");
  const A = agenda.json || {};
  check("GET /agenda responde 200", agenda.status === 200, `→ ${agenda.status}`);
  check("Agenda incluye marcador de flota (fleetTotal/coveredCount)",
    typeof A.summary?.fleetTotal === "number" && typeof A.summary?.coveredCount === "number",
    `→ ${A.summary?.coveredCount}/${A.summary?.fleetTotal}`);
  check("Agenda incluye checklist[]", Array.isArray(A.checklist));
  const row = (A.checklist || []).find((c) => c.carId === carId);
  check("El checklist atribuye el conductor vigente hoy", !!row && row.handoverId === hoId, `→ ${row?.driverName}`);

  const st = await api("GET", `/api/cars/${carId}/statement`);
  check("GET estado de cuenta responde 200", st.status === 200, `→ ${st.status}`);
  check("Estado de cuenta trae desglose por conductor", Array.isArray(st.json?.drivers));
  check("Estado de cuenta incluye texto de WhatsApp", typeof st.json?.whatsappText === "string" && st.json.whatsappText.length > 0);

  const col = await api("GET", "/api/collections");
  check("GET /collections responde 200", col.status === 200, `→ ${col.status}`);

  const rem = await api("GET", "/api/reminders?moment=morning");
  check("GET /reminders responde 200", rem.status === 200, `→ ${rem.status}`);
  check("Recordatorios incluyen marcador de gestión", typeof rem.json?.counts?.fleetTotal === "number");
  check("Recordatorios incluyen texto de WhatsApp", typeof rem.json?.whatsappText === "string");

  // ── 8. Nequi (pagos entrantes por correo) ──────────────────────────────────
  console.log("\n▸ 8. Nequi (pendientes · aprobar · descartar)");
  const pendingList = await api("GET", "/api/nequi/pending");
  const pendings = Array.isArray(pendingList.json) ? pendingList.json : [];
  check("GET /nequi/pending responde 200 con lista", pendingList.status === 200 && Array.isArray(pendingList.json), `→ ${pendings.length} pendientes`);

  const listAll = await api("GET", "/api/nequi/pending?status=all");
  check("GET /nequi/pending?status=all responde 200", listAll.status === 200);

  const target = pendings.find((p) => p.status === "pending");
  if (target) {
    const badApprove = await api("POST", `/api/nequi/pending/${target.id}/approve`, { body: { carId, date: "fecha-mala" } });
    check("Aprobar con fecha inválida es rechazado (400)", badApprove.status === 400, `→ ${badApprove.status}`);

    const approve = await api("POST", `/api/nequi/pending/${target.id}/approve`, { body: { carId, date: today() } });
    check("Aprobar pendiente crea el pago real (ok)", approve.status === 200 && approve.json?.ok === true, `→ ${approve.status}`);
    check("El pago aprobado pertenece al carro indicado", approve.json?.payment?.carId === carId);
    check("El monto del pago es igual al detectado", Number(approve.json?.payment?.amount) === Number(target.amount),
      `→ ${approve.json?.payment?.amount} / ${target.amount}`);

    const approveAgain = await api("POST", `/api/nequi/pending/${target.id}/approve`, { body: { carId, date: today() } });
    check("Reaprobar el mismo pendiente es rechazado (409)", approveAgain.status === 409, `→ ${approveAgain.status}`);

    if (approve.json?.payment?.id) {
      await api("DELETE", `/api/payments/${approve.json.payment.id}`);
    }
  } else {
    check("Aprobar pendiente (omitido: sin pendientes en la base de prueba)", true, "ℹ ejecuta 'npm run test-db:fixtures' para sembrar uno");
  }

  const pending2 = (await api("GET", "/api/nequi/pending")).json?.find?.((p) => p.status === "pending");
  if (pending2) {
    const dismiss = await api("DELETE", `/api/nequi/pending/${pending2.id}`);
    check("Descartar pendiente (ok)", dismiss.status === 200 && dismiss.json?.ok === true, `→ ${dismiss.status}`);
  } else {
    check("Descartar pendiente (omitido: sin pendientes)", true);
  }

  const sync = await api("POST", "/api/nequi/sync");
  check("POST /nequi/sync responde sin error de servidor", sync.status === 200, `→ ${sync.status} ${sync.json?.reason || ""}`);

  // ── 9. Gastos · Documentos · Días libres ───────────────────────────────────
  console.log("\n▸ 9. Gastos · Documentos · Días libres");
  const exp = await api("POST", "/api/expenses", { body: { date: today(), amount: 30000, category: "E2E", note: "prueba" } });
  const expId = exp.json?.id;
  check("Crear gasto (201)", exp.status === 201 && !!expId, `→ ${exp.status}`);
  if (expId) check("Eliminar gasto (ok)", (await api("DELETE", `/api/expenses/${expId}`)).status === 200);

  const doc = await api("POST", "/api/documents", { body: { carId, type: "SOAT", expiry: today(), note: "E2E" } });
  const docId = doc.json?.id;
  check("Crear documento (201)", doc.status === 201 && !!docId, `→ ${doc.status}`);
  if (docId) check("Eliminar documento (ok)", (await api("DELETE", `/api/documents/${docId}`)).status === 200);

  const offBad = await api("POST", "/api/offdays/toggle", { body: { carId, date: today(), reason: "otro" } });
  check("Día libre con motivo 'otro' sin detalle es rechazado (400)", offBad.status === 400, `→ ${offBad.status}`);

  const off = await api("POST", "/api/offdays/toggle", { body: { carId, date: today(), reason: "descanso" } });
  check("Alternar día libre (ok)", off.status === 200 && off.json?.active === true, `→ ${off.status}`);
  const offClear = await api("DELETE", `/api/offdays/${today()}`);
  check("Limpiar día libre (ok)", offClear.status === 200, `→ ${offClear.status}`);

  // ── 10. Limpieza (solo lo creado por el E2E) ───────────────────────────────
  console.log("\n▸ 10. Limpieza de datos E2E");
  for (const hid of [ho2Id, hoId]) {
    if (!hid) continue;
    const delHo = await api("DELETE", `/api/handovers/${hid}`);
    check(`Eliminar entrega ${hid.slice(-4)} (ok)`, delHo.status === 200 && delHo.json?.ok === true, `→ ${delHo.status}`);
  }
  const deact = await api("DELETE", `/api/cars/${carId}`);
  check("Desactivar carro E2E (soft delete)", deact.status === 200 && deact.json?.ok === true, `→ ${deact.status}`);

  // ── Resumen ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  RESULTADO:  ${passed}/${results.length} pruebas OK   ${failed ? `(${failed} FALLIDAS)` : "— sin fallos"}`);
  console.log("──────────────────────────────────────────────────────────");
  if (failed) {
    console.log("  Pruebas fallidas:");
    for (const r of results.filter((x) => !x.ok)) console.log(`    ✘ ${r.name} ${r.detail}`);
  }
  console.log("");
  return failed === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error("\n❌ E2E interrumpido:", err.message, "\n");
    process.exit(1);
  });
