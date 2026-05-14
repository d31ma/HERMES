import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb } from "@/repositories/index.js";
import {
  listDevices,
  findDeviceById,
  findDeviceByCredentialId,
  putDevice,
  putWebAuthnDevice,
  updateDeviceSignCount,
  deleteDevice,
  findMfaSession,
  putMfaSession,
  deleteMfaSession,
  purgeExpiredMfaSessions,
  findSetupSession,
  putSetupSession,
  deleteSetupSession
} from "@/repositories/mfa.js";
let fylo;
let testRoot;
beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), "caduceus-test-"));
  fylo = await createDb(testRoot);
});
afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});
function inMinutes(n) {
  return new Date(Date.now() + n * 60 * 1000).toISOString();
}
const device = {
  id: "dev-001",
  userEmail: "alice@example.com",
  name: "Authenticator App",
  secret: "JBSWY3DPEHPK3PXP",
  createdAt: "2024-01-01T00:00:00.000Z"
};
describe("putDevice / listDevices", () => {
  it("stores and retrieves a device", async () => {
    await putDevice(fylo, device);
    const devices = await listDevices(fylo, "alice@example.com");
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe("Authenticator App");
  });
  it("scopes devices by email", async () => {
    await putDevice(fylo, device);
    await putDevice(fylo, { ...device, id: "dev-002", userEmail: "bob@example.com" });
    const aliceDevices = await listDevices(fylo, "alice@example.com");
    const bobDevices = await listDevices(fylo, "bob@example.com");
    expect(aliceDevices).toHaveLength(1);
    expect(bobDevices).toHaveLength(1);
    expect(aliceDevices[0].userEmail).toBe("alice@example.com");
  });
});
describe("findDeviceById", () => {
  it("finds a device by logical id", async () => {
    await putDevice(fylo, device);
    const [docId, found] = await findDeviceById(fylo, "dev-001");
    expect(docId).not.toBeNull();
    expect(found.name).toBe("Authenticator App");
  });
  it("returns [null, null] when not found", async () => {
    const [docId, found] = await findDeviceById(fylo, "dev-999");
    expect(docId).toBeNull();
    expect(found).toBeNull();
  });
});
describe("deleteDevice", () => {
  it("removes the device", async () => {
    await putDevice(fylo, device);
    const [docId] = await findDeviceById(fylo, "dev-001");
    await deleteDevice(fylo, docId);
    const devices = await listDevices(fylo, "alice@example.com");
    expect(devices).toHaveLength(0);
  });
});
describe("putMfaSession / findMfaSession", () => {
  it("stores and retrieves a session", async () => {
    const session = {
      id: "sess-001",
      email: "alice@example.com",
      expiresAt: inMinutes(5)
    };
    await putMfaSession(fylo, session);
    const [docId, found] = await findMfaSession(fylo, "sess-001");
    expect(docId).not.toBeNull();
    expect(found.email).toBe("alice@example.com");
  });
  it("returns [null, null] when not found", async () => {
    const [docId, found] = await findMfaSession(fylo, "no-such-session");
    expect(docId).toBeNull();
    expect(found).toBeNull();
  });
});
describe("deleteMfaSession", () => {
  it("removes the session", async () => {
    const session = { id: "sess-001", email: "alice@example.com", expiresAt: inMinutes(5) };
    await putMfaSession(fylo, session);
    const [docId] = await findMfaSession(fylo, "sess-001");
    await deleteMfaSession(fylo, docId);
    const [, after] = await findMfaSession(fylo, "sess-001");
    expect(after).toBeNull();
  });
});
describe("purgeExpiredMfaSessions", () => {
  it("deletes expired sessions for the given email", async () => {
    const expired = { id: "sess-exp", email: "alice@example.com", expiresAt: inMinutes(-10) };
    const active = { id: "sess-act", email: "alice@example.com", expiresAt: inMinutes(5) };
    await putMfaSession(fylo, expired);
    await putMfaSession(fylo, active);
    await purgeExpiredMfaSessions(fylo, "alice@example.com");
    const [, expiredAfter] = await findMfaSession(fylo, "sess-exp");
    const [, activeAfter] = await findMfaSession(fylo, "sess-act");
    expect(expiredAfter).toBeNull();
    expect(activeAfter).not.toBeNull();
  });
  it("does not affect sessions for other emails", async () => {
    const bobSession = { id: "bob-sess", email: "bob@example.com", expiresAt: inMinutes(-5) };
    await putMfaSession(fylo, bobSession);
    await purgeExpiredMfaSessions(fylo, "alice@example.com");
    const [, found] = await findMfaSession(fylo, "bob-sess");
    expect(found).not.toBeNull();
  });
});
describe("putSetupSession / findSetupSession", () => {
  it("stores and retrieves a setup session", async () => {
    const session = {
      id: "setup-001",
      email: "alice@example.com",
      totpSecret: "JBSWY3DPEHPK3PXP",
      expiresAt: inMinutes(15)
    };
    await putSetupSession(fylo, session);
    const [docId, found] = await findSetupSession(fylo, "setup-001");
    expect(docId).not.toBeNull();
    expect(found.totpSecret).toBe("JBSWY3DPEHPK3PXP");
  });
  it("returns [null, null] when not found", async () => {
    const [docId, found] = await findSetupSession(fylo, "no-setup");
    expect(docId).toBeNull();
    expect(found).toBeNull();
  });
});
describe("deleteSetupSession", () => {
  it("removes the setup session", async () => {
    const session = {
      id: "setup-001",
      email: "alice@example.com",
      totpSecret: "JBSWY3DPEHPK3PXP",
      expiresAt: inMinutes(15)
    };
    await putSetupSession(fylo, session);
    const [docId] = await findSetupSession(fylo, "setup-001");
    await deleteSetupSession(fylo, docId);
    const [, after] = await findSetupSession(fylo, "setup-001");
    expect(after).toBeNull();
  });
});

