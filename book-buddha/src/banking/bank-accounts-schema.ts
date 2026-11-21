import type Database from "better-sqlite3";

/**
 * v25 (R12a) - the DETAILS of a bank account. The account itself is an ordinary `chart_accounts`
 * row (role BANK, company-owned); this table only adds what a chart row cannot say: which kind of
 * bank account it is, where, the optional sanctioned limit of an overdraft / cash credit, and
 * whether it counts toward the cash-management view.
 *
 * ADDITIVE ONLY and IDEMPOTENT (CREATE TABLE IF NOT EXISTS). NOT registered here; `migrations.ts`
 * owns version numbers. A full account number is NEVER stored: only its last four digits.
 */
export const BANK_ACCOUNT_KINDS = ["CURRENT", "SAVINGS", "OVERDRAFT", "CASH_CREDIT"] as const;
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number];

export function applyBankAccountsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      account_code TEXT PRIMARY KEY REFERENCES chart_accounts(code),
      company_id TEXT NOT NULL REFERENCES companies(id),
      kind TEXT NOT NULL CHECK(kind IN (${BANK_ACCOUNT_KINDS.map((k) => `'${k}'`).join(", ")})),
      bank_name TEXT,
      branch TEXT,
      account_number_last4 TEXT CHECK(account_number_last4 IS NULL OR (length(account_number_last4) = 4 AND account_number_last4 NOT GLOB '*[^0-9]*')),
      ifsc TEXT CHECK(ifsc IS NULL OR (length(ifsc) = 11 AND substr(ifsc, 5, 1) = '0')),
      part_of_cash_management INTEGER NOT NULL DEFAULT 1 CHECK(part_of_cash_management IN (0, 1)),
      sanctioned_limit_paise INTEGER CHECK(sanctioned_limit_paise IS NULL OR sanctioned_limit_paise > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON bank_accounts(company_id);
  `);
}
