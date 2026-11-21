import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import { CHART_ACCOUNTS_TRIGGER_NAMES, SEED_ACCOUNTS, V9_SEED_ACCOUNTS, V11_SEED_ACCOUNTS } from "./chart-accounts-schema.js";
import { applyCustomerCreditsSchema } from "./customer-credits-schema.js";

/**
 * Migration v11 rebuilds chart_accounts to widen the role CHECK. Until this file it had only ever
 * run over a freshly seeded chart. The owner's database also holds a user-created account with a
 * company AND a parent, a deactivated account, and posted journal lines.
 *
 * THE DATABASE IS BUILT AT v10 ON PURPOSE. Constructing AccountingRepository (or running the whole
 * migration list) first would put the chart at v12; v11's guard then sees the widened CHECK and
 * skips the rebuild, and every assertion below would pass while testing nothing. The pre-state
 * assertions in each test (the table SQL lacks 'CUSTOMER_CREDITS') are what prove the rebuild ran.
 */

type ChartRow = {
  code: string;
  company_id: string | null;
  name: string;
  type: string;
  role: string | null;
  parent_code: string | null;
  active: number;
  created_at: string;
  updated_at: string;
};

const CHART_COLUMNS = "code, company_id, name, type, role, parent_code, active, created_at, updated_at";
const at = (version: number) => migrations.filter((m) => m.version <= version);

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
});
afterEach(() => db.close());

const tableSql = (name: string): string =>
  (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string }).sql;
const chart = (): ChartRow[] =>
  db.prepare(`SELECT ${CHART_COLUMNS} FROM chart_accounts ORDER BY code`).all() as ChartRow[];
const objectsSql = (type: "trigger" | "index", table?: string): Array<{ name: string; sql: string }> =>
  (table === undefined
    ? db.prepare("SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY name").all(type)
    : db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = ? AND tbl_name = ? AND sql IS NOT NULL ORDER BY name")
        .all(type, table)) as Array<{ name: string; sql: string }>;
