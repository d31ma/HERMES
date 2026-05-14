import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb } from "@/repositories/index.js";
import { putDomain, findDomainEntry } from "@/repositories/domains.js";
import { listDomainMigrations } from "@/repositories/domain-migrations.js";
import { putEmail, findEmailById } from "@/repositories/emails.js";
import { putUser, findUserByEmail } from "@/repositories/users.js";
import { putDevice, listDevices } from "@/repositories/mfa.js";
import { upsertPushSubscription, listPushSubscriptions } from "@/repositories/push.js";
import { presentEmailForDomainMigrations } from "@/services/domain-migration.js";
let fylo;
let testRoot;
beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), "caduceus-domain-migration-"));
  fylo = await createDb(testRoot);
});
afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});
describe("domain:migrate", () => {
  it("promotes old-domain users to the new suffix while preserving aliases and owned records", async () => {
    await putDomain(fylo, {
      domain: "old.example",
      inboundEnabled: true,
      routes: [{ id: "store-old.example", match: "*@old.example", action: { type: "store" }, enabled: true }]
    });
    await putUser(fylo, {
      email: "alice@old.example",
      phones: ["+15551234567"],
      domains: ["old.example"],
      role: "admin"
    });
    await putDevice(fylo, {
      id: "device-1",
      userEmail: "alice@old.example",
      name: "Phone",
      secret: "secret",
      createdAt: new Date().toISOString()
    });
    await upsertPushSubscription(fylo, {
      userEmail: "alice@old.example",
      endpoint: "https://push.example.test/alice",
      keys: { p256dh: "p256dh", auth: "auth" }
    });
    const dryRun = Bun.spawnSync([
      "bun",
      "scripts/migrate-domain.mjs",
      "--from=old.example",
      "--to=new.example"
    ], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, FYLO_ROOT: testRoot },
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(dryRun.exitCode).toBe(0);
    expect(JSON.parse(dryRun.stdout.toString()).dryRun).toBe(true);
    const applied = Bun.spawnSync([
      "bun",
      "scripts/migrate-domain.mjs",
      "--from=old.example",
      "--to=new.example",
      "--apply"
    ], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, FYLO_ROOT: testRoot },
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(applied.exitCode).toBe(0);
    const [, newDomain] = await findDomainEntry(fylo, "new.example");
    expect(newDomain).not.toBeNull();
    expect(newDomain.routes[0].match).toBe("*@new.example");
    const [, byNewEmail] = await findUserByEmail(fylo, "alice@new.example");
    expect(byNewEmail).not.toBeNull();
    expect(byNewEmail.email).toBe("alice@new.example");
    expect(byNewEmail.aliases).toContain("alice@old.example");
    expect(byNewEmail.domains).toContain("old.example");
    expect(byNewEmail.domains).toContain("new.example");
    const [, byOldAlias] = await findUserByEmail(fylo, "alice@old.example");
    expect(byOldAlias.email).toBe("alice@new.example");
    expect(await listDevices(fylo, "alice@old.example")).toHaveLength(0);
    expect(await listDevices(fylo, "alice@new.example")).toHaveLength(1);
    expect(await listPushSubscriptions(fylo, "alice@old.example")).toHaveLength(0);
    expect(await listPushSubscriptions(fylo, "alice@new.example")).toHaveLength(1);
    const migrations = await listDomainMigrations(fylo);
    expect(migrations.some((migration) => migration.fromDomain === "old.example" && migration.toDomain === "new.example")).toBe(true);
    await putEmail(fylo, {
      id: "old-mail-1",
      domain: "old.example",
      recipient: "alice@old.example",
      sender: "sender@example.test",
      subject: "Before migration",
      body: "Historical mail",
      folder: "inbox",
      read: false,
      starred: false,
      receivedAt: new Date().toISOString(),
      processed: true
    });
    const [, storedEmail] = await findEmailById(fylo, "old-mail-1");
    const presented = await presentEmailForDomainMigrations(fylo, storedEmail);
    expect(presented.recipient).toBe("alice@new.example");
    expect(presented.originalRecipient).toBe("alice@old.example");
  });
});
