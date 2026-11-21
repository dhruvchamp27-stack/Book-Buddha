import type Database from "better-sqlite3";

/**
 * R12 set two shared contract (orchestrator, before the 12e–12g builders start; builders do not
 * edit this file). Migration v28.
 *
 * A bank STATEMENT LINE is held here, OUTSIDE the books (FD §D2, QBO "For review"): nothing in
 * these tables is a journal entry. A line reaches the books only when 12f posts it through an
 * existing door (createVoucher, recordPayment, recordSupplierPayment, createInternalTransfer) or
 * links it to a journal line already posted.
 *
 * SIGN: `amount_paise` is from the BANK ACCOUNT's point of view in the books: positive = money IN
 * (a deposit; the statement's "Credit" column), negative = money OUT (a withdrawal; the
 * statement's "Debit" column). Never zero. Same convention as the register (debit − credit).
 *
 * Keyed on company + account: the seeded `BANK` (company_id NULL) is shared by every company.
 *
 * IDEMPOTENT: CREATE ... IF NOT EXISTS only.
 */
export function applyStatementLinesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_statement_imports (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      account_code TEXT NOT NULL REFERENCES chart_accounts(code),
      file_name TEXT NOT NULL,
      default_business_id TEXT REFERENCES businesses(id),
      rows_in_file INTEGER NOT NULL,
      lines_added INTEGER NOT NULL,
      lines_skipped INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bank_statement_lines (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      account_code TEXT NOT NULL REFERENCES chart_accounts(code),
      import_id TEXT REFERENCES bank_statement_imports(id),
      row_number INTEGER,
      txn_date TEXT NOT NULL,
      description TEXT NOT NULL,
      reference TEXT,
      amount_paise INTEGER NOT NULL CHECK(amount_paise <> 0),
      balance_paise INTEGER,
      fingerprint TEXT NOT NULL,
      business_id TEXT REFERENCES businesses(id),
      fair_id TEXT,
      status TEXT NOT NULL DEFAULT 'FOR_REVIEW'
        CHECK(status IN ('FOR_REVIEW', 'ADDED', 'MATCHED', 'TRANSFERRED', 'EXCLUDED')),
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_queue
      ON bank_statement_lines(company_id, account_code, status, txn_date);
    CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_fingerprint
      ON bank_statement_lines(company_id, account_code, fingerprint);
    CREATE TABLE IF NOT EXISTS bank_statement_line_links (
      line_id TEXT NOT NULL REFERENCES bank_statement_lines(id),
      journal_line_id INTEGER NOT NULL REFERENCES journal_lines(id),
      journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
      link_kind TEXT NOT NULL
        CHECK(link_kind IN ('VOUCHER', 'PAYMENT', 'SUPPLIER_PAYMENT', 'INTERNAL_TRANSFER', 'EXISTING')),
      document_id TEXT,
      posted_by_feed INTEGER NOT NULL CHECK(posted_by_feed IN (0, 1)),
      created_at TEXT NOT NULL,
      PRIMARY KEY (line_id, journal_line_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_statement_line_links_journal_line
      ON bank_statement_line_links(journal_line_id);
  `);
}
