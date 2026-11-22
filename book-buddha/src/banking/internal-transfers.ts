import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { JournalEntry, JournalSourceType } from "../accounting/types.js";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";
import { istDateOf } from "../database/ist-date.js";
import { assertPeriodOpen, postJournalEntry } from "../database/ledger.js";
import { assertMoneyAccount, companyOfBusiness } from "./money-accounts.js";
import { assertNotOnBankLine } from "./statement-lines.js";

/**
 * R12c - Internal Transfers: money moved between two of the company's OWN cash/bank accounts
 * (cash banked, bank to bank, cash withdrawn, paying down an overdraft / cash credit).
 *
 * Dr the receiving account / Cr the paying account. Both sides are money accounts, which the P&L
 * and the cash view treat as settlement, so a transfer changes no profit figure on either basis.
 * Cancelling posts a reversing entry; nothing is edited or deleted.
 */
export interface InternalTransfer {
  readonly id: string;
  readonly companyId: string;
  readonly businessId: string;
  readonly fairId: string | null;
  readonly number: string;
  readonly transferDate: string;
  readonly fromAccount: string;
  readonly toAccount: string;
  readonly amountPaise: number;
  readonly paymentMode: string | null;
  readonly paymentReference: string | null;
  readonly memo: string | null;
  readonly status: "POSTED" | "CANCELLED";
  readonly journalEntryId: string;
  readonly reversalEntryId: string | null;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
}

export interface CreateInternalTransferInput {
  readonly businessId: string;
  readonly date: string;
  readonly fromAccount: string;
  readonly toAccount: string;
  readonly amountPaise: number;
  readonly paymentMode?: string | undefined;
  readonly paymentReference?: string | undefined;
  readonly memo?: string | undefined;
  readonly fairId?: string | undefined;
}

export interface ListMovementsFilter {
  readonly fromDate?: string | undefined;
  readonly toDate?: string | undefined;
  readonly businessId?: string | undefined;
}

