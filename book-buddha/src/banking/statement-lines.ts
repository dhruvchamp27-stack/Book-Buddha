import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { RepositoryValidationError } from "../database/errors.js";
import { normaliseName } from "../import-export/codec.js";

/**
 * R12 set two shared contract (orchestrator, before the 12e–12g builders start; builders do not
 * edit this file). Tables: `statement-lines-schema.ts` (migration v28).
 *
 * Who writes what:
 * - 12e (statement import) creates lines through `insertStatementLine`, after its own duplicate check.
 * - 12f (review queue) owns every STATUS change and every row of `bank_statement_line_links`.
 * - 12g (bank rules) reads lines and returns a `LineSuggestion`; it never writes a line or a link.
 *
 * Status:  FOR_REVIEW ──Add / Split / Uncategorised──▶ ADDED
 *                     ──Match (document or posted line)─▶ MATCHED
 *                     ──Transfer─────────────────────▶ TRANSFERRED
 *                     ──Exclude──────────────────────▶ EXCLUDED
 *          and Undo takes any of those back to FOR_REVIEW.
 */

export type StatementLineStatus = "FOR_REVIEW" | "ADDED" | "MATCHED" | "TRANSFERRED" | "EXCLUDED";
export type LinkKind = "VOUCHER" | "PAYMENT" | "SUPPLIER_PAYMENT" | "INTERNAL_TRANSFER" | "EXISTING";

