import type Database from "better-sqlite3";
import { ACCOUNT_CODES } from "../accounting/types.js";
import type { JournalEntry } from "../accounting/types.js";
import { isValidIsoDate } from "../accounting/recurrence.js";
import { AccountingError } from "../accounting/engine.js";
import { RepositoryValidationError } from "./errors.js";

const KNOWN_ACCOUNTS: ReadonlySet<string> = new Set(ACCOUNT_CODES);

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

  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of entry.lines) {
    if (!KNOWN_ACCOUNTS.has(line.account)) {
      throw new AccountingError(`Journal entry ${entry.id} uses unknown account "${line.account}".`);
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
