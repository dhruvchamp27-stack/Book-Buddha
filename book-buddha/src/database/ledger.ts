import type Database from "better-sqlite3";
import type { JournalEntry } from "../accounting/types.js";
import { isValidIsoDate } from "../accounting/recurrence.js";
import { AccountingError } from "../accounting/engine.js";
import { RepositoryValidationError } from "./errors.js";

/**
 * What the door knows about an account, read from chart_accounts (decision S2-1). The door no
 * longer consults the static ACCOUNT_CODES set: accounts are created at RUNTIME, so a static
 * list would reject exactly the accounts the user just made. ACCOUNT_CODES remains the typed
 * union of the codes the POSTING ENGINE emits itself, which is a different and smaller thing.
 */
type AccountRow = { code: string; active: number; company_id: string | null };

/**
 * The ONLY door through which journal entries are written (enforced by single-writer.test.ts).
 * Asserts, before any write, that the entry balances and every line is well-formed, so no
 * caller can persist an unbalanced journal. The columns are nullable in SQLite (migration v5),
 * so the non-null guarantee for every NEW entry lives here: businessId and entryDate are required.
 */
export function postJournalEntry(
  db: Database.Database,
  entry: JournalEntry,
  dims: { businessId: string; entryDate: string; fairId?: string },
): void {
  if (typeof dims.businessId !== "string" || dims.businessId.trim() === "") {
    throw new RepositoryValidationError("A journal entry needs a business.");
  }
  // The project is OPTIONAL (nullable column): absent means NULL. When given it must be real.
  if (dims.fairId !== undefined) {
    if (typeof dims.fairId !== "string" || dims.fairId.trim() === "") {
      throw new RepositoryValidationError("A project (fair) id cannot be empty.");
    }
    if (db.prepare("SELECT 1 FROM fairs WHERE id = ?").get(dims.fairId) === undefined) {
      throw new RepositoryValidationError(`Fair ${dims.fairId} was not found.`);
    }
  }
  if (!isValidIsoDate(dims.entryDate)) {
    throw new RepositoryValidationError("Journal entry date must be a real date written as YYYY-MM-DD.");
  }

  // The company this entry belongs to, for scoping accounts that belong to one company.
  const company = db
    .prepare("SELECT company_id FROM businesses WHERE id = ?")
    .get(dims.businessId) as { company_id: string } | undefined;
  const lookupAccount = db.prepare("SELECT code, active, company_id FROM chart_accounts WHERE code = ?");

  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of entry.lines) {
    const account = lookupAccount.get(line.account) as AccountRow | undefined;
    if (account === undefined) {
      throw new AccountingError(`Journal entry ${entry.id} uses unknown account "${line.account}".`);
    }
    // A company-owned account can only be posted to by that company; system accounts
    // (company_id NULL) are shared by all of them.
    if (account.company_id !== null && company !== undefined && account.company_id !== company.company_id) {
      throw new AccountingError(
        `Journal entry ${entry.id} uses account "${line.account}", which belongs to another company.`,
      );
    }
    // A deactivated account takes no NEW postings. A reversal is exempt: cancelling an old
    // document must always be possible, even after its account was retired — which is also why
    // the database trigger checks existence only and leaves this rule to the door.
    if (account.active === 0 && !entry.isReversal) {
      throw new AccountingError(
        `Journal entry ${entry.id} uses account "${line.account}", which is no longer active. Reactivate it, or pick another account.`,
      );
    }
    const validAmounts = Number.isInteger(line.debitPaise) && Number.isInteger(line.creditPaise)
      && line.debitPaise >= 0 && line.creditPaise >= 0
      && (line.debitPaise > 0) !== (line.creditPaise > 0);
    if (!validAmounts) {
      throw new AccountingError(
        `Journal entry ${entry.id}: each line must have exactly one of debit or credit above zero, in whole paise (got debit ${line.debitPaise}, credit ${line.creditPaise} on ${line.account}).`,
      );
    }
    debitTotal += line.debitPaise;
    creditTotal += line.creditPaise;
  }
  if (debitTotal !== creditTotal) {
    throw new AccountingError(
      `Journal entry ${entry.id} does not balance: debits ${debitTotal} paise, credits ${creditTotal} paise.`,
    );
  }

  // EXTENSION POINT (financial-year lock): a later slice rejects the post here when
  // dims.entryDate falls inside a locked financial year. Not implemented yet.

  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date, fair_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(entry.id, entry.sourceId, entry.description, entry.isReversal ? 1 : 0, now, entry.sourceType ?? "INVOICE", dims.businessId, dims.entryDate, dims.fairId ?? null);
  const statement = db.prepare(
    "INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES (?, ?, ?, ?)",
  );
  for (const line of entry.lines) {
    statement.run(entry.id, line.account, line.debitPaise, line.creditPaise);
  }
}