export interface StatementLine {
  readonly id: string;
  readonly companyId: string;
  readonly accountCode: string;
  readonly importId: string | null;
  readonly rowNumber: number | null;
  readonly txnDate: string;
  readonly description: string;
  readonly reference: string | null;
  /** + money IN to the bank account, − money OUT. Never 0. */
  readonly amountPaise: number;
  readonly balancePaise: number | null;
  readonly fingerprint: string;
  readonly businessId: string | null;
  readonly fairId: string | null;
  readonly status: StatementLineStatus;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface StatementLineLink {
  readonly lineId: string;
  readonly journalLineId: number;
  readonly journalEntryId: string;
  readonly linkKind: LinkKind;
  /** The voucher / payment / supplier payment / internal transfer id; null for EXISTING. */
  readonly documentId: string | null;
  /** 1 = 12f posted this entry (Undo cancels it); 0 = link only (Undo just unlinks). */
  readonly postedByFeed: boolean;
  readonly createdAt: string;
}

/**
 * What a bank rule (12g) proposes for a line. PRE-FILL ONLY (FD §D5): nothing is posted from it;
 * the user still confirms through a 12f action. A rule never proposes an Uncategorised account.
 */
export interface LineSuggestion {
  readonly ruleId: string;
  readonly ruleName: string;
  /** ADD → post to `accountCode`; TRANSFER → an Internal Transfer with money account `accountCode`. */
  readonly action: "ADD" | "TRANSFER";
  readonly accountCode: string;
  readonly businessId: string | null;
  readonly fairId: string | null;
  readonly partyName: string | null;
  readonly memo: string | null;
}

/**
 * The duplicate key of a line: account, date, signed amount, normalised description and
 * reference. NOT unique: two identical Rs 59 charges on one day are two real lines (12e keeps both).
 * The running balance is deliberately left out, so a file mapped with and without a balance column
 * still recognises its own lines.
 */
export function fingerprintOf(line: {
  accountCode: string;
  txnDate: string;
  amountPaise: number;
  description: string;
  reference?: string | null | undefined;
}): string {
  return [line.accountCode, line.txnDate, String(line.amountPaise), normaliseName(line.description), normaliseName(line.reference ?? "")].join("|");
}

export interface InsertStatementLineInput {
  readonly companyId: string;
  readonly accountCode: string;
  readonly importId?: string | null;
  readonly rowNumber?: number | null;
  readonly txnDate: string;
  readonly description: string;
  readonly reference?: string | null;
  readonly amountPaise: number;
  readonly balancePaise?: number | null;
  readonly businessId?: string | null;
  readonly fairId?: string | null;
}

/**
 * Inserts ONE line as FOR_REVIEW, no duplicate check (that is 12e's job) and no audit event (12e
 * audits the import as a whole). Validates the shape only. Tests of 12f/12g use it to seed lines.
 */
export function insertStatementLine(db: Database.Database, input: InsertStatementLineInput): StatementLine {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise === 0) {
    throw new RepositoryValidationError("A statement line's amount must be a whole number of paise and not zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.txnDate)) {
    throw new RepositoryValidationError(`A statement line's date must be YYYY-MM-DD, not "${input.txnDate}".`);
  }
  if (input.description.trim() === "") {
    throw new RepositoryValidationError("A statement line needs a description.");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bank_statement_lines
       (id, company_id, account_code, import_id, row_number, txn_date, description, reference, amount_paise,
        balance_paise, fingerprint, business_id, fair_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FOR_REVIEW', ?)`,
  ).run(
    id,
    input.companyId,
    input.accountCode,
    input.importId ?? null,
    input.rowNumber ?? null,
    input.txnDate,
    input.description.trim(),
    input.reference ?? null,
    input.amountPaise,
    input.balancePaise ?? null,
    fingerprintOf(input),
    input.businessId ?? null,
    input.fairId ?? null,
    now,
  );
  return getStatementLine(db, id);
}

interface LineRow {
  id: string;
  company_id: string;
  account_code: string;
  import_id: string | null;
  row_number: number | null;
  txn_date: string;
  description: string;
  reference: string | null;
  amount_paise: number;
  balance_paise: number | null;
  fingerprint: string;
  business_id: string | null;
  fair_id: string | null;
  status: StatementLineStatus;
  resolved_at: string | null;
  created_at: string;
}

export function getStatementLine(db: Database.Database, id: string): StatementLine {
  const row = db.prepare("SELECT * FROM bank_statement_lines WHERE id = ?").get(id) as LineRow | undefined;
  if (row === undefined) throw new RepositoryValidationError(`Statement line ${id} was not found.`);
  return toLine(row);
}

/** Lines of one account, oldest first (date, then the order they were imported). */
export function listStatementLines(
  db: Database.Database,
  filter: {
    companyId: string;
    accountCode: string;
    status?: StatementLineStatus | undefined;
    fromDate?: string | undefined;
    toDate?: string | undefined;
  },
): StatementLine[] {
  const where = ["company_id = ?", "account_code = ?"];
  const args: (string | number)[] = [filter.companyId, filter.accountCode];
  if (filter.status !== undefined) { where.push("status = ?"); args.push(filter.status); }
  if (filter.fromDate !== undefined) { where.push("txn_date >= ?"); args.push(filter.fromDate); }
  if (filter.toDate !== undefined) { where.push("txn_date <= ?"); args.push(filter.toDate); }
  const rows = db
    .prepare(`SELECT * FROM bank_statement_lines WHERE ${where.join(" AND ")} ORDER BY txn_date, rowid`)
    .all(...args) as LineRow[];
  return rows.map(toLine);
}

export function linksOfLine(db: Database.Database, lineId: string): StatementLineLink[] {
  const rows = db
    .prepare("SELECT * FROM bank_statement_line_links WHERE line_id = ? ORDER BY journal_line_id")
    .all(lineId) as {
      line_id: string;
      journal_line_id: number;
      journal_entry_id: string;
      link_kind: LinkKind;
      document_id: string | null;
      posted_by_feed: number;
      created_at: string;
    }[];
  return rows.map((r) => ({
    lineId: r.line_id,
    journalLineId: r.journal_line_id,
    journalEntryId: r.journal_entry_id,
    linkKind: r.link_kind,
    documentId: r.document_id,
    postedByFeed: r.posted_by_feed === 1,
    createdAt: r.created_at,
  }));
}

/**
 * Refuses to cancel a posted entry that a bank statement line was added or matched to. Cancelling it
 * from its own screen would leave the bank line MATCHED/ADDED against money the books no longer
 * hold. The way back is Undo on the bank line (12f), which unlinks first: an entry the bank feed
 * POSTED is then cancelled for you; an entry that was already in the books is only unlinked, and
 * can then be cancelled from its own screen.
 */
export function assertNotOnBankLine(db: Database.Database, journalEntryId: string, what: string): void {
  const row = db
    .prepare(
      `SELECT s.txn_date AS d, s.description AS t, k.posted_by_feed AS feed FROM bank_statement_line_links k
         JOIN bank_statement_lines s ON s.id = k.line_id
        WHERE k.journal_entry_id = ? LIMIT 1`,
    )
    .get(journalEntryId) as { d: string; t: string; feed: number } | undefined;
  if (row !== undefined) {
    const way = row.feed === 1
      ? "Undo that line in the bank review queue instead; it cancels this for you."
      : "Undo that line in the bank review queue first; then this can be cancelled.";
    throw new RepositoryValidationError(`${what} is matched to the bank statement line of ${row.d} ("${row.t}"). ${way}`);
  }
}

/**
 * The entry a reversal undoes, by the codebase's two naming conventions (see reconciliation.ts
 * reversedEntryIds): `<id>-reversal`, and `je-opening-<kind>-reversal-<id>` for the opening sets.
 */
export function reversedEntryIdOf(reversalId: string): string | null {
  const suffix = "-reversal";
  if (reversalId.endsWith(suffix)) return reversalId.slice(0, -suffix.length);
  const opening = /^je-opening-(balance|customer|supplier)-reversal-(.+)$/.exec(reversalId);
  return opening === null ? null : `je-opening-${opening[1]}-${opening[2]}`;
}

function toLine(r: LineRow): StatementLine {
  return {
    id: r.id,
    companyId: r.company_id,
    accountCode: r.account_code,
    importId: r.import_id,
    rowNumber: r.row_number,
    txnDate: r.txn_date,
    description: r.description,
    reference: r.reference,
    amountPaise: r.amount_paise,
    balancePaise: r.balance_paise,
    fingerprint: r.fingerprint,
    businessId: r.business_id,
    fairId: r.fair_id,
    status: r.status,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}