// ── WebAuthn Passkey Devices ───────────────────────────────────────────────

describe("putWebAuthnDevice / findDeviceByCredentialId", () => {
  it("stores and finds a passkey by credentialId", async () => {
    await putWebAuthnDevice(fylo, {
      id: "passkey-001",
      userEmail: "alice@example.com",
      name: "My Passkey",
      credentialId: "cred-abc123",
      publicKey: "base64publickeydata",
      signCount: 1,
    });
    const [docId, found] = await findDeviceByCredentialId(fylo, "cred-abc123");
    expect(docId).not.toBeNull();
    expect(found.name).toBe("My Passkey");
    expect(found.publicKey).toBe("base64publickeydata");
    expect(found.signCount).toBe(1);
  });

  it("returns [null, null] for unknown credentialId", async () => {
    const [docId, found] = await findDeviceByCredentialId(fylo, "unknown-cred");
    expect(docId).toBeNull();
    expect(found).toBeNull();
  });

  it("appears in listDevices for the user", async () => {
    await putWebAuthnDevice(fylo, {
      id: "passkey-002",
      userEmail: "alice@example.com",
      name: "Phone Passkey",
      credentialId: "cred-xyz789",
      publicKey: "somekey",
      signCount: 0,
    });
    const devices = await listDevices(fylo, "alice@example.com");
    const passkey = devices.find(d => d.id === "passkey-002");
    expect(passkey).toBeDefined();
    expect(passkey.name).toBe("Phone Passkey");
  });

  it("is scoped by user email", async () => {
    await putWebAuthnDevice(fylo, {
      id: "pk-alice", userEmail: "alice@example.com", name: "A", credentialId: "c-a", publicKey: "k", signCount: 0,
    });
    await putWebAuthnDevice(fylo, {
      id: "pk-bob", userEmail: "bob@example.com", name: "B", credentialId: "c-b", publicKey: "k", signCount: 0,
    });
    const alice = await listDevices(fylo, "alice@example.com");
    const bob = await listDevices(fylo, "bob@example.com");
    expect(alice.find(d => d.id === "pk-alice")).toBeDefined();
    expect(bob.find(d => d.id === "pk-bob")).toBeDefined();
    expect(alice.find(d => d.id === "pk-bob")).toBeUndefined();
  });
});

describe("updateDeviceSignCount", () => {
  it("updates the signature counter", async () => {
    await putWebAuthnDevice(fylo, {
      id: "pk-signcount", userEmail: "a@e.com", name: "SC", credentialId: "c-sc", publicKey: "k", signCount: 1,
    });
    const [docId] = await findDeviceByCredentialId(fylo, "c-sc");
    await updateDeviceSignCount(fylo, docId, 5);
    const [, found] = await findDeviceByCredentialId(fylo, "c-sc");
    expect(found.signCount).toBe(5);
  });
});
