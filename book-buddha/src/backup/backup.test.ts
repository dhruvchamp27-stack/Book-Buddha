import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreditNote, Invoice } from "../accounting/types.js";
import { migrations, runMigrations } from "../database/migrations.js";
import { AccountingRepository } from "../database/repository.js";
import {
  BACKUP_ID_PATTERN,
  BackupError,
  createBackup,
  listBackups,
  resolveBackupFolder,
  restoreBackup,
  runAutomaticBackup,
  verifyBackup,
} from "./backup.js";

/**
 * Every file this suite touches lives in ONE fresh directory under os.tmpdir(), removed afterwards.
 * Nothing here reads or writes the repo folder, the home folder or BOOK_BUDDHA_DATABASE.
 */
let tmp: string;
let dbPath: string;
let backupsRoot: string;
let attachmentsRoot: string;
const opened: Array<{ close(): unknown }> = [];

const track = <T extends { close(): unknown }>(x: T): T => {
  opened.push(x);
  return x;
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-backup-"));
  dbPath = path.join(tmp, "live", "book-buddha.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  backupsRoot = path.join(tmp, "backups");
  attachmentsRoot = path.join(tmp, "live", "attachments");
});

afterEach(() => {
  for (const handle of opened.splice(0)) {
    try {
      handle.close();
    } catch {
      // already closed
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Real books: stock opening, a bill for stock, an invoice, a partial payment, a credit note. */
function buildBooks(repo: AccountingRepository): void {
  const companyId = repo.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repo.createBusiness({ companyId, name: "Biz" });
  const customerId = repo.createCustomer({ companyId, name: "Customer" });
  const supplierId = repo.createSupplier({ companyId, name: "Supplier" });
  const itemId = repo.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  repo.addStockMovement({ itemId, movementType: "OPENING", quantity: 20, unitCostPaise: 4000, businessId, occurredOn: "2026-04-02" });
  const bill = repo.createPurchaseBill({
    businessId, supplierId, number: "PB-1", billDate: "2026-04-10", paymentAccount: "CASH",
    taxType: "CGST_SGST", taxRateBasisPoints: 1800,
    lines: [{ itemId, description: "Atlas", quantity: 10, unitPricePaise: 5000 }],
  });
  repo.finalizePurchaseBill(bill.id);
  const invoice: Invoice = {
    id: "inv1", number: "INV-1", businessId, customerId, invoiceDate: "2026-04-15", status: "DRAFT",
    paymentAccount: "RECEIVABLES", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
    lines: [{ itemId, description: "Atlas", quantity: 6, unitPricePaise: 9000 }],
  };
  repo.saveDraft(invoice);
  repo.finalizeInvoice("inv1");
  repo.recordPayment("inv1", 20000, "2026-04-20");
  const note: CreditNote = {
    id: "cn1", invoiceId: "inv1", number: "CN-1", reason: "Return", status: "DRAFT",
    lines: [{ itemId, description: "Returned", quantity: 1, unitPricePaise: 9000 }],
  };
  repo.saveCreditNote(note);
  repo.finalizeCreditNote("cn1");
}

const figures = (repo: AccountingRepository) => ({
  trialBalance: repo.getTrialBalance(),
  receivables: repo.getReceivables(),
  inventory: repo.getInventoryValuation(),
});

describe("backup of real books", () => {
  it("restored books show exactly the same numbers", async () => {
    const live = track(new AccountingRepository(dbPath));
    buildBooks(live);
    const before = figures(live);
    expect(before.trialBalance.length).toBeGreaterThan(3);
    expect(before.receivables.length).toBeGreaterThan(0);
    expect(before.inventory.length).toBeGreaterThan(0);

    const manifest = await createBackup(live.db, { backupsRoot, scope: "DATABASE_ONLY", label: "test" });
    expect(manifest.status).toBe("OK");
    expect(manifest.rowCounts.invoices).toBe(1);
    expect(manifest.schemaVersion).toBe(migrations[migrations.length - 1]?.version);
    expect(manifest.files.map((f) => f.path)).toEqual(["book-buddha.db"]);
    live.close();

    const target = path.join(tmp, "restored", "book-buddha.db");
    const result = await restoreBackup({ folder: resolveBackupFolder(backupsRoot, manifest.id), targetDbPath: target });
    expect(result.preRestoreBackup).toBeNull();
    expect(result.verification.every((c) => c.ok)).toBe(true);

    const restored = track(new AccountingRepository(target));
    expect(figures(restored)).toEqual(before);
    restored.close();
  });

  it("an existing prototype database restores and still migrates", async () => {
    const old = track(new Database(dbPath));
    old.pragma("foreign_keys = ON");
    runMigrations(old, migrations.filter((m) => m.version <= 15));
    old.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Old Co', '2026-01-01')").run();
    old.prepare("INSERT INTO businesses (id, company_id, name, created_at) VALUES ('b1', 'c1', 'Old Biz', '2026-01-01')").run();
    const manifest = await createBackup(old, { backupsRoot, scope: "DATABASE_ONLY" });
    expect(manifest.schemaVersion).toBe(15);
    old.close();

    const target = path.join(tmp, "restored", "book-buddha.db");
    const result = await restoreBackup({ folder: resolveBackupFolder(backupsRoot, manifest.id), targetDbPath: target });
    expect(result.schemaVersionInBackup).toBe(15);
    expect(result.schemaVersionNow).toBe(migrations[migrations.length - 1]?.version);
    expect(result.warnings.join(" ")).toContain("older version");

    const check = track(new Database(target, { readonly: true }));
    expect(check.prepare("SELECT name FROM companies").all()).toEqual([{ name: "Old Co" }]);
    expect(check.prepare("SELECT name FROM businesses").all()).toEqual([{ name: "Old Biz" }]);
    expect((check.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v).toBe(migrations[migrations.length - 1]?.version);
    check.close();
  });
});

describe("verification", () => {
  async function oneBackup(): Promise<string> {
    const live = track(new AccountingRepository(dbPath));
    buildBooks(live);
    const m = await createBackup(live.db, { backupsRoot, scope: "DATABASE_ONLY" });
    live.close();
    return resolveBackupFolder(backupsRoot, m.id);
  }

  it("a clean backup passes every check", async () => {
    const folder = await oneBackup();
    const v = verifyBackup(folder);
    expect(v.ok).toBe(true);
    expect(v.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(["manifest", "sha256:book-buddha.db", "integrity_check", "foreign_key_check", "journal_balances", "journal_entries_balance"]),
    );
  });

  it("changing one byte of the database fails the SHA-256 check", async () => {
    const folder = await oneBackup();
    const file = path.join(folder, "book-buddha.db");
    const bytes = fs.readFileSync(file);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    fs.writeFileSync(file, bytes);
    const v = verifyBackup(folder);
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name === "sha256:book-buddha.db")?.ok).toBe(false);
  });

  it("an unbalanced journal is named by the journal checks", async () => {
    const folder = await oneBackup();
    const file = path.join(folder, "book-buddha.db");
    const db = track(new Database(file));
    // Triggers may protect the journal; the point is a damaged file, so drop them in this COPY only.
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>) db.exec(`DROP TRIGGER "${t.name}"`);
    db.prepare("UPDATE journal_lines SET debit_paise = debit_paise + 1 WHERE id = (SELECT MIN(id) FROM journal_lines WHERE debit_paise > 0)").run();
    db.close();
    const v = verifyBackup(folder);
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name === "journal_balances")?.ok).toBe(false);
    expect(v.checks.find((c) => c.name === "journal_entries_balance")?.ok).toBe(false);
  });

  it("a missing manifest is reported, and a folder without one is listed as incomplete", async () => {
    const folder = await oneBackup();
    fs.rmSync(path.join(folder, "manifest.json"));
    expect(verifyBackup(folder).ok).toBe(false);
    const entries = listBackups(backupsRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.manifest).toBeNull();
    expect(entries[0]?.problem).toContain("manifest");
  });

  it("a leftover half-written backup folder is listed, not hidden", () => {
    fs.mkdirSync(path.join(backupsRoot, ".tmp-bk-whatever"), { recursive: true });
    const entries = listBackups(backupsRoot);
    expect(entries.map((e) => e.id)).toEqual([".tmp-bk-whatever"]);
    expect(entries[0]?.problem).toContain("Unfinished");
  });
});

