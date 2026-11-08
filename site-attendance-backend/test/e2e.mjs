// End-to-end checks against a running API. Creates buildings, workers and shifts,
// so only point it at a throwaway database (deploy/e2e-test.sh does this).
//
// Env: API_URL, ADMIN_USERNAME, ADMIN_PASSWORD, E2E_ALLOWED_ORIGIN (a CORS_ORIGINS entry),
//      E2E_ALLOW_WRITES=1, DATABASE_URL (the same throwaway database the API uses;
//      report fixtures are inserted directly). The proxy checks assume TRUST_PROXY=1.

import pg from "pg";

if (process.env.E2E_ALLOW_WRITES !== "1") {
  console.error("Refusing to run: set E2E_ALLOW_WRITES=1 and use a throwaway database.");
  process.exit(2);
}
const API = process.env.API_URL ?? "http://127.0.0.1:5055/api";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ALLOWED_ORIGIN = process.env.E2E_ALLOWED_ORIGIN;
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
check("lunch start", (await call("POST", "/attendance/lunch-start", { token: worker })).status === 200);
check("lunch end", (await call("POST", "/attendance/lunch-end", { token: worker })).status === 200);
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

console.log("== Errors and CORS");
const bad = await call("POST", "/admin/login", { raw: "{not json" });
check("malformed JSON -> 400 JSON", bad.status === 400 && typeof bad.data?.error === "string", JSON.stringify(bad.data));
const nf = await call("GET", "/nope");
check("unknown route -> 404 JSON", nf.status === 404 && nf.data?.error === "Not found");
if (ALLOWED_ORIGIN) {
  const okOrigin = await call("GET", "/health", { headers: { Origin: ALLOWED_ORIGIN } });
  check("CORS allowed origin", okOrigin.headers.get("access-control-allow-origin") === ALLOWED_ORIGIN);
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
