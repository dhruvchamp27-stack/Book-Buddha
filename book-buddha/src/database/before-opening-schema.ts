import type Database from "better-sqlite3";

/**
 * Migration v33 body (F, rulings S16-2(c), Q13, S17-12): documents and payments dated ON or BEFORE the
 * business's opening date are kept as HISTORY - visible and searchable, marked "Before opening",
 * NEVER journalled and never moving stock, and left out of every total and report.
 *
 * One column per table, `before_opening` 0/1, default 0. The flag is set once, at finalize / record,
 * and frozen after that. Status is unchanged (a history invoice is still FINALIZED or CANCELLED).
 *
 * ADDITIVE ONLY and IDEMPOTENT: each ALTER is guarded by PRAGMA table_info. Nothing is backfilled -
 * every existing row was posted, so it is not history. NOT registered here: `migrations.ts` owns
 * version numbers.
 */
export const BEFORE_OPENING_TABLES = [
  "invoices",
  "purchase_bills",
  "expenses",
  "credit_notes",
  "purchase_returns",
  "payments",
  "supplier_payments",
] as const;

export function applyBeforeOpeningSchema(db: Database.Database): void {
  for (const table of BEFORE_OPENING_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "before_opening")) {
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN before_opening INTEGER NOT NULL DEFAULT 0 CHECK (before_opening IN (0, 1))`,
      );
    }
  }
}