describe("scope", () => {
  it("EVERYTHING carries attachment files byte for byte; DATABASE_ONLY does not and says so", async () => {
    const live = track(new AccountingRepository(dbPath));
    fs.mkdirSync(path.join(attachmentsRoot, "2026"), { recursive: true });
    const payload = Buffer.from([0, 1, 2, 3, 250, 251, 252]);
    fs.writeFileSync(path.join(attachmentsRoot, "2026", "scan.bin"), payload);

    const full = await createBackup(live.db, { backupsRoot, attachmentsRoot, scope: "EVERYTHING" });
    expect(full.files.map((f) => f.path)).toEqual(["book-buddha.db", "attachments/2026/scan.bin"]);
    expect(fs.readFileSync(path.join(resolveBackupFolder(backupsRoot, full.id), "attachments", "2026", "scan.bin"))).toEqual(payload);
    expect(full.included.join(" ")).toContain("attached files themselves");

    const dbOnly = await createBackup(live.db, { backupsRoot, attachmentsRoot, scope: "DATABASE_ONLY" });
    expect(dbOnly.files.map((f) => f.path)).toEqual(["book-buddha.db"]);
    expect(dbOnly.notIncluded.join(" ")).toContain("attached files");
    expect(fs.existsSync(path.join(resolveBackupFolder(backupsRoot, dbOnly.id), "attachments"))).toBe(false);

    await expect(createBackup(live.db, { backupsRoot, scope: "EVERYTHING" })).rejects.toBeInstanceOf(BackupError);
    // No leftover temp folder after the refusal.
    expect(fs.readdirSync(backupsRoot).some((n) => n.startsWith(".tmp-"))).toBe(false);
    live.close();
  });
});

