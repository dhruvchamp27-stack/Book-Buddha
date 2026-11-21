/**
 * R12d - QBO-style bank reconciliation.
 *
 * SIGN CONVENTION (also stated in the API errors): every balance is debit - credit, the
 * "money held" view. Money IN = a debit to the bank account, money OUT = a credit. An overdraft or
 * cash credit in use is therefore NEGATIVE: a statement that shows Rs 1,50,000 OWED must be entered
 * as -15000000 paise.
 *
 * Rules (the plan's rulings): one IN_PROGRESS per company + account; finish only at difference 0
 * (no automatic plug); undo the LATEST finished one only, with a reason; history is kept (UNDONE);
 * posted journal lines are never touched; start / finish / undo / discard / edit are audited.
 */
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { isValidIsoDate } from "../accounting/recurrence.js";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";
import { assertMoneyAccount } from "./money-accounts.js";

export type ReconciliationStatus = "IN_PROGRESS" | "FINISHED" | "UNDONE";

export interface ReconciliationHeader {
  readonly id: string;
  readonly companyId: string;
  readonly accountCode: string;
  readonly statementEndDate: string;
  readonly statementEndingBalancePaise: number;
  readonly beginningBalancePaise: number;
  readonly status: ReconciliationStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly undoneAt: string | null;
  readonly undoReason: string | null;
}

export interface ReconciliationLine {
  readonly journalLineId: number;
  readonly journalEntryId: string;
  readonly entryDate: string;
  readonly description: string;
  readonly businessId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly isReversal: boolean;
  readonly inPaise: number;
  readonly outPaise: number;
  readonly ticked: boolean;
}

export interface ReconciliationDetail {
  readonly header: ReconciliationHeader;
  /** IN_PROGRESS: every line on offer. FINISHED / UNDONE: the lines that were cleared. */
  readonly candidates: readonly ReconciliationLine[];
  readonly clearedInPaise: number;
  readonly clearedOutPaise: number;
  readonly clearedBalancePaise: number;
  readonly differencePaise: number;
}

export interface ReconciliationReport {
  readonly header: ReconciliationHeader;
  readonly beginningBalancePaise: number;
  readonly clearedInPaise: number;
  readonly clearedOutPaise: number;
  readonly endingBalancePaise: number;
  readonly clearedLines: readonly ReconciliationLine[];
  /** Lines dated on or before the end date that were still uncleared when this one was finished. */
  readonly unclearedLines: readonly ReconciliationLine[];
  /**
   * Changes made AFTER finishing: ADDED = a line dated inside the period but posted later (back-dated);
   * CANCELLED = a reversal, however it is dated (cancels post today), of a document whose line was cleared here.
   */
  readonly changedAfterFinishing: readonly ChangedLine[];
}

export interface ChangedLine extends ReconciliationLine {
  readonly change: "ADDED" | "CANCELLED";
}

interface HeaderRow {
  id: string;
  company_id: string;
  account_code: string;
  statement_end_date: string;
  statement_ending_balance_paise: number;
  beginning_balance_paise: number;
  status: ReconciliationStatus;
  started_at: string;
  finished_at: string | null;
  undone_at: string | null;
  undo_reason: string | null;
  entries_high_water: number | null;
}

interface LineRow {
  id: number;
  journal_entry_id: string;
  entry_date: string;
  description: string;
  business_id: string;
  source_type: string;
  source_id: string;
  is_reversal: number;
  debit_paise: number;
  credit_paise: number;
  ticked: number;
}

const LINE_SELECT = `
  SELECT jl.id AS id, je.id AS journal_entry_id, je.entry_date AS entry_date, je.description AS description,
         je.business_id AS business_id, je.source_type AS source_type, je.source_id AS source_id,
         je.is_reversal AS is_reversal, jl.debit_paise AS debit_paise, jl.credit_paise AS credit_paise`;
const LINE_ORDER = "ORDER BY je.entry_date, je.rowid, jl.id";

