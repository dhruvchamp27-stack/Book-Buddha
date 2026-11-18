import type Database from "better-sqlite3";
import { V18_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v18 - R8 bill discount. Header-level discount and extra charge on a purchase bill, the mirror of
 * what an invoice has had since the baseline.
 *
 * ADDITIVE ONLY, twice over:
 *  - two columns on `purchase_bills`, both NOT NULL DEFAULT 0, added with ALTER TABLE. No table is
 *    rebuilt, so no trigger has to be dropped and replayed (the rule that bit v11: any rebuild of
 *    `chart_accounts` must replay every trigger whose body mentions it, `journal_lines_account_exists`
 *    included). Every bill that exists today reads back 0 / 0, which is exactly what it was.
 *  - two chart accounts, seeded from the FROZEN V18 list, never the live SEED_ACCOUNTS. The reason
 *    is on V11_SEED_ACCOUNTS: an account appended to the live list would be handed to every FRESH
 *    database by an older migration, so the migration meant to add it would never run its seeding
 *    in any test and would execute for the first time on the owner's real database.
 *
 * Why the discount needs an account of its own rather than being netted into the goods cost - the
 * stock-layer and the EXPENSE-in-credit arguments - is written out on V18_ADDED_ACCOUNTS.
 *
 * NOT registered here. The orchestrator registers it as v18 in `migrations.ts`, which owns version
 * numbers (the convention at the top of opening-balances-schema.ts). The runner wraps `up` in a
 * transaction, so a throw below rolls the whole of v18 back and v18 is not recorded.
 *
 * NOTHING IS BACKFILLED and no journal entry is touched. A bill finalized before v18 was posted
 * without a discount because it had none; re-deriving its entry here would rewrite posted history.
 */
export function applyBillDiscountSchema(db: Database.Database): void {
  db.transaction(() => {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(purchase_bills)").all() as Array<{ name: string }>).map((row) => row.name),
    );
    // Idempotent: ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite, and a migration must be
    // safe to meet a database that has already been partly upgraded.
    if (!columns.has("discount_paise")) {
      db.exec("ALTER TABLE purchase_bills ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.has("extra_charge_paise")) {
      db.exec("ALTER TABLE purchase_bills ADD COLUMN extra_charge_paise INTEGER NOT NULL DEFAULT 0");
    }

    const now = new Date().toISOString();
    const find = db.prepare("SELECT type, role FROM chart_accounts WHERE code = ?");
    const insert = db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
    );
    for (const account of V18_ADDED_ACCOUNTS) {
      const row = find.get(account.code) as { type: string; role: string | null } | undefined;
      if (row === undefined) {
        insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
        continue;
      }
      // A system code is never INSERT OR IGNOREd into place. If it already exists under a
      // DIFFERENT class, something has reused the code, so throw (rolling v18 back) naming both.
      if (row.type !== account.type || (row.role ?? null) !== (account.role ?? null)) {
        throw new Error(
          `Migration v18 found account ${account.code} as ${row.type}/${String(row.role)} but expected ${account.type}/${String(account.role ?? null)}; rolled back.`,
        );
      }
    }
  })();
}