interface Row {
  id: string; company_id: string; business_id: string; fair_id: string | null; number: string;
  transfer_date: string; from_account: string; to_account: string; amount_paise: number;
  payment_mode: string | null; payment_reference: string | null; memo: string | null;
  status: "POSTED" | "CANCELLED"; journal_entry_id: string; reversal_entry_id: string | null;
  created_at: string; cancelled_at: string | null; cancellation_reason: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- Helpers shared with vouchers.ts -------------------------------------------------------

/** "25-26" for any date from 1 Apr 2025 to 31 Mar 2026. */
export function financialYearLabel(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  const two = (n: number): string => String(n % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}

export function assertRealDate(date: unknown, what: string): asserts date is string {
  if (typeof date !== "string" || !ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new RepositoryValidationError(`${what} must be a real date written as YYYY-MM-DD.`);
  }
}

/** A positive whole number of paise (never a float). */
export function assertPositivePaise(amount: unknown, what: string): asserts amount is number {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    throw new RepositoryValidationError(`${what} must be a whole number of paise above zero.`);
  }
}

/** The payment mode, when given, must exist, be active, and be a system mode or the company's own. */
export function assertPaymentMode(db: Database.Database, mode: string | undefined, companyId: string): void {
  if (mode === undefined) return;
  const row = db
    .prepare("SELECT active FROM payment_modes WHERE code = ? AND (company_id IS NULL OR company_id = ?)")
    .get(mode, companyId) as { active: number } | undefined;
  if (row === undefined) throw new RepositoryValidationError(`Payment mode ${mode} is not known to this company.`);
  if (row.active === 0) throw new RepositoryValidationError(`Payment mode ${mode} is no longer active.`);
}

/**
 * Next number for a company, one sequence per prefix and financial year: `TRF-001/25-26`.
 * Cancelled documents keep their number, so the highest number ever issued is read, not a count.
 */
export function nextDocumentNumber(
  db: Database.Database, table: "internal_transfers" | "vouchers", companyId: string, prefix: string, date: string,
): string {
  const label = financialYearLabel(date);
  const rows = db
    .prepare(`SELECT number FROM ${table} WHERE company_id = ? AND number LIKE ?`)
    .all(companyId, `${prefix}-%/${label}`) as Array<{ number: string }>;
  return nextNumberAfter(rows.map((r) => r.number), prefix, label);
}

/**
 * The pure half of the numbering: given every number already issued in one series, the next one,
 * `PREFIX-001/25-26`. The highest ever issued plus one (a count would reuse a cancelled number).
 * Shared with the per-business series in repository.ts (INV, QUO, CN, PR).
 */
export function nextNumberAfter(existing: readonly string[], prefix: string, label: string): string {
  let highest = 0;
  for (const number of existing) {
    if (!number.startsWith(`${prefix}-`) || !number.endsWith(`/${label}`)) continue;
    const n = Number(number.slice(prefix.length + 1, number.indexOf("/")));
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  return `${prefix}-${String(highest + 1).padStart(3, "0")}/${label}`;
}

/**
 * The exact mirror of an entry already on the ledger: every line's debit and credit swapped. Read
 * from the ledger rather than rebuilt from the document, the same way
 * AccountingRepository.reversalOfPostedEntry (repository.ts:2866) does it, so a reversal can never
 * drift from what was posted.
 */
export function reversalOf(
  db: Database.Database, postedEntryId: string, reversalId: string, sourceId: string,
  sourceType: JournalSourceType, description: string,
): JournalEntry {
  const lines = db
    .prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
    .all(postedEntryId) as Array<{ account: string; debit_paise: number; credit_paise: number }>;
  if (lines.length === 0) {
    throw new RepositoryValidationError(`Journal entry ${postedEntryId} has no lines to reverse.`);
  }
  return {
    id: reversalId,
    sourceId,
    sourceType,
    description,
    isReversal: true,
    lines: lines.map((l) => ({ account: l.account, debitPaise: l.credit_paise, creditPaise: l.debit_paise })),
  };
}

/**
 * The date a cancellation is posted. Copied from AccountingRepository.cancelPayment
 * (repository.ts:2913): every cancellation in this codebase is dated TODAY in IST (istDateOf), never
 * the original document's date, so a settled period is never rewritten. TODAY's period is therefore
 * the one that has to be open (assertPeriodOpen, repository.ts:2914).
 */
export function cancellationDate(db: Database.Database, businessId: string): string {
  const cancelledOn = istDateOf();
  assertPeriodOpen(db, businessId, cancelledOn);
  return cancelledOn;
}

export function requireReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new RepositoryValidationError("A reason is required to cancel.");
  }
  return reason.trim();
}

function optionalText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
export { optionalText };

// ---- Internal transfers --------------------------------------------------------------------

function toTransfer(r: Row): InternalTransfer {
  return {
    id: r.id, companyId: r.company_id, businessId: r.business_id, fairId: r.fair_id, number: r.number,
    transferDate: r.transfer_date, fromAccount: r.from_account, toAccount: r.to_account,
    amountPaise: r.amount_paise, paymentMode: r.payment_mode, paymentReference: r.payment_reference,
    memo: r.memo, status: r.status, journalEntryId: r.journal_entry_id, reversalEntryId: r.reversal_entry_id,
    createdAt: r.created_at, cancelledAt: r.cancelled_at, cancellationReason: r.cancellation_reason,
  };
}