/**
 * The journal-entry ids that would REVERSE an entry cleared in this reconciliation. The codebase uses
 * two naming conventions for a reversal: `<original id>-reversal` (invoices, bills, expenses,
 * payments, supplier payments, purchase returns, stock, internal transfers, vouchers) and, for the
 * opening sets, `je-opening-<kind>-<id>` -> `je-opening-<kind>-reversal-<id>`
 * (repository.ts reverseOpeningBalances / reverseOpeningCustomerBalance / ...SupplierBalance).
 */
function reversedEntryIds(db: Database.Database, reconciliationId: string): Set<string> {
  const cleared = db
    .prepare(
      `SELECT DISTINCT jl.journal_entry_id AS id FROM bank_reconciliation_lines t
         JOIN journal_lines jl ON jl.id = t.journal_line_id
        WHERE t.reconciliation_id = ?`,
    )
    .all(reconciliationId) as Array<{ id: string }>;
  const ids = new Set<string>();
  for (const { id } of cleared) {
    ids.add(`${id}-reversal`);
    const opening = /^je-opening-(balance|customer|supplier)-(.+)$/.exec(id);
    if (opening !== null) ids.add(`je-opening-${opening[1]}-reversal-${opening[2]}`);
  }
  return ids;
}

/** Rs with Indian grouping, paise only when non-zero: 35400 -> "Rs 354", -15000000 -> "-Rs 1,50,000". */
export function formatRupees(paise: number): string {
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const digits = String(whole);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest === "" ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  return `${paise < 0 ? "-" : ""}Rs ${grouped}${frac === 0 ? "" : `.${String(frac).padStart(2, "0")}`}`;
}

const toHeader = (r: HeaderRow): ReconciliationHeader => ({
  id: r.id,
  companyId: r.company_id,
  accountCode: r.account_code,
  statementEndDate: r.statement_end_date,
  statementEndingBalancePaise: r.statement_ending_balance_paise,
  beginningBalancePaise: r.beginning_balance_paise,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  undoneAt: r.undone_at,
  undoReason: r.undo_reason,
});

const toLine = (r: LineRow): ReconciliationLine => ({
  journalLineId: r.id,
  journalEntryId: r.journal_entry_id,
  entryDate: r.entry_date,
  description: r.description,
  businessId: r.business_id,
  sourceType: r.source_type,
  sourceId: r.source_id,
  isReversal: r.is_reversal === 1,
  inPaise: r.debit_paise,
  outPaise: r.credit_paise,
  ticked: r.ticked === 1,
});

function requireRow(db: Database.Database, id: string): HeaderRow {
  const row = db.prepare("SELECT * FROM bank_reconciliations WHERE id = ?").get(id) as HeaderRow | undefined;
  if (row === undefined) throw new RepositoryValidationError(`Reconciliation ${id} was not found.`);
  return row;
}

function requireInProgress(row: HeaderRow, what: string): void {
  if (row.status !== "IN_PROGRESS") {
    throw new RepositoryValidationError(`Only a reconciliation that is in progress can be ${what}; this one is ${row.status}.`);
  }
}

const SIGN_NOTE =
  "Balances are debit minus credit (money held): an overdraft or cash credit in use is negative, so a statement showing Rs 1,50,000 owed is entered as -Rs 1,50,000.";

function assertWholePaise(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RepositoryValidationError(`${label} must be a whole number of paise. ${SIGN_NOTE}`);
  }
}

function assertDate(value: string, label: string): void {
  if (typeof value !== "string" || !isValidIsoDate(value)) {
    throw new RepositoryValidationError(`${label} must be a real date written as YYYY-MM-DD.`);
  }
}

function lastFinished(db: Database.Database, companyId: string, accountCode: string): HeaderRow | undefined {
  return db
    .prepare(
      `SELECT * FROM bank_reconciliations
        WHERE company_id = ? AND account_code = ? AND status = 'FINISHED'
        ORDER BY statement_end_date DESC, finished_at DESC LIMIT 1`,
    )
    .get(companyId, accountCode) as HeaderRow | undefined;
}