const versions = (): number[] =>
  (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map(
    (r) => r.version,
  );
const ledger = () => ({
  entries: db.prepare("SELECT * FROM journal_entries ORDER BY id").all(),
  lines: db.prepare("SELECT * FROM journal_lines ORDER BY id").all(),
});

/** The owner's world at v10, written as raw SQL because the repository API is not safe at v10. */
function seedRealisticChart(): void {
  db.exec(`
    INSERT INTO companies (id, name, created_at) VALUES ('co1', 'Owner Co', '2025-04-01T00:00:00.000Z');
    INSERT INTO businesses (id, company_id, name, created_at) VALUES ('b1', 'co1', 'Biz', '2025-04-01T00:00:00.000Z');

    -- A user parent, then a user child carrying BOTH company_id and parent_code, then one that is
    -- later deactivated. Distinct created_at / updated_at so a column mix-up cannot hide.
    INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at)
      VALUES ('EXP-PARENT', 'co1', 'Stall Costs', 'EXPENSE', NULL, NULL, 1, '2025-05-01T10:00:00.000Z', '2025-05-02T10:00:00.000Z');
    INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at)
      VALUES ('EXP-STALL-RENT', 'co1', 'Stall Rent', 'EXPENSE', NULL, 'EXP-PARENT', 1, '2025-06-01T11:00:00.000Z', '2025-06-03T11:30:00.000Z');
    INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at)
      VALUES ('EXP-OLD-TRAVEL', 'co1', 'Old Travel', 'EXPENSE', NULL, 'EXP-PARENT', 1, '2025-07-01T12:00:00.000Z', '2025-07-01T12:00:00.000Z');

    INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date)
      VALUES ('je-rent', 'x1', 'Rent paid', 0, '2025-08-01T00:00:00.000Z', 'EXPENSE', 'b1', '2025-08-01');
    INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-rent', 'EXP-STALL-RENT', 500000, 0);
    INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-rent', 'CASH', 0, 500000);
    INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date)
      VALUES ('je-travel', 'x2', 'Travel', 0, '2025-08-02T00:00:00.000Z', 'EXPENSE', 'b1', '2025-08-02');
    INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-travel', 'EXP-OLD-TRAVEL', 120000, 0);
    INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-travel', 'BANK', 0, 120000);

    -- Deactivated AFTER it was posted to, as in real life.
    UPDATE chart_accounts SET active = 0 WHERE code = 'EXP-OLD-TRAVEL';
  `);
}

function buildAtV10(): void {
  runMigrations(db, at(10));
  seedRealisticChart();
  // PRE-STATE: this is what proves the rebuild below really runs.
  expect(tableSql("chart_accounts")).not.toContain("'CUSTOMER_CREDITS'");
  expect(versions()).toEqual(at(10).map((m) => m.version));
}

describe("v11 rebuild over a realistic chart", () => {
  it("keeps every account byte-identical, and every guard, trigger and index in place", () => {
    buildAtV10();
    const rowsBefore = chart();
    const triggersBefore = objectsSql("trigger");
    const chartIndexesBefore = objectsSql("index", "chart_accounts");
    const ledgerBefore = ledger();
    expect(rowsBefore.find((r) => r.code === "EXP-STALL-RENT")).toMatchObject({
      company_id: "co1",
      parent_code: "EXP-PARENT",
    });
    expect(rowsBefore.find((r) => r.code === "EXP-OLD-TRAVEL")?.active).toBe(0);
    expect(chartIndexesBefore.length).toBeGreaterThan(0);

    // The real path: the whole list, so v11 runs from runMigrations like it will for the owner.
    const ran = runMigrations(db, migrations);
    expect(ran).toEqual(migrations.filter((m) => m.version > 10).map((m) => m.version));

    // Rebuilt: the widened CHECK is present.
    expect(tableSql("chart_accounts")).toContain("'CUSTOMER_CREDITS'");

    // Every pre-existing row survives byte-identical, with ONE sanctioned exception: v11 renames
    // UNCATEGORIZED (S4-4) in its seed step, which moves only name and updated_at.
    const rowsAfter = chart();
    for (const before of rowsBefore) {
      const after = rowsAfter.find((r) => r.code === before.code);
      expect(after, `account ${before.code} vanished`).toBeDefined();
      if (before.code === "UNCATEGORIZED") {
        expect({ ...after, name: "", updated_at: "" }).toEqual({ ...before, name: "", updated_at: "" });
        expect(after?.name).toBe("Uncategorised Expense");
      } else {
        expect(after).toEqual(before);
      }
    }
    // And exactly the new system accounts were added, nothing else. This runs the FULL list from
    // v10, so "new" means every code in the live chart that the frozen v9 chart did not have. It is
    // DERIVED, not a literal: the literal went stale at v13 and would again at every later
    // migration that adds an account, and said nothing about v11. It stays an exact comparison.
    const addedCodes = rowsAfter.filter((r) => !rowsBefore.some((b) => b.code === r.code)).map((r) => r.code);
    const expectedAdded = SEED_ACCOUNTS.map((a) => a.code).filter((c) => !V9_SEED_ACCOUNTS.some((a) => a.code === c));
    expect(expectedAdded).toContain("CUSTOMER_CREDITS"); // guard: the derivation is not vacuously empty
    expect(addedCodes.sort()).toEqual([...expectedAdded].sort());

    // Integrity.
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);

    // Triggers: all three present, with their original SQL, and the other tables' triggers too.
    // v24 (R12b) adds its own money_account guard triggers on other tables; every trigger that
    // existed before must still be here, byte-identical, and nothing else may have appeared.
    expect(objectsSql("trigger").filter((t) => !/^trg_\w+_money_account_(insert|update)$/.test(t.name))).toEqual(triggersBefore);
    const names = objectsSql("trigger").map((t) => t.name);
    for (const name of CHART_ACCOUNTS_TRIGGER_NAMES) expect(names).toContain(name);
    // Indexes on chart_accounts are back, identically.
    expect(objectsSql("index", "chart_accounts")).toEqual(chartIndexesBefore);

    // Foreign keys still point where they should (rename must not have left a stale target).
    const fk = (table: string) =>
      (db.pragma(`foreign_key_list(${table})`) as Array<{ table: string; from: string }>).map((f) => `${f.from}->${f.table}`);
    expect(fk("chart_accounts").sort()).toEqual(["company_id->companies", "parent_code->chart_accounts"]);
    expect(fk("journal_lines")).toContain("account->chart_accounts");

    // The ledger is untouched and still joins to the chart.
    expect(ledger()).toEqual(ledgerBefore);
    const joined = db
      .prepare(
        `SELECT jl.account, ca.name, ca.active, ca.parent_code FROM journal_lines jl
         JOIN chart_accounts ca ON ca.code = jl.account WHERE jl.journal_entry_id IN ('je-rent', 'je-travel') ORDER BY jl.id`,
      )
      .all();
    expect(joined).toEqual([
      { account: "EXP-STALL-RENT", name: "Stall Rent", active: 1, parent_code: "EXP-PARENT" },
      { account: "CASH", name: expect.any(String), active: 1, parent_code: null },
      { account: "EXP-OLD-TRAVEL", name: "Old Travel", active: 0, parent_code: "EXP-PARENT" },
      { account: "BANK", name: expect.any(String), active: 1, parent_code: null },
    ]);
  });

  it("leaves the triggers FUNCTIONAL, not merely present", () => {
    buildAtV10();
    runMigrations(db, migrations);

    // journal_lines_account_exists (lives on journal_lines, reads chart_accounts).
    expect(() =>
      db
        .prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-rent', 'NO_SUCH_ACCOUNT', 100, 0)")
        .run(),
    ).toThrow(/must be a code that exists in chart_accounts/);
    // ...and still ACCEPTS a real user account, including the deactivated one (reversals need it).
    for (const account of ["EXP-STALL-RENT", "EXP-OLD-TRAVEL", "CUSTOMER_CREDITS"]) {
      db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-rent', ?, 100, 0)").run(account);
    }

    expect(() => db.prepare("DELETE FROM chart_accounts WHERE code = 'EXP-OLD-TRAVEL'").run()).toThrow(/permanent/);
    expect(() => db.prepare("UPDATE chart_accounts SET type = 'INCOME' WHERE code = 'EXP-STALL-RENT'").run()).toThrow(
      /can never change/,
    );
    expect(() => db.prepare("UPDATE chart_accounts SET code = 'ZZ' WHERE code = 'EXP-STALL-RENT'").run()).toThrow(
      /can never change/,
    );
    // Renaming and deactivating stay allowed (the spec's promise).
    db.prepare("UPDATE chart_accounts SET name = 'Stall Rent 2', active = 0 WHERE code = 'EXP-STALL-RENT'").run();
  });

  it("enforces the widened role CHECK and the unchanged type CHECK", () => {
    buildAtV10();
    runMigrations(db, migrations);
    const insert = db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, 'n', ?, ?, NULL, 1, 't', 't')",
    );
    insert.run("OK-ROLE", "LIABILITY", "CUSTOMER_CREDITS");
    expect(() => insert.run("BAD-ROLE", "LIABILITY", "BOGUS")).toThrow(/CHECK/);
    expect(() => insert.run("BAD-TYPE", "BOGUS", null)).toThrow(/CHECK/);
  });

  it("a second runMigrations is a clean no-op", () => {
    buildAtV10();
    runMigrations(db, migrations);
    const rows = chart();
    const sql = tableSql("chart_accounts");
    const triggers = objectsSql("trigger");
    const applied = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
    const ledgerNow = ledger();

    expect(runMigrations(db, migrations)).toEqual([]);
    // And v11's own guard, called directly, must also decline to rebuild or touch a row.
    applyCustomerCreditsSchema(db);

    expect(chart()).toEqual(rows);
    expect(tableSql("chart_accounts")).toBe(sql);
    expect(objectsSql("trigger")).toEqual(triggers);
    expect(db.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(applied);
    expect(ledger()).toEqual(ledgerNow);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("v11 over an owner-edited chart", () => {
  /**
   * S5-10, OWNER RULED: v11 renames UNCATEGORIZED only while the name is still the v9 default.
   * A name the owner chose himself must survive the migration untouched.
   *
   * This pin previously held the OPPOSITE behaviour - any name was overwritten without a trace -
   * and was deliberately inverted when the owner ruled. Both directions are tested below.
   */
  it("S5-10: a renamed UNCATEGORIZED keeps the owner's name, untouched", () => {
    runMigrations(db, at(10));
    db.prepare("UPDATE chart_accounts SET name = 'Misc Spend', updated_at = '2025-01-01T00:00:00.000Z' WHERE code = 'UNCATEGORIZED'").run();
    expect(tableSql("chart_accounts")).not.toContain("'CUSTOMER_CREDITS'");

    runMigrations(db, migrations);

    const row = chart().find((r) => r.code === "UNCATEGORIZED");
    // The owner's name survives, and updated_at is NOT bumped: the row was never written at all.
    expect(row?.name).toBe("Misc Spend");
    expect(row?.updated_at).toBe("2025-01-01T00:00:00.000Z");
    expect(row).toMatchObject({ type: "EXPENSE", role: null });
    // Re-running changes nothing either.
    runMigrations(db, migrations);
    expect(chart().find((r) => r.code === "UNCATEGORIZED")).toEqual(row);
  });

  it("S5-10: an UNCATEGORIZED still carrying the v9 default name IS renamed, once", () => {
    runMigrations(db, at(10));
    const before = chart().find((r) => r.code === "UNCATEGORIZED");
    // The v9 seed name, derived rather than retyped, is what v11 looks for.
    expect(before?.name).toBe(V9_SEED_ACCOUNTS.find((a) => a.code === "UNCATEGORIZED")?.name);

    runMigrations(db, migrations);

    const renamed = chart().find((r) => r.code === "UNCATEGORIZED");
    expect(renamed?.name).toBe(V11_SEED_ACCOUNTS.find((a) => a.code === "UNCATEGORIZED")?.name);
    expect(renamed?.updated_at).not.toBe(before?.updated_at);
    // Idempotent: a second run leaves the renamed row exactly as it is.
    runMigrations(db, migrations);
    expect(chart().find((r) => r.code === "UNCATEGORIZED")).toEqual(renamed);
  });

  it("rolls back cleanly when a user account already uses a code v11 must seed", () => {
    runMigrations(db, at(10));
    seedRealisticChart();
    // A user (company-owned) account squatting on a system code, with a different class and role.
    db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES ('CUSTOMER_CREDITS', 'co1', 'My Own Thing', 'EXPENSE', NULL, 'EXP-PARENT', 1, '2025-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z')",
    ).run();
    const rowsBefore = chart();
    const sqlBefore = tableSql("chart_accounts");
    const triggersBefore = objectsSql("trigger");
    const indexesBefore = objectsSql("index");
    const ledgerBefore = ledger();

    expect(() => runMigrations(db, migrations)).toThrow(/found account CUSTOMER_CREDITS as EXPENSE\/null.*rolled back/);

    // Really rolled back: not recorded, table SQL still narrow, nothing half-built.
    expect(versions()).toEqual(at(10).map((m) => m.version));
    expect(tableSql("chart_accounts")).toBe(sqlBefore);
    expect(tableSql("chart_accounts")).not.toContain("'CUSTOMER_CREDITS'");
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chart_accounts_v2'").get()).toBeUndefined();
    expect(chart()).toEqual(rowsBefore);
    expect(objectsSql("trigger")).toEqual(triggersBefore);
    expect(objectsSql("index")).toEqual(indexesBefore);
    expect(ledger()).toEqual(ledgerBefore);
    // foreign_keys restored by the finally block, and nothing left dangling.
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);

    // Still usable: the triggers still bite and a normal write still works.
    expect(() =>
      db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-rent', 'NOPE', 1, 0)").run(),
    ).toThrow(/must be a code that exists/);
    db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-rent', 'EXP-STALL-RENT', 1, 0)").run();
  });
});
