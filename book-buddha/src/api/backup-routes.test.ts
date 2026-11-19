import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import type { BackupManifest, BackupVerification } from "../backup/backup.js";
import { buildApi } from "./server.js";

let tmp: string;
let backupsRoot: string;
let attachmentsRoot: string;
let repository: AccountingRepository;
let app: ReturnType<typeof buildApi>;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-backup-api-"));
  backupsRoot = path.join(tmp, "backups");
  attachmentsRoot = path.join(tmp, "attachments");
  repository = new AccountingRepository();
  // buildApi registers the backup routes itself (R11 wiring); the test only points them at its own
  // temporary folders, so nothing is ever written outside `tmp`.
  app = buildApi(repository, { __unsafeDisableAuthForTests: true, attachmentStorageRoot: attachmentsRoot, backupsRoot });
});

afterEach(async () => {
  await app.close();
  repository.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("backup routes", () => {
  it("creates, lists and verifies a backup", async () => {
    const created = await app.inject({ method: "POST", url: "/backups", payload: { scope: "DATABASE_ONLY", label: "before audit" } });
    expect(created.statusCode).toBe(201);
    const manifest = created.json<BackupManifest>();
    expect(manifest.label).toBe("before audit");
    expect(manifest.kind).toBe("MANUAL");
    expect(manifest.notIncluded.join(" ")).toContain("attached files");

    const listed = await app.inject({ method: "GET", url: "/backups" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ backups: Array<{ id: string }> }>().backups.map((b) => b.id)).toEqual([manifest.id]);

    const verified = await app.inject({ method: "POST", url: `/backups/${manifest.id}/verify` });
    expect(verified.statusCode).toBe(200);
    expect(verified.json<BackupVerification>().ok).toBe(true);
  });

  it("verify reports a damaged backup as not ok", async () => {
    const manifest = (await app.inject({ method: "POST", url: "/backups", payload: { scope: "DATABASE_ONLY" } })).json<BackupManifest>();
    fs.appendFileSync(path.join(backupsRoot, manifest.id, "book-buddha.db"), "x");
    const verified = await app.inject({ method: "POST", url: `/backups/${manifest.id}/verify` });
    expect(verified.statusCode).toBe(200);
    expect(verified.json<BackupVerification>().ok).toBe(false);
  });

  it("bad bodies are 400", async () => {
    for (const payload of [{}, { scope: "ALL" }, { scope: "DATABASE_ONLY", label: "" }]) {
      const res = await app.inject({ method: "POST", url: "/backups", payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("a well-formed id that does not exist is 404", async () => {
    const res = await app.inject({ method: "POST", url: "/backups/bk-20260101T000000000Z-abcdef/verify" });
    expect(res.statusCode).toBe(404);
  });

  it("an id that tries to leave the backups folder is refused and nothing outside the root is touched", async () => {
    // A decoy OUTSIDE the root that a traversal would reach; it must not be verified or changed.
    const decoy = path.join(tmp, "decoy");
    fs.mkdirSync(decoy);
    fs.writeFileSync(path.join(decoy, "manifest.json"), "{}");
    fs.mkdirSync(backupsRoot, { recursive: true });
    for (const id of ["..%2Fdecoy", "..%5Cdecoy", "%2E%2E%2Fdecoy", "bk-1", "..", encodeURIComponent(decoy)]) {
      const res = await app.inject({ method: "POST", url: `/backups/${id}/verify` });
      expect([400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(200);
    }
    expect(fs.readFileSync(path.join(decoy, "manifest.json"), "utf8")).toBe("{}");
    expect(fs.readdirSync(decoy)).toEqual(["manifest.json"]);
  });

  it("EVERYTHING scope includes attachment files", async () => {
    fs.mkdirSync(attachmentsRoot, { recursive: true });
    fs.writeFileSync(path.join(attachmentsRoot, "a.txt"), "hello");
    const res = await app.inject({ method: "POST", url: "/backups", payload: { scope: "EVERYTHING" } });
    expect(res.statusCode).toBe(201);
    expect(res.json<BackupManifest>().files.map((f) => f.path)).toContain("attachments/a.txt");
  });

  it("there is no restore route", async () => {
    const res = await app.inject({ method: "POST", url: "/backups/bk-20260101T000000000Z-abcdef/restore" });
    expect(res.statusCode).toBe(404);
  });
});
