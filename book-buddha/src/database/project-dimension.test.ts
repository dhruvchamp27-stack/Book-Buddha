import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import { applyProjectDimensionSchema } from "./project-dimension-schema.js";

const upTo5 = migrations.filter((m) => m.version <= 5);

/** Every version the app ships, derived from the list: a new migration must not require a test edit.
 *  NOTE: the partial lists below ([1..4], [1..5]) are deliberate historical states and stay literal. */
const allVersions = migrations.map((m) => m.version);
const TABLES = ["journal_entries", "stock_movements", "purchase_bills", "expenses"];

/** A database at schema v5 (before any record had a fair_id on the journal/stock/bill/expense tables). */
function dbAtV5(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, upTo5);
  return db;
}

function seedParties(db: Database.Database): void {
  db.exec(`
    INSERT INTO companies (id, name, created_at) VALUES ('co', 'Co', '2026-01-01T00:00:00.000Z');
    INSERT INTO businesses (id, company_id, name, created_at) VALUES ('biz', 'co', 'Books', '2026-01-01T00:00:00.000Z');
    INSERT INTO customers (id, company_id, name, created_at) VALUES ('cust', 'co', 'Host School', '2026-01-01T00:00:00.000Z');
    INSERT INTO suppliers (id, company_id, name, created_at) VALUES ('sup', 'co', 'Sup', '2026-01-01T00:00:00.000Z');
    INSERT INTO fairs (id, company_id, host_customer_id, name, created_at) VALUES
      ('fairA', 'co', 'cust', 'Fair A', '2026-01-01T00:00:00.000Z'),
      ('fairB', 'co', 'cust', 'Fair B', '2026-01-01T00:00:00.000Z');
  `);
}

function addInvoice(db: Database.Database, id: string, fairId: string | null): void {
  db.prepare(
    "INSERT INTO invoices (id, business_id, customer_id, fair_id, number, invoice_date, payment_account, status, created_at) VALUES (?, 'biz', 'cust', ?, ?, '2026-02-01', 'RECEIVABLES', 'FINALIZED', '2026-02-01T00:00:00.000Z')",
  ).run(id, fairId, id);
}

function addEntry(db: Database.Database, id: string, sourceId: string, sourceType: string): void {
  db.prepare(
    "INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date) VALUES (?, ?, 'x', ?, '2026-06-30T10:00:00.000Z', ?, 'biz', '2026-06-30')",
  ).run(id, sourceId, id.endsWith("-reversal") ? 1 : 0, sourceType);
  db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES (?, 'CASH', 100, 0)").run(id);
  db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES (?, 'SALES', 0, 100)").run(id);
}

/** Every invoice-sourced entry shape for one invoice; `tag` keeps payment/note ids unique. */
function addInvoiceEntries(db: Database.Database, inv: string, tag: string): string[] {
  db.prepare("INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at) VALUES (?, ?, 100, 'CASH', '2026-03-05T09:30:00.000Z')").run(`pay${tag}`, inv);
  db.prepare("INSERT INTO credit_notes (id, invoice_id, number, reason, status, created_at) VALUES (?, ?, ?, 'r', 'FINALIZED', '2026-04-20T11:00:00.000Z')").run(`cn${tag}`, inv, `CN${tag}`);
  const ids = [
    `je-${inv}`, `je-${inv}-reversal`, `je-inventory-${inv}`, `je-inventory-${inv}-reversal`,
    `je-payment-pay${tag}`, `je-credit-note-cn${tag}`, `je-credit-note-inventory-cn${tag}`,
  ];
  for (const id of ids) addEntry(db, id, inv, "INVOICE");
  return ids;
}

