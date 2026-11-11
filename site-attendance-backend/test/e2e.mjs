// End-to-end checks against a running API. Creates buildings, workers and shifts,
// so only point it at a throwaway database (deploy/e2e-test.sh does this).
//
// Env: API_URL, ADMIN_USERNAME, ADMIN_PASSWORD, E2E_ALLOWED_ORIGIN (a CORS_ORIGINS entry),
//      E2E_ALLOW_WRITES=1, DATABASE_URL (the same throwaway database the API uses;
//      report fixtures are inserted directly), E2E_CLOCK_PORT (the API must be started
//      with --import ./test/fakeClock.mjs and the same port).
//      The proxy checks assume TRUST_PROXY=1.

import pg from "pg";

if (process.env.E2E_ALLOW_WRITES !== "1") {
  console.error("Refusing to run: set E2E_ALLOW_WRITES=1 and use a throwaway database.");
  process.exit(2);
}
const API = process.env.API_URL ?? "http://127.0.0.1:5055/api";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ALLOWED_ORIGIN = process.env.E2E_ALLOWED_ORIGIN;
const CLOCK_URL = `http://127.0.0.1:${process.env.E2E_CLOCK_PORT}`;
if (!process.env.E2E_CLOCK_PORT) {
  console.error("Refusing to run: start the API with --import ./test/fakeClock.mjs and set E2E_CLOCK_PORT.");
  process.exit(2);
}
const run = Date.now().toString(36);

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
}
async function call(method, path, { token, body, raw, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined || raw ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}
// What nginx sends upstream: any client-supplied X-Forwarded-For, then the real client IP.
const viaNginx = (clientIp, spoofed) => ({
  "X-Forwarded-For": spoofed ? `${spoofed}, ${clientIp}` : clientIp,
});

console.log("== API, database and validation");
const health = await call("GET", "/health");
check("health 200", health.status === 200);
check("helmet headers", health.headers.get("x-content-type-options") === "nosniff" && !health.headers.get("x-powered-by"));

check("admin bad login 401", (await call("POST", "/admin/login", { body: { username: ADMIN_USERNAME, password: "nope" } })).status === 401);
const login = await call("POST", "/admin/login", { body: { username: ADMIN_USERNAME.toUpperCase(), password: ADMIN_PASSWORD } });
check("admin login", login.status === 200 && login.data.token);
const admin = login.data.token;

check("buildings requires auth", (await call("GET", "/buildings")).status === 401);
check("building invalid 400", (await call("POST", "/buildings", { token: admin, body: { name: "", address: "x" } })).status === 400);
const b = await call("POST", "/buildings", { token: admin, body: { name: `E2E Site ${run}`, address: "Riga", latitude: 56.9496, longitude: 24.1052, radius_meters: 30 } });
check("building create", b.status === 200 && b.data.id, JSON.stringify(b.data));
const bid = b.data.id;
// The admin UI sends NUMERIC values back as strings when editing.
check("building update w/ string coords", (await call("PUT", `/buildings/${bid}`, { token: admin, body: { ...b.data, radius_meters: 50 } })).status === 200);
check("building PUT bad id 404", (await call("PUT", "/buildings/abc", { token: admin, body: b.data })).status === 404);
check("building PUT missing 404", (await call("PUT", "/buildings/2147483647", { token: admin, body: { ...b.data, name: `Other ${run}` } })).status === 404);
check("building DELETE missing 404", (await call("DELETE", "/buildings/2147483647", { token: admin })).status === 404);

const w1 = `w1-${run}`;
check("worker no password 400", (await call("POST", "/workers", { token: admin, body: { full_name: "W", username: w1, hourly_rate: 7 } })).status === 400);
check("worker bad building 400", (await call("POST", "/workers", { token: admin, body: { full_name: "W", username: w1, password: "pw1234", hourly_rate: 7, assigned_building_id: 2147483647 } })).status === 400);
const w = await call("POST", "/workers", { token: admin, body: { full_name: "Worker One", username: w1, password: "pw1234", hourly_rate: 10, assigned_building_id: bid } });
check("worker create", w.status === 200 && w.data.id, JSON.stringify(w.data));
const dup = await call("POST", "/workers", { token: admin, body: { full_name: "X", username: w1.toUpperCase(), password: "pw", hourly_rate: null, assigned_building_id: null } });
check("worker dup username (case-insens) 400", dup.status === 400, dup.data?.error);
check("worker update keep password", (await call("PUT", `/workers/${w.data.id}`, { token: admin, body: { full_name: "Worker One", username: w1, password: "", hourly_rate: "10.00", assigned_building_id: bid } })).status === 200);

const wl = await call("POST", "/worker-auth/login", { body: { username: w1, password: "pw1234" } });
check("worker login", wl.status === 200 && wl.data.token && !("password" in wl.data.worker));
const worker = wl.data.token;
check("admin token rejected on worker route", (await call("GET", "/attendance/active", { token: admin })).status === 403);

console.log("== Shift lifecycle");
const onSite = { latitude: 56.9497, longitude: 24.1053 };
check("punch-in far 400", (await call("POST", "/attendance/punch-in", { token: worker, body: { latitude: 57.5, longitude: 24.1 } })).status === 400);
const pin = await call("POST", "/attendance/punch-in", { token: worker, body: onSite });
check("punch-in 201", pin.status === 201, `work_date=${JSON.stringify(pin.data?.log?.work_date)}`);
check("work_date is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(pin.data?.log?.work_date ?? ""));
check("punch-in twice 400", (await call("POST", "/attendance/punch-in", { token: worker, body: onSite })).status === 400);
const active = await call("GET", "/attendance/active", { token: worker });
check("active shift", active.data?.activeShift?.id === pin.data.log.id);
const drift = Math.abs(new Date(active.data.activeShift.punch_in_time).getTime() - Date.now());
check("punch_in_time is correct instant", drift < 60_000, `drift ${drift}ms`);
const end = await call("POST", "/attendance/end-work", { token: worker });
check("end work", end.status === 200, JSON.stringify(end.data?.summary));
check("history", (await call("GET", "/attendance/history", { token: worker })).data?.shifts?.length === 1);

// The partial unique index must allow exactly one of several simultaneous punch-ins.
const racers = await Promise.all(Array.from({ length: 6 }, () =>
  call("POST", "/attendance/punch-in", { token: worker, body: onSite })));
const created = racers.filter((r) => r.status === 201).length;
check("concurrent punch-in creates exactly one", created === 1 && racers.every((r) => r.status === 201 || r.status === 400), racers.map((r) => r.status).join(","));

const rep = await call("GET", "/reports", { token: admin });
const mine = rep.data?.shifts?.filter((s) => s.full_name === "Worker One" && s.building_name === `E2E Site ${run}`) ?? [];
check("report", rep.status === 200 && mine.length === 2, `range ${rep.data?.start_date}..${rep.data?.end_date}`);

console.log("== Report pagination, search and export");
// API-made shifts last seconds (0 hours), so seed completed shifts with known hours
// directly, in January 2020 to stay clear of the rows above. Every name contains the
// run id, so counts stay exact even if the database is reused.
const siteA = (await call("POST", "/buildings", { token: admin, body: { name: `Alpha ${run}`, address: "Riga", latitude: 56.95, longitude: 24.1, radius_meters: 30 } })).data;
const siteB = (await call("POST", "/buildings", { token: admin, body: { name: `Beta ${run}_%`, address: "Riga", latitude: 56.96, longitude: 24.1, radius_meters: 30 } })).data;
const newWorker = async (full_name, username, building) =>
  (await call("POST", "/workers", { token: admin, body: { full_name, username, password: "pw1234", hourly_rate: 10, assigned_building_id: building.id } })).data;
const wa = await newWorker(`Pagina Tester ${run}`, `pag-a-${run}`, siteA);
// wb holds literal % and _; wc is a decoy that unescaped wildcards would also match.
const wb = await newWorker(`Zed ${run}%x`, `zed-${run}_q`, siteB);
const wc = await newWorker(`Carl ${run}Ax`, `carl-${run}Zq`, siteA);
check("report fixtures created", Boolean(siteA?.id && siteB?.id && wa?.id && wb?.id && wc?.id));

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const seedShift = (worker, site, date, hours, earned) =>
  db.query(
    `INSERT INTO attendance_logs (worker_id, building_id, work_date, punch_in_time, end_work_time,
                                  total_worked_hours, daily_earned, status)
     VALUES ($1, $2, $3::date, $3::date + time '08:00', $3::date + time '17:00', $4, $5, 'Completed')`,
    [worker.id, site.id, date, hours, earned],
  );
for (let day = 1; day <= 23; day++) {
  await seedShift(wa, siteA, `2020-01-${String(day).padStart(2, "0")}`, 8, 80);
}
await seedShift(wb, siteB, "2020-01-10", 4.5, 45);
await seedShift(wb, siteB, "2020-01-11", 4.5, 45);
await seedShift(wc, siteA, "2020-01-05", 7.25, 72.5);
await db.end();
const SEEDED = { rows: 26, hours: 23 * 8 + 2 * 4.5 + 7.25, earnings: 23 * 80 + 2 * 45 + 72.5 };

const reportQuery = (params) =>
  new URLSearchParams({ start_date: "2020-01-01", end_date: "2020-01-31", ...params });
const report = (params) => call("GET", `/reports?${reportQuery(params)}`, { token: admin });
const exportReport = (params, token = admin) => call("GET", `/reports/export?${reportQuery(params)}`, { token });
const sameTotals = (t) =>
  t?.periods === SEEDED.rows && Math.abs(t.hours - SEEDED.hours) < 1e-9 && Math.abs(t.earnings - SEEDED.earnings) < 1e-9;

const legacy = await report({ search: run });
check("no page params -> original shape (shifts, no rows)", Array.isArray(legacy.data?.shifts) && legacy.data.shifts.length === SEEDED.rows && legacy.data.rows === undefined);

const p1 = await report({ search: run, page: "1" });
check("page 1: default page_size 10", p1.status === 200 && p1.data.page === 1 && p1.data.page_size === 10 && p1.data.rows.length === 10);
check("total_rows / total_pages", p1.data.total_rows === SEEDED.rows && p1.data.total_pages === 3, `${p1.data.total_rows} rows, ${p1.data.total_pages} pages`);
check("totals cover all matches, not the page", sameTotals(p1.data.totals), JSON.stringify(p1.data.totals));
const p2 = await report({ search: run, page: "2" });
const p3 = await report({ search: run, page: "3" });
check("last page has the remainder (6)", p3.data.rows.length === 6);
check("totals identical on every page", sameTotals(p2.data.totals) && sameTotals(p3.data.totals));
const p4 = await report({ search: run, page: "4" });
check("page past the end: empty rows, totals intact", p4.status === 200 && p4.data.rows.length === 0 && p4.data.total_rows === SEEDED.rows && sameTotals(p4.data.totals));
const allPaged = [...p1.data.rows, ...p2.data.rows, ...p3.data.rows];
check("pages don't overlap or skip rows", new Set(allPaged.map((r) => r.id)).size === SEEDED.rows);
check("stable order: work_date DESC, id DESC across pages",
  allPaged.every((r, i) => i === 0 || allPaged[i - 1].work_date > r.work_date || (allPaged[i - 1].work_date === r.work_date && allPaged[i - 1].id > r.id)));
check("row hours across pages add up to totals", allPaged.reduce((s, r) => s + Number(r.total_worked_hours), 0).toFixed(2) === SEEDED.hours.toFixed(2));
check("rows include username", allPaged.some((r) => r.username === `pag-a-${run}`));
const s25a = await report({ search: run, page: "1", page_size: "25" });
const s25b = await report({ search: run, page: "2", page_size: "25" });
check("page_size 25: 25 + 1, 2 pages", s25a.data.rows.length === 25 && s25b.data.rows.length === 1 && s25a.data.total_pages === 2);
const s50 = await report({ search: run, page_size: "50" });
check("page_size 50 (page omitted): 1 page", s50.data.page === 1 && s50.data.rows.length === SEEDED.rows && s50.data.total_pages === 1);

const total = async (params) => (await report({ page_size: "100", ...params })).data?.total_rows;
check("search by full name, case-insensitive", (await total({ search: `PAGINA tester ${run}` })) === 23);
check("search by username", (await total({ search: `pag-a-${run}` })) === 23 && (await total({ search: `carl-${run}` })) === 1);
check("search by site name", (await total({ search: `alpha ${run}` })) === 24 && (await total({ search: `Beta ${run}_%` })) === 2);
check("% is matched literally (decoy not matched)", (await total({ search: `${run}%x` })) === 2);
check("_ is matched literally (decoy not matched)", (await total({ search: `${run}_q` })) === 2);
const pct = await report({ search: "%", page_size: "100" });
check("search '%' only returns rows containing %",
  pct.data.rows.every((r) => `${r.full_name}${r.username}${r.building_name ?? ""}`.includes("%")) &&
  pct.data.rows.some((r) => r.username === `zed-${run}_q`) && !pct.data.rows.some((r) => r.username === `pag-a-${run}`));
check("backslash is safe (no SQL error)", (await report({ search: `${run}\\`, page: "1" })).status === 200);
check("search is trimmed", (await total({ search: `  pag-a-${run}  ` })) === 23);
check("whitespace-only search is ignored", (await total({ search: "   " })) === (await total({})));
const none = await report({ search: `nomatch-${run}`, page: "1" });
check("empty result", none.status === 200 && none.data.rows.length === 0 && none.data.total_rows === 0 && none.data.total_pages === 1 && none.data.totals.periods === 0 && none.data.totals.hours === 0 && none.data.totals.earnings === 0);
const oneDay = await report({ search: run, start_date: "2020-01-05", end_date: "2020-01-05", page: "1" });
check("single-day range includes that day (inclusive end)", oneDay.data.total_rows === 2);

const badParams = [{ page: "0" }, { page: "-1" }, { page: "abc" }, { page: "1.5" }, { page_size: "7" }, { page_size: "200" }, { page_size: "" }, { search: "x".repeat(101) }];
const badResults = await Promise.all(badParams.map((params) => report(params)));
check("invalid page/page_size/search -> 400 with message", badResults.every((r) => r.status === 400 && typeof r.data?.error === "string"),
  badResults.map((r, i) => `${JSON.stringify(badParams[i]).slice(0, 24)}:${r.status}`).join(" "));
check("search of exactly 100 chars is allowed", (await report({ search: "x".repeat(100), page: "1" })).status === 200);
const repeated = await call("GET", `/reports?${reportQuery({ search: "a" })}&search=b&page=1`, { token: admin });
check("repeated search param -> 400", repeated.status === 400, repeated.data?.error);

const exp = await exportReport({ search: run, page: "2", page_size: "10" });
check("export returns every matching row (ignores page)", exp.status === 200 && exp.data.rows.length === SEEDED.rows && exp.data.total_rows === SEEDED.rows);
check("export rows = union of all pages", exp.status === 200 && exp.data.rows.every((r) => allPaged.some((p) => p.id === r.id)));
check("export totals match paged totals", sameTotals(exp.data?.totals));
check("export validates params", (await exportReport({ search: "x".repeat(101) })).status === 400);
check("export requires admin", (await exportReport({ search: run }, null)).status === 401 && (await exportReport({ search: run }, worker)).status === 403);

console.log("== Pay and attendance rules (frozen server clock)");
// Tokens are issued before the clock is set back, so they stay valid after it is released.
const setClock = async (iso) => {
  const res = await fetch(`${CLOCK_URL}/set`, { method: "POST", body: iso });
  if (res.status !== 204) throw new Error(`clock set failed for ${iso}`);
};
const releaseClock = () => fetch(`${CLOCK_URL}/release`, { method: "POST" });

// Riga is UTC+3 on these June dates. Each scenario uses its own day.
const riga = (day, time) => `2025-06-${day}T${time.length === 5 ? `${time}:00` : time}+03:00`;
const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

const payW = await call("POST", "/workers", { token: admin, body: { full_name: "Pay Rules", username: `pay-${run}`, password: "pw1234", hourly_rate: 10, assigned_building_id: bid } });
check("new worker defaults to work_start_time 08:00", payW.data?.work_start_time === "08:00", JSON.stringify(payW.data?.work_start_time));
const payId = payW.data.id;
const payBody = (extra) => ({ full_name: "Pay Rules", username: `pay-${run}`, password: "", hourly_rate: 10, assigned_building_id: bid, ...extra });
const badTimes = await Promise.all(["25:00", "8:00", "08:60", "08:00:00", "", "abc"].map((work_start_time) =>
  call("PUT", `/workers/${payId}`, { token: admin, body: payBody({ work_start_time }) })));
check("invalid work_start_time -> 400", badTimes.every((r) => r.status === 400), badTimes.map((r) => r.status).join(","));
const setStart = await call("PUT", `/workers/${payId}`, { token: admin, body: payBody({ work_start_time: "09:30" }) });
check("work_start_time can be edited", setStart.status === 200 && setStart.data.work_start_time === "09:30");
const keptStart = await call("PUT", `/workers/${payId}`, { token: admin, body: payBody({}) });
check("PUT without work_start_time keeps it", keptStart.data?.work_start_time === "09:30");
const workerList = await call("GET", "/workers", { token: admin });
check("workers list includes work_start_time", workerList.data?.find((x) => x.id === payId)?.work_start_time === "09:30");
await call("PUT", `/workers/${payId}`, { token: admin, body: payBody({ work_start_time: "08:00" }) });

const payToken = (await call("POST", "/worker-auth/login", { body: { username: `pay-${run}`, password: "pw1234" } })).data.token;
const punchAt = async (iso) => {
  await setClock(iso);
  return call("POST", "/attendance/punch-in", { token: payToken, body: onSite });
};
const lunchAt = async (iso, minutes) => {
  await setClock(iso);
  return call("POST", "/attendance/lunch", { token: payToken, body: { minutes } });
};
const finishAt = async (iso) => {
  await setClock(iso);
  return call("POST", "/attendance/end-work", { token: payToken });
};
const hasCode = (r, status, code) => r.status === status && r.data?.code === code && typeof r.data?.error === "string";

for (const [day, arrive, paid, late, waiting] of [
  ["02", "07:30", "08:00", 0, 30],
  ["03", "07:45", "08:00", 0, 15],
  ["04", "07:50", "08:05", 5, 15],
  ["05", "08:00", "08:15", 15, 15],
  ["06", "08:10", "08:25", 25, 15],
]) {
  const r = await punchAt(riga(day, arrive));
  const log = r.data?.log;
  check(`arrive ${arrive} -> paid ${paid}, late ${late}`,
    r.status === 201 && sameInstant(log.paid_start_at, riga(day, paid)) && log.lateness_minutes === late && log.waiting_minutes === waiting,
    `${log?.local_times?.paid_start} late=${log?.lateness_minutes} waiting=${log?.waiting_minutes}`);
  check(`  status fields at ${arrive}`,
    sameInstant(log.arrival_at, riga(day, arrive)) && sameInstant(log.scheduled_start_at, riga(day, "08:00")) &&
    sameInstant(r.data.server_now, riga(day, arrive)) && log.work_date === `2025-06-${day}` && log.local_times.paid_start === paid);
  await finishAt(riga(day, "16:00"));
}

// Winter time: 08:00 Riga is 06:00 UTC, an hour different from the June shifts.
const winter = await punchAt("2025-01-15T07:30:00+02:00");
check("scheduled start follows winter time", sameInstant(winter.data?.log?.scheduled_start_at, "2025-01-15T06:00:00Z"));
await finishAt("2025-01-15T16:00:00+02:00");

// The schedule is copied at punch-in: a later change must not alter a running shift.
await call("PUT", `/workers/${payId}`, { token: admin, body: payBody({ work_start_time: "09:30" }) });
const custom = await punchAt(riga("07", "09:20"));
check("per-worker start time applies (09:30, arrive 09:20 -> 09:35, late 5)", sameInstant(custom.data?.log?.paid_start_at, riga("07", "09:35")) && custom.data.log.lateness_minutes === 5);
await call("PUT", `/workers/${payId}`, { token: admin, body: payBody({ work_start_time: "08:00" }) });
const stillCustom = await call("GET", "/attendance/active", { token: payToken });
check("editing the worker doesn't change a running shift", sameInstant(stillCustom.data?.activeShift?.scheduled_start_at, riga("07", "09:30")));
check("active: includes schedule and rules", stillCustom.data?.schedule?.work_start === "08:00" && stillCustom.data?.schedule?.arrive_by === "07:45" && stillCustom.data?.rules?.lunch_min_minutes === 30 &&stillCustom.data?.rules?.lunch_max_minutes === 60);
await finishAt(riga("07", "16:00"));

console.log("-- lunch rules");
check("lunch with no active shift -> 404 NO_ACTIVE_SHIFT", hasCode(await lunchAt(riga("09", "12:05"), 50), 404, "NO_ACTIVE_SHIFT"));
check("end-work with no active shift -> 404 NO_ACTIVE_SHIFT", hasCode(await finishAt(riga("09", "12:06")), 404, "NO_ACTIVE_SHIFT"));

// Mon 9 Jun: arrive 07:50, paid from 08:05.
await punchAt(riga("09", "07:50"));
for (const minutes of [29, 61, 0, "50", 45.5, null, undefined]) {
  check(`lunch minutes ${JSON.stringify(minutes)} -> 400 INVALID_LUNCH_MINUTES`, hasCode(await lunchAt(riga("09", "12:05"), minutes), 400, "INVALID_LUNCH_MINUTES"));
}
check("lunch at 11:59:59 -> LUNCH_WINDOW_NOT_OPEN", hasCode(await lunchAt(riga("09", "11:59:59"), 45), 409, "LUNCH_WINDOW_NOT_OPEN"));
const noBody = await call("POST", "/attendance/lunch", { token: payToken });
check("lunch without a body -> 400", hasCode(noBody, 400, "INVALID_LUNCH_MINUTES"));
const lunchOk = await lunchAt(riga("09", "12:00"), 45);
check("lunch at 12:00 for 45 min accepted", lunchOk.status === 200 && lunchOk.data.log.lunch_minutes === 45, JSON.stringify(lunchOk.data?.code ?? ""));
check("lunch response includes the rules (min 30, max 60)", lunchOk.data?.rules?.lunch_min_minutes === 30 && lunchOk.data.rules.lunch_max_minutes === 60);
check("lunch fields stored",sameInstant(lunchOk.data?.log?.lunch_started_at, riga("09", "12:00")) && sameInstant(lunchOk.data?.log?.lunch_planned_end_at, riga("09", "12:45")) && sameInstant(lunchOk.data?.server_now, riga("09", "12:00")));
check("double lunch -> LUNCH_ALREADY_TAKEN", hasCode(await lunchAt(riga("09", "12:10"), 45), 409, "LUNCH_ALREADY_TAKEN"));
check("second lunch after the first ended -> LUNCH_ALREADY_TAKEN", hasCode(await lunchAt(riga("09", "12:30"), 40), 409, "LUNCH_ALREADY_TAKEN"));
check("end-lunch action removed", (await call("POST", "/attendance/lunch-end", { token: payToken })).status === 404);
check("old lunch-start action removed", (await call("POST", "/attendance/lunch-start", { token: payToken })).status === 404);
const midLunch = await call("GET", "/attendance/active", { token: payToken });
check("active shift shows the running lunch and server_now", midLunch.data?.activeShift?.lunch_minutes === 45 && midLunch.data?.activeShift?.local_times?.lunch_planned_end === "12:45" && sameInstant(midLunch.data?.server_now, riga("09", "12:30")));
let done = await finishAt(riga("09", "17:00"));
check("recorded lunch deducted (08:05-17:00 less 45 = 8.17 h)", done.data?.summary?.worked_hours === 8.17 && done.data.summary.earned_today === 81.7 && done.data.summary.lunch_deducted_minutes === 45 && done.data.summary.lunch_deduction_type === "recorded", JSON.stringify(done.data?.summary));
check("finish summary includes arrival and paid start", sameInstant(done.data?.summary?.arrival_at, riga("09", "07:50")) && sameInstant(done.data?.summary?.paid_start_at, riga("09", "08:05")));
const recordedShiftId = done.data.log.id;

// Boundaries of the window.
await punchAt(riga("10", "07:30"));
check("lunch at 12:31:00 -> LUNCH_WINDOW_CLOSED", hasCode(await lunchAt(riga("10", "12:31:00"), 60), 409, "LUNCH_WINDOW_CLOSED"));
check("the rejected lunch left nothing behind", (await call("GET", "/attendance/active", { token: payToken })).data?.activeShift?.lunch_started_at === null);
check("lunch at 12:30:59 accepted (the 12:30 minute counts)", (await lunchAt(riga("10", "12:30:59"), 60)).status === 200);
await finishAt(riga("10", "17:00"));
await punchAt(riga("11", "07:30"));
check("lunch at 12:30:00 accepted", (await lunchAt(riga("11", "12:30"), 40)).status === 200);
await finishAt(riga("11", "17:00"));

// Paid time has not started yet at 12:05 for someone who arrived at 11:55.
await punchAt(riga("12", "11:55"));
check("lunch before paid start -> LUNCH_BEFORE_PAID_START", hasCode(await lunchAt(riga("12", "12:05"), 50), 409, "LUNCH_BEFORE_PAID_START"));
check("lunch exactly at paid start accepted", (await lunchAt(riga("12", "12:10"), 50)).status === 200);
await finishAt(riga("12", "17:00"));

console.log("-- deductions");
await punchAt(riga("13", "07:45"));
check("lunch of 60 min (the maximum) accepted", (await lunchAt(riga("13", "12:00"), 60)).status === 200);
done = await finishAt(riga("13", "12:20"));
check("finish during lunch deducts elapsed only (08:00-12:20 less 20 = 4.00 h)", done.data?.summary?.worked_hours === 4 && done.data.summary.lunch_deducted_minutes === 20 && done.data.summary.lunch_deduction_type === "elapsed", JSON.stringify(done.data?.summary));
check("finish during lunch: lunch_end is the finish", sameInstant(done.data?.log?.lunch_end_time, riga("13", "12:20")));
const elapsedShiftId = done.data.log.id;

await punchAt(riga("16", "07:45"));
done = await finishAt(riga("16", "13:00:01"));
check("no lunch, just over 5 h -> 60 deducted", done.data?.summary?.lunch_deducted_minutes === 60 && done.data.summary.lunch_deduction_type === "default" && done.data.summary.worked_hours === 4, JSON.stringify(done.data?.summary));
await punchAt(riga("17", "07:45"));
done = await finishAt(riga("17", "13:00"));
check("no lunch, exactly 5 h -> no deduction", done.data?.summary?.lunch_deducted_minutes === 0 && done.data.summary.lunch_deduction_type === "none" && done.data.summary.worked_hours === 5, JSON.stringify(done.data?.summary));
await punchAt(riga("18", "07:45"));
done = await finishAt(riga("18", "12:00"));
check("no lunch, under 5 h -> no deduction", done.data?.summary?.lunch_deducted_minutes === 0 && done.data.summary.worked_hours === 4);
await punchAt(riga("19", "07:30"));
done = await finishAt(riga("19", "07:40"));
check("finish before paid start -> 0 hours, 0 pay", done.status === 200 && done.data.summary.worked_hours === 0 && done.data.summary.earned_today === 0 && done.data.summary.lunch_deducted_minutes === 0);
await punchAt(riga("20", "07:45"));
await setClock(riga("20", "08:00"));
const raceFinish = await Promise.all([call("POST", "/attendance/end-work", { token: payToken }), call("POST", "/attendance/end-work", { token: payToken })]);
check("concurrent finish: exactly one succeeds", raceFinish.map((r) => r.status).sort().join(",") === "200,404", raceFinish.map((r) => r.status).join(","));

// The shortest lunches: 30 (the minimum) and 35 minutes.
await punchAt(riga("24", "07:45"));
const minLunch = await lunchAt(riga("24", "12:00"), 30);
check("lunch of 30 min (the minimum) accepted", minLunch.status === 200 && minLunch.data.log.lunch_minutes === 30 && sameInstant(minLunch.data.log.lunch_planned_end_at, riga("24", "12:30")), JSON.stringify(minLunch.data?.code ?? ""));
done = await finishAt(riga("24", "16:30"));
check("30 min lunch deducted (08:00-16:30 less 30 = 8.00 h)", done.data?.summary?.worked_hours === 8 && done.data.summary.earned_today === 80 && done.data.summary.lunch_deducted_minutes === 30 && done.data.summary.lunch_deduction_type === "recorded", JSON.stringify(done.data?.summary));
await punchAt(riga("25", "07:45"));
check("lunch of 35 min accepted", (await lunchAt(riga("25", "12:30"), 35)).status === 200);
done = await finishAt(riga("25", "17:00"));
check("35 min lunch deducted (08:00-17:00 less 35 = 8.42 h)", done.data?.summary?.worked_hours === 8.42 && done.data.summary.lunch_deducted_minutes === 35 && done.data.summary.lunch_deduction_type === "recorded", JSON.stringify(done.data?.summary));

console.log("-- admin correction");
const patchShift = (id, body, token = admin) => call("PATCH", `/shifts/${id}`, { token, body });
const auditOf = async (id) => (await call("GET", `/shifts/${id}/adjustments`, { token: admin })).data?.adjustments;
await setClock(riga("30", "20:00"));
const correctReason = "Forgot to tap on arrival";
check("correction requires admin", (await call("PATCH", `/shifts/${recordedShiftId}`, { body: { reason: "x", lunch_minutes: 50 } })).status === 401 && (await patchShift(recordedShiftId, { reason: "x", lunch_minutes: 50 }, payToken)).status === 403);
check("correction without reason -> REASON_REQUIRED", hasCode(await patchShift(recordedShiftId, { lunch_minutes: 50 }), 400, "REASON_REQUIRED") && hasCode(await patchShift(recordedShiftId, { reason: "   ", lunch_minutes: 50 }), 400, "REASON_REQUIRED"));
check("correction with no fields -> NO_FIELDS", hasCode(await patchShift(recordedShiftId, { reason: "x" }), 400, "NO_FIELDS"));
check("unknown shift -> SHIFT_NOT_FOUND", hasCode(await patchShift(2147483647, { reason: "x", lunch_minutes: 50 }), 404, "SHIFT_NOT_FOUND") && hasCode(await patchShift("abc", { reason: "x", lunch_minutes: 50 }), 404, "SHIFT_NOT_FOUND"));
check("timestamp without timezone -> INVALID_TIMESTAMP", hasCode(await patchShift(recordedShiftId, { reason: "x", finish_at: "2025-06-09T17:00:00" }), 400, "INVALID_TIMESTAMP"));
check("bad lunch_minutes -> INVALID_LUNCH_MINUTES", hasCode(await patchShift(recordedShiftId, { reason: "x", lunch_minutes: -1 }), 400, "INVALID_LUNCH_MINUTES") && hasCode(await patchShift(recordedShiftId, { reason: "x", lunch_minutes: 12.5 }), 400, "INVALID_LUNCH_MINUTES"));
check("finish before paid start -> INVALID_SHIFT_TIMES", hasCode(await patchShift(recordedShiftId, { reason: "x", finish_at: riga("09", "08:00") }), 400, "INVALID_SHIFT_TIMES"));
check("finish in the future -> FINISH_IN_FUTURE", hasCode(await patchShift(recordedShiftId, { reason: "x", finish_at: riga("30", "21:00"), paid_start_at: riga("30", "19:00") }), 400, "FINISH_IN_FUTURE"));
check("no real change -> NO_CHANGES", hasCode(await patchShift(recordedShiftId, { reason: "x", lunch_minutes: 45 }), 400, "NO_CHANGES"));
check("rejected corrections write no audit row", (await auditOf(recordedShiftId)).length === 0);

// The rate changes after the shift was paid: a correction must keep the original rate.
await call("PUT", `/workers/${payId}`, { token: admin, body: payBody({ hourly_rate: 20 }) });
const fixed = await patchShift(recordedShiftId, { reason: correctReason, paid_start_at: riga("09", "08:00") });
check("correction recalculates (08:00-17:00 less 45 = 8.25 h)", fixed.status === 200 && Number(fixed.data.shift.total_worked_hours) === 8.25, JSON.stringify(fixed.data?.shift?.total_worked_hours));
check("correction keeps the rate the shift was paid at", Number(fixed.data?.shift?.daily_earned) === 82.5);
await call("PUT", `/workers/${payId}`, { token: admin, body: payBody({ hourly_rate: 10 }) });
let audit = await auditOf(recordedShiftId);
check("audit: one row with who, why and when", audit.length === 1 && audit[0].admin_username.toLowerCase() === ADMIN_USERNAME.toLowerCase() && Number.isInteger(audit[0].admin_id) && audit[0].reason === correctReason && Boolean(audit[0].created_at), JSON.stringify(audit[0]));
check("audit: old and new values", sameInstant(audit[0].old_values.paid_start_at, riga("09", "08:05")) && sameInstant(audit[0].new_values.paid_start_at, riga("09", "08:00")) && audit[0].old_values.total_worked_hours === 8.17 && audit[0].new_values.total_worked_hours === 8.25 && audit[0].old_values.daily_earned === 81.7 && audit[0].new_values.daily_earned === 82.5);
const moved = await patchShift(recordedShiftId, { reason: "Left later", finish_at: riga("09", "18:00"), lunch_minutes: 60 });
check("finish and lunch corrected together (08:00-18:00 less 60 = 9 h)", Number(moved.data?.shift?.total_worked_hours) === 9 && moved.data.shift.lunch_minutes === 60 && sameInstant(moved.data.shift.lunch_planned_end_at, riga("09", "13:00")));
audit = await auditOf(recordedShiftId);
check("audit: each correction is its own row, newest first", audit.length === 2 && audit[0].reason === "Left later" && audit[1].reason === correctReason && audit[0].old_values.lunch_minutes === 45 && audit[0].new_values.lunch_minutes === 60);
const noLunch = await patchShift(recordedShiftId, { reason: "Worked through lunch", lunch_minutes: 0 });
check("lunch_minutes 0 removes the deduction", Number(noLunch.data?.shift?.total_worked_hours) === 10 && Number(noLunch.data.shift.lunch_deducted_minutes) === 0);
const exact = await patchShift(elapsedShiftId, { reason: "Lunch was 30 minutes", lunch_minutes: 30 });
check("admin's lunch figure is deducted exactly on a finish-during-lunch shift", Number(exact.data?.shift?.lunch_deducted_minutes) === 30 && Number(exact.data.shift.total_worked_hours) === 3.83, JSON.stringify(exact.data?.shift?.lunch_deducted_minutes));

const forgot = await punchAt(riga("23", "07:45"));
await setClock(riga("23", "20:00"));
check("running shift needs finish_at -> SHIFT_STILL_ACTIVE", hasCode(await patchShift(forgot.data.log.id, { reason: "x", paid_start_at: riga("23", "07:50") }), 409, "SHIFT_STILL_ACTIVE"));
const closed = await patchShift(forgot.data.log.id, { reason: "Forgot to finish", finish_at: riga("23", "17:00") });
check("finish_at ends a forgotten shift (no lunch: 60 deducted, 8 h)", closed.status === 200 && closed.data.shift.status === "Completed" && Number(closed.data.shift.total_worked_hours) === 8 && Number(closed.data.shift.daily_earned) === 80);
check("worker can start a new shift afterwards", (await call("GET", "/attendance/active", { token: payToken })).data?.activeShift === null);

console.log("-- reports");
const juneRows = async (extra = {}) => {
  const query = new URLSearchParams({ start_date: "2025-06-01", end_date: "2025-06-30", search: `pay-${run}`, ...extra });
  return call("GET", `/reports?${query}`, { token: admin });
};
const legacyJune = await juneRows();
const latePaged = await juneRows({ page: "1", page_size: "100" });
const exportedJune = await call("GET", `/reports/export?${new URLSearchParams({ start_date: "2025-06-01", end_date: "2025-06-30", search: `pay-${run}` })}`, { token: admin });
const dayRow = (rows, date) => rows?.find((r) => r.work_date === date);
for (const [label, rows] of [["legacy", legacyJune.data?.shifts], ["paged", latePaged.data?.rows], ["export", exportedJune.data?.rows]]) {
  const row = dayRow(rows, "2025-06-04");
  check(`${label} report row: arrival, paid start, waiting, lateness`, row && sameInstant(row.arrival_at, riga("04", "07:50")) && sameInstant(row.paid_start_at, riga("04", "08:05")) && row.waiting_minutes === 15 && row.lateness_minutes === 5, JSON.stringify(row && { w: row.waiting_minutes, l: row.lateness_minutes }));
  const lunchRow = dayRow(rows, "2025-06-13");
  check(`${label} report row: lunch minutes and hours`, lunchRow && lunchRow.lunch_minutes === 30 && Number(lunchRow.lunch_deducted_minutes) === 30 && Number(lunchRow.total_worked_hours) === 3.83);
}
const oldRow = (await report({ search: `pag-a-${run}`, page: "1" })).data?.rows?.[0];
check("rows inserted without the new columns still report (lateness unknown)", oldRow && oldRow.lateness_minutes === null && oldRow.waiting_minutes === null);
await releaseClock();

console.log("== Errors and CORS");
const bad = await call("POST", "/admin/login", { raw: "{not json" });
check("malformed JSON -> 400 JSON", bad.status === 400 && typeof bad.data?.error === "string", JSON.stringify(bad.data));
const nf = await call("GET", "/nope");
check("unknown route -> 404 JSON", nf.status === 404 && nf.data?.error === "Not found");
if (ALLOWED_ORIGIN) {
  const okOrigin = await call("GET", "/health", { headers: { Origin: ALLOWED_ORIGIN } });
  check("CORS allowed origin", okOrigin.headers.get("access-control-allow-origin") === ALLOWED_ORIGIN);
  const exposed = (okOrigin.headers.get("access-control-expose-headers") ?? "").split(",").map((h) => h.trim().toLowerCase());
  check("CORS exposes the Date header", exposed.includes("date"), okOrigin.headers.get("access-control-expose-headers") ?? "(missing)");
}
const evilOrigin = await call("GET", "/health", { headers: { Origin: "https://evil.example" } });
check("CORS other origin blocked", !evilOrigin.headers.get("access-control-allow-origin"));

console.log("== Login rate limiting behind the proxy (TRUST_PROXY=1)");
const victim = `victim-${run}`;
const other = `other-${run}`;
for (const username of [victim, other]) {
  await call("POST", "/workers", { token: admin, body: { full_name: username, username, password: "right-pw", assigned_building_id: bid } });
}
const attackerIp = "203.0.113.10";
let last;
for (let i = 0; i < 10; i++) {
  last = await call("POST", "/worker-auth/login", { headers: viaNginx(attackerIp), body: { username: victim, password: "wrong" } });
}
check("10 failures from one IP are allowed (401)", last.status === 401);
last = await call("POST", "/worker-auth/login", { headers: viaNginx(attackerIp), body: { username: victim, password: "wrong" } });
check("11th failure from that IP -> 429", last.status === 429, JSON.stringify(last.data));
const spoofed = await call("POST", "/worker-auth/login", { headers: viaNginx(attackerIp, "198.51.100.77"), body: { username: victim, password: "right-pw" } });
check("forged X-Forwarded-For does not bypass the limit", spoofed.status === 429);
const otherIp = await call("POST", "/worker-auth/login", { headers: viaNginx("203.0.113.20"), body: { username: victim, password: "right-pw" } });
check("same user from another IP can still log in", otherIp.status === 200);
const sameIpOtherUser = await call("POST", "/worker-auth/login", { headers: viaNginx(attackerIp), body: { username: other, password: "right-pw" } });
check("other user on the attacker's IP can still log in", sameIpOtherUser.status === 200);

let spray;
for (let i = 0; i < 101; i++) {
  spray = await call("POST", "/worker-auth/login", { headers: viaNginx("203.0.113.30"), body: { username: `spray-${run}-${i}`, password: "x" } });
}
check("guessing across 100+ usernames from one IP -> 429", spray.status === 429);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exitCode = failures ? 1 : 0;