describe("restore", () => {
  it("backs up what it replaces first, moves it aside, restores attachments, and keeps users and counters on request", async () => {
    const live = track(new AccountingRepository(dbPath));
    const companyId = live.createCompany({ name: "Co" });
    live.createCustomer({ companyId, name: "A" });
    fs.mkdirSync(attachmentsRoot, { recursive: true });
    fs.writeFileSync(path.join(attachmentsRoot, "old.txt"), "in the backup");
    const backup = await createBackup(live.db, { backupsRoot, attachmentsRoot, scope: "EVERYTHING" });

    // Life goes on after the backup: more customers (counter moves), an admin appears, a new file.
    live.createCustomer({ companyId, name: "B" });
    live.createCustomer({ companyId, name: "C" });
    const password = "Correct-Horse-Battery-42";
    live.setupAdmin({ password });
    fs.writeFileSync(path.join(attachmentsRoot, "new.txt"), "after the backup");
    const counterNow = live.db.prepare("SELECT next_seq FROM customer_number_counters").all();
    live.close();

    const result = await restoreBackup({
      folder: resolveBackupFolder(backupsRoot, backup.id),
      targetDbPath: dbPath,
      targetAttachmentsRoot: attachmentsRoot,
      preRestoreBackupsRoot: backupsRoot,
      options: { preserveUsers: true, preserveCounters: true },
    });

    // Pre-restore backup exists, is kept, and verifies; it holds the customers that are about to vanish.
    expect(result.preRestoreBackup?.kind).toBe("PRE_RESTORE");
    expect(result.preRestoreBackup?.rowCounts.customers).toBe(3);
    expect(verifyBackup(resolveBackupFolder(backupsRoot, result.preRestoreBackup?.id ?? "")).ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/2 customer\(s\) entered after the backup/);
    // Nothing destroyed: the old files are moved aside.
    expect(result.movedAside.length).toBeGreaterThanOrEqual(2);
    for (const p of result.movedAside) expect(fs.existsSync(p)).toBe(true);

    // Attachments are the backup's, byte for byte (new.txt went aside with the old folder).
    expect(fs.readFileSync(path.join(attachmentsRoot, "old.txt"), "utf8")).toBe("in the backup");
    expect(fs.existsSync(path.join(attachmentsRoot, "new.txt"))).toBe(false);

    const restored = track(new AccountingRepository(dbPath));
    expect(restored.db.prepare("SELECT COUNT(*) AS n FROM customers").get()).toEqual({ n: 1 });
    // preserveUsers: the current admin can still sign in.
    expect(restored.login(password).token).toBeTruthy();
    // preserveCounters: the next number is NOT moved back to where the backup was.
    expect(restored.db.prepare("SELECT next_seq FROM customer_number_counters").all()).toEqual(counterNow);
    restored.close();
  });

  it("without preserveUsers the backup's own users come back, and old sessions are discarded", async () => {
    const live = track(new AccountingRepository(dbPath));
    const password = "Correct-Horse-Battery-42";
    live.setupAdmin({ password });
    live.login(password);
    expect((live.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get() as { n: number }).n).toBe(1);
    const backup = await createBackup(live.db, { backupsRoot, scope: "DATABASE_ONLY" });
    live.close();

    const target = path.join(tmp, "elsewhere", "book-buddha.db");
    const result = await restoreBackup({ folder: resolveBackupFolder(backupsRoot, backup.id), targetDbPath: target });
    expect(result.warnings.join(" ")).toContain("sign in again");
    const restored = track(new AccountingRepository(target));
    expect((restored.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get() as { n: number }).n).toBe(0);
    expect(restored.login(password).token).toBeTruthy();
    restored.close();
  });

  it("refuses a tampered backup and leaves an existing database exactly as it was", async () => {
    const live = track(new AccountingRepository(dbPath));
    buildBooks(live);
    const backup = await createBackup(live.db, { backupsRoot, scope: "DATABASE_ONLY" });
    live.close();
    const folder = resolveBackupFolder(backupsRoot, backup.id);
    fs.appendFileSync(path.join(folder, "book-buddha.db"), "x");
    const liveBytes = fs.readFileSync(dbPath);
    await expect(restoreBackup({ folder, targetDbPath: dbPath, preRestoreBackupsRoot: backupsRoot })).rejects.toThrow(/NOT restored/);
    expect(fs.readFileSync(dbPath)).toEqual(liveBytes);
    expect(listBackups(backupsRoot)).toHaveLength(1);
  });

  it("refuses to replace an existing database when no pre-restore location is given", async () => {
    const live = track(new AccountingRepository(dbPath));
    const backup = await createBackup(live.db, { backupsRoot, scope: "DATABASE_ONLY" });
    live.close();
    await expect(restoreBackup({ folder: resolveBackupFolder(backupsRoot, backup.id), targetDbPath: dbPath })).rejects.toThrow(/pre-restore/);
  });
});

