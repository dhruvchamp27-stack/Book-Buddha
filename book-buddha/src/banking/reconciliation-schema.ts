import type Database from "better-sqlite3";

/**
 * R12d - bank reconciliation tables (migration v27, registered by the orchestrator).
 *
 * IDEMPOTENT: every statement is CREATE ... IF NOT EXISTS, so it can be called any number of times.
 * Posted journal lines are never touched: reconciliation state lives ONLY in these two tables.
 *
 * `entries_high_water` is the highest journal_entries rowid at the moment the reconciliation was
 * finished. It is how "changed after finishing" is detected exactly (an entry with a higher rowid
 * was posted afterwards), without depending on two timestamps landing in different milliseconds.
 */
export function applyReconciliationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_reconciliations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      account_code TEXT NOT NULL REFERENCES chart_accounts(code),
      statement_end_date TEXT NOT NULL,
      statement_ending_balance_paise INTEGER NOT NULL,
      beginning_balance_paise INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('IN_PROGRESS', 'FINISHED', 'UNDONE')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      undone_at TEXT,
      undo_reason TEXT,
      entries_high_water INTEGER
    );
    CREATE TABLE IF NOT EXISTS bank_reconciliation_lines (
      reconciliation_id TEXT NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
      journal_line_id INTEGER NOT NULL REFERENCES journal_lines(id),
      PRIMARY KEY (reconciliation_id, journal_line_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_account
      ON bank_reconciliations(company_id, account_code, status);
    CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_lines_line
      ON bank_reconciliation_lines(journal_line_id);
  `);
}
