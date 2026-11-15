import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";

const upTo4 = migrations.filter((m) => m.version <= 4);

/** A database at schema v4 (before journal_entries had business_id / entry_date). */
function dbAtV4(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, upTo4);
  return db;
}

function seedParties(db: Database.Database): void {
  db.exec(`
    INSERT INTO companies (id, name, created_at) VALUES ('co', 'Co', '2026-01-01T00:00:00.000Z');
    INSERT INTO businesses (id, company_id, name, created_at) VALUES
      ('bizA', 'co', 'Books A', '2026-01-01T00:00:00.000Z'),
      ('bizB', 'co', 'Books B', '2026-01-01T00:00:00.000Z');
    INSERT INTO customers (id, company_id, name, created_at) VALUES ('cust', 'co', 'Cust', '2026-01-01T00:00:00.000Z');
    INSERT INTO suppliers (id, company_id, name, created_at) VALUES ('sup', 'co', 'Sup', '2026-01-01T00:00:00.000Z');
  `);
}

function addInvoice(db: Database.Database, id: string, businessId: string, invoiceDate: string | null, createdAt: string): void {
  db.prepare(
    "INSERT INTO invoices (id, business_id, customer_id, number, invoice_date, payment_account, status, created_at) VALUES (?, ?, 'cust', ?, ?, 'RECEIVABLES', 'FINALIZED', ?)",
  ).run(id, businessId, id, invoiceDate, createdAt);
}

function addEntry(db: Database.Database, id: string, sourceId: string, sourceType: string, createdAt = "2026-06-30T10:00:00.000Z"): void {
  db.prepare(
    "INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type) VALUES (?, ?, 'x', ?, ?, ?)",
  ).run(id, sourceId, id.endsWith("-reversal") ? 1 : 0, createdAt, sourceType);
  db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES (?, 'CASH', 100, 0)").run(id);
  db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES (?, 'SALES', 0, 100)").run(id);
}

function dims(db: Database.Database, id: string): { business_id: string | null; entry_date: string | null } {
  return db.prepare("SELECT business_id, entry_date FROM journal_entries WHERE id = ?").get(id) as {
    business_id: string | null;
    entry_date: string | null;
  };
}

function columns(db: Database.Database): string[] {
  return (db.prepare("PRAGMA table_info(journal_entries)").all() as Array<{ name: string }>).map((c) => c.name);
}

