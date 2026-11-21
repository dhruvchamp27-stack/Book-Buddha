import type Database from "better-sqlite3";
import { RepositoryValidationError } from "./errors.js";
import { assertMoneyAccount } from "../banking/money-accounts.js";

/**
 * v24 - every money movement can go through ANY cash or bank account, and carry a payment mode and
 * a reference (R12b; spec §9.1; Dhruv S15).
 *
 * THE TRAP THIS MIGRATION AVOIDS. On invoices, purchase bills and expenses the old `payment_account`
 * column does NOT say which cash/bank account money moved through. It says whether the document was
 * PAID AT ONCE ('CASH') or is owed ('RECEIVABLES' / 'PAYABLES'), and `deriveCashView` reads
 * `payment_account = 'CASH'` as "paid at once". That column KEEPS its CHECK and its meaning. The
 * account the money actually went through is a NEW column, `money_account`, so a document paid into
 * a bank is still `payment_account = 'CASH'` (paid at once) with `money_account = 'HDFC'`.
 *
 * ADDITIVE ONLY (no table rebuild, so no trigger replay - the v11 rule). Three columns on nine tables:
 *   money_account     TEXT NOT NULL DEFAULT 'CASH'   which cash/bank account (any CASH- or BANK-role code)
 *   payment_mode      TEXT NULL                      how it moved (a payment_modes code); NULL on old rows
 *   payment_reference TEXT NULL                      UTR / cheque number, later matched against a statement
 *
 * BACKFILL. Nothing moves in the books. Where the old `payment_account` already named the money
 * account (the four refund / opening tables, CHECK IN ('CASH', 'BANK')) it is copied; everywhere
 * else the money went through CASH, which is the column default.
 *
 * TRIGGERS. SQLite cannot add a CHECK to an existing column, and a rebuild is off the table, so a
 * BEFORE INSERT and a BEFORE UPDATE trigger on every table refuse a money_account that is not a
 * CASH- or BANK-role chart account, and a payment_mode that is not in payment_modes. The
 * repository checks the same things first (company, active) with a friendly message; the trigger is
 * the last line of defence for any other writer.
 *
 * Idempotent: columns are added only when absent, the backfill runs only when the column was just
 * added, triggers are CREATE IF NOT EXISTS. NOT registered here; `migrations.ts` owns version numbers.
 */
export const MONEY_ACCOUNT_TABLES = [
  "payments",
  "supplier_payments",
  "invoices",
  "purchase_bills",
  "expenses",
  "credit_note_refunds",
  "supplier_refunds",
  "opening_balance_receipts",
  "opening_balance_settlements",
] as const;

/** Tables whose old payment_account (CHECK IN ('CASH', 'BANK')) already named the money account. */
const PAYMENT_ACCOUNT_NAMES_MONEY_ACCOUNT: ReadonlySet<string> = new Set([
  "credit_note_refunds",
  "supplier_refunds",
  "opening_balance_receipts",
  "opening_balance_settlements",
]);