function hasInProgress(db: Database.Database, companyId: string, accountCode: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM bank_reconciliations WHERE company_id = ? AND account_code = ? AND status = 'IN_PROGRESS'")
      .get(companyId, accountCode) !== undefined
  );
}

/** Starts a reconciliation. See the file header for the sign convention. */
export function startReconciliation(
  db: Database.Database,
  input: { companyId: string; accountCode: string; statementEndDate: string; statementEndingBalancePaise: number },
): ReconciliationHeader {
  const account = assertMoneyAccount(db, input.accountCode, input.companyId);
  if (account.role !== "BANK") {
    throw new RepositoryValidationError(`${account.name} (${account.code}) is not a bank account, so it cannot be reconciled.`);
  }
  assertDate(input.statementEndDate, "The statement end date");
  assertWholePaise(input.statementEndingBalancePaise, "The statement ending balance");
  const id = randomUUID();
  db.transaction(() => {
    if (hasInProgress(db, input.companyId, input.accountCode)) {
      throw new RepositoryValidationError(
        `${account.name} already has a reconciliation in progress. Finish it, or discard it, before starting another.`,
      );
    }
    const previous = lastFinished(db, input.companyId, input.accountCode);
    if (previous !== undefined && input.statementEndDate <= previous.statement_end_date) {
      throw new RepositoryValidationError(
        `The statement end date must be after ${previous.statement_end_date}, the end date of the last finished reconciliation of ${account.name}.`,
      );
    }
    const beginning = previous === undefined ? 0 : previous.statement_ending_balance_paise;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO bank_reconciliations
        (id, company_id, account_code, statement_end_date, statement_ending_balance_paise, beginning_balance_paise, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?)`,
    ).run(id, input.companyId, input.accountCode, input.statementEndDate, input.statementEndingBalancePaise, beginning, now);
    // R12 set two (plan 12f): a book line that a bank statement line was added or matched to has
    // already been seen on the bank's own statement, so it arrives ticked (C) when the statement
    // line is dated on or before this statement's end date. The user can still untick it.
    const preTicked = db
      .prepare(
        `INSERT INTO bank_reconciliation_lines (reconciliation_id, journal_line_id)
         SELECT ?, k.journal_line_id
           FROM bank_statement_line_links k
           JOIN bank_statement_lines s ON s.id = k.line_id
           JOIN journal_lines jl ON jl.id = k.journal_line_id
           JOIN journal_entries je ON je.id = jl.journal_entry_id
           JOIN businesses b ON b.id = je.business_id
          WHERE s.company_id = ? AND s.account_code = ? AND s.txn_date <= ?
            AND jl.account = ? AND b.company_id = ? AND je.entry_date <= ?
            AND k.journal_line_id NOT IN (SELECT l.journal_line_id FROM bank_reconciliation_lines l
                                            JOIN bank_reconciliations r ON r.id = l.reconciliation_id
                                           WHERE r.status = 'FINISHED')`,
      )
      .run(
        id,
        input.companyId,
        input.accountCode,
        input.statementEndDate,
        input.accountCode,
        input.companyId,
        input.statementEndDate,
      ).changes;
    appendAuditEvent(db, {
      action: "RECONCILIATION_STARTED",
      entityId: id,
      entityType: "bank_reconciliation",
      companyId: input.companyId,
      occurredAt: now,
      afterValues: {
        accountCode: input.accountCode,
        statementEndDate: input.statementEndDate,
        statementEndingBalancePaise: input.statementEndingBalancePaise,
        beginningBalancePaise: beginning,
        preTickedFromStatement: preTicked,
      },
    });
  })();
  return toHeader(requireRow(db, id));
}

/** Lines on offer for an in-progress reconciliation: the account, the company's businesses, dated <= end, not finished. */
function candidateRows(db: Database.Database, row: HeaderRow): LineRow[] {
  return db
    .prepare(
      `${LINE_SELECT},
              CASE WHEN EXISTS (SELECT 1 FROM bank_reconciliation_lines t
                                 WHERE t.reconciliation_id = ? AND t.journal_line_id = jl.id) THEN 1 ELSE 0 END AS ticked
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN businesses b ON b.id = je.business_id
        WHERE jl.account = ? AND b.company_id = ? AND je.entry_date <= ?
          AND jl.id NOT IN (SELECT l.journal_line_id FROM bank_reconciliation_lines l
                              JOIN bank_reconciliations r ON r.id = l.reconciliation_id
                             WHERE r.status = 'FINISHED')
        ${LINE_ORDER}`,
    )
    .all(row.id, row.account_code, row.company_id, row.statement_end_date) as LineRow[];
}

/** The lines recorded as cleared in this reconciliation. */
function clearedRows(db: Database.Database, id: string): LineRow[] {
  return db
    .prepare(
      `${LINE_SELECT}, 1 AS ticked
         FROM bank_reconciliation_lines t
         JOIN journal_lines jl ON jl.id = t.journal_line_id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE t.reconciliation_id = ?
        ${LINE_ORDER}`,
    )
    .all(id) as LineRow[];
}

export function getReconciliation(db: Database.Database, id: string): ReconciliationDetail {
  const row = requireRow(db, id);
  const rows = row.status === "IN_PROGRESS" ? candidateRows(db, row) : clearedRows(db, id);
  const candidates = rows.map(toLine);
  const cleared = candidates.filter((l) => l.ticked);
  const clearedInPaise = cleared.reduce((s, l) => s + l.inPaise, 0);
  const clearedOutPaise = cleared.reduce((s, l) => s + l.outPaise, 0);
  const clearedBalancePaise = row.beginning_balance_paise + clearedInPaise - clearedOutPaise;
  return {
    header: toHeader(row),
    candidates,
    clearedInPaise,
    clearedOutPaise,
    clearedBalancePaise,
    differencePaise: row.statement_ending_balance_paise - clearedBalancePaise,
  };
}

/** Ticks or unticks lines. Saved at once: leaving the reconciliation IN_PROGRESS is "save for later". */
export function setTicked(db: Database.Database, id: string, journalLineIds: readonly number[], ticked: boolean): ReconciliationDetail {
  if (!Array.isArray(journalLineIds) || journalLineIds.length === 0 || !journalLineIds.every((n) => Number.isSafeInteger(n))) {
    throw new RepositoryValidationError("Give the journal line ids to tick or untick, as whole numbers.");
  }
  db.transaction(() => {
    const row = requireRow(db, id);
    requireInProgress(row, ticked ? "ticked" : "unticked");
    if (ticked) {
      const offered = new Set(candidateRows(db, row).map((r) => r.id));
      for (const lineId of journalLineIds) {
        if (!offered.has(lineId)) {
          throw new RepositoryValidationError(
            `Line ${lineId} cannot be ticked here: it is not on this account, is dated after ${row.statement_end_date}, or is already reconciled.`,
          );
        }
      }
      const insert = db.prepare("INSERT OR IGNORE INTO bank_reconciliation_lines (reconciliation_id, journal_line_id) VALUES (?, ?)");
      for (const lineId of journalLineIds) insert.run(id, lineId);
    } else {
      const remove = db.prepare("DELETE FROM bank_reconciliation_lines WHERE reconciliation_id = ? AND journal_line_id = ?");
      for (const lineId of journalLineIds) remove.run(id, lineId);
    }
  })();
  return getReconciliation(db, id);
}

/** Changes the statement end date and/or ending balance while IN_PROGRESS. The beginning balance does not change. */
export function editStatement(
  db: Database.Database,
  id: string,
  changes: { statementEndDate?: string; statementEndingBalancePaise?: number },
): ReconciliationDetail {
  db.transaction(() => {
    const row = requireRow(db, id);
    requireInProgress(row, "edited");
    const endDate = changes.statementEndDate ?? row.statement_end_date;
    const ending = changes.statementEndingBalancePaise ?? row.statement_ending_balance_paise;
    assertDate(endDate, "The statement end date");
    assertWholePaise(ending, "The statement ending balance");
    const previous = lastFinished(db, row.company_id, row.account_code);
    if (previous !== undefined && endDate <= previous.statement_end_date) {
      throw new RepositoryValidationError(
        `The statement end date must be after ${previous.statement_end_date}, the end date of the last finished reconciliation.`,
      );
    }
    const tooLate = db
      .prepare(
        `SELECT COUNT(*) AS n FROM bank_reconciliation_lines t
           JOIN journal_lines jl ON jl.id = t.journal_line_id
           JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE t.reconciliation_id = ? AND je.entry_date > ?`,
      )
      .get(id, endDate) as { n: number };
    if (tooLate.n > 0) {
      throw new RepositoryValidationError(`${tooLate.n} ticked line(s) are dated after ${endDate}. Untick them before moving the end date earlier.`);
    }
    db.prepare("UPDATE bank_reconciliations SET statement_end_date = ?, statement_ending_balance_paise = ? WHERE id = ?").run(endDate, ending, id);
    appendAuditEvent(db, {
      action: "RECONCILIATION_EDITED",
      entityId: id,
      entityType: "bank_reconciliation",
      companyId: row.company_id,
      occurredAt: new Date().toISOString(),
      beforeValues: { statementEndDate: row.statement_end_date, statementEndingBalancePaise: row.statement_ending_balance_paise },
      afterValues: { statementEndDate: endDate, statementEndingBalancePaise: ending },
    });
  })();
  return getReconciliation(db, id);
}

/** Throws the in-progress reconciliation away (ticks included). Audited. */
export function discardReconciliation(db: Database.Database, id: string): void {
  db.transaction(() => {
    const row = requireRow(db, id);
    requireInProgress(row, "discarded");
    const ticks = (db.prepare("SELECT COUNT(*) AS n FROM bank_reconciliation_lines WHERE reconciliation_id = ?").get(id) as { n: number }).n;
    db.prepare("DELETE FROM bank_reconciliation_lines WHERE reconciliation_id = ?").run(id);
    db.prepare("DELETE FROM bank_reconciliations WHERE id = ?").run(id);
    appendAuditEvent(db, {
      action: "RECONCILIATION_DISCARDED",
      entityId: id,
      entityType: "bank_reconciliation",
      companyId: row.company_id,
      occurredAt: new Date().toISOString(),
      beforeValues: {
        accountCode: row.account_code,
        statementEndDate: row.statement_end_date,
        statementEndingBalancePaise: row.statement_ending_balance_paise,
        tickedLines: ticks,
      },
    });
  })();
}

/** Finish: only at difference 0. There is no automatic plug entry - post the missing entry, then tick it. */
export function finishReconciliation(db: Database.Database, id: string): ReconciliationHeader {
  db.transaction(() => {
    const row = requireRow(db, id);
    requireInProgress(row, "finished");
    const detail = getReconciliation(db, id);
    if (detail.differencePaise !== 0) {
      throw new RepositoryValidationError(
        `The difference is ${formatRupees(detail.differencePaise)}, not zero, so this reconciliation cannot be finished. ` +
          `Statement ${formatRupees(row.statement_ending_balance_paise)} against cleared ${formatRupees(detail.clearedBalancePaise)}. ` +
          `Tick the missing lines, or post the missing entry and tick it. ${SIGN_NOTE}`,
      );
    }
    const now = new Date().toISOString();
    const high = (db.prepare("SELECT COALESCE(MAX(rowid), 0) AS m FROM journal_entries").get() as { m: number }).m;
    db.prepare("UPDATE bank_reconciliations SET status = 'FINISHED', finished_at = ?, entries_high_water = ? WHERE id = ?").run(now, high, id);
    appendAuditEvent(db, {
      action: "RECONCILIATION_FINISHED",
      entityId: id,
      entityType: "bank_reconciliation",
      companyId: row.company_id,
      occurredAt: now,
      afterValues: {
        accountCode: row.account_code,
        statementEndDate: row.statement_end_date,
        beginningBalancePaise: row.beginning_balance_paise,
        clearedInPaise: detail.clearedInPaise,
        clearedOutPaise: detail.clearedOutPaise,
        endingBalancePaise: row.statement_ending_balance_paise,
        clearedLines: detail.candidates.filter((l) => l.ticked).length,
      },
    });
  })();
  return toHeader(requireRow(db, id));
}

/** Undo the LATEST finished reconciliation of its account. Reason required. Rows are kept (UNDONE). */
export function undoReconciliation(db: Database.Database, id: string, reason: string): ReconciliationHeader {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new RepositoryValidationError("A reason is required to undo a reconciliation.");
  }
  db.transaction(() => {
    const row = requireRow(db, id);
    if (row.status !== "FINISHED") {
      throw new RepositoryValidationError(`Only a finished reconciliation can be undone; this one is ${row.status}.`);
    }
    const latest = lastFinished(db, row.company_id, row.account_code);
    if (latest === undefined || latest.id !== id) {
      throw new RepositoryValidationError(
        `Only the latest finished reconciliation can be undone. Undo the one ending ${latest?.statement_end_date ?? "later"} first.`,
      );
    }
    if (hasInProgress(db, row.company_id, row.account_code)) {
      throw new RepositoryValidationError("A newer reconciliation is in progress on this account. Finish or discard it before undoing this one.");
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE bank_reconciliations SET status = 'UNDONE', undone_at = ?, undo_reason = ? WHERE id = ?").run(now, reason.trim(), id);
    appendAuditEvent(db, {
      action: "RECONCILIATION_UNDONE",
      entityId: id,
      entityType: "bank_reconciliation",
      companyId: row.company_id,
      occurredAt: now,
      reason: reason.trim(),
      beforeValues: { status: "FINISHED", accountCode: row.account_code, statementEndDate: row.statement_end_date },
      afterValues: { status: "UNDONE" },
    });
  })();
  return toHeader(requireRow(db, id));
}

/** The report of a FINISHED reconciliation. */
export function getReconciliationReport(db: Database.Database, id: string): ReconciliationReport {
  const row = requireRow(db, id);
  if (row.status !== "FINISHED" || row.entries_high_water === null) {
    throw new RepositoryValidationError(`A report exists only for a finished reconciliation; this one is ${row.status}.`);
  }
  const detail = getReconciliation(db, id);
  const base = `
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN businesses b ON b.id = je.business_id
   WHERE jl.account = ? AND b.company_id = ? AND je.entry_date <= ?
     AND jl.id NOT IN (SELECT journal_line_id FROM bank_reconciliation_lines WHERE reconciliation_id = ?)`;
  // Uncleared at finish time: posted before the finish, and not cleared by an EARLIER finished reconciliation.
  const uncleared = db
    .prepare(
      `${LINE_SELECT}, 0 AS ticked ${base}
        AND je.rowid <= ?
        AND jl.id NOT IN (SELECT l.journal_line_id FROM bank_reconciliation_lines l
                            JOIN bank_reconciliations r ON r.id = l.reconciliation_id
                           WHERE r.status = 'FINISHED' AND r.id <> ? AND r.statement_end_date < ?)
        ${LINE_ORDER}`,
    )
    .all(row.account_code, row.company_id, row.statement_end_date, id, row.entries_high_water, id, row.statement_end_date) as LineRow[];
  const reversalIds = reversedEntryIds(db, id);
  // CANCELLED: a later reversal on this account of a document whose line was cleared here. Cancels post
  // dated today, so the reversal is usually AFTER the end date and the date filter must not apply.
  const cancelled = db
    .prepare(
      `${LINE_SELECT}, 0 AS ticked
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN businesses b ON b.id = je.business_id
        WHERE jl.account = ? AND b.company_id = ? AND je.is_reversal = 1 AND je.rowid > ?
          AND EXISTS (SELECT 1 FROM bank_reconciliation_lines t
                        JOIN journal_lines cl ON cl.id = t.journal_line_id
                        JOIN journal_entries ce ON ce.id = cl.journal_entry_id
                       WHERE t.reconciliation_id = ? AND ce.source_type = je.source_type AND ce.source_id = je.source_id)
        ${LINE_ORDER}`,
    )
    .all(row.account_code, row.company_id, row.entries_high_water, id)
    // (source_type, source_id) is NOT unique per entry: every payment on one invoice carries that
    // invoice's id. So the reversal must reverse an entry CLEARED HERE, matched by entry id
    // (orchestrator review, S15): a second, uncleared payment on the same invoice must not show.
    .filter((r) => reversalIds.has((r as LineRow).journal_entry_id)) as LineRow[];
  const cancelledIds = new Set(cancelled.map((r) => r.id));
  const added = db
    .prepare(`${LINE_SELECT}, 0 AS ticked ${base} AND je.rowid > ? ${LINE_ORDER}`)
    .all(row.account_code, row.company_id, row.statement_end_date, id, row.entries_high_water) as LineRow[];
  const changed: ChangedLine[] = [
    ...added.filter((r) => !cancelledIds.has(r.id)).map((r): ChangedLine => ({ ...toLine(r), change: "ADDED" })),
    ...cancelled.map((r): ChangedLine => ({ ...toLine(r), change: "CANCELLED" })),
  ].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.journalLineId - b.journalLineId);
  return {
    header: detail.header,
    beginningBalancePaise: row.beginning_balance_paise,
    clearedInPaise: detail.clearedInPaise,
    clearedOutPaise: detail.clearedOutPaise,
    endingBalancePaise: row.statement_ending_balance_paise,
    clearedLines: detail.candidates,
    unclearedLines: uncleared.map(toLine),
    changedAfterFinishing: changed,
  };
}

/** History for one account, newest first. */
export function listReconciliations(db: Database.Database, companyId: string, accountCode: string): ReconciliationHeader[] {
  const rows = db
    .prepare(
      `SELECT * FROM bank_reconciliations WHERE company_id = ? AND account_code = ?
        ORDER BY statement_end_date DESC, started_at DESC, rowid DESC`,
    )
    .all(companyId, accountCode) as HeaderRow[];
  return rows.map(toHeader);
}

/** For later wiring into the register: "C" = ticked in an in-progress reconciliation, "R" = in a finished one. */
export function reconciliationStatusOf(db: Database.Database, journalLineIds: readonly number[]): Map<number, "C" | "R"> {
  const result = new Map<number, "C" | "R">();
  const stmt = db.prepare(
    `SELECT r.status AS status FROM bank_reconciliation_lines l
       JOIN bank_reconciliations r ON r.id = l.reconciliation_id
      WHERE l.journal_line_id = ? AND r.status IN ('IN_PROGRESS', 'FINISHED')`,
  );
  for (const lineId of journalLineIds) {
    const rows = stmt.all(lineId) as Array<{ status: string }>;
    if (rows.some((r) => r.status === "FINISHED")) result.set(lineId, "R");
    else if (rows.length > 0) result.set(lineId, "C");
  }
  return result;
}

/** Finished reconciliations that cleared any line of this journal entry (so editing or cancelling it matters). */
export function finishedReconciliationsTouchingEntry(
  db: Database.Database,
  journalEntryId: string,
): Array<{ id: string; accountCode: string; statementEndDate: string }> {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.id AS id, r.account_code AS account_code, r.statement_end_date AS statement_end_date
         FROM bank_reconciliation_lines l
         JOIN bank_reconciliations r ON r.id = l.reconciliation_id
         JOIN journal_lines jl ON jl.id = l.journal_line_id
        WHERE jl.journal_entry_id = ? AND r.status = 'FINISHED'
        ORDER BY r.statement_end_date`,
    )
    .all(journalEntryId) as Array<{ id: string; account_code: string; statement_end_date: string }>;
  return rows.map((r) => ({ id: r.id, accountCode: r.account_code, statementEndDate: r.statement_end_date }));
}
