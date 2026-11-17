import type Database from "better-sqlite3";
import { V15_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v15 - inter-fair clearing (S5-11). Additive only: it seeds INTER_FAIR_CLEARING and nothing else.
 * No table is rebuilt and no CHECK is widened (the account is an ASSET with no role).
 *
 * NOT registered here. It is registered by the orchestrator as v15 in `migrations.ts`, which owns
 * version numbers, and must not register itself (the convention at the top of
 * opening-balances-schema.ts). The migration runner wraps `up` in a transaction, so a throw from
 * the seeding below rolls the whole of v15 back and v15 is not recorded.
 *
 * Seeds the FROZEN v15 list (V15_ADDED_ACCOUNTS), never the live SEED_ACCOUNTS: a later account
 * added to the live list must not be handed to v15 on a fresh database. A system code is never
 * `INSERT OR IGNORE`d into place; if it already exists under a DIFFERENT class or role, something
 * has reused it, so throw (rolling back v15) naming both.
 */
export function applyInterFairClearingSchema(db: Database.Database): void {
  db.transaction(() => {
    const now = new Date().toISOString();
    const find = db.prepare("SELECT type, role FROM chart_accounts WHERE code = ?");
    const insert = db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
    );
    for (const account of V15_ADDED_ACCOUNTS) {
      const row = find.get(account.code) as { type: string; role: string | null } | undefined;
      if (row === undefined) {
        insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
        continue;
      }
      if (row.type !== account.type || (row.role ?? null) !== (account.role ?? null)) {
        throw new Error(
          `Migration v15 found account ${account.code} as ${row.type}/${String(row.role)} but expected ${account.type}/${String(account.role ?? null)}; rolled back.`,
        );
      }
    }
  })();
}
