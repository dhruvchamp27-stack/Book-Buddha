import type Database from "better-sqlite3";
import { V13_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v13 - the opening-balance foundation (R4a, section 14). Additive only: it seeds the accounts
 * added since v11 and creates two tables. No table is rebuilt and no CHECK is widened.
 *
 * NOT registered here. It is registered by the orchestrator as v13 in `migrations.ts`, which owns
 * version numbers, and must not register itself (the convention at the top of
 * customer-credits-schema.ts). The migration runner wraps `up` in a transaction, so a throw from
 * the seeding below rolls the whole of v13 back and v13 is not recorded.
 *
 * `opening_balances` is the header of ONE set of opening figures; `opening_balance_lines` holds
 * what the owner TYPED. The balancing OPENING_BALANCE_EQUITY line is not stored here: it lives
 * only in the posted journal entry (`journal_entry_id`), which is the single source of truth for
 * the ledger. Corrections are by reversal (`reversed_at`), never by edit or delete.
 */
export function applyOpeningBalancesSchema(db: Database.Database): void {
  db.transaction(() => {
    seedAccountsAddedSinceV11(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS opening_balances (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        as_at TEXT NOT NULL,
        journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
        reversed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_opening_balances_business ON opening_balances(business_id);
      CREATE INDEX IF NOT EXISTS idx_opening_balances_entry ON opening_balances(journal_entry_id);
      -- Backstop for the repository's own "one live set per business" rule.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_opening_balances_one_live
        ON opening_balances(business_id) WHERE reversed_at IS NULL;

      CREATE TABLE IF NOT EXISTS opening_balance_lines (
        id TEXT PRIMARY KEY,
        opening_balance_id TEXT NOT NULL REFERENCES opening_balances(id),
        account TEXT NOT NULL REFERENCES chart_accounts(code),
        debit_paise INTEGER NOT NULL DEFAULT 0,
        credit_paise INTEGER NOT NULL DEFAULT 0,
        CHECK(debit_paise >= 0 AND credit_paise >= 0
          AND ((debit_paise > 0 AND credit_paise = 0) OR (debit_paise = 0 AND credit_paise > 0)))
      );
      CREATE INDEX IF NOT EXISTS idx_opening_balance_lines_set ON opening_balance_lines(opening_balance_id);
      CREATE INDEX IF NOT EXISTS idx_opening_balance_lines_account ON opening_balance_lines(account);
    `);
  })();
}

/**
 * Roles whose balances come from their own SUB-LEDGER, so they can never be typed in as an opening
 * line: RECEIVABLES (opening customer balances), PAYABLES (opening supplier balances), INVENTORY
 * (opening stock) and CUSTOMER_CREDITS (credit notes). Typing one here would put the ledger and the
 * sub-ledger permanently out of step, with no report able to say why.
 *
 * Why not SETTLEMENT_ROLES: that constant answers a different question - "is this line how a
 * document was settled, rather than what it earned" (the cash-view exclusion). It contains CASH and
 * BANK, which are exactly what an owner MUST be able to open with, and it lacks INVENTORY, which
 * must be refused. The two sets overlap on three roles but are not the same set.
 *
 * Matched by ROLE through a lookup in chart_accounts, never by a list of codes: codes are not a
 * fixed union, and only a system account can carry a role (S2-1), so no user account is caught.
 */
export const OPENING_CONTROL_ROLES = ["RECEIVABLES", "PAYABLES", "INVENTORY", "CUSTOMER_CREDITS"] as const;

/** The plug: holds whatever difference remains until everything is entered. Never an input. */
export const OPENING_BALANCE_EQUITY_CODE = "OPENING_BALANCE_EQUITY";

/**
 * Seeds the FROZEN v13 list (V13_ADDED_ACCOUNTS), never the live SEED_ACCOUNTS: a later account
 * added to the live list must not be handed to v13 on a fresh database. Mirrors v11's safety: a
 * system code is never `INSERT OR IGNORE`d into place. If it already exists under a DIFFERENT
 * class or role, something has reused it, so throw (rolling back v13) naming both.
 */
function seedAccountsAddedSinceV11(db: Database.Database): void {
  const now = new Date().toISOString();
  const find = db.prepare("SELECT type, role FROM chart_accounts WHERE code = ?");
  const insert = db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
  );
  for (const account of V13_ADDED_ACCOUNTS) {
    const row = find.get(account.code) as { type: string; role: string | null } | undefined;
    if (row === undefined) {
      insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
      continue;
    }
    if (row.type !== account.type || (row.role ?? null) !== (account.role ?? null)) {
      throw new Error(
        `Migration v13 found account ${account.code} as ${row.type}/${String(row.role)} but expected ${account.type}/${String(account.role ?? null)}; rolled back.`,
      );
    }
  }
}