export function createInternalTransfer(db: Database.Database, input: CreateInternalTransferInput): InternalTransfer {
  return db.transaction(() => {
    const companyId = companyOfBusiness(db, input.businessId);
    assertRealDate(input.date, "The transfer date");
    assertPositivePaise(input.amountPaise, "The amount");
    if (input.fromAccount === input.toAccount) {
      throw new RepositoryValidationError("A transfer needs two different accounts: money cannot move from an account to itself.");
    }
    assertMoneyAccount(db, input.fromAccount, companyId);
    assertMoneyAccount(db, input.toAccount, companyId);
    assertPaymentMode(db, input.paymentMode, companyId);

    const id = randomUUID();
    const number = nextDocumentNumber(db, "internal_transfers", companyId, "TRF", input.date);
    const journalEntryId = `je-trf-${id}`;
    const now = new Date().toISOString();
    // The posting door checks the financial-year lock and the balance; if it throws, the whole
    // transaction (including the document row and the number) is rolled back.
    postJournalEntry(
      db,
      {
        id: journalEntryId,
        sourceId: id,
        sourceType: "INTERNAL_TRANSFER",
        description: `Internal transfer ${number}: ${input.fromAccount} to ${input.toAccount}`,
        isReversal: false,
        lines: [
          { account: input.toAccount, debitPaise: input.amountPaise, creditPaise: 0 },
          { account: input.fromAccount, debitPaise: 0, creditPaise: input.amountPaise },
        ],
      },
      { businessId: input.businessId, entryDate: input.date, ...(input.fairId === undefined ? {} : { fairId: input.fairId }) },
    );
    db.prepare(
      `INSERT INTO internal_transfers
         (id, company_id, business_id, fair_id, number, transfer_date, from_account, to_account, amount_paise,
          payment_mode, payment_reference, memo, status, journal_entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
    ).run(
      id, companyId, input.businessId, input.fairId ?? null, number, input.date, input.fromAccount, input.toAccount,
      input.amountPaise, input.paymentMode ?? null, optionalText(input.paymentReference), optionalText(input.memo),
      journalEntryId, now,
    );
    const created = getInternalTransfer(db, id);
    appendAuditEvent(db, {
      action: "INTERNAL_TRANSFER_POSTED",
      entityId: id,
      entityType: "internal_transfer",
      companyId,
      occurredAt: now,
      afterValues: created,
    });
    return created;
  })();
}

export function getInternalTransfer(db: Database.Database, id: string): InternalTransfer {
  const row = db.prepare("SELECT * FROM internal_transfers WHERE id = ?").get(id) as Row | undefined;
  if (row === undefined) throw new RepositoryValidationError(`Internal transfer ${id} was not found.`);
  return toTransfer(row);
}

export function listInternalTransfers(
  db: Database.Database, companyId: string, filter: ListMovementsFilter = {},
): InternalTransfer[] {
  const where = ["company_id = ?"];
  const params: string[] = [companyId];
  if (filter.fromDate !== undefined) { where.push("transfer_date >= ?"); params.push(filter.fromDate); }
  if (filter.toDate !== undefined) { where.push("transfer_date <= ?"); params.push(filter.toDate); }
  if (filter.businessId !== undefined) { where.push("business_id = ?"); params.push(filter.businessId); }
  const rows = db
    .prepare(`SELECT * FROM internal_transfers WHERE ${where.join(" AND ")} ORDER BY transfer_date, rowid`)
    .all(...params) as Row[];
  return rows.map(toTransfer);
}

export function cancelInternalTransfer(db: Database.Database, id: string, reason: string): InternalTransfer {
  return db.transaction(() => {
    const why = requireReason(reason);
    const before = getInternalTransfer(db, id);
    if (before.status === "CANCELLED") {
      throw new RepositoryValidationError(`Internal transfer ${before.number} has already been cancelled.`);
    }
    assertNotOnBankLine(db, before.journalEntryId, `Internal transfer ${before.number}`);
    const cancelledOn = cancellationDate(db, before.businessId);
    const reversalId = `${before.journalEntryId}-reversal`;
    postJournalEntry(
      db,
      reversalOf(db, before.journalEntryId, reversalId, before.id, "INTERNAL_TRANSFER", `Cancelled internal transfer ${before.number}`),
      { businessId: before.businessId, entryDate: cancelledOn, ...(before.fairId === null ? {} : { fairId: before.fairId }) },
    );
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE internal_transfers SET status = 'CANCELLED', reversal_entry_id = ?, cancelled_at = ?, cancellation_reason = ? WHERE id = ?",
    ).run(reversalId, now, why, id);
    const after = getInternalTransfer(db, id);
    appendAuditEvent(db, {
      action: "INTERNAL_TRANSFER_CANCELLED",
      entityId: id,
      entityType: "internal_transfer",
      companyId: before.companyId,
      occurredAt: now,
      reason: why,
      beforeValues: { status: before.status },
      afterValues: { status: after.status, reversalEntryId: reversalId, reversalDate: cancelledOn },
    });
    return after;
  })();
}