export function applyMoneyAccountSchema(db: Database.Database): void {
  const columnsOf = (table: string): Set<string> =>
    new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));

  for (const table of MONEY_ACCOUNT_TABLES) {
    const columns = columnsOf(table);
    const addedMoneyAccount = !columns.has("money_account");
    if (addedMoneyAccount) db.exec(`ALTER TABLE ${table} ADD COLUMN money_account TEXT NOT NULL DEFAULT 'CASH'`);
    if (!columns.has("payment_mode")) db.exec(`ALTER TABLE ${table} ADD COLUMN payment_mode TEXT`);
    if (!columns.has("payment_reference")) db.exec(`ALTER TABLE ${table} ADD COLUMN payment_reference TEXT`);
    if (addedMoneyAccount && PAYMENT_ACCOUNT_NAMES_MONEY_ACCOUNT.has(table)) {
      db.exec(`UPDATE ${table} SET money_account = payment_account`);
    }

    const checks = `
      SELECT RAISE(ABORT, 'money_account must be a cash or bank account')
       WHERE NOT EXISTS (SELECT 1 FROM chart_accounts WHERE code = NEW.money_account AND role IN ('CASH', 'BANK'));
      SELECT RAISE(ABORT, 'payment_mode is not a known payment mode')
       WHERE NEW.payment_mode IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_modes WHERE code = NEW.payment_mode);`;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${table}_money_account_insert BEFORE INSERT ON ${table}
      BEGIN ${checks} END;
      CREATE TRIGGER IF NOT EXISTS trg_${table}_money_account_update BEFORE UPDATE OF money_account, payment_mode ON ${table}
      BEGIN ${checks} END;
    `);
  }
}

// ---------------------------------------------------------------------------------------------
// Shared by the repository: one place decides what a valid money account / mode / reference is.
// ---------------------------------------------------------------------------------------------

/** What a caller may say about WHERE and HOW money moved. All optional; the default is CASH. */
export interface MoneyFieldsInput {
  readonly moneyAccount?: string | undefined;
  /** null (a read-back of an old row) counts as "none". */
  readonly paymentMode?: string | null | undefined;
  readonly paymentReference?: string | null | undefined;
}

/** What is stored and read back. */
export interface MoneyFields {
  readonly moneyAccount: string;
  readonly paymentMode: string | null;
  readonly paymentReference: string | null;
}

export const DEFAULT_MONEY_ACCOUNT = "CASH";
const MAX_REFERENCE_LENGTH = 100;

/**
 * Validates the three fields for a NEW posting of a company and returns what to store.
 *
 * - `moneyAccount` defaults to CASH and must be an ACTIVE CASH/BANK-role account visible to the
 *   company (assertMoneyAccount).
 * - `legacyAccount` is the old CASH|BANK `paymentAccount` of the refund and opening methods. Given
 *   alone it IS the money account; given with a `moneyAccount` that disagrees, it is an error.
 * - `paymentMode`, when given, must exist, be active, and be a system mode or the company's own.
 * - `paymentReference` is trimmed; empty means none.
 */
export function resolveMoneyFields(
  db: Database.Database,
  companyId: string,
  input: MoneyFieldsInput,
  legacyAccount?: string,
): MoneyFields {
  let account = input.moneyAccount;
  if (legacyAccount !== undefined) {
    if (account !== undefined && account !== legacyAccount) {
      throw new RepositoryValidationError(
        `paymentAccount (${legacyAccount}) and moneyAccount (${account}) disagree. Send one of them, or make them the same.`,
      );
    }
    account = legacyAccount;
  }
  const moneyAccount = account ?? DEFAULT_MONEY_ACCOUNT;
  assertMoneyAccount(db, moneyAccount, companyId);

  let paymentMode: string | null = null;
  if (input.paymentMode !== undefined && input.paymentMode !== null) {
    const code = input.paymentMode.trim();
    const row = db
      .prepare("SELECT code, label, active FROM payment_modes WHERE code = ? AND (company_id IS NULL OR company_id = ?)")
      .get(code, companyId) as { code: string; label: string; active: number } | undefined;
    if (row === undefined) throw new RepositoryValidationError(`"${code}" is not a payment mode of this company.`);
    if (row.active === 0) throw new RepositoryValidationError(`The payment mode ${row.label} (${row.code}) is no longer active. Pick another.`);
    paymentMode = row.code;
  }

  let paymentReference: string | null = null;
  if (input.paymentReference !== undefined && input.paymentReference !== null) {
    const reference = input.paymentReference.trim();
    if (reference.length > MAX_REFERENCE_LENGTH) {
      throw new RepositoryValidationError(`A payment reference can be at most ${MAX_REFERENCE_LENGTH} characters.`);
    }
    paymentReference = reference === "" ? null : reference;
  }
  return { moneyAccount, paymentMode, paymentReference };
}

/** The old `payment_account` value (CHECK IN ('CASH', 'BANK')) that goes with a money account's role. */
export function legacyAccountFor(db: Database.Database, moneyAccount: string): "CASH" | "BANK" {
  const row = db.prepare("SELECT role FROM chart_accounts WHERE code = ?").get(moneyAccount) as { role: string } | undefined;
  return row?.role === "CASH" ? "CASH" : "BANK";
}
