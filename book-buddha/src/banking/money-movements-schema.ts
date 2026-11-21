import type Database from "better-sqlite3";

/**
 * v26 (R12c) - Internal Transfers and Receipt / Payment Vouchers.
 *
 * ADDITIVE ONLY: four new tables, no existing table is altered. IDEMPOTENT (CREATE ... IF NOT
 * EXISTS), so a test can call it right after `new AccountingRepository()` and the migration can
 * call it again safely. NOT registered here; `migrations.ts` owns version numbers.
 *
 * A document is never edited or deleted: cancelling sets `status = 'CANCELLED'` and links the
 * reversing journal entry in `reversal_entry_id`. The journal entries themselves are written only
 * through postJournalEntry (ledger.ts).
 */
export function applyMoneyMovementsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS internal_transfers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      business_id TEXT NOT NULL REFERENCES businesses(id),
      fair_id TEXT REFERENCES fairs(id),
      number TEXT NOT NULL,
      transfer_date TEXT NOT NULL,
      from_account TEXT NOT NULL REFERENCES chart_accounts(code),
      to_account TEXT NOT NULL REFERENCES chart_accounts(code),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      payment_mode TEXT,
      payment_reference TEXT,
      memo TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED', 'CANCELLED')),
      journal_entry_id TEXT NOT NULL,
      reversal_entry_id TEXT,
      created_at TEXT NOT NULL,
      cancelled_at TEXT,
      cancellation_reason TEXT,
      CHECK(from_account <> to_account),
      UNIQUE(company_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_internal_transfers_company_date ON internal_transfers(company_id, transfer_date);

    CREATE TABLE IF NOT EXISTS vouchers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      business_id TEXT NOT NULL REFERENCES businesses(id),
      fair_id TEXT REFERENCES fairs(id),
      kind TEXT NOT NULL CHECK(kind IN ('RECEIPT', 'PAYMENT')),
      number TEXT NOT NULL,
      voucher_date TEXT NOT NULL,
      money_account TEXT NOT NULL REFERENCES chart_accounts(code),
      payment_mode TEXT,
      payment_reference TEXT,
      party_name TEXT,
      narration TEXT,
      total_paise INTEGER NOT NULL CHECK(total_paise > 0),
      status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED', 'CANCELLED')),
      journal_entry_id TEXT NOT NULL,
      reversal_entry_id TEXT,
      created_at TEXT NOT NULL,
      cancelled_at TEXT,
      cancellation_reason TEXT,
      UNIQUE(company_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_vouchers_company_date ON vouchers(company_id, voucher_date);

    CREATE TABLE IF NOT EXISTS voucher_lines (
      voucher_id TEXT NOT NULL REFERENCES vouchers(id),
      line_no INTEGER NOT NULL,
      account TEXT NOT NULL REFERENCES chart_accounts(code),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      description TEXT,
      PRIMARY KEY (voucher_id, line_no)
    );
  `);
}
