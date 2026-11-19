import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_BODY_LIMIT_BYTES, contentDispositionFor } from "./attachment-routes.js";
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

/** R9 routes 2-5: upload, list by entity, download, delete. Files only ever go under os.tmpdir(). */
describe("attachments API: upload, list, download, delete", () => {
  let storageRoot: string;
  let repository: AccountingRepository;
  let app: ReturnType<typeof buildApi>;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-attachments-routes-"));
    repository = new AccountingRepository();
    app = buildApi(repository, { __unsafeDisableAuthForTests: true, attachmentStorageRoot: storageRoot });
  });

  afterEach(async () => {
    await app.close();
    repository.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  const upload = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/attachments", payload });
  const body = (bytes: Buffer, over: Record<string, unknown> = {}) => ({
    entityType: "INVOICE",
    entityId: "inv-1",
    fileName: "scan.pdf",
    mimeType: "application/pdf",
    contentBase64: bytes.toString("base64"),
    ...over,
  });
  const pdfBytes = (size: number): Buffer => {
    const bytes = Buffer.alloc(size, 0x41);
    bytes.write("%PDF-1.4\n", 0, "latin1");
    for (let i = 9; i < size; i += 7) bytes[i] = (i * 31) % 256;
    return bytes;
  };

  it("round-trips: upload, list, then download byte-identical with the stored Content-Type", async () => {
    const bytes = pdfBytes(5000);
    const created = await upload(body(bytes));
    expect(created.statusCode).toBe(201);
    const meta = created.json<Attachment>();
    expect(meta).toMatchObject({ entityType: "INVOICE", entityId: "inv-1", originalFilename: "scan.pdf", sizeBytes: 5000 });

    const listed = await app.inject({ method: "GET", url: "/attachments?entityType=INVOICE&entityId=inv-1" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<Attachment[]>().map((a) => a.id)).toEqual([meta.id]);
    const other = await app.inject({ method: "GET", url: "/attachments?entityType=INVOICE&entityId=inv-2" });
    expect(other.json<Attachment[]>()).toEqual([]);

    const content = await app.inject({ method: "GET", url: `/attachments/${meta.id}/content` });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toBe("application/pdf");
    expect(content.headers["content-disposition"]).toContain('filename="scan.pdf"');
    expect(Buffer.compare(content.rawPayload, bytes)).toBe(0);
  });

  it("accepts a body over Fastify's 1 MB default but under the cap (bodyLimit is on the route)", async () => {
    const bytes = Buffer.alloc(1_100_000, "a"); // ~1.47 MB once base64
    const payload = body(bytes, { fileName: "big.txt", mimeType: "text/plain" });
    expect(JSON.stringify(payload).length).toBeGreaterThan(1024 * 1024);
    const response = await upload(payload);
    expect(response.statusCode).toBe(201);
  });

  it("answers a file over the engine cap with 400 and the engine's own message", async () => {
    // Base64 of 10 MiB + 1 is ~14 MB: under the 15 MiB HTTP limit, so the ENGINE answers (not a bare 413).
    const bytes = Buffer.alloc(DEFAULT_MAX_ATTACHMENT_BYTES + 1, "a");
    const response = await upload(body(bytes, { fileName: "huge.txt", mimeType: "text/plain" }));
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("too large");
  });

  it("refuses invalid base64, an unknown entity type and a malformed body with 400", async () => {
    for (const junk of ["not base64!!", "QUJD*", "QUJDR", "QU=JD", "=QUJ"]) {
      const response = await upload(body(pdfBytes(20), { contentBase64: junk }));
      expect(response.statusCode, junk).toBe(400);
    }
    expect((await upload(body(pdfBytes(20), { entityType: "SPACESHIP" }))).statusCode).toBe(400);
    expect((await upload({ entityType: "INVOICE" })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/attachments?entityType=SPACESHIP&entityId=x" })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: "GET", url: "/attachments?entityType=INVOICE" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/attachments" })).statusCode).toBe(400);
  });

  it("answers 404 for content and delete of an attachment that does not exist", async () => {
    expect((await app.inject({ method: "GET", url: "/attachments/nope/content" })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/attachments/nope" })).statusCode).toBe(404);
  });

  it("deletes with 204, then content is 404 and the file is gone from disk", async () => {
    const meta = (await upload(body(pdfBytes(300)))).json<Attachment>();
    const onDisk = path.join(storageRoot, meta.storedFilename);
    expect(fs.existsSync(onDisk)).toBe(true);

    const deleted = await app.inject({ method: "DELETE", url: `/attachments/${meta.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(fs.existsSync(onDisk)).toBe(false);
    expect((await app.inject({ method: "GET", url: `/attachments/${meta.id}/content` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/attachments/${meta.id}` })).statusCode).toBe(404);
  });

  it("keeps Content-Disposition safe for a file name with a quote, a newline or non-ASCII", async () => {
    // A quote survives the engine's name check and so reaches the header through the real route.
    const meta = (await upload(body(pdfBytes(50), { fileName: 'bad"name.pdf' }))).json<Attachment>();
    const header = (await app.inject({ method: "GET", url: `/attachments/${meta.id}/content` })).headers[
      "content-disposition"
    ] as string;
    expect(header).toBe(`attachment; filename="badname.pdf"; filename*=UTF-8''badname.pdf`);

    // The engine refuses control characters on the way in; a row written some other way must still be safe.
    repository.db.prepare("UPDATE attachments SET original_filename = ? WHERE id = ?").run('a"b\r\nSet-Cookie: x=1.pdf', meta.id);
    const forced = (await app.inject({ method: "GET", url: `/attachments/${meta.id}/content` })).headers[
      "content-disposition"
    ] as string;
    expect(forced).not.toMatch(/[\r\n]/);
    expect(forced.startsWith('attachment; filename="abSet-Cookie: x=1.pdf"')).toBe(true);

    expect(contentDispositionFor("r\u00e9sum\u00e9.pdf")).toBe(
      `attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
    );
  });

  it("refuses all four new routes with 401 when auth is not disabled", async () => {
    const guarded = buildApi(repository, { attachmentStorageRoot: storageRoot });
    try {
      await guarded.ready();
      // An admin must exist first, otherwise every route answers 409 and proves nothing about tokens.
      const setup = await guarded.inject({
        method: "POST",
        url: "/auth/setup",
        payload: { password: "correct horse battery staple 42" },
      });
      expect(setup.statusCode).toBe(201);
      const post = await guarded.inject({ method: "POST", url: "/attachments", payload: body(pdfBytes(20)) });
      const list = await guarded.inject({ method: "GET", url: "/attachments?entityType=INVOICE&entityId=a" });
      const content = await guarded.inject({ method: "GET", url: "/attachments/x/content" });
      const del = await guarded.inject({ method: "DELETE", url: "/attachments/x" });
      expect([post, list, content, del].map((r) => r.statusCode)).toEqual([401, 401, 401, 401]);
    } finally {
      await guarded.close();
    }
  });
});
