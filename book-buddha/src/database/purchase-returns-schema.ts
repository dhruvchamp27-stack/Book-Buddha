import type Database from "better-sqlite3";
import { V19_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v19 - R8 purchase returns (the supplier mirror of a credit note) and supplier refunds.
 *
 * Until now goods could only go back to a supplier by CANCELLING the whole bill, which is all or
 * nothing and rewrites a document that was correct when it was issued. A return is the partial,
 * honest case: some of what was bought goes back, on its own dated document, leaving the bill
 * standing as posted.
 *
 * ADDITIVE ONLY: four new tables and one new account. No existing table is altered or rebuilt, so
 * no trigger has to be replayed (the v11 rule), and nothing is backfilled - there is no such thing
 * as a purchase return before this migration.
 *
 * The two tables mirror credit_notes / credit_note_lines deliberately, down to the column names,
 * because the whole feature is the mirror of that one and the next person to read both should not
 * have to hold two vocabularies at once.
 *
 * NOT registered here. The orchestrator registers it as v19 in `migrations.ts`, which owns version
 * numbers. The runner wraps `up` in a transaction, so a throw below rolls the whole of v19 back.
 */
export function applyPurchaseReturnsSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id TEXT PRIMARY KEY,
        bill_id TEXT NOT NULL REFERENCES purchase_bills(id),
        number TEXT NOT NULL,
        reason TEXT NOT NULL,
        -- A return HAS a date of its own, unlike a credit note (S8-4: that a credit note cannot
        -- be back-dated is an open complaint). Goods go back on a day, and the owner may well
        -- enter it later, so the document carries the day it happened.
        return_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('DRAFT', 'FINALIZED', 'CANCELLED')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_returns_bill ON purchase_returns(bill_id);

      CREATE TABLE IF NOT EXISTS purchase_return_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES items(id),
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_return ON purchase_return_lines(purchase_return_id);

      -- Money the supplier actually hands back, against a return that exceeded what was still
      -- owed on the bill. The mirror of credit_note_refunds.
      CREATE TABLE IF NOT EXISTS supplier_refunds (
        id TEXT PRIMARY KEY,
        purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id),
        amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
        refunded_on TEXT NOT NULL,
        payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'BANK')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_refunds_return ON supplier_refunds(purchase_return_id);
    `);

    const now = new Date().toISOString();
    const find = db.prepare("SELECT type, role FROM chart_accounts WHERE code = ?");
    const insert = db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
    );
    for (const account of V19_ADDED_ACCOUNTS) {
      const row = find.get(account.code) as { type: string; role: string | null } | undefined;
      if (row === undefined) {
        insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
        continue;
      }
      if (row.type !== account.type || (row.role ?? null) !== (account.role ?? null)) {
        throw new Error(
          `Migration v19 found account ${account.code} as ${row.type}/${String(row.role)} but expected ${account.type}/${String(account.role ?? null)}; rolled back.`,
        );
      }
    }
  })();
}
