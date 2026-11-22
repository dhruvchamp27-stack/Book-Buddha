import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import { applyLineTaxSchema } from "./line-tax-schema.js";
import { V34_ADDED_ACCOUNTS, ROUND_OFF_ACCOUNT } from "./chart-accounts-schema.js";

/**
 * v34 adds the per-line GST rate and the invoice round-off (I, rulings S18-3 and S18-5).
 *
 * These build a database to v33 and then run the tail of the chain, so v34's own ALTERs, its
 * backfills and its ROUND_OFF seeding all run for real on data that pre-dates them - the same shape
 * as the v13 and v15 seeding tests, and for the same reason.
 *
 * The backfill is the part that matters: an existing line must inherit the rate its DOCUMENT charged,
 * and `invoices.total_paise` must land on exactly what `open-items.ts` computed before the migration,
 * or every receivable, statement and ageing figure moves the moment the owner upgrades.
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
const objectsSql = (type: "trigger" | "index"): unknown[] =>
  db.prepare("SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY name").all(type);

/**
 * One company, one 18% credit invoice of 2 x Rs 250.00 less Rs 40.00 discount plus Rs 15.00 extra
 * charge, and a credit note on it. Taxable = 50000 - 4000 + 1500 = 47500; tax at 1800bp =
 * round(47500 * 0.18) = 8550; total = 56050. All seeded at v33, where the rate lives on the document.
 */
function seedAtV33(): void {
  db.exec(`
    INSERT INTO companies (id, name, created_at) VALUES ('co1', 'Owner Co', '2025-04-01T00:00:00.000Z');
    INSERT INTO businesses (id, company_id, name, created_at) VALUES ('bz1', 'co1', 'Books', '2025-04-01T00:00:00.000Z');
    INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu1', 'co1', 'Sunrise School', '2025-04-01T00:00:00.000Z');
    INSERT INTO items (id, company_id, name, unit, track_stock, created_at)
      VALUES ('it1', 'co1', 'Novel A', 'each', 0, '2025-04-01T00:00:00.000Z');

    INSERT INTO invoices (id, business_id, customer_id, number, invoice_date, discount_paise, extra_charge_paise,
                          tax_type, tax_rate_basis_points, payment_account, status, created_at)
      VALUES ('inv1', 'bz1', 'cu1', 'INV-001/25-26', '2025-10-10', 4000, 1500,
              'CGST_SGST', 1800, 'RECEIVABLES', 'FINALIZED', '2025-10-10T00:00:00.000Z');
    INSERT INTO invoice_lines (invoice_id, item_id, description, quantity, unit_price_paise)
      VALUES ('inv1', 'it1', 'Novel A', 2, 25000);

    INSERT INTO credit_notes (id, invoice_id, number, reason, status, created_at)
      VALUES ('cn1', 'inv1', 'CN-001/25-26', 'One damaged', 'FINALIZED', '2025-10-20T00:00:00.000Z');
    INSERT INTO credit_note_lines (credit_note_id, item_id, description, quantity, unit_price_paise)
      VALUES ('cn1', 'it1', 'Novel A', 1, 25000);
  `);
}