describe("migration v5: journal business_id and entry_date", () => {
  it("runs clean on a fresh database and adds both columns", () => {
    const db = new Database(":memory:");
    expect(runMigrations(db)).toEqual([1, 2, 3, 4, 5]);
    expect(columns(db)).toEqual(expect.arrayContaining(["business_id", "entry_date"]));
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  it("backfills every entry kind from its own source document", () => {
    const db = dbAtV4();
    seedParties(db);

    // Invoice in business A: finalize, reversal, inventory, inventory reversal, payment, credit notes.
    addInvoice(db, "inv1", "bizA", "2026-01-10", "2026-01-12T08:00:00.000Z");
    db.prepare("INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at) VALUES ('pay1', 'inv1', 100, 'CASH', '2026-03-05T09:30:00.000Z')").run();
    db.prepare("INSERT INTO credit_notes (id, invoice_id, number, reason, status, created_at) VALUES ('cn1', 'inv1', 'CN1', 'r', 'FINALIZED', '2026-04-20T11:00:00.000Z')").run();
    for (const id of ["je-inv1", "je-inv1-reversal", "je-inventory-inv1", "je-inventory-inv1-reversal", "je-payment-pay1", "je-credit-note-cn1", "je-credit-note-inventory-cn1"]) {
      addEntry(db, id, "inv1", "INVOICE");
    }

    // Purchase bill + its reversal + a supplier payment against it, business B.
    db.prepare("INSERT INTO purchase_bills (id, business_id, supplier_id, number, bill_date, payment_account, status, created_at) VALUES ('bill1', 'bizB', 'sup', 'B1', '2026-02-14', 'PAYABLES', 'CANCELLED', '2026-02-15T00:00:00.000Z')").run();
    db.prepare("INSERT INTO supplier_payments (id, supplier_id, bill_id, amount_paise, payment_account, paid_at) VALUES ('sp1', 'sup', 'bill1', 50, 'CASH', '2026-02-28T12:00:00.000Z')").run();
    addEntry(db, "je-bill-bill1", "bill1", "PURCHASE_BILL");
    addEntry(db, "je-bill-bill1-reversal", "bill1", "PURCHASE_BILL");
    addEntry(db, "je-supplier-payment-sp1", "bill1", "SUPPLIER_PAYMENT");

    // Expense + reversal + supplier payment against it, business A.
    db.prepare("INSERT INTO expenses (id, business_id, number, expense_date, description, amount_paise, payment_account, status, created_at) VALUES ('exp1', 'bizA', 'E1', '2026-05-02', 'd', 100, 'PAYABLES', 'CANCELLED', '2026-05-03T00:00:00.000Z')").run();
    db.prepare("INSERT INTO supplier_payments (id, supplier_id, expense_id, amount_paise, payment_account, paid_at) VALUES ('sp2', 'sup', 'exp1', 40, 'CASH', '2026-05-20T12:00:00.000Z')").run();
    addEntry(db, "je-expense-exp1", "exp1", "EXPENSE");
    addEntry(db, "je-expense-exp1-reversal", "exp1", "EXPENSE");
    addEntry(db, "je-supplier-payment-sp2", "exp1", "SUPPLIER_PAYMENT");

    const entriesBefore = db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get();
    const linesBefore = db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get();
    expect(runMigrations(db)).toEqual([5]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual(entriesBefore);
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()).toEqual(linesBefore);

    const expected: Record<string, [string, string]> = {
      "je-inv1": ["bizA", "2026-01-10"],
      "je-inv1-reversal": ["bizA", "2026-06-30"],
      "je-inventory-inv1": ["bizA", "2026-01-10"],
      "je-inventory-inv1-reversal": ["bizA", "2026-06-30"],
      "je-payment-pay1": ["bizA", "2026-03-05"],
      "je-credit-note-cn1": ["bizA", "2026-04-20"],
      "je-credit-note-inventory-cn1": ["bizA", "2026-04-20"],
      "je-bill-bill1": ["bizB", "2026-02-14"],
      "je-bill-bill1-reversal": ["bizB", "2026-06-30"],
      "je-supplier-payment-sp1": ["bizB", "2026-02-28"],
      "je-expense-exp1": ["bizA", "2026-05-02"],
      "je-expense-exp1-reversal": ["bizA", "2026-06-30"],
      "je-supplier-payment-sp2": ["bizA", "2026-05-20"],
    };
    for (const [id, [businessId, date]] of Object.entries(expected)) {
      // Reversals carry their own posting date (default fixture created_at = 2026-06-30).
      expect(dims(db, id), id).toEqual({ business_id: businessId, entry_date: date });
    }
  });

  it("dates a payment entry by the payment, not by the invoice it belongs to", () => {
    const db = dbAtV4();
    seedParties(db);
    addInvoice(db, "inv1", "bizA", "2026-01-10", "2026-01-10T00:00:00.000Z");
    db.prepare("INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at) VALUES ('pay1', 'inv1', 100, 'CASH', '2026-03-05T09:30:00.000Z')").run();
    addEntry(db, "je-inv1", "inv1", "INVOICE");
    addEntry(db, "je-payment-pay1", "inv1", "INVOICE");
    runMigrations(db);
    expect(dims(db, "je-payment-pay1").entry_date).toBe("2026-03-05");
    expect(dims(db, "je-inv1").entry_date).toBe("2026-01-10");
  });

  it("dates timestamp-derived entries by the IST calendar day, not the UTC day", () => {
    const db = dbAtV4();
    seedParties(db);
    addInvoice(db, "inv1", "bizA", "2026-03-01", "2026-03-01T00:00:00.000Z");
    // 20:30 UTC on 4 March = 02:00 IST on 5 March.
    db.prepare("INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at) VALUES ('pay1', 'inv1', 100, 'CASH', '2026-03-04T20:30:00.000Z')").run();
    // 18:29 UTC on 4 March = 23:59 IST on 4 March (must stay the 4th).
    db.prepare("INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at) VALUES ('pay2', 'inv1', 100, 'CASH', '2026-03-04T18:29:00.000Z')").run();
    addEntry(db, "je-payment-pay1", "inv1", "INVOICE");
    addEntry(db, "je-payment-pay2", "inv1", "INVOICE");
    runMigrations(db);
    expect(dims(db, "je-payment-pay1").entry_date).toBe("2026-03-05");
    expect(dims(db, "je-payment-pay2").entry_date).toBe("2026-03-04");
  });

  it("dates a reversal on the day it was posted, not the original document's date", () => {
    const db = dbAtV4();
    seedParties(db);
    addInvoice(db, "inv1", "bizA", "2026-01-10", "2026-01-10T00:00:00.000Z");
    db.prepare("INSERT INTO purchase_bills (id, business_id, supplier_id, number, bill_date, payment_account, status, created_at) VALUES ('bill1', 'bizB', 'sup', 'B1', '2026-01-15', 'PAYABLES', 'CANCELLED', '2026-01-15T00:00:00.000Z')").run();
    db.prepare("INSERT INTO expenses (id, business_id, number, expense_date, description, amount_paise, payment_account, status, created_at) VALUES ('exp1', 'bizA', 'E1', '2026-01-20', 'd', 100, 'PAYABLES', 'CANCELLED', '2026-01-20T00:00:00.000Z')").run();
    addEntry(db, "je-inv1", "inv1", "INVOICE", "2026-01-10T05:00:00.000Z");
    addEntry(db, "je-inv1-reversal", "inv1", "INVOICE", "2026-03-18T05:00:00.000Z");
    addEntry(db, "je-inventory-inv1-reversal", "inv1", "INVOICE", "2026-03-18T05:00:00.000Z");
    addEntry(db, "je-bill-bill1-reversal", "bill1", "PURCHASE_BILL", "2026-03-19T05:00:00.000Z");
    addEntry(db, "je-expense-exp1-reversal", "exp1", "EXPENSE", "2026-03-20T05:00:00.000Z");
    runMigrations(db);
    expect(dims(db, "je-inv1")).toEqual({ business_id: "bizA", entry_date: "2026-01-10" });
    expect(dims(db, "je-inv1-reversal")).toEqual({ business_id: "bizA", entry_date: "2026-03-18" });
    expect(dims(db, "je-inventory-inv1-reversal")).toEqual({ business_id: "bizA", entry_date: "2026-03-18" });
    expect(dims(db, "je-bill-bill1-reversal")).toEqual({ business_id: "bizB", entry_date: "2026-03-19" });
    expect(dims(db, "je-expense-exp1-reversal")).toEqual({ business_id: "bizA", entry_date: "2026-03-20" });
  });

  it("falls back to the invoice created_at date when invoice_date is NULL", () => {
    const db = dbAtV4();
    seedParties(db);
    addInvoice(db, "inv1", "bizA", null, "2026-02-03T18:45:00.000Z"); // 00:15 IST on the 4th
    addEntry(db, "je-inv1", "inv1", "INVOICE", "2026-09-09T00:00:00.000Z");
    runMigrations(db);
    expect(dims(db, "je-inv1")).toEqual({ business_id: "bizA", entry_date: "2026-02-04" });
  });

  it("stamps entries with their own business when several businesses exist", () => {
    const db = dbAtV4();
    seedParties(db);
    addInvoice(db, "invA", "bizA", "2026-01-01", "2026-01-01T00:00:00.000Z");
    addInvoice(db, "invB", "bizB", "2026-02-02", "2026-02-02T00:00:00.000Z");
    addEntry(db, "je-invA", "invA", "INVOICE");
    addEntry(db, "je-invB", "invB", "INVOICE");
    runMigrations(db);
    expect(dims(db, "je-invA")).toEqual({ business_id: "bizA", entry_date: "2026-01-01" });
    expect(dims(db, "je-invB")).toEqual({ business_id: "bizB", entry_date: "2026-02-02" });
  });

  it("is idempotent: re-running the migration list and the migration body is a no-op", () => {
    const db = dbAtV4();
    seedParties(db);
    addInvoice(db, "inv1", "bizA", "2026-01-10", "2026-01-10T00:00:00.000Z");
    addEntry(db, "je-inv1", "inv1", "INVOICE");
    expect(runMigrations(db)).toEqual([5]);
    const snapshot = db.prepare("SELECT * FROM journal_entries ORDER BY id").all();
    expect(runMigrations(db)).toEqual([]);
    // Body re-run directly (columns already exist) must not error or change anything.
    expect(() => migrations.find((m) => m.version === 5)?.up(db)).not.toThrow();
    expect(db.prepare("SELECT * FROM journal_entries ORDER BY id").all()).toEqual(snapshot);
    expect(columns(db).filter((c) => c === "business_id")).toHaveLength(1);
  });

  it("throws, naming the entry and its source type, and rolls back when a source document is missing", () => {
    const db = dbAtV4();
    seedParties(db);
    addInvoice(db, "inv1", "bizA", "2026-01-10", "2026-01-10T00:00:00.000Z");
    addEntry(db, "je-inv1", "inv1", "INVOICE");
    addEntry(db, "je-bill-ghost", "ghost", "PURCHASE_BILL");

    expect(() => runMigrations(db)).toThrow(/je-bill-ghost \(PURCHASE_BILL\)/);
    expect(columns(db)).not.toContain("business_id");
    expect(columns(db)).not.toContain("entry_date");
    expect((db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version)).toEqual([1, 2, 3, 4]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()).toEqual({ n: 4 });
  });
});
