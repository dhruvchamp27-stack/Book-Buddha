import type Database from "better-sqlite3";

/**
 * v14 - opening customer and supplier balances (R4b). Additive only: four new tables, no table is
 * rebuilt and no CHECK is widened.
 *
 * NOT registered here. It is registered by the orchestrator as v14 in `migrations.ts`, which owns
 * version numbers, and must not register itself (the convention at the top of
 * opening-balances-schema.ts). The migration runner wraps `up` in a transaction.
 *
 * An opening CUSTOMER balance is a document in its own right: `amount_paise` (Y) is what the
 * customer owes at `as_at`, and `income_paise` (X, 0 <= X <= Y) is how much of it is income that
 * was earned before the books began (S5-2). X = 0 - the default - means the sale predates the
 * books and collecting it is a pure balance-sheet movement. The posted journal entry is the single
 * source of truth for the ledger; these rows are the sub-ledger the cash view and the open-items
 * query read. A supplier balance is money OWED, and paying it is never an expense or income, so it
 * carries no income figure.
 *
 * Receipts and settlements live in their own tables on purpose: `payments.payment_account` is still
 * CHECK IN ('CASH'), so BANK is unusable through it. credit_note_refunds dodges the same limit the
 * same way. Corrections are by reversal (`reversed_at`), never by edit or delete.
 */
export function applyOpeningSubLedgerSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS opening_customer_balances (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        customer_id TEXT NOT NULL REFERENCES customers(id),
        as_at TEXT NOT NULL,
        amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
        income_paise INTEGER NOT NULL DEFAULT 0 CHECK(income_paise >= 0 AND income_paise <= amount_paise),
        income_account TEXT REFERENCES chart_accounts(code),
        journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
        reversed_at TEXT,
        created_at TEXT NOT NULL,
        CHECK((income_paise = 0 AND income_account IS NULL) OR (income_paise > 0 AND income_account IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_opening_customer_balances_business ON opening_customer_balances(business_id);
      CREATE INDEX IF NOT EXISTS idx_opening_customer_balances_customer ON opening_customer_balances(customer_id);
      CREATE INDEX IF NOT EXISTS idx_opening_customer_balances_income_account ON opening_customer_balances(income_account);
      CREATE INDEX IF NOT EXISTS idx_opening_customer_balances_entry ON opening_customer_balances(journal_entry_id);
      -- Backstop for the repository's "one live opening balance per customer per business" rule.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_opening_customer_balances_one_live
        ON opening_customer_balances(business_id, customer_id) WHERE reversed_at IS NULL;

      CREATE TABLE IF NOT EXISTS opening_supplier_balances (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        as_at TEXT NOT NULL,
        amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
        journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
        reversed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_opening_supplier_balances_business ON opening_supplier_balances(business_id);
      CREATE INDEX IF NOT EXISTS idx_opening_supplier_balances_supplier ON opening_supplier_balances(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_opening_supplier_balances_entry ON opening_supplier_balances(journal_entry_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_opening_supplier_balances_one_live
        ON opening_supplier_balances(business_id, supplier_id) WHERE reversed_at IS NULL;

      CREATE TABLE IF NOT EXISTS opening_balance_receipts (
        id TEXT PRIMARY KEY,
        opening_customer_balance_id TEXT NOT NULL REFERENCES opening_customer_balances(id),
        amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
        received_on TEXT NOT NULL,
        payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'BANK')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_opening_balance_receipts_balance ON opening_balance_receipts(opening_customer_balance_id);

      CREATE TABLE IF NOT EXISTS opening_balance_settlements (
        id TEXT PRIMARY KEY,
        opening_supplier_balance_id TEXT NOT NULL REFERENCES opening_supplier_balances(id),
        amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
        paid_on TEXT NOT NULL,
        payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'BANK')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_opening_balance_settlements_balance ON opening_balance_settlements(opening_supplier_balance_id);
    `);
  })();
}
