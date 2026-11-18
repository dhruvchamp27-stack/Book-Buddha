import type Database from "better-sqlite3";
import { V21_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v21 - the ROUNDING account the derived cash view uses to tie to the cash that actually moved.
 *
 * ADDITIVE ONLY: one new chart account (INCOME, no role, so the role CHECK needs no widening and
 * no table is rebuilt). Nothing is backfilled: the cash view is derived on every read, so the
 * rounding line appears the moment the code runs and no stored figure moves.
 *
 * Seeds the FROZEN v21 list (V21_ADDED_ACCOUNTS), never the live SEED_ACCOUNTS. If ROUNDING already
 * exists under a different class or role, something has reused the code: throw, rolling v21 back.
 *
 * NOT registered here; `migrations.ts` owns version numbers.
 */
export function applyCashRoundingSchema(db: Database.Database): void {
  db.transaction(() => {
    const now = new Date().toISOString();
    const find = db.prepare("SELECT type, role FROM chart_accounts WHERE code = ?");
    const insert = db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
    );
    for (const account of V21_ADDED_ACCOUNTS) {
      const row = find.get(account.code) as { type: string; role: string | null } | undefined;
      if (row === undefined) {
        insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
        continue;
      }
      if (row.type !== account.type || (row.role ?? null) !== (account.role ?? null)) {
        throw new Error(
          `Migration v21 found account ${account.code} as ${row.type}/${String(row.role)} but expected ${account.type}/${String(account.role ?? null)}; rolled back.`,
        );
      }
    }
  })();
}
