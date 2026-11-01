// End-to-end checks against a running API. Creates buildings, workers and shifts,
// so only point it at a throwaway database (deploy/e2e-test.sh does this).
//
// Env: API_URL, ADMIN_USERNAME, ADMIN_PASSWORD, E2E_ALLOWED_ORIGIN (a CORS_ORIGINS entry),
//      E2E_ALLOW_WRITES=1. The proxy checks assume the API runs with TRUST_PROXY=1.

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
