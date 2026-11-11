// Test-only preload that lets test/e2e.mjs set the API's clock, so rules such as
// "arrive at 07:50" or "lunch at 12:31" can be tested at exact times:
//
//   E2E_CLOCK_PORT=5056 node --import ./test/fakeClock.mjs dist/index.js
//
// The application has no knowledge of this file. Nothing here is loaded unless the
// server is started with --import as above (deploy/e2e-test.sh does that for its
// throwaway instance; the systemd service does not).
//
// POST /set with an ISO timestamp as the body freezes the clock there.
// POST /release goes back to real time.
import http from "node:http";

const port = Number(process.env.E2E_CLOCK_PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("fakeClock.mjs needs E2E_CLOCK_PORT");
}

const RealDate = Date;
let frozenMs = null;

class ClockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0 && frozenMs !== null) super(frozenMs);
    else super(...args);
  }
  static now() {
    return frozenMs ?? RealDate.now();
  }
}
globalThis.Date = ClockDate;

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/release") {
        frozenMs = null;
      } else if (req.method === "POST" && req.url === "/set" && !Number.isNaN(RealDate.parse(body))) {
        frozenMs = RealDate.parse(body);
      } else {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(204).end();
    });
  })
  .listen(port, "127.0.0.1")
  .unref();
