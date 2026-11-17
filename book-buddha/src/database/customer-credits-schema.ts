import type Database from "better-sqlite3";
import { ACCOUNT_ROLES, ACCOUNT_TYPES, SEED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v11 and v12 - the credit-discharge slice (S4-1, S4-4, S4-5).
 *
 * v11 widens the chart_accounts `role` CHECK so CUSTOMER_CREDITS can exist, and seeds the two
 * accounts added since v9. v12 is purely additive: the two discharge tables and the column that
 * persists a note's refundable share.
 *
 * Neither is registered here. `migrations.ts` owns version numbers.
 */

type ObjectRow = { name: string; sql: string };

/** The identity of chart_accounts that the rebuild must not change. */
type ChartFingerprint = {
  triggers: string;
  indexes: string;
  rows: number;
  content: string;
};

/**
 * Every trigger whose BODY mentions chart_accounts, not merely those whose tbl_name is
 * chart_accounts. `journal_lines_account_exists` sits on journal_lines and reads chart_accounts,
 * and SQLite re-parses every trigger during ALTER TABLE ... RENAME: leaving it in place fails the
 * rename outright with "error in trigger journal_lines_account_exists: no such table:
 * main.chart_accounts". Reproduced on SQLite 3.53.4 before this was written.
 */
const triggersMentioningChart = (db: Database.Database): ObjectRow[] =>
  db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%chart_accounts%' ORDER BY name")
    .all() as ObjectRow[];

const indexesOfChart = (db: Database.Database): ObjectRow[] =>
  db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chart_accounts' AND sql IS NOT NULL ORDER BY name",
    )
    .all() as ObjectRow[];

function fingerprint(db: Database.Database): ChartFingerprint {
  const totals = db.prepare("SELECT COUNT(*) AS rows FROM chart_accounts").get() as { rows: number };
  // Content, not just a count: a rebuild that silently dropped a role or reclassified an account
  // would keep the same number of rows.
  const content = JSON.stringify(
    db
      .prepare("SELECT code, company_id, name, type, role, parent_code, active FROM chart_accounts ORDER BY code")
      .all(),
  );
  return {
    triggers: JSON.stringify(triggersMentioningChart(db).map((r) => [r.name, r.sql])),
    indexes: JSON.stringify(indexesOfChart(db).map((r) => [r.name, r.sql])),
    rows: totals.rows,
    content,
  };
}

const tableSql = (db: Database.Database, name: string): string | undefined =>
  (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string } | undefined)
    ?.sql;

export function applyCustomerCreditsSchema(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Guard on what this migration ADDS - the widened CHECK - never on the old one being
      // absent, or the rebuild would re-run forever once the old list is gone (the v9 lesson).
      const sql = tableSql(db, "chart_accounts");
      if (sql !== undefined && !sql.includes("'CUSTOMER_CREDITS'")) rebuildChartAccounts(db);
      seedAccountsAddedSinceV9(db);

      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(`Migration v11 left ${violations.length} foreign key violation(s); rolled back.`);
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function rebuildChartAccounts(db: Database.Database): void {
  const before = fingerprint(db);
  const triggers = triggersMentioningChart(db);
  const indexes = indexesOfChart(db);
  for (const trigger of triggers) db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);

  db.exec(`
    CREATE TABLE chart_accounts_v2 (
      code TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN (${ACCOUNT_TYPES.map((t) => `'${t}'`).join(", ")})),
      role TEXT CHECK(role IN (${ACCOUNT_ROLES.map((r) => `'${r}'`).join(", ")})),
      parent_code TEXT REFERENCES chart_accounts(code),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO chart_accounts_v2 (code, company_id, name, type, role, parent_code, active, created_at, updated_at)
      SELECT code, company_id, name, type, role, parent_code, active, created_at, updated_at FROM chart_accounts ORDER BY code;
    DROP TABLE chart_accounts;
    ALTER TABLE chart_accounts_v2 RENAME TO chart_accounts;
  `);

  for (const index of indexes) db.exec(index.sql);
  for (const trigger of triggers) db.exec(trigger.sql);

  const after = fingerprint(db);
  for (const key of ["triggers", "indexes", "rows", "content"] as const) {
    if (before[key] !== after[key]) {
      throw new Error(
        `Migration v11 changed chart_accounts.${key} during the rebuild (before ${String(before[key])}, after ${String(after[key])}); rolled back.`,
      );
    }
  }
}

function seedAccountsAddedSinceV9(db: Database.Database): void {
  const now = new Date().toISOString();
  const existing = new Map(
    (
      db.prepare("SELECT code, type, role, name FROM chart_accounts").all() as Array<{
        code: string;
        type: string;
        role: string | null;
        name: string;
      }>
    ).map((row) => [row.code, row]),
  );
  const insert = db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
  );
  for (const account of SEED_ACCOUNTS) {
    const row = existing.get(account.code);
    if (row === undefined) {
      insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
      continue;
    }
    // Never INSERT OR IGNORE a system account into place: if a code already exists under a
    // DIFFERENT class or role, something has reused it, and silently skipping would leave the
    // engine reading an account that means something else.
    if (row.type !== account.type || (row.role ?? null) !== (account.role ?? null)) {
      throw new Error(
        `Migration v11 found account ${account.code} as ${row.type}/${String(row.role)} but expected ${account.type}/${String(account.role ?? null)}; rolled back.`,
      );
    }
  }
  // S4-4: UNCATEGORIZED keeps its code (codes are immutable, S2-1) and becomes explicitly the
  // expense side now that UNCATEGORIZED_INCOME exists. Only `name` changes, which the
  // chart_accounts_no_reclass trigger permits - it guards code, type and role.
  db.prepare("UPDATE chart_accounts SET name = ?, updated_at = ? WHERE code = 'UNCATEGORIZED' AND name <> ?").run(
    "Uncategorised Expense",
    now,
    "Uncategorised Expense",
  );
}

/**
 * v12 - additive only. Two tables for the two ways a credit note is discharged (S4-5), plus the
 * column that persists how much of a note was NOT set against an open balance.
 *
 * The split has to be stored, not recomputed: the books fix it at finalize time from the balance
 * outstanding then, while the cash-view walk sorts notes BEFORE payments on the same day. Pay
 * 14,000 in the morning and credit 5,000 that afternoon and the two disagree - the ledger says
 * 1,000 offset and 4,000 refundable, a recomputing walk would say 5,000 offset.
 */
export function applyCreditDischargeSchema(db: Database.Database): void {
  const columns = db.pragma("table_info(credit_notes)") as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "refundable_paise")) {
    db.exec("ALTER TABLE credit_notes ADD COLUMN refundable_paise INTEGER NOT NULL DEFAULT 0");
  }
  // Existing notes need no backfill: until this slice a note could never exceed what was still
  // unpaid, so every one of them is fully offset and 0 is already right.
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_note_refunds (
      id TEXT PRIMARY KEY,
      credit_note_id TEXT NOT NULL REFERENCES credit_notes(id),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      refunded_on TEXT NOT NULL,
      payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'BANK')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credit_note_refunds_note ON credit_note_refunds(credit_note_id);

    CREATE TABLE IF NOT EXISTS credit_note_applications (
      id TEXT PRIMARY KEY,
      credit_note_id TEXT NOT NULL REFERENCES credit_notes(id),
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      applied_on TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credit_note_applications_note ON credit_note_applications(credit_note_id);
    CREATE INDEX IF NOT EXISTS idx_credit_note_applications_invoice ON credit_note_applications(invoice_id);
  `);
}