describe("automatic backups", () => {
  const T0 = new Date("2026-11-01T06:00:00.000Z");
  const hours = (n: number): Date => new Date(T0.getTime() + n * 3600_000);

  it("a second call within 24 hours does nothing, and one after 24 hours makes a new backup", async () => {
    const repo = track(new AccountingRepository());
    const first = await runAutomaticBackup(repo.db, { backupsRoot, now: T0 });
    expect(first.created?.kind).toBe("AUTOMATIC");
    expect(first.created?.scope).toBe("DATABASE_ONLY");
    const second = await runAutomaticBackup(repo.db, { backupsRoot, now: hours(23) });
    expect(second.created).toBeNull();
    const third = await runAutomaticBackup(repo.db, { backupsRoot, now: hours(24) });
    expect(third.created).not.toBeNull();
    expect(listBackups(backupsRoot)).toHaveLength(2);
  });

  it("prunes automatic backups to exactly `keep` and never deletes a manual one", async () => {
    const repo = track(new AccountingRepository());
    const manual = await createBackup(repo.db, { backupsRoot, scope: "DATABASE_ONLY", now: T0 });
    for (let day = 0; day < 5; day += 1) {
      await runAutomaticBackup(repo.db, { backupsRoot, keep: 3, now: hours(day * 24) });
    }
    const all = listBackups(backupsRoot);
    expect(all.filter((e) => e.manifest?.kind === "AUTOMATIC")).toHaveLength(3);
    expect(all.filter((e) => e.manifest?.kind === "MANUAL").map((e) => e.id)).toEqual([manual.id]);
    // The three kept are the newest three.
    const kept = all.filter((e) => e.manifest?.kind === "AUTOMATIC").map((e) => e.manifest?.createdAt);
    expect(kept).toEqual([hours(96), hours(72), hours(48)].map((d) => d.toISOString()));
  });

  it("rejects a nonsense keep", async () => {
    const repo = track(new AccountingRepository());
    await expect(runAutomaticBackup(repo.db, { backupsRoot, keep: 0 })).rejects.toBeInstanceOf(BackupError);
  });
});

describe("backup ids", () => {
  it("only an exact generated id is accepted", async () => {
    const repo = track(new AccountingRepository());
    const m = await createBackup(repo.db, { backupsRoot, scope: "DATABASE_ONLY" });
    expect(BACKUP_ID_PATTERN.test(m.id)).toBe(true);
    for (const bad of ["..", "../x", "..\\x", "bk-1", ".tmp-" + m.id, m.id + "/..", "C:\\Windows"]) {
      expect(() => resolveBackupFolder(backupsRoot, bad)).toThrow(BackupError);
    }
  });
});
