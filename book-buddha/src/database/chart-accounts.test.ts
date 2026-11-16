import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import {
  ACCOUNT_ROLES,
  ACCOUNT_TYPES,
  applyChartOfAccountsSchema,
  CHART_ACCOUNTS_TRIGGER_NAMES,
  SEED_ACCOUNTS,
} from "./chart-accounts-schema.js";
import { AUDIT_TRIGGER_NAMES } from "./audit-chain-schema.js";
import { ACCOUNT_CODES } from "../accounting/types.js";
import { AccountingRepository } from "./repository.js";

/** A database at the schema just BEFORE the chart of accounts (everything up to v8). */
function preV9Db(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db, migrations.filter((m) => m.version < 9));
  return db;
}

function migrated(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

const names = (db: Database.Database, type: "trigger" | "index"): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = ?").all(type) as Array<{ name: string }>).map((r) => r.name);

/**
 * A real company + business, because migration v9 gates on a global `foreign_key_check`: a
 * journal entry pointing at a business that does not exist would (rightly) fail that gate.
 * Only source_id is left dangling - journal_entries dropped its FK to invoices in v4.
 */
function seedEntry(db: Database.Database, id = "je1"): void {
  db.exec(`
    INSERT OR IGNORE INTO companies (id, name, created_at) VALUES ('co', 'Co', '2026-01-01');
    INSERT OR IGNORE INTO businesses (id, company_id, name, created_at) VALUES ('b1', 'co', 'Business', '2026-01-01');
  `);
  db.prepare(
    "INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date) VALUES (?, 'inv1', 'Invoice', 0, '2026-01-01', 'INVOICE', 'b1', '2026-01-01')",
  ).run(id);
}

describe("chart_accounts table and seed", () => {
  it("is created by the ordinary migration path with every seeded account", () => {
    const db = migrated();
    const rows = db.prepare("SELECT code, name, type, role, company_id, active FROM chart_accounts ORDER BY code").all() as Array<{
      code: string; name: string; type: string; role: string | null; company_id: string | null; active: number;
    }>;
    expect(rows).toHaveLength(SEED_ACCOUNTS.length);
    for (const seeded of SEED_ACCOUNTS) {
      const row = rows.find((r) => r.code === seeded.code);
      expect(row, `seeded account ${seeded.code} is missing`).toBeDefined();
      expect(row).toMatchObject({ name: seeded.name, type: seeded.type, role: seeded.role ?? null, active: 1 });
      // S2-1: system accounts are seeded ONCE with company_id NULL, not per company.
      expect(row?.company_id).toBeNull();
    }
  });

  it("seeds every code the posting engine can emit, so no existing journal can be orphaned", () => {
    const db = migrated();
    const seeded = new Set((db.prepare("SELECT code FROM chart_accounts").all() as Array<{ code: string }>).map((r) => r.code));
    for (const code of ACCOUNT_CODES) expect(seeded, `engine code ${code} is not in the chart`).toContain(code);
  });

  it("gives every account exactly one of the five classes, and a role only where it has a job", () => {
    const db = migrated();
    const rows = db.prepare("SELECT code, type, role FROM chart_accounts").all() as Array<{ code: string; type: string; role: string | null }>;
    for (const row of rows) {
      expect(ACCOUNT_TYPES as readonly string[]).toContain(row.type);
      if (row.role !== null) expect(ACCOUNT_ROLES as readonly string[]).toContain(row.role);
    }
    // A class is never empty: every report section has something to group.
    for (const type of ACCOUNT_TYPES) {
      expect(rows.filter((r) => r.type === type).length, `no account is classed ${type}`).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown class or role outright", () => {
    const db = migrated();
    const insert = (type: string, role: string | null) =>
      db.prepare(
        "INSERT INTO chart_accounts (code, company_id, name, type, role, active, created_at, updated_at) VALUES ('X', NULL, 'X', ?, ?, 1, 't', 't')",
      ).run(type, role);
    expect(() => insert("TAX", null)).toThrow(/CHECK/);
    expect(() => insert("ASSET", "SOMETHING")).toThrow(/CHECK/);
  });

  it("is idempotent: re-running changes nothing", () => {
    const db = migrated();
    const before = db.prepare("SELECT * FROM chart_accounts ORDER BY code").all();
    const linesBefore = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'journal_lines'").get();
    applyChartOfAccountsSchema(db);
    applyChartOfAccountsSchema(db);
    expect(db.prepare("SELECT * FROM chart_accounts ORDER BY code").all()).toEqual(before);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'journal_lines'").get()).toEqual(linesBefore);
  });
});

describe("the journal_lines rebuild", () => {
  it("drops the fixed account CHECK and adds the chart_accounts foreign key", () => {
    const beforeSql = (preV9Db().prepare("SELECT sql FROM sqlite_master WHERE name = 'journal_lines'").get() as { sql: string }).sql;
    expect(beforeSql).toContain("'PAYABLES'"); // the old hardcoded list
    const afterSql = (migrated().prepare("SELECT sql FROM sqlite_master WHERE name = 'journal_lines'").get() as { sql: string }).sql;
    expect(afterSql).not.toContain("'PAYABLES'");
    expect(afterSql).toContain("REFERENCES chart_accounts");
  });

  it("carries existing journal lines across untouched, ids and all", () => {
    const db = preV9Db();
    seedEntry(db);
    db.exec(`
      INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise)
        VALUES ('je1', 'CASH', 11800, 0), ('je1', 'SALES', 0, 10000), ('je1', 'OUTPUT_CGST', 0, 900), ('je1', 'OUTPUT_SGST', 0, 900);
    `);
    const before = db.prepare("SELECT id, journal_entry_id, account, debit_paise, credit_paise FROM journal_lines ORDER BY id").all();
    runMigrations(db);
    expect(db.prepare("SELECT id, journal_entry_id, account, debit_paise, credit_paise FROM journal_lines ORDER BY id").all()).toEqual(before);
  });

  it("REPLAYS the v8 immutability triggers: journal history stays protected after the rebuild", () => {
    const db = migrated();
    const installed = names(db, "trigger");
    for (const name of AUDIT_TRIGGER_NAMES) expect(installed, `v8 trigger ${name} was lost in the v9 rebuild`).toContain(name);
    for (const name of CHART_ACCOUNTS_TRIGGER_NAMES) expect(installed).toContain(name);

    seedEntry(db);
    db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'CASH', 100, 0), ('je1', 'SALES', 0, 100)");
    expect(() => db.exec("DELETE FROM journal_lines")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_lines SET debit_paise = 999")).toThrow(/immutable/);
    expect(() => db.exec("DELETE FROM journal_entries")).toThrow(/immutable/);
  });

  it("keeps the v8 trigger SQL byte-identical across the rebuild", () => {
    const sqlOf = (db: Database.Database) =>
      db.prepare(
        `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN (${AUDIT_TRIGGER_NAMES.map(() => "?").join(", ")}) ORDER BY name`,
      ).all(...AUDIT_TRIGGER_NAMES);
    expect(sqlOf(migrated())).toEqual(sqlOf(preV9Db()));
  });

  it("keeps the id sequence running, so a line posted after the rebuild never reuses an id", () => {
    const db = preV9Db();
    seedEntry(db);
    db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'CASH', 100, 0), ('je1', 'SALES', 0, 100)");
    runMigrations(db);
    db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'INVENTORY', 50, 0)");
    const ids = (db.prepare("SELECT id FROM journal_lines ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual([1, 2, 3]);
  });
});

describe("account validity is enforced in the database itself", () => {
  it("refuses a journal line whose account is not in the chart, on any connection", () => {
    const db = migrated();
    seedEntry(db);
    // Foreign keys are OFF here on purpose: this is the property the dropped CHECK used to have,
    // and the trigger is what buys it back.
    db.pragma("foreign_keys = OFF");
    expect(() =>
      db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'MADE_UP', 100, 0)"),
    ).toThrow(/chart_accounts/);
  });

  it("accepts a line on an account created at RUNTIME - the whole point of the table", () => {
    const db = migrated();
    seedEntry(db);
    db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, active, created_at, updated_at) VALUES ('MARKETING', NULL, 'Marketing', 'EXPENSE', NULL, 1, 't', 't')",
    ).run();
    db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'MARKETING', 100, 0)");
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines WHERE account = 'MARKETING'").get()).toEqual({ n: 1 });
  });

  it("still accepts a line on a DEACTIVATED account, so cancel-with-reversal cannot break", () => {
    const db = migrated();
    seedEntry(db);
    db.prepare("UPDATE chart_accounts SET active = 0 WHERE code = 'OTHER_INCOME'").run();
    db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'OTHER_INCOME', 0, 100)");
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines WHERE account = 'OTHER_INCOME'").get()).toEqual({ n: 1 });
  });
});

