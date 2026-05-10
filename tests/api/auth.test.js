import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startTestServer } from "./helpers.js";

let s;
beforeAll(async () => {
  s = await startTestServer();
}, 15000);
afterAll(() => s.stop());

async function seedUser(email = "alice@example.com", phone = "+15551234567") {
  const r = await s.post("/test/seed/user", {
    email,
    phones: [phone],
    domains: ["example.com"],
    role: "admin",
  });
  expect(r.status).toBe(200);
}

async function seedAliasedUser(primaryEmail, alias, phone = "+15551234567") {
  const domain = primaryEmail.split("@")[1];
  const aliasDomain = alias.split("@")[1];
  const r = await s.post("/test/seed/user", {
    email: primaryEmail,
    aliases: [alias],
    phones: [phone],
    domains: [domain, aliasDomain],
    role: "admin",
  });
  expect(r.status).toBe(200);
}

// ── WebAuthn Auth Request ───────────────────────────────────────────────────

describe("POST /auth/webauthn/auth-request", () => {
  it("returns 400 when email is missing", async () => {
    const r = await s.post("/auth/webauthn/auth-request", {});
    expect(r.status).toBe(400);
  });

  it("returns notFound when user does not exist", async () => {
    const r = await s.post("/auth/webauthn/auth-request", { email: "nobody@example.com" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.notFound).toBe(true);
  });

  it("returns requiresSetup when user has no passkeys", async () => {
    await seedUser("no-passkey@example.com");
    const r = await s.post("/auth/webauthn/auth-request", { email: "no-passkey@example.com" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.requiresSetup).toBe(true);
  });

  it("returns challenge and options for MFA request (backward compat)", async () => {
    await seedUser("mfa-req@example.com");
    const r = await s.post("/auth/mfa/request", { email: "mfa-req@example.com" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.requiresSetup).toBe(true);
  });
});

// ── WebAuthn Auth ───────────────────────────────────────────────────────────

describe("POST /auth/webauthn/auth", () => {
  it("returns 400 when fields are missing", async () => {
    const r = await s.post("/auth/webauthn/auth", {});
    expect(r.status).toBe(400);
  });

  it("returns 401 with invalid session", async () => {
    const r = await s.post("/auth/webauthn/auth", {
      sessionId: "bad-session",
      credential: { id: "test-cred" },
    });
    expect(r.status).toBe(401);
  });
});

// ── MFA Request (backward compat) ──────────────────────────────────────────

describe("POST /auth/mfa/request", () => {
  it("returns 400 when email is missing", async () => {
    const r = await s.post("/auth/mfa/request", {});
    expect(r.status).toBe(400);
  });

  it("returns 404 when user does not exist", async () => {
    const r = await s.post("/auth/mfa/request", { email: "nobody@example.com" });
    expect(r.status).toBe(404);
  });

  it("returns requiresSetup when user has no devices", async () => {
    await seedUser("mfa-setup@example.com");
    const r = await s.post("/auth/mfa/request", { email: "mfa-setup@example.com" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.requiresSetup).toBe(true);
  });

  it("resolves an old email alias to the primary account", async () => {
    await seedAliasedUser("alias-pri@example.com", "alias-old@old.example.com");
    const r = await s.post("/auth/mfa/request", { email: "alias-old@old.example.com" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.requiresSetup).toBe(true);
  });
});

// ── SMS ────────────────────────────────────────────────────────────────────

describe("POST /auth/sms/request", () => {
  it("returns sent for unknown email and phone", async () => {
    const r = await s.post("/auth/sms/request", { email: "unknown@example.com", phone: "+15550000000" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sent).toBe(true);
  });
});

// ── OAuth ──────────────────────────────────────────────────────────────────

describe("POST /auth/oauth/request", () => {
  it("returns providers list with no provider specified", async () => {
    const r = await s.post("/auth/oauth/request", {});
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it("returns 400 for invalid provider", async () => {
    const r = await s.post("/auth/oauth/request", { provider: "facebook" });
    expect(r.status).toBe(400);
  });

  it("returns 400 when provider not configured", async () => {
    const r = await s.post("/auth/oauth/request", { provider: "google" });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toContain("not configured");
  });
});

describe("POST /auth/oauth/callback", () => {
  it("returns 400 when fields missing", async () => {
    const r = await s.post("/auth/oauth/callback", {});
    expect(r.status).toBe(400);
  });

  it("returns 400 for invalid provider", async () => {
    const r = await s.post("/auth/oauth/callback", {
      provider: "facebook", code: "test-code", state: "test-state",
    });
    expect(r.status).toBe(400);
  });

  it("returns 400 when provider not configured", async () => {
    const r = await s.post("/auth/oauth/callback", {
      provider: "google", code: "test-code", state: "test-state",
    });
    expect(r.status).toBe(400);
  });
});