function fairOf(db: Database.Database, id: string): string | null {
  return (db.prepare("SELECT fair_id FROM journal_entries WHERE id = ?").get(id) as { fair_id: string | null }).fair_id;
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function versions(db: Database.Database): number[] {
  return (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version);
}

describe("migration v6: project (fair) dimension", () => {
  it("runs clean on a fresh database and adds fair_id to all four tables", () => {
    const db = new Database(":memory:");
    expect(runMigrations(db)).toEqual(allVersions);
    for (const table of TABLES) expect(columns(db, table), table).toContain("fair_id");
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  it("backfills every invoice-sourced entry shape with the invoice's fair", () => {
    const db = dbAtV5();
    seedParties(db);
    addInvoice(db, "inv1", "fairA");
    const ids = addInvoiceEntries(db, "inv1", "1");
    const entriesBefore = db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get();
    const linesBefore = db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get();

    expect(runMigrations(db)).toEqual([6]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual(entriesBefore);
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()).toEqual(linesBefore);
    expect(ids).toHaveLength(7);
    for (const id of ids) expect(fairOf(db, id), id).toBe("fairA");
  });

  it("leaves fair_id NULL for an invoice with no fair, without erroring", () => {
    const db = dbAtV5();
    seedParties(db);
    addInvoice(db, "inv1", null);
    const ids = addInvoiceEntries(db, "inv1", "1");
    expect(() => runMigrations(db)).not.toThrow();
    expect(versions(db)).toContain(6);
    for (const id of ids) expect(fairOf(db, id), id).toBeNull();
  });

  it("does not cross-contaminate two fairs (or a fair and a fairless invoice)", () => {
    const db = dbAtV5();
    seedParties(db);
    addInvoice(db, "invA", "fairA");
    addInvoice(db, "invB", "fairB");
    addInvoice(db, "invN", null);
    const a = addInvoiceEntries(db, "invA", "A");
    const b = addInvoiceEntries(db, "invB", "B");
    const n = addInvoiceEntries(db, "invN", "N");
    runMigrations(db);
    for (const id of a) expect(fairOf(db, id), id).toBe("fairA");
    for (const id of b) expect(fairOf(db, id), id).toBe("fairB");
    for (const id of n) expect(fairOf(db, id), id).toBeNull();
  });

  it("backfills bill, expense and supplier-payment entries to NULL", () => {
    const db = dbAtV5();
    seedParties(db);
    addInvoice(db, "inv1", "fairA");
    db.prepare("INSERT INTO purchase_bills (id, business_id, supplier_id, number, bill_date, payment_account, status, created_at) VALUES ('bill1', 'biz', 'sup', 'B1', '2026-02-14', 'PAYABLES', 'FINALIZED', '2026-02-15T00:00:00.000Z')").run();
    db.prepare("INSERT INTO expenses (id, business_id, number, expense_date, description, amount_paise, payment_account, status, created_at) VALUES ('exp1', 'biz', 'E1', '2026-05-02', 'd', 100, 'PAYABLES', 'FINALIZED', '2026-05-03T00:00:00.000Z')").run();
    db.prepare("INSERT INTO supplier_payments (id, supplier_id, bill_id, amount_paise, payment_account, paid_at) VALUES ('sp1', 'sup', 'bill1', 50, 'CASH', '2026-02-28T12:00:00.000Z')").run();
    const nullIds: Array<[string, string, string]> = [
      ["je-bill-bill1", "bill1", "PURCHASE_BILL"],
      ["je-bill-bill1-reversal", "bill1", "PURCHASE_BILL"],
      ["je-expense-exp1", "exp1", "EXPENSE"],
      ["je-expense-exp1-reversal", "exp1", "EXPENSE"],
      ["je-supplier-payment-sp1", "bill1", "SUPPLIER_PAYMENT"],
    ];
    for (const [id, src, type] of nullIds) addEntry(db, id, src, type);
    addEntry(db, "je-inv1", "inv1", "INVOICE");
    runMigrations(db);
    for (const [id] of nullIds) expect(fairOf(db, id), id).toBeNull();
    expect(fairOf(db, "je-inv1")).toBe("fairA");
    for (const table of ["purchase_bills", "expenses", "stock_movements"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE fair_id IS NOT NULL`).get()).toEqual({ n: 0 });
    }
  });

  it("is idempotent: re-running the list and the body changes nothing", () => {
    const db = dbAtV5();
    seedParties(db);
    addInvoice(db, "inv1", "fairA");
    addInvoiceEntries(db, "inv1", "1");
    expect(runMigrations(db)).toEqual([6]);
    const snapshot = db.prepare("SELECT * FROM journal_entries ORDER BY id").all();
    expect(runMigrations(db)).toEqual([]);
    expect(() => migrations.find((m) => m.version === 6)?.up(db)).not.toThrow();
    expect(db.prepare("SELECT * FROM journal_entries ORDER BY id").all()).toEqual(snapshot);
    for (const table of TABLES) expect(columns(db, table).filter((c) => c === "fair_id"), table).toHaveLength(1);
  });

  it("throws and rolls back when an entry's fair disagrees with its source invoice's fair", () => {
    const db = dbAtV5();
    seedParties(db);
    addInvoice(db, "inv1", "fairA");
    addEntry(db, "je-inv1", "inv1", "INVOICE");
    // Construct the bad state directly: the column already exists and holds the WRONG fair.
    db.exec("ALTER TABLE journal_entries ADD COLUMN fair_id TEXT REFERENCES fairs(id)");
    db.exec("UPDATE journal_entries SET fair_id = 'fairB' WHERE id = 'je-inv1'");

    expect(() => runMigrations(db)).toThrow(/je-inv1 \(INVOICE\)/);
    expect(versions(db)).toEqual([1, 2, 3, 4, 5]);
    // The columns the failed migration added elsewhere were rolled back too.
    for (const table of ["stock_movements", "purchase_bills", "expenses"]) expect(columns(db, table), table).not.toContain("fair_id");
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()).toEqual({ n: 2 });
  });

  it("throws and rolls back when an entry of a non-invoice document carries a fair", () => {
    const db = dbAtV5();
    seedParties(db);
    db.prepare("INSERT INTO expenses (id, business_id, number, expense_date, description, amount_paise, payment_account, status, created_at) VALUES ('exp1', 'biz', 'E1', '2026-05-02', 'd', 100, 'PAYABLES', 'FINALIZED', '2026-05-03T00:00:00.000Z')").run();
    addEntry(db, "je-expense-exp1", "exp1", "EXPENSE");
    db.exec("ALTER TABLE journal_entries ADD COLUMN fair_id TEXT REFERENCES fairs(id)");
    db.exec("UPDATE journal_entries SET fair_id = 'fairA' WHERE id = 'je-expense-exp1'");
    expect(() => runMigrations(db)).toThrow(/je-expense-exp1 \(EXPENSE\)/);
    expect(versions(db)).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts a bill entry whose fair matches its own bill, so re-running after slice 8b is safe", () => {
    const db = dbAtV5();
    seedParties(db);
    db.prepare("INSERT INTO purchase_bills (id, business_id, supplier_id, number, bill_date, payment_account, status, created_at) VALUES ('bill1', 'biz', 'sup', 'B9', '2026-02-14', 'PAYABLES', 'FINALIZED', '2026-02-15T00:00:00.000Z')").run();
    addEntry(db, "je-bill-bill1", "bill1", "PURCHASE_BILL");
    runMigrations(db);
    expect(versions(db)).toEqual(allVersions);

    // Slice 8b onwards: bills legitimately carry a fair, and so do their journal entries.
    db.exec("UPDATE purchase_bills SET fair_id = 'fairA' WHERE id = 'bill1'");
    db.exec("UPDATE journal_entries SET fair_id = 'fairA' WHERE id = 'je-bill-bill1'");
    expect(() => applyProjectDimensionSchema(db)).not.toThrow();

    // A genuine mismatch is still caught, against the bill's own fair.
    db.exec("UPDATE journal_entries SET fair_id = 'fairB' WHERE id = 'je-bill-bill1'");
    expect(() => applyProjectDimensionSchema(db)).toThrow(/je-bill-bill1 \(PURCHASE_BILL\)/);
  });

  it("throws when an entry shape of a fair-carrying invoice was not mapped", () => {
    const db = dbAtV5();
    seedParties(db);
    addInvoice(db, "inv1", "fairA");
    addEntry(db, "je-mystery-inv1", "inv1", "INVOICE");
    expect(() => runMigrations(db)).toThrow(/je-mystery-inv1 \(INVOICE\)/);
    expect(versions(db)).toEqual([1, 2, 3, 4, 5]);
    expect(columns(db, "journal_entries")).not.toContain("fair_id");
  });
});
