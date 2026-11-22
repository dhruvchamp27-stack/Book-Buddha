import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAttachmentsSchema } from "../database/attachments-schema.js";
import { AUDIT_NEW_COLUMNS } from "../database/audit-chain-schema.js";
import { verifyAuditChain } from "../database/audit-log.js";
import {
  deleteAttachment,
  getAttachment,
  getAttachmentPath,
  listAttachments,
  storeAttachment,
  type AttachmentEntityType,
  type StoreAttachmentInput,
} from "./attachments.js";

const PDF = Buffer.from("%PDF-1.4\nhello book buddha\n%%EOF");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("data")]);

let db: Database.Database;
let sandbox: string;
let root: string;

function snapshot(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

function pdf(originalFilename: string, extra: Partial<StoreAttachmentInput> = {}): StoreAttachmentInput {
  return {
    entityType: "INVOICE",
    entityId: "inv-1",
    originalFilename,
    mimeType: "application/pdf",
    content: PDF,
    ...extra,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  applyAttachmentsSchema(db);
  // Attachment writes are audited, so the audit log (legacy table + the hash-chain columns, without the journal triggers) must exist, as in the real database.
  db.exec("CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_id TEXT NOT NULL, occurred_at TEXT NOT NULL)");
  for (const [name, type] of AUDIT_NEW_COLUMNS) db.exec(`ALTER TABLE audit_events ADD COLUMN ${name} ${type}`);
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bb-attach-"));
  root = path.join(sandbox, "store");
});

afterEach(() => {
  db.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("attachments", () => {
  it("stores, lists, gets, reads back and deletes", () => {
    const saved = storeAttachment(db, root, pdf("Invoice 001.pdf", { createdBy: "dhruv" }));
    expect(saved.originalFilename).toBe("Invoice 001.pdf");
    expect(saved.storedFilename).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(saved.sizeBytes).toBe(PDF.length);
    expect(saved.createdBy).toBe("dhruv");

    expect(listAttachments(db, "INVOICE", "inv-1")).toEqual([saved]);
    expect(getAttachment(db, saved.id)).toEqual(saved);
    const onDisk = getAttachmentPath(root, saved);
    expect(fs.readFileSync(onDisk).equals(PDF)).toBe(true);

    deleteAttachment(db, root, saved.id);
    expect(getAttachment(db, saved.id)).toBeNull();
    expect(fs.existsSync(onDisk)).toBe(false);
    expect(snapshot(root)).toEqual([]);
  });

  it("audits an upload and a delete, and the audit chain still verifies", () => {
    const saved = storeAttachment(db, root, pdf("Invoice 001.pdf"));
    deleteAttachment(db, root, saved.id);
    const events = db.prepare("SELECT action, entity_type, entity_id, before_values, after_values FROM audit_events ORDER BY id").all() as Array<{
      action: string; entity_type: string; entity_id: string; before_values: string | null; after_values: string | null;
    }>;
    expect(events.map((e) => e.action)).toEqual(["attachment.uploaded", "attachment.deleted"]);
    expect(events.every((e) => e.entity_type === "attachment" && e.entity_id === saved.id)).toBe(true);
    expect(JSON.parse(events[0]?.after_values ?? "{}")).toEqual({ entityType: "INVOICE", entityId: "inv-1", filename: "Invoice 001.pdf", sha256: saved.sha256 });
    expect(JSON.parse(events[1]?.before_values ?? "{}")).toMatchObject({ filename: "Invoice 001.pdf", sha256: saved.sha256 });
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("computes the correct sha256", () => {
    const saved = storeAttachment(db, root, pdf("a.pdf"));
    expect(saved.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
    const known = storeAttachment(db, root, {
      entityType: "EXPENSE",
      entityId: "e1",
      originalFilename: "n.txt",
      mimeType: "text/plain",
      content: Buffer.from("abc"),
    });
    expect(known.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("rejects an oversized file and respects a custom limit", () => {
    expect(() => storeAttachment(db, root, pdf("a.pdf", { maxSizeBytes: 10 }))).toThrow(/too large/);
    expect(listAttachments(db, "INVOICE", "inv-1")).toHaveLength(0);
    expect(() => storeAttachment(db, root, pdf("a.pdf", { maxSizeBytes: PDF.length }))).not.toThrow();
  });

  it("rejects a disallowed MIME type", () => {
    expect(() =>
      storeAttachment(db, root, pdf("run.exe", { mimeType: "application/x-msdownload" })),
    ).toThrow(/not allowed/);
    expect(() => storeAttachment(db, root, pdf("a.html", { mimeType: "text/html" }))).toThrow(/not allowed/);
  });

  it("rejects a mismatched extension and MIME pair", () => {
    expect(() => storeAttachment(db, root, pdf("scan.png"))).toThrow(/does not match/);
    expect(() =>
      storeAttachment(db, root, pdf("scan.pdf", { mimeType: "image/png", content: PNG })),
    ).toThrow(/does not match/);
    expect(() => storeAttachment(db, root, pdf("noextension"))).toThrow(/does not match/);
  });

  it("rejects content that does not match the declared type", () => {
    expect(() => storeAttachment(db, root, pdf("fake.pdf", { content: Buffer.from("not a pdf") }))).toThrow(
      /does not look like/,
    );
  });

  it("rejects empty files, unknown entity types and blank entity ids", () => {
    expect(() => storeAttachment(db, root, pdf("a.pdf", { content: Buffer.alloc(0) }))).toThrow(/empty/);
    expect(() =>
      storeAttachment(db, root, pdf("a.pdf", { entityType: "BANK" as unknown as AttachmentEntityType })),
    ).toThrow(/entity type/);
    expect(() => storeAttachment(db, root, pdf("a.pdf", { entityId: " " }))).toThrow(/entity id/);
  });

  describe("path traversal", () => {
    const hostile = [
      "../../evil.pdf",
      "..\\..\\evil.pdf",
      "/etc/passwd",
      "C:\\Windows\\system32\\evil.pdf",
      "\\\\server\\share\\evil.pdf",
      "evil\0.pdf",
      `${"a".repeat(300)}.pdf`,
      "..",
      "../",
    ];

    it.each(hostile)("neutralises or refuses %j without writing outside the root", (name) => {
      const before = snapshot(sandbox);
      let saved: ReturnType<typeof storeAttachment> | undefined;
      try {
        saved = storeAttachment(db, root, pdf(name));
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
      const added = snapshot(sandbox).filter((entry) => !before.includes(entry));
      for (const entry of added) {
        expect(entry === "store" || entry.startsWith(`store${path.sep}`)).toBe(true);
      }
      expect(fs.existsSync(path.join(sandbox, "evil.pdf"))).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(sandbox), "evil.pdf"))).toBe(false);
      if (saved) {
        expect(saved.storedFilename).not.toMatch(/[\\/]/);
        expect(saved.originalFilename).not.toMatch(/[\\/\0]/);
        const full = getAttachmentPath(root, saved);
        expect(path.dirname(full)).toBe(path.resolve(root));
        expect(fs.existsSync(full)).toBe(true);
      }
    });

    it("refuses control characters and over-long names outright", () => {
      expect(() => storeAttachment(db, root, pdf("evil\0.pdf"))).toThrow(/control characters/);
      expect(() => storeAttachment(db, root, pdf(`${"a".repeat(300)}.pdf`))).toThrow(/too long/);
    });

    it("neutralises directory parts to the bare file name", () => {
      expect(storeAttachment(db, root, pdf("../../evil.pdf")).originalFilename).toBe("evil.pdf");
      expect(storeAttachment(db, root, pdf("C:\\Windows\\system32\\evil.pdf")).originalFilename).toBe("evil.pdf");
      expect(storeAttachment(db, root, pdf("\\\\server\\share\\evil.pdf")).originalFilename).toBe("evil.pdf");
    });

    it("refuses to resolve a tampered stored filename from the database", () => {
      const saved = storeAttachment(db, root, pdf("a.pdf"));
      for (const bad of ["../escape.pdf", "..\\escape.pdf", "/abs.pdf", "sub/x.pdf"]) {
        expect(() => getAttachmentPath(root, { ...saved, storedFilename: bad })).toThrow(/Unsafe|escapes/);
      }
    });
  });

  it("does not collide when two files share an original filename", () => {
    const a = storeAttachment(db, root, pdf("same.pdf"));
    const b = storeAttachment(db, root, pdf("same.pdf", { content: Buffer.from("%PDF-1.7 other") }));
    expect(a.storedFilename).not.toBe(b.storedFilename);
    expect(fs.readFileSync(getAttachmentPath(root, a)).equals(PDF)).toBe(true);
    expect(fs.readFileSync(getAttachmentPath(root, b)).toString()).toBe("%PDF-1.7 other");
    expect(snapshot(root)).toHaveLength(2);
  });

  it("scopes listing by entity type and id", () => {
    const a = storeAttachment(db, root, pdf("a.pdf", { entityId: "inv-1" }));
    storeAttachment(db, root, pdf("b.pdf", { entityId: "inv-2" }));
    storeAttachment(db, root, pdf("c.pdf", { entityType: "PURCHASE_BILL", entityId: "inv-1" }));
    expect(listAttachments(db, "INVOICE", "inv-1")).toEqual([a]);
    expect(listAttachments(db, "INVOICE", "inv-2")).toHaveLength(1);
    expect(listAttachments(db, "PURCHASE_BILL", "inv-1")).toHaveLength(1);
    expect(listAttachments(db, "FAIR", "inv-1")).toHaveLength(0);
  });

  it("deleting an unknown id fails clearly and leaves files alone", () => {
    const saved = storeAttachment(db, root, pdf("a.pdf"));
    expect(() => deleteAttachment(db, root, "missing")).toThrow(/not found/);
    expect(fs.existsSync(getAttachmentPath(root, saved))).toBe(true);
  });

  it("removes the file again if the database insert fails", () => {
    db.exec("DROP TABLE attachments");
    expect(() => storeAttachment(db, root, pdf("a.pdf"))).toThrow();
    expect(snapshot(root)).toEqual([]);
  });

  it("applying the schema twice is harmless", () => {
    expect(() => applyAttachmentsSchema(db)).not.toThrow();
  });
});
