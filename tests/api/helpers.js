import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import { signJwt } from "@/services/auth.js";
const HERMES_ROOT = join(import.meta.dir, "..", "..");
const TACH_SERVE = join(HERMES_ROOT, "node_modules", ".bin", "yon.serve");
const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const INBOUND_WEBHOOK_SECRET = process.env.INBOUND_WEBHOOK_SECRET || "test-inbound-secret";
const EVENTS_WEBHOOK_SECRET = process.env.EVENTS_WEBHOOK_SECRET || "test-events-secret";
const PORT_BASE = 19000;
let portCounter = 0;
export async function startTestServer() {
  const port = PORT_BASE + portCounter++ % 100;
  const testRoot = mkdtempSync(join(tmpdir(), "hermes-api-test-"));
  const proc = Bun.spawn(["bun", TACH_SERVE], {
    cwd: HERMES_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      FYLO_ROOT: testRoot,
    },
    stdout: "ignore",
    stderr: "ignore"
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 1e4;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/auth/mfa/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(500)
      });
      if (r.status !== 0)
        break;
    } catch {
      await Bun.sleep(100);
    }
  }
  const stop = () => {
    proc.kill();
    rmSync(testRoot, { recursive: true, force: true });
  };
  const makeHeaders = (body, opts) => {
    const h = { "Content-Type": "application/json" };
    if (opts?.token)
      h["Authorization"] = `Bearer ${opts.token}`;
    if (opts?.secret)
      h["X-Webhook-Secret"] = opts.secret;
    if (opts?.secret)
      h["X-Hermes-Signature"] = createHmac("sha256", opts.secret).update(JSON.stringify(body ?? {})).digest("hex");
    return h;
  };
  return {
    url,
    testRoot,
    stop,
    token: (claims) => signJwt(claims, JWT_SECRET),
    get: (path, opts) => fetch(`${url}${path}`, { headers: makeHeaders(undefined, opts) }),
    post: (path, body, opts) => fetch(`${url}${path}`, {
      method: "POST",
      headers: makeHeaders(body, { ...opts, secret: opts?.secret ?? (
        path === "/inbound/webhook" ? INBOUND_WEBHOOK_SECRET :
        path.startsWith("/events/") ? EVENTS_WEBHOOK_SECRET :
        undefined
      ) }),
      body: JSON.stringify(body)
    }),
    put: (path, body, opts) => fetch(`${url}${path}`, { method: "PUT", headers: makeHeaders(body, opts), body: JSON.stringify(body) }),
    delete: (path, opts) => fetch(`${url}${path}`, {
      method: "DELETE",
      headers: makeHeaders(opts?.body, opts),
      body: opts?.body ? JSON.stringify(opts.body) : undefined
    })
  };
}