describe("the chart itself is guarded", () => {
  it("never lets an account be deleted or re-classed, but allows rename and deactivate", () => {
    const db = migrated();
    expect(() => db.exec("DELETE FROM chart_accounts WHERE code = 'SALES'")).toThrow(/permanent/);
    expect(() => db.exec("UPDATE chart_accounts SET type = 'EXPENSE' WHERE code = 'SALES'")).toThrow(/re-classified/);
    expect(() => db.exec("UPDATE chart_accounts SET code = 'REVENUE' WHERE code = 'SALES'")).toThrow(/re-classified/);
    expect(() => db.exec("UPDATE chart_accounts SET role = 'CASH' WHERE code = 'SALES'")).toThrow(/re-classified/);
    // The spec's promise: "add/rename anytime".
    db.exec("UPDATE chart_accounts SET name = 'Revenue' WHERE code = 'SALES'");
    db.exec("UPDATE chart_accounts SET active = 0 WHERE code = 'LOANS'");
    expect(db.prepare("SELECT name FROM chart_accounts WHERE code = 'SALES'").get()).toEqual({ name: "Revenue" });
  });

  it("refuses a duplicate code, so the foreign key always has exactly one parent", () => {
    const db = migrated();
    expect(() =>
      db.exec("INSERT INTO chart_accounts (code, company_id, name, type, active, created_at, updated_at) VALUES ('SALES', 'c1', 'Other sales', 'INCOME', 1, 't', 't')"),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});

/**
 * The structural invariants the table buys us. These are the tests that would have caught the
 * old bug: a code missing from one of three hardcoded report lists was silently dropped, and for
 * a balance-sheet account that unbalanced the sheet with NO error at all.
 */
describe("reports are classified by the table, not by a hardcoded list", () => {
  /**
   * One balanced journal entry that touches EVERY seeded account, so each report section has
   * something in it. Posted through SQL rather than the door because the door's own validation
   * is the subject of the next commit; what is under test here is the report classification.
   */
  function postAcrossEveryAccount(db: Database.Database): void {
    seedEntry(db, "je-all");
    const codes = (db.prepare("SELECT code, type FROM chart_accounts ORDER BY code").all() as Array<{ code: string; type: string }>);
    const insert = db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-all', ?, ?, ?)");
    // Debit every debit-normal account 1000 and credit every credit-normal one, then square the
    // entry off against CASH so debits equal credits exactly.
    let debits = 0;
    let credits = 0;
    for (const { code, type } of codes) {
      if (code === "CASH") continue;
      const creditNormal = type === "INCOME" || type === "LIABILITY" || type === "EQUITY";
      insert.run(code, creditNormal ? 0 : 1000, creditNormal ? 1000 : 0);
      if (creditNormal) credits += 1000; else debits += 1000;
    }
    const squareOff = credits - debits;
    insert.run("CASH", squareOff > 0 ? squareOff : 0, squareOff > 0 ? 0 : -squareOff);
  }

  it("keeps assets = liabilities + equity with EVERY seeded account posted to", () => {
    const repository = new AccountingRepository();
    const db = repository.db;
    postAcrossEveryAccount(db);
    const sheet = repository.getBalanceSheet();
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    // And every account that was posted to appears in exactly one section of the sheet or the P&L.
    const pl = repository.getProfitAndLoss({ basis: "ACCRUAL" });
    const placed = [...sheet.assets, ...sheet.liabilities, ...sheet.equity, ...pl.income, ...pl.expenses]
      .map((r) => r.account)
      .filter((code) => code !== "RETAINED_EARNINGS");
    const posted = (db.prepare("SELECT DISTINCT account FROM journal_lines").all() as Array<{ account: string }>).map((r) => r.account);
    expect([...placed].sort()).toEqual([...posted].sort());
    expect(new Set(placed).size, "an account was placed in two sections at once").toBe(placed.length);
  });

  it("agrees with a raw SUM over journal_lines, so the JOIN drops nothing", () => {
    const repository = new AccountingRepository();
    const db = repository.db;
    postAcrossEveryAccount(db);
    const tb = repository.getTrialBalance();
    const raw = db.prepare("SELECT COALESCE(SUM(debit_paise), 0) AS d, COALESCE(SUM(credit_paise), 0) AS c FROM journal_lines").get() as { d: number; c: number };
    expect(tb.reduce((t, r) => t + r.debitPaise, 0)).toBe(raw.d);
    expect(tb.reduce((t, r) => t + r.creditPaise, 0)).toBe(raw.c);
    expect(raw.d).toBe(raw.c);
    expect(tb).toHaveLength((db.prepare("SELECT COUNT(DISTINCT account) AS n FROM journal_lines").get() as { n: number }).n);
  });

  it("puts a RUNTIME-created account into the right report section with no code change", () => {
    const repository = new AccountingRepository();
    const db = repository.db;
    seedEntry(db);
    db.exec(`
      INSERT INTO chart_accounts (code, company_id, name, type, active, created_at, updated_at)
        VALUES ('FAIR_STALL_RENT', NULL, 'Fair stall rent', 'EXPENSE', 1, 't', 't'),
               ('SPONSORSHIP', NULL, 'Sponsorship income', 'INCOME', 1, 't', 't'),
               ('DEPOSITS_HELD', NULL, 'Refundable deposits held', 'LIABILITY', 1, 't', 't');
      INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES
        ('je1', 'FAIR_STALL_RENT', 5000, 0),
        ('je1', 'SPONSORSHIP', 0, 3000),
        ('je1', 'DEPOSITS_HELD', 0, 2000);
    `);
    const pl = repository.getProfitAndLoss({ basis: "ACCRUAL" });
    expect(pl.expenses.map((r) => r.account)).toContain("FAIR_STALL_RENT");
    expect(pl.income.map((r) => r.account)).toContain("SPONSORSHIP");
    expect(pl.totalExpensesPaise).toBe(5000);
    expect(pl.totalIncomePaise).toBe(3000);
    const sheet = repository.getBalanceSheet();
    expect(sheet.liabilities.map((r) => r.account)).toContain("DEPOSITS_HELD");
    // The whole point: a brand-new account cannot unbalance the sheet.
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
  });

  it("refuses to report at all on a ledger account with no seat in the chart", () => {
    const repository = new AccountingRepository();
    const db = repository.db;
    seedEntry(db);
    db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'SALES', 0, 100)");
    // Forge the orphan the FK and trigger exist to prevent, and prove the reports shout rather
    // than silently dropping it the way the hardcoded lists used to.
    db.exec("DROP TRIGGER journal_lines_account_exists");
    db.pragma("foreign_keys = OFF");
    db.exec("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'ORPHAN', 100, 0)");
    expect(() => repository.getBalanceSheet()).toThrow(/ORPHAN/);
    expect(() => repository.getTrialBalance()).toThrow(/chart_accounts/);
  });
});