describe("migration v34 - per-line GST and the invoice round-off", () => {
  it("a database built to v33 has none of the v34 columns, so v34's own backfill runs for real", () => {
    runMigrations(db, at(33));
    expect(columns("invoice_lines")).not.toContain("tax_rate_basis_points");
    expect(columns("invoices")).not.toContain("round_off_paise");
    expect(columns("invoices")).not.toContain("total_paise");
    expect(columns("items")).not.toContain("default_tax_rate_basis_points");
    expect(columns("credit_note_lines")).not.toContain("reverses_invoice_line_id");
  });

  it("backfills every line from its document, and a credit-note line from the parent INVOICE", () => {
    runMigrations(db, at(33));
    seedAtV33();
    runMigrations(db, migrations);

    // The invoice charged 18%, so its line now carries 18% - and so does the note's line, which had
    // no rate of its own to copy and had to be reached through credit_notes -> invoices.
    const line = db.prepare("SELECT tax_rate_basis_points AS r FROM invoice_lines WHERE invoice_id = 'inv1'").get() as { r: number };
    expect(line.r).toBe(1800);
    const noteLine = db.prepare("SELECT tax_rate_basis_points AS r FROM credit_note_lines WHERE credit_note_id = 'cn1'").get() as { r: number };
    expect(noteLine.r).toBe(1800);
  });

  it("stores the total exactly as open-items.ts computed it, and leaves the round-off at 0 (I-Q10)", () => {
    runMigrations(db, at(33));
    seedAtV33();
    runMigrations(db, migrations);

    // Hand-worked: lines 2 x 25000 = 50000; taxable 50000 - 4000 + 1500 = 47500;
    // tax round(47500 * 1800 / 10000) = round(8550) = 8550; total 47500 + 8550 = 56050.
    const row = db.prepare("SELECT total_paise AS total, round_off_paise AS roundOff FROM invoices WHERE id = 'inv1'").get() as { total: number; roundOff: number };
    expect(row.total).toBe(56050);
    // An invoice posted before v34 is NEVER re-rounded: its figures stand (I-Q10).
    expect(row.roundOff).toBe(0);
  });

  it("an invoice with no lines backfills to 0, not NULL (the NOT NULL column would otherwise fail)", () => {
    runMigrations(db, at(33));
    seedAtV33();
    db.exec(`
      INSERT INTO invoices (id, business_id, customer_id, number, discount_paise, extra_charge_paise,
                            tax_type, tax_rate_basis_points, payment_account, status, created_at)
        VALUES ('inv2', 'bz1', 'cu1', 'INV-002/25-26', 0, 0, 'NONE', 0, 'CASH', 'DRAFT', '2025-10-11T00:00:00.000Z');
    `);
    expect(() => runMigrations(db, migrations)).not.toThrow();
    const row = db.prepare("SELECT total_paise AS total FROM invoices WHERE id = 'inv2'").get() as { total: number };
    expect(row.total).toBe(0);
  });

  it("seeds ROUND_OFF as a ROLELESS income account and does NOT rebuild chart_accounts (I-Q11)", () => {
    runMigrations(db, at(33));
    const triggersBefore = objectsSql("trigger");
    const indexesBefore = objectsSql("index");

    runMigrations(db, migrations);

    const account = db.prepare("SELECT code, name, type, role, company_id AS companyId, active FROM chart_accounts WHERE code = ?").get(ROUND_OFF_ACCOUNT);
    expect(account).toMatchObject({ code: "ROUND_OFF", name: "Round off", type: "INCOME", role: null, companyId: null, active: 1 });
    expect(V34_ADDED_ACCOUNTS).toEqual([{ code: "ROUND_OFF", name: "Round off", type: "INCOME" }]);
    // No role means the role CHECK is untouched, which means no table rebuild: every trigger and
    // index that existed at v33 must still be here, byte-identical. This is the whole point of
    // ruling I-Q11 and the assertion that would catch a future "just add a role".
    expect(objectsSql("trigger")).toEqual(triggersBefore);
    expect(objectsSql("index")).toEqual(indexesBefore);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("is a clean no-op the second time, and never overwrites a rate edited after the migration", () => {
    runMigrations(db, at(33));
    seedAtV33();
    runMigrations(db, migrations);

    // A line's rate is changed after v34 ran - exactly what a mixed-rate invoice looks like.
    db.exec("UPDATE invoice_lines SET tax_rate_basis_points = 500 WHERE invoice_id = 'inv1'");
    expect(runMigrations(db, migrations)).toEqual([]);
    // Re-running the body directly must not re-backfill over that edit: the backfill lives inside
    // the branch where its own ALTER ran, so this is a no-op.
    applyLineTaxSchema(db);
    const line = db.prepare("SELECT tax_rate_basis_points AS r FROM invoice_lines WHERE invoice_id = 'inv1'").get() as { r: number };
    expect(line.r).toBe(500);
  });

  it("throws and rolls back to v33 when ROUND_OFF is already taken under a different class", () => {
    runMigrations(db, at(33));
    db.exec(`
      INSERT INTO companies (id, name, created_at) VALUES ('co1', 'Owner Co', '2025-04-01T00:00:00.000Z');
      INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at)
        VALUES ('ROUND_OFF', 'co1', 'My Own Thing', 'EXPENSE', NULL, NULL, 1, '2025-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z');
    `);

    expect(() => runMigrations(db, migrations)).toThrow(
      /found account ROUND_OFF as EXPENSE\/null but expected INCOME\/null.*rolled back/,
    );

    const applied = (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version);
    expect(applied).toEqual(at(33).map((m) => m.version));
    expect(columns("invoices")).not.toContain("total_paise");
  });
});
