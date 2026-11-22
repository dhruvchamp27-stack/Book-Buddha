import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import { applyBillRoundOffSchema, BILL_ROUND_OFF_TABLES } from "./bill-round-off-schema.js";

/**
 * v35 adds the optional bill/expense round-off (ruling I-Q6, S18-6).
 *
 * These build a database to v34 and then run the tail, so v35's ALTERs run for real on rows that
 * pre-date them. What has to be proved is mostly what v35 does NOT do: it must not backfill, must not
 * round anything, and must leave every posted bill and expense exactly as it was.
 */
const at = (version: number) => migrations.filter((m) => m.version <= version);

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
});
afterEach(() => db.close());

const columns = (table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

/** A finalized 18% bill of 100 x Rs 25.00 and a finalized expense, both seeded before v35 exists. */
function seedAtV34(): void {
  db.exec(`
    INSERT INTO companies (id, name, created_at) VALUES ('co1', 'Owner Co', '2025-04-01T00:00:00.000Z');
    INSERT INTO businesses (id, company_id, name, created_at) VALUES ('bz1', 'co1', 'Books', '2025-04-01T00:00:00.000Z');
    INSERT INTO suppliers (id, company_id, name, created_at) VALUES ('su1', 'co1', 'Paper Mill', '2025-04-01T00:00:00.000Z');
    INSERT INTO items (id, company_id, name, unit, track_stock, created_at)
      VALUES ('it1', 'co1', 'Notebook', 'each', 0, '2025-04-01T00:00:00.000Z');

    INSERT INTO purchase_bills (id, business_id, supplier_id, number, bill_date, tax_type,
                                tax_rate_basis_points, payment_account, status, created_at)
      VALUES ('pb1', 'bz1', 'su1', 'PB-001/25-26', '2025-10-10', 'CGST_SGST', 1800,
              'PAYABLES', 'FINALIZED', '2025-10-10T00:00:00.000Z');
    INSERT INTO purchase_bill_lines (bill_id, item_id, description, quantity, unit_price_paise)
      VALUES ('pb1', 'it1', 'Notebook', 100, 2500);

    INSERT INTO expenses (id, business_id, number, expense_date, description, amount_paise,
                          tax_type, tax_rate_basis_points, payment_account, status, created_at)
      VALUES ('ex1', 'bz1', 'EXP-001', '2025-10-11', 'Stall rent', 200000, 'NONE', 0,
              'CASH', 'FINALIZED', '2025-10-11T00:00:00.000Z');
  `);
}

describe("migration v35 - optional round-off on bills and expenses", () => {
  it("a database built to v34 has the column on neither table", () => {
    runMigrations(db, at(34));
    for (const table of BILL_ROUND_OFF_TABLES) {
      expect(columns(table)).not.toContain("round_off_paise");
    }
  });

  it("adds the column to bills and expenses, and to nothing else", () => {
    runMigrations(db, migrations);
    for (const table of BILL_ROUND_OFF_TABLES) {
      expect(columns(table)).toContain("round_off_paise");
    }
    // I-Q6 is bills and expenses ONLY. Purchase returns and credit notes must not gain it.
    expect(columns("purchase_returns")).not.toContain("round_off_paise");
    expect(columns("credit_notes")).not.toContain("round_off_paise");
  });

  it("NOTHING is backfilled: a bill and an expense posted before v35 are untouched and read 0", () => {
    runMigrations(db, at(34));
    seedAtV34();
    const billBefore = db.prepare("SELECT * FROM purchase_bills WHERE id = 'pb1'").get() as Record<string, unknown>;
    const expenseBefore = db.prepare("SELECT * FROM expenses WHERE id = 'ex1'").get() as Record<string, unknown>;

    runMigrations(db, migrations);

    const billAfter = db.prepare("SELECT * FROM purchase_bills WHERE id = 'pb1'").get() as Record<string, unknown>;
    const expenseAfter = db.prepare("SELECT * FROM expenses WHERE id = 'ex1'").get() as Record<string, unknown>;
    // Every column that existed before is byte-identical; the only difference is the new one at 0.
    for (const [key, value] of Object.entries(billBefore)) expect(billAfter[key]).toEqual(value);
    for (const [key, value] of Object.entries(expenseBefore)) expect(expenseAfter[key]).toEqual(value);
    expect(billAfter["round_off_paise"]).toBe(0);
    expect(expenseAfter["round_off_paise"]).toBe(0);
  });

  it("accepts a signed amount under a rupee and REFUSES a rupee or more (I-Q6 'under Rs 1')", () => {
    runMigrations(db, migrations);
    seedAtV34();

    const set = (value: number): void => {
      db.prepare("UPDATE purchase_bills SET round_off_paise = ? WHERE id = 'pb1'").run(value);
    };
    set(99);
    expect((db.prepare("SELECT round_off_paise AS r FROM purchase_bills WHERE id = 'pb1'").get() as { r: number }).r).toBe(99);
    set(-99);
    expect((db.prepare("SELECT round_off_paise AS r FROM purchase_bills WHERE id = 'pb1'").get() as { r: number }).r).toBe(-99);
    set(0);

    // A whole rupee or more is not a round-off, and the database says so rather than trusting callers.
    expect(() => set(100)).toThrow(/CHECK constraint failed/);
    expect(() => set(-100)).toThrow(/CHECK constraint failed/);
    expect(() => set(250)).toThrow(/CHECK constraint failed/);
  });

  it("is a clean no-op the second time", () => {
    runMigrations(db, migrations);
    seedAtV34();
    db.prepare("UPDATE purchase_bills SET round_off_paise = 37 WHERE id = 'pb1'").run();

    expect(runMigrations(db, migrations)).toEqual([]);
    // Re-running the body directly must not reset what the owner typed.
    applyBillRoundOffSchema(db);
    expect((db.prepare("SELECT round_off_paise AS r FROM purchase_bills WHERE id = 'pb1'").get() as { r: number }).r).toBe(37);
  });

  it("v35 is the version after v34, and R14 has not taken it", () => {
    runMigrations(db, migrations);
    const applied = (db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{ version: number; name: string }>);
    const last = applied[applied.length - 1];
    expect(last).toMatchObject({ version: 35, name: "bill_round_off" });
    expect(applied.filter((m) => m.version === 35)).toHaveLength(1);
  });
});
