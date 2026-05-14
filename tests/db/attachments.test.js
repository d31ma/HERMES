import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb } from "@/repositories/index.js";
import {
  deleteAttachmentsForEmail,
  findAttachmentById,
  listAttachmentSummaries,
  readAttachmentContent,
  saveEmailAttachments
} from "@/repositories/attachments.js";
let fylo;
let testRoot;
let previousFyloRoot;
let previousAttachmentRoot;
beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), "caduceus-attachments-test-"));
  previousFyloRoot = process.env.FYLO_ROOT;
  previousAttachmentRoot = process.env.ATTACHMENT_ROOT;
  process.env.FYLO_ROOT = testRoot;
  delete process.env.ATTACHMENT_ROOT;
  fylo = await createDb(testRoot);
});
afterEach(() => {
  if (previousFyloRoot === undefined)
    delete process.env.FYLO_ROOT;
  else
    process.env.FYLO_ROOT = previousFyloRoot;
  if (previousAttachmentRoot === undefined)
    delete process.env.ATTACHMENT_ROOT;
  else
    process.env.ATTACHMENT_ROOT = previousAttachmentRoot;
  rmSync(testRoot, { recursive: true, force: true });
});
describe("email attachment storage", () => {
  it("saves metadata and file content", async () => {
    const summaries = await saveEmailAttachments(fylo, "msg-1", "example.com", [
      {
        filename: "hello.txt",
        contentType: "text/plain",
        content: new TextEncoder().encode("hello attachment"),
        disposition: "attachment"
      }
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].filename).toBe("hello.txt");
    expect(summaries[0].size).toBe("hello attachment".length);
    const [docId, record] = await findAttachmentById(fylo, summaries[0].id);
    expect(docId).not.toBeNull();
    expect(record?.emailId).toBe("msg-1");
    expect(new TextDecoder().decode(await readAttachmentContent(record))).toBe("hello attachment");
  });
  it("lists summaries without storage paths", async () => {
    await saveEmailAttachments(fylo, "msg-1", "example.com", [
      { filename: "a.txt", contentType: "text/plain", content: new TextEncoder().encode("a") }
    ]);
    const summaries = await listAttachmentSummaries(fylo, "msg-1");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].storagePath).toBeUndefined();
  });
  it("deletes metadata and files for an email", async () => {
    const [summary] = await saveEmailAttachments(fylo, "msg-1", "example.com", [
      { filename: "gone.txt", contentType: "text/plain", content: new TextEncoder().encode("gone") }
    ]);
    await deleteAttachmentsForEmail(fylo, "msg-1");
    const [, record] = await findAttachmentById(fylo, summary.id);
    expect(record).toBeNull();
  });
});
