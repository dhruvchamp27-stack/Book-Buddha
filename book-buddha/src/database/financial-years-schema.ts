import type Database from "better-sqlite3";

/**
 * Migration v10 body (wired by the orchestrator in migrations.ts): financial years and the lock.
 *
 * Purely additive - one new table, so nothing existing is touched and it stays transactional.
 *
 * A year is per BUSINESS, not per company: the prototype allows several businesses under one
 * company and they can close on different dates (CLAUDE_FINISHING_PLAN.md section 19).
 *
 * The lock itself is enforced in the posting door (ledger.ts), at the extension point left there
 * by the one-door commit. That is the only place journal entries are written, so a locked period
 * cannot be posted into by any route - and because EVERY reversal in this codebase is dated the
 * day it happens (never the original document's date), locking a past year can never block a
 * cancellation. The reversal simply lands in the current open period, which is what an accountant
 * expects and why the lock needs no reversal exemption.
 */
export function applyFinancialYearsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_years (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'LOCKED')),
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(ends_on >= starts_on),
      -- A business cannot have two years starting on the same day. Full overlap prevention
      -- needs a range comparison, which SQLite cannot express as a constraint, so the
      -- repository checks it; this catches the exact-duplicate case in the database itself.
      UNIQUE(business_id, starts_on)
    );
    CREATE INDEX IF NOT EXISTS idx_financial_years_business ON financial_years(business_id, starts_on, ends_on);
    -- The door's lookup: locked years for a business, by date. Partial index so it stays small.
    CREATE INDEX IF NOT EXISTS idx_financial_years_locked
      ON financial_years(business_id, starts_on, ends_on) WHERE status = 'LOCKED';
  `);
}
