import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import { applyOpeningBalancesSchema } from "./opening-balances-schema.js";
import { SEED_ACCOUNTS, V11_SEED_ACCOUNTS, V13_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v13 adds STOCK_ADJUSTMENT (S5-3). The trap this file guards: v11 seeds from a list, and if that
 * list were the LIVE SEED_ACCOUNTS, every fresh database would receive STOCK_ADJUSTMENT at v11 and
 * v13's own seeding would never run in any test - its first real run would be on the owner's
 * database. These tests build a database at v12 so v13's seeding is exercised for real.
 */
const at = (version: number) => migrations.filter((m) => m.version <= version);

type ChartRow = { code: string; company_id: string | null; name: string; type: string; role: string | null; parent_code: string | null; active: number; created_at: string; updated_at: string };
let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
});
afterEach(() => db.close());

const chart = (): ChartRow[] =>
  db.prepare("SELECT code, company_id, name, type, role, parent_code, active, created_at, updated_at FROM chart_accounts ORDER BY code").all() as ChartRow[];
const versions = (): number[] =>
  (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version);
const objectsSql = (type: "trigger" | "index"): unknown[] =>
  db.prepare("SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY name").all(type);

describe("the v11 seed list is frozen", () => {
  it("V11_SEED_ACCOUNTS is exactly today's pre-v13 chart and does NOT contain STOCK_ADJUSTMENT", () => {
    expect(V11_SEED_ACCOUNTS.map((a) => a.code).sort()).toEqual(
      [
        "BANK", "CAPITAL", "CASH", "COGS", "CUSTOMER_CREDITS", "EXPENSE", "INPUT_CGST", "INPUT_IGST", "INPUT_SGST", "INVENTORY",
        "LOANS", "OPENING_BALANCE_EQUITY", "OTHER_ASSETS", "OTHER_INCOME", "OTHER_LIABILITIES", "OUTPUT_CGST", "OUTPUT_IGST",
        "OUTPUT_SGST", "PAYABLES", "RECEIVABLES", "SALES", "UNCATEGORIZED", "UNCATEGORIZED_INCOME", "UNEARNED_REVENUE",
      ].sort(),
    );
    expect(V11_SEED_ACCOUNTS.find((a) => a.code === "UNCATEGORIZED")?.name).toBe("Uncategorised Expense");
    // The live list = frozen v11 list + exactly the v13 addition, then whatever later migrations
    // added. Asserted on the FROZEN v13 list and its position, so a later migration's account
    // (v15 broke the old literal) cannot make this go stale. Still exact.
    expect(V13_ADDED_ACCOUNTS.map((a) => a.code)).toEqual(["STOCK_ADJUSTMENT"]);
    expect(SEED_ACCOUNTS.slice(V11_SEED_ACCOUNTS.length, V11_SEED_ACCOUNTS.length + V13_ADDED_ACCOUNTS.length)).toEqual(V13_ADDED_ACCOUNTS);
    expect(SEED_ACCOUNTS.find((a) => a.code === "STOCK_ADJUSTMENT")).toMatchObject({ type: "EXPENSE" });
    expect(SEED_ACCOUNTS.find((a) => a.code === "STOCK_ADJUSTMENT")?.role).toBeUndefined();
  });

  it("a database built to v12 does NOT have STOCK_ADJUSTMENT (v11 must not seed from the live list)", () => {
    runMigrations(db, at(12));
    expect(chart().map((r) => r.code)).not.toContain("STOCK_ADJUSTMENT");
  });
});

describe("v13 seeding from a database built to v12", () => {
  it("adds exactly STOCK_ADJUSTMENT (EXPENSE, no role), leaving every existing row byte-identical", () => {
    runMigrations(db, at(12));
    const before = chart();
    const triggersBefore = objectsSql("trigger");

    // SCOPED TO v13, not the whole chain. Running the full list made this assertion about every
    // migration above v12, so it went red when v14 was registered and again when v15 seeded its
    // own account - each time saying nothing at all about v13. Both bounds are derived.
    const ran = runMigrations(db, at(13));
    expect(ran).toEqual(migrations.filter((m) => m.version > 12 && m.version <= 13).map((m) => m.version));

    const after = chart();
    for (const row of before) expect(after.find((r) => r.code === row.code)).toEqual(row);
    const added = after.filter((r) => !before.some((b) => b.code === r.code));
    expect(added.map((r) => r.code).sort()).toEqual(V13_ADDED_ACCOUNTS.map((a) => a.code).sort());
    expect(added[0]).toMatchObject({ name: "Stock Adjustment", type: "EXPENSE", role: null, company_id: null, parent_code: null, active: 1 });
    // The chart_accounts table was NOT rebuilt: v13 is additive (no role widened).
    expect(objectsSql("trigger")).toEqual(triggersBefore);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    // Scoped to v13 with everything below it, matching the at(13) run above.
    expect(versions()).toEqual(at(13).map((m) => m.version));
  });

  it("is a clean no-op the second time", () => {
    runMigrations(db, migrations);
    const rows = chart();
    expect(runMigrations(db, migrations)).toEqual([]);
    applyOpeningBalancesSchema(db);
    expect(chart()).toEqual(rows);
  });

  it("throws and rolls back to v12 when STOCK_ADJUSTMENT is already taken under a different class", () => {
    runMigrations(db, at(12));
    db.exec(`
      INSERT INTO companies (id, name, created_at) VALUES ('co1', 'Owner Co', '2025-04-01T00:00:00.000Z');
      INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at)
        VALUES ('STOCK_ADJUSTMENT', 'co1', 'My Own Thing', 'INCOME', NULL, NULL, 1, '2025-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z');
    `);
    const rowsBefore = chart();
    const triggersBefore = objectsSql("trigger");
    const indexesBefore = objectsSql("index");

    expect(() => runMigrations(db, migrations)).toThrow(
      /found account STOCK_ADJUSTMENT as INCOME\/null but expected EXPENSE\/null.*rolled back/,
    );

    // Really rolled back: v13 not recorded, none of its tables exist, chart untouched.
    expect(versions()).toEqual(at(12).map((m) => m.version));
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('opening_balances', 'opening_balance_lines')").get()).toBeUndefined();
    expect(chart()).toEqual(rowsBefore);
    expect(objectsSql("trigger")).toEqual(triggersBefore);
    expect(objectsSql("index")).toEqual(indexesBefore);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
