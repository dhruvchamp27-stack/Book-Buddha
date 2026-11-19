import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_BODY_LIMIT_BYTES } from "./attachment-routes.js";
import { buildApi, resolveAttachmentStorageRoot } from "./server.js";
import { DEFAULT_MAX_ATTACHMENT_BYTES, storeAttachment, type Attachment } from "../attachments/attachments.js";
import { AccountingRepository } from "../database/repository.js";

/**
 * R9, the HTTP door onto attachments.
 *
 * The storage engine has been built and tested since session 2 and REACHABLE FROM NOTHING: 24
 * passing tests, a registered migration, and no route anywhere. This file covers the door itself —
 * the metadata route, the error mapping every other attachment route will go through, and the
 * body limit base64 forces on us (S11-19). The upload, list, download and delete routes are the
 * rest of R9 and bring their own tests.
 */
describe("attachments API", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-attachments-"));
  });

  afterEach(() => {
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it("answers metadata for a stored attachment and 404 for one that does not exist", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true, attachmentStorageRoot: storageRoot });
    try {
      const stored = storeAttachment(repository.db, storageRoot, {
        entityType: "INVOICE",
        entityId: "inv-1",
        originalFilename: "bill.txt",
        mimeType: "text/plain",
        content: Buffer.from("two atlases, Rs 250 each\n"),
      });

      const found = await app.inject({ method: "GET", url: `/attachments/${stored.id}` });
      expect(found.statusCode).toBe(200);
      // The bytes are NOT in the answer: this route says what the file is, not what is in it.
      expect(found.json<Attachment>()).toMatchObject({
        id: stored.id,
        entityType: "INVOICE",
        entityId: "inv-1",
        originalFilename: "bill.txt",
        mimeType: "text/plain",
        sizeBytes: 25,
        sha256: stored.sha256,
      });
      expect(found.json<Record<string, unknown>>().content).toBeUndefined();

      // Not found is 404, not 500 and not an empty 200 that reads as "no file attached".
      const missing = await app.inject({ method: "GET", url: "/attachments/no-such-id" });
      expect(missing.statusCode).toBe(404);
      expect(missing.json<{ error: string }>().error).toContain("no-such-id");
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("protects the attachment routes like every other route", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      const attachmentRoutes = app.authRoutes.filter((route) => route.url.startsWith("/attachments"));
      expect(attachmentRoutes.length).toBeGreaterThan(0);
      expect(attachmentRoutes.filter((route) => route.isPublic)).toEqual([]);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("raises the body limit far enough for a 10 MiB file sent as base64", () => {
    // S11-19: base64 inside ordinary JSON, so the HTTP limit must clear the ENGINE's cap inflated
    // by 4/3. Fastify's default is 1 MB, which would refuse a 1 MB PDF outright.
    expect(ATTACHMENT_BODY_LIMIT_BYTES).toBeGreaterThan(DEFAULT_MAX_ATTACHMENT_BYTES * (4 / 3));
    expect(ATTACHMENT_BODY_LIMIT_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it("puts the files beside the database, and takes an explicit folder over that", () => {
    const beside = resolveAttachmentStorageRoot(path.join("C:", "books", "book-buddha.db"));
    expect(beside).toBe(path.join(path.resolve(path.join("C:", "books")), "attachments"));

    // An in-memory database has no folder of its own to sit beside.
    expect(resolveAttachmentStorageRoot(":memory:")).toBe(path.resolve("attachments"));

    // The explicit option wins over both, which is how a test keeps its files in a temp folder.
    expect(resolveAttachmentStorageRoot(path.join("C:", "books", "book-buddha.db"), storageRoot)).toBe(
      path.resolve(storageRoot),
    );
  });
});
