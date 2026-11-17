import type Database from "better-sqlite3";

/**
 * Migration v17 body: let a recorded payment be CANCELLED without deleting it (R8).
 *
 * Until now a payment could not be undone at all. The only ways out were to delete the row,
 * which destroys the record and breaks the audit chain, or to leave a wrong payment standing,
 * which leaves the customer's balance wrong for good. Both sit badly against
 * cancel-with-reversal, a fixed rule of this project.
 *
 * Two nullable columns on each payment table. NULLABLE on purpose: SQLite cannot add a NOT
 * NULL column without a default, and a table rebuild would have to drop and replay every
 * trigger that mentions these tables. Nothing is backfilled - every payment that exists today
 * is a live one, which is exactly what `cancelled_at IS NULL` means.
 *
 * NO JOURNAL ENTRY IS TOUCHED HERE. A cancellation posts its own reversing entry, dated the
 * day it happens, through the normal posting door. That is what keeps the ledger immutable:
 * the original payment entry stays exactly as it was posted, and the reversal sits beside it.
 *
 * Idempotent: each column is added only when absent, so re-running is a no-op.
 */
export function applyPaymentCancellationSchema(db: Database.Database): void {
  const hasColumn = (table: "payments" | "supplier_payments", name: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((column) => column.name === name);

  for (const table of ["payments", "supplier_payments"] as const) {
    if (!hasColumn(table, "cancelled_at")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN cancelled_at TEXT`);
    }
    if (!hasColumn(table, "cancellation_reason")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN cancellation_reason TEXT`);
    }
  }
}
