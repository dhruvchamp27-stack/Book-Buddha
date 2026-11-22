import type Database from "better-sqlite3";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";
import type { AccountingRepository } from "../database/repository.js";
import { normaliseName } from "../import-export/codec.js";
import { cancelInternalTransfer, createInternalTransfer } from "./internal-transfers.js";
import { companyOfBusiness } from "./money-accounts.js";
import { formatRupees } from "./reconciliation.js";
import {
  getStatementLine,
  linksOfLine,
  listStatementLines,
  type LineSuggestion,
  type LinkKind,
  type StatementLine,
  type StatementLineLink,
  type StatementLineStatus,
} from "./statement-lines.js";
import { cancelVoucher, createVoucher } from "./vouchers.js";

/**
 * R12 12f - the review queue (FD section D3, D6, D7).
 *
 * Turns each FOR_REVIEW statement line into books entries through the EXISTING doors only
 * (createVoucher, createInternalTransfer, repository.recordPayment / recordSupplierPayment and their
 * cancel twins). Nothing here writes a journal row or an audit row itself.
 *
 * THE TWO RULES THAT MATTER
 * 1. A statement line is never counted twice. A line is resolved ONCE (Add, Match, Transfer, Exclude);
 *    `bank_statement_line_links.journal_line_id` is UNIQUE, so one journal line serves one statement line,
 *    and every action refuses a line that is not FOR_REVIEW.
 * 2. Nothing posts without confirm. Every action that POSTS or REVERSES takes `confirm`; `confirm: false`
 *    runs the very same path inside a transaction that ALWAYS rolls back and reports what WOULD post.
 *
 * Every action is ONE transaction: the post, the links, the status and the audit event land together
 * or not at all.
 *
 * SIGN. `amountPaise` of a line is + money IN to the bank account, - money OUT. A bank's
 * "Debit / Withdrawal" column is money OUT = negative: the opposite of the books' word "debit".
 *
 * CONTEXT. Functions that only read or write plain tables accept either the repository or its
 * `db`. `matchLine` (documents) and `undoLine` post and cancel payments through the repository's own
 * doors, so they need the AccountingRepository.
 */

export type ReviewContext = AccountingRepository | Database.Database;

export interface WillPostLine {
  readonly account: string;
  readonly accountName: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
}
export interface WillPostEntry {
  readonly description: string;
  readonly entryDate: string;
  readonly lines: readonly WillPostLine[];
}

export interface ConfirmedResult {
  readonly confirmed: true;
  readonly line: StatementLine;
  readonly links: readonly StatementLineLink[];
}
export interface PreviewResult {
  readonly confirmed: false;
  readonly willPost: readonly WillPostEntry[];
}
export type ReviewResult = ConfirmedResult | PreviewResult;

export interface SplitInput {
  readonly accountCode: string;
  readonly amountPaise: number;
  readonly description?: string | undefined;
}

export interface AddLineInput {
  readonly splits: readonly SplitInput[];
  readonly partyName?: string | undefined;
  readonly narration?: string | undefined;
  readonly paymentMode?: string | undefined;
  /** Q12: confirm a bank line dated in an earlier month than today changes figures already reported. */
  readonly confirmBackdatedMonth?: boolean | undefined;
  readonly confirm: boolean;
}

export interface MatchDocumentInput {
  readonly kind: "INVOICE" | "BILL";
  readonly id: string;
  readonly amountPaise: number;
}

export interface MatchLineInput {
  readonly documents?: readonly MatchDocumentInput[] | undefined;
  readonly journalLineIds?: readonly number[] | undefined;
  readonly paymentMode?: string | undefined;
  /** Q12: confirm a bank line dated in an earlier month than today changes figures already reported. */
  readonly confirmBackdatedMonth?: boolean | undefined;
  readonly confirm?: boolean | undefined;
}

export interface DocumentMatch {
  readonly kind: "INVOICE" | "BILL";
  readonly id: string;
  readonly number: string;
  readonly partyName: string;
  readonly date: string;
  readonly businessId: string;
  readonly businessName: string;
  readonly outstandingPaise: number;
}

export interface PostedLineMatch {
  readonly journalLineId: number;
  readonly journalEntryId: string;
  readonly entryDate: string;
  readonly description: string;
  readonly sourceType: string;
  readonly businessId: string;
  /** Signed: + debit (money in to the account), - credit. */
  readonly amountPaise: number;
}

export interface Matches {
  readonly documents: readonly DocumentMatch[];
  readonly postedLines: readonly PostedLineMatch[];
}

export interface ReviewQueueEntry {
  readonly line: StatementLine;
  readonly links: readonly StatementLineLink[];
  readonly suggestion: LineSuggestion | null;
}

// ---- plumbing ------------------------------------------------------------------------------------

function dbOf(ctx: ReviewContext): Database.Database {
  return "prepare" in ctx ? ctx : ctx.db;
}

function repositoryOf(ctx: ReviewContext): AccountingRepository {
  if ("prepare" in ctx) {
    throw new RepositoryValidationError("This action posts through the repository; pass the AccountingRepository, not the bare database.");
  }
  return ctx;
}

/** Thrown on purpose inside a preview to roll the transaction back; carries what would have posted. */
class PreviewRollback extends Error {
  public readonly willPost: readonly WillPostEntry[];
  public constructor(willPost: readonly WillPostEntry[]) {
    super("preview");
    this.willPost = willPost;
  }
}

function maxEntryRowid(db: Database.Database): number {
  return (db.prepare("SELECT COALESCE(MAX(rowid), 0) AS m FROM journal_entries").get() as { m: number }).m;
}

/** The journal entries created since `afterRowid`, with their lines. */
function entriesSince(db: Database.Database, afterRowid: number): WillPostEntry[] {
  const entries = db
    .prepare("SELECT id, description, entry_date FROM journal_entries WHERE rowid > ? ORDER BY rowid")
    .all(afterRowid) as Array<{ id: string; description: string; entry_date: string }>;
  const lines = db.prepare(
    `SELECT jl.account AS account, COALESCE(ca.name, jl.account) AS name, jl.debit_paise AS debit, jl.credit_paise AS credit
       FROM journal_lines jl LEFT JOIN chart_accounts ca ON ca.code = jl.account
      WHERE jl.journal_entry_id = ? ORDER BY jl.id`,
  );
  return entries.map((e) => ({
    description: e.description,
    entryDate: e.entry_date,
    lines: (lines.all(e.id) as Array<{ account: string; name: string; debit: number; credit: number }>).map((l) => ({
      account: l.account,
      accountName: l.name,
      debitPaise: l.debit,
      creditPaise: l.credit,
    })),
  }));
}

/**
 * Runs `work` as ONE transaction. `preview` = true runs the same path and then always rolls back,
 * returning what would have been posted; nothing at all (journal, voucher, payment, link, status,
 * audit) survives.
 */
function execute(db: Database.Database, lineId: string, preview: boolean, work: () => void): ReviewResult {
  if (!preview) {
    db.transaction(work)();
    return { confirmed: true, line: getStatementLine(db, lineId), links: linksOfLine(db, lineId) };
  }
  const before = maxEntryRowid(db);
  try {
    db.transaction(() => {
      work();
      throw new PreviewRollback(entriesSince(db, before));
    })();
  } catch (error) {
    if (error instanceof PreviewRollback) return { confirmed: false, willPost: error.willPost };
    throw error;
  }
  throw new Error("unreachable: a preview always ends in a rollback");
}

function audit(
  db: Database.Database,
  action: string,
  line: StatementLine,
  detail: { beforeValues?: unknown; afterValues?: unknown; reason?: string },
): void {
  appendAuditEvent(db, {
    action,
    entityId: line.id,
    entityType: "bank_statement_line",
    companyId: line.companyId,
    occurredAt: new Date().toISOString(),
    ...detail,
  });
}

function requireForReview(line: StatementLine): void {
  if (line.status !== "FOR_REVIEW") {
    throw new RepositoryValidationError(
      `This bank line is ${line.status}, not FOR_REVIEW. Undo it first if it has to be done again.`,
    );
  }
}

/** A line that will post needs a business of its own company (FD D4). */
function requirePostingBusiness(db: Database.Database, line: StatementLine): string {
  if (line.businessId === null) {
    throw new RepositoryValidationError("Choose a business for this line first.");
  }
  if (companyOfBusiness(db, line.businessId) !== line.companyId) {
    throw new RepositoryValidationError("The business chosen for this line belongs to another company.");
  }
  return line.businessId;
}

function bankJournalLineId(db: Database.Database, entryId: string, account: string): number {
  const row = db
    .prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = ? ORDER BY id LIMIT 1")
    .get(entryId, account) as { id: number } | undefined;
  if (row === undefined) {
    throw new RepositoryValidationError(`Journal entry ${entryId} has no line on ${account}.`);
  }
  return row.id;
}

function insertLink(
  db: Database.Database,
  line: StatementLine,
  journalLineId: number,
  journalEntryId: string,
  kind: LinkKind,
  documentId: string | null,
  postedByFeed: boolean,
): void {
  db.prepare(
    `INSERT INTO bank_statement_line_links
       (line_id, journal_line_id, journal_entry_id, link_kind, document_id, posted_by_feed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(line.id, journalLineId, journalEntryId, kind, documentId, postedByFeed ? 1 : 0, new Date().toISOString());
}

function setStatus(
  db: Database.Database,
  lineId: string,
  status: StatementLineStatus,
  businessId?: string,
): void {
  const resolved = status === "FOR_REVIEW" ? null : new Date().toISOString();
  if (businessId === undefined) {
    db.prepare("UPDATE bank_statement_lines SET status = ?, resolved_at = ? WHERE id = ?").run(status, resolved, lineId);
  } else {
    db.prepare("UPDATE bank_statement_lines SET status = ?, resolved_at = ?, business_id = ? WHERE id = ?").run(status, resolved, businessId, lineId);
  }
}

const rupees = (paise: number): string => formatRupees(paise);

// ---- update ----------------------------------------------------------------------------------------

/** Set (or clear, with null) the business and project (fair) of a line that is still FOR_REVIEW. */
export function updateLine(
  ctx: ReviewContext,
  id: string,
  patch: { businessId?: string | null | undefined; fairId?: string | null | undefined },
): StatementLine {
  const db = dbOf(ctx);
  return db.transaction(() => {
    const before = getStatementLine(db, id);
    requireForReview(before);
    if (patch.businessId === undefined && patch.fairId === undefined) {
      throw new RepositoryValidationError("Send a business, a project, or both.");
    }
    let businessId = before.businessId;
    let fairId = before.fairId;
    if (patch.businessId !== undefined) {
      if (patch.businessId !== null && companyOfBusiness(db, patch.businessId) !== before.companyId) {
        throw new RepositoryValidationError("That business belongs to another company.");
      }
      businessId = patch.businessId;
    }
    if (patch.fairId !== undefined) {
      if (patch.fairId !== null) {
        const fair = db.prepare("SELECT company_id FROM fairs WHERE id = ?").get(patch.fairId) as { company_id: string } | undefined;
        if (fair === undefined || fair.company_id !== before.companyId) {
          throw new RepositoryValidationError("That project was not found in this company.");
        }
      }
      fairId = patch.fairId;
    }
    db.prepare("UPDATE bank_statement_lines SET business_id = ?, fair_id = ? WHERE id = ?").run(businessId, fairId, id);
    const after = getStatementLine(db, id);
    audit(db, "BANK_LINE_UPDATED", after, {
      beforeValues: { businessId: before.businessId, fairId: before.fairId },
      afterValues: { businessId: after.businessId, fairId: after.fairId },
    });
    return after;
  })();
}

// ---- add / uncategorise ------------------------------------------------------------------------------

function addWork(db: Database.Database, id: string, input: AddLineInput, uncategorised: boolean): () => void {
  return () => {
    const line = getStatementLine(db, id);
    requireForReview(line);
    const businessId = requirePostingBusiness(db, line);
    if (!Array.isArray(input.splits) || input.splits.length === 0) {
      throw new RepositoryValidationError("Split the line to at least one account.");
    }
    const target = Math.abs(line.amountPaise);
    let sum = 0;
    for (const [i, s] of input.splits.entries()) {
      if (!Number.isSafeInteger(s.amountPaise) || s.amountPaise <= 0) {
        throw new RepositoryValidationError(`Split ${i + 1}: the amount must be a whole number of paise above zero.`);
      }
      sum += s.amountPaise;
    }
    if (sum !== target) {
      throw new RepositoryValidationError(
        `The splits add up to ${rupees(sum)} but the bank line is ${rupees(target)}. They must add up to the same amount.`,
      );
    }
    const voucher = createVoucher(db, {
      kind: line.amountPaise > 0 ? "RECEIPT" : "PAYMENT",
      businessId,
      date: line.txnDate,
      moneyAccount: line.accountCode,
      lines: input.splits.map((s) => ({ account: s.accountCode, amountPaise: s.amountPaise, description: s.description })),
      paymentMode: input.paymentMode,
      paymentReference: line.reference ?? undefined,
      partyName: input.partyName,
      narration: input.narration,
      fairId: line.fairId ?? undefined,
      confirmBackdatedMonth: input.confirmBackdatedMonth,
    });
    insertLink(db, line, bankJournalLineId(db, voucher.journalEntryId, line.accountCode), voucher.journalEntryId, "VOUCHER", voucher.id, true);
    setStatus(db, id, "ADDED");
    audit(db, "BANK_LINE_ADDED", line, {
      beforeValues: { status: line.status },
      afterValues: {
        status: "ADDED", voucherId: voucher.id, voucherNumber: voucher.number, totalPaise: voucher.totalPaise,
        uncategorised, splits: input.splits.map((s) => ({ accountCode: s.accountCode, amountPaise: s.amountPaise })),
      },
    });
  };
}

/**
 * Add: ONE voucher (RECEIPT for money in, PAYMENT for money out) split over one or more accounts.
 * `confirm: false` previews; `confirm: true` posts.
 */
export function addLine(ctx: ReviewContext, id: string, input: AddLineInput): ReviewResult {
  const db = dbOf(ctx);
  return execute(db, id, input.confirm !== true, addWork(db, id, input, false));
}

/** Add to the Uncategorised account (UNCATEGORIZED for money out, UNCATEGORIZED_INCOME for money in). */
export function uncategoriseLine(ctx: ReviewContext, id: string, input: { confirm: boolean; confirmBackdatedMonth?: boolean | undefined }): ReviewResult {
  const db = dbOf(ctx);
  const line = getStatementLine(db, id);
  const accountCode = line.amountPaise > 0 ? "UNCATEGORIZED_INCOME" : "UNCATEGORIZED";
  const add: AddLineInput = {
    splits: [{ accountCode, amountPaise: Math.abs(line.amountPaise), description: "Uncategorised" }],
    confirm: input.confirm,
    confirmBackdatedMonth: input.confirmBackdatedMonth,
  };
  return execute(db, id, input.confirm !== true, addWork(db, id, add, true));
}

// ---- transfer ------------------------------------------------------------------------------------------

/** An Internal Transfer between the line's account and another cash/bank account. */
export function transferLine(
  ctx: ReviewContext,
  id: string,
  input: { otherAccountCode: string; paymentMode?: string | undefined; confirm: boolean; confirmBackdatedMonth?: boolean | undefined },
): ReviewResult {
  const db = dbOf(ctx);
  return execute(db, id, input.confirm !== true, () => {
    const line = getStatementLine(db, id);
    requireForReview(line);
    const businessId = requirePostingBusiness(db, line);
    const moneyOut = line.amountPaise < 0;
    const transfer = createInternalTransfer(db, {
      businessId,
      date: line.txnDate,
      fromAccount: moneyOut ? line.accountCode : input.otherAccountCode,
      toAccount: moneyOut ? input.otherAccountCode : line.accountCode,
      amountPaise: Math.abs(line.amountPaise),
      paymentMode: input.paymentMode,
      paymentReference: line.reference ?? undefined,
      memo: line.description,
      fairId: line.fairId ?? undefined,
      confirmBackdatedMonth: input.confirmBackdatedMonth,
    });
    insertLink(db, line, bankJournalLineId(db, transfer.journalEntryId, line.accountCode), transfer.journalEntryId, "INTERNAL_TRANSFER", transfer.id, true);
    setStatus(db, id, "TRANSFERRED");
    audit(db, "BANK_LINE_TRANSFERRED", line, {
      beforeValues: { status: line.status },
      afterValues: {
        status: "TRANSFERRED", transferId: transfer.id, transferNumber: transfer.number,
        fromAccount: transfer.fromAccount, toAccount: transfer.toAccount, amountPaise: transfer.amountPaise,
      },
    });
  });
}

// ---- find matches ---------------------------------------------------------------------------------------

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const dayDistance = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** An entry is reversed when its `-reversal` twin exists (either naming convention). */
function isReversed(db: Database.Database, entryId: string): boolean {
  const exists = db.prepare("SELECT 1 FROM journal_entries WHERE id = ?");
  if (exists.get(`${entryId}-reversal`) !== undefined) return true;
  const opening = /^je-opening-(balance|customer|supplier)-(.+)$/.exec(entryId);
  return opening !== null && exists.get(`je-opening-${opening[1]}-reversal-${opening[2]}`) !== undefined;
}

interface CandidateRow {
  id: number;
  entry_id: string;
  entry_date: string;
  description: string;
  source_type: string;
  business_id: string;
  signed: number;
}

/**
 * Journal lines on the line's account that could BE this statement line: same company (the seeded
 * BANK is shared, so company scope is by the entry's business), dated from 30 days before to 5 days
 * after, not already linked, not in a FINISHED reconciliation, not a reversal and not reversed.
 * `exactAmount` keeps only the same signed amount; otherwise only the same direction.
 */
function candidateJournalLines(db: Database.Database, line: StatementLine, exactAmount: boolean): CandidateRow[] {
  const rows = db
    .prepare(
      `SELECT jl.id AS id, je.id AS entry_id, je.entry_date AS entry_date, je.description AS description,
              je.source_type AS source_type, je.business_id AS business_id, jl.debit_paise - jl.credit_paise AS signed
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN businesses b ON b.id = je.business_id
        WHERE jl.account = ? AND b.company_id = ? AND je.is_reversal = 0
          AND je.entry_date BETWEEN ? AND ?
          AND NOT EXISTS (SELECT 1 FROM bank_statement_line_links l WHERE l.journal_line_id = jl.id)
          AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_lines t
                            JOIN bank_reconciliations r ON r.id = t.reconciliation_id
                           WHERE t.journal_line_id = jl.id AND r.status = 'FINISHED')
        ORDER BY je.entry_date, jl.id`,
    )
    .all(line.accountCode, line.companyId, shiftDate(line.txnDate, -30), shiftDate(line.txnDate, 5)) as CandidateRow[];
  return rows.filter((r) => {
    if (isReversed(db, r.entry_id)) return false;
    return exactAmount ? r.signed === line.amountPaise : Math.sign(r.signed) === Math.sign(line.amountPaise);
  });
}

function toPosted(r: CandidateRow): PostedLineMatch {
  return {
    journalLineId: r.id,
    journalEntryId: r.entry_id,
    entryDate: r.entry_date,
    description: r.description,
    sourceType: r.source_type,
    businessId: r.business_id,
    amountPaise: r.signed,
  };
}

interface OpenDocument extends DocumentMatch {
  readonly paiseDate: string;
}

function openDocuments(repository: AccountingRepository, line: StatementLine): OpenDocument[] {
  const db = repository.db;
  const businesses = db.prepare("SELECT id, name FROM businesses WHERE company_id = ?").all(line.companyId) as Array<{ id: string; name: string }>;
  const out: OpenDocument[] = [];
  const moneyIn = line.amountPaise > 0;
  for (const biz of businesses) {
    if (moneyIn) {
      const names = db.prepare("SELECT i.id AS id, c.name AS name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.business_id = ?")
        .all(biz.id) as Array<{ id: string; name: string }>;
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      for (const row of repository.getReceivables({ businessId: biz.id })) {
        if (row.kind !== "INVOICE" || row.outstandingPaise <= 0) continue;
        out.push({
          kind: "INVOICE", id: row.invoiceId, number: row.invoiceNumber, partyName: nameOf.get(row.invoiceId) ?? "",
          date: row.invoiceDate.slice(0, 10), paiseDate: row.invoiceDate.slice(0, 10),
          businessId: biz.id, businessName: biz.name, outstandingPaise: row.outstandingPaise,
        });
      }
    } else {
      const names = db.prepare("SELECT b.id AS id, s.name AS name FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id WHERE b.business_id = ?")
        .all(biz.id) as Array<{ id: string; name: string }>;
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      for (const row of repository.getPayables({ businessId: biz.id })) {
        if (row.documentType !== "BILL" || row.outstandingPaise <= 0) continue;
        out.push({
          kind: "BILL", id: row.documentId, number: row.documentNumber, partyName: nameOf.get(row.documentId) ?? "",
          date: row.documentDate.slice(0, 10), paiseDate: row.documentDate.slice(0, 10),
          businessId: biz.id, businessName: biz.name, outstandingPaise: row.outstandingPaise,
        });
      }
    }
  }
  return out;
}

/**
 * What this line could be matched to. Money in: the company's open INVOICES; money out: open BILLS.
 * Ranked: outstanding equal to the line first, then the party name or document number appearing in
 * the description / reference, then the nearest date. Plus already-posted journal lines of the same
 * signed amount. Needs the repository (open documents come from its receivables / payables).
 */
export function findMatches(ctx: ReviewContext, id: string): Matches {
  const repository = repositoryOf(ctx);
  const db = repository.db;
  const line = getStatementLine(db, id);
  requireForReview(line);
  const haystack = normaliseName(`${line.description} ${line.reference ?? ""}`);
  const target = Math.abs(line.amountPaise);
  const score = (d: OpenDocument): [number, number, number] => {
    const party = normaliseName(d.partyName);
    const number = normaliseName(d.number);
    const named = (party !== "" && haystack.includes(party)) || (number !== "" && haystack.includes(number));
    return [d.outstandingPaise === target ? 0 : 1, named ? 0 : 1, dayDistance(d.paiseDate, line.txnDate)];
  };
  const documents = openDocuments(repository, line)
    .map((d) => ({ d, s: score(d) }))
    .sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.s[2] - b.s[2] || a.d.number.localeCompare(b.d.number))
    .map(({ d }): DocumentMatch => ({
      kind: d.kind, id: d.id, number: d.number, partyName: d.partyName, date: d.date,
      businessId: d.businessId, businessName: d.businessName, outstandingPaise: d.outstandingPaise,
    }));
  const postedLines = candidateJournalLines(db, line, true)
    .sort((a, b) => dayDistance(a.entry_date, line.txnDate) - dayDistance(b.entry_date, line.txnDate) || a.id - b.id)
    .map(toPosted);
  return { documents, postedLines };
}

// ---- match ----------------------------------------------------------------------------------------------

/**
 * Match a line to documents (posts a payment per document: needs confirm) OR to journal lines already
 * posted (link only: nothing posts, no confirm needed). Exactly one of the two lists, non-empty.
 */
export function matchLine(ctx: ReviewContext, id: string, input: MatchLineInput): ReviewResult {
  const db = dbOf(ctx);
  const hasDocs = input.documents !== undefined && input.documents.length > 0;
  const hasLines = input.journalLineIds !== undefined && input.journalLineIds.length > 0;
  if (hasDocs === hasLines) {
    throw new RepositoryValidationError("Match to documents or to posted lines: send exactly one list, and it cannot be empty.");
  }
  if (hasLines) {
    return execute(db, id, false, () => matchPostedLines(db, id, input.journalLineIds as readonly number[]));
  }
  const repository = repositoryOf(ctx);
  return execute(db, id, input.confirm !== true, () => matchDocuments(repository, id, input.documents as readonly MatchDocumentInput[], input.paymentMode, input.confirmBackdatedMonth));
}

function matchDocuments(
  repository: AccountingRepository, id: string, documents: readonly MatchDocumentInput[], paymentMode: string | undefined,
  confirmBackdatedMonth?: boolean,
): void {
  const db = repository.db;
  const line = getStatementLine(db, id);
  requireForReview(line);
  const moneyIn = line.amountPaise > 0;
  const open = new Map(openDocuments(repository, line).map((d) => [`${d.kind}:${d.id}`, d]));
  const seen = new Set<string>();
  let sum = 0;
  const businesses = new Set<string>();
  const chosen: Array<{ doc: OpenDocument; amountPaise: number }> = [];
  for (const entry of documents) {
    if (entry.kind !== "INVOICE" && entry.kind !== "BILL") {
      throw new RepositoryValidationError("A document is an INVOICE or a BILL.");
    }
    if (moneyIn && entry.kind !== "INVOICE") {
      throw new RepositoryValidationError("Money coming in can only be matched to invoices; a bill is paid with money going out.");
    }
    if (!moneyIn && entry.kind !== "BILL") {
      throw new RepositoryValidationError("Money going out can only be matched to bills; an invoice is paid with money coming in.");
    }
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) throw new RepositoryValidationError("The same document is listed twice; give it one amount.");
    seen.add(key);
    if (!Number.isSafeInteger(entry.amountPaise) || entry.amountPaise <= 0) {
      throw new RepositoryValidationError("Each amount must be a whole number of paise above zero.");
    }
    const doc = open.get(key);
    if (doc === undefined) {
      throw new RepositoryValidationError(`${entry.kind === "INVOICE" ? "Invoice" : "Bill"} ${entry.id} is not open for this company (not found, not finalized, already paid, or another company's).`);
    }
    if (entry.amountPaise > doc.outstandingPaise) {
      throw new RepositoryValidationError(
        `${doc.number}: ${rupees(entry.amountPaise)} is more than the ${rupees(doc.outstandingPaise)} still outstanding on it.`,
      );
    }
    sum += entry.amountPaise;
    businesses.add(doc.businessId);
    chosen.push({ doc, amountPaise: entry.amountPaise });
  }
  const target = Math.abs(line.amountPaise);
  if (sum !== target) {
    throw new RepositoryValidationError(
      `The documents add up to ${rupees(sum)} but the bank line is ${rupees(target)}. ${sum < target
        ? "Over-payment is not supported: match the line to more documents, or Add the line instead."
        : "Reduce the amounts so they add up to the bank line."}`,
    );
  }
  if (businesses.size !== 1) {
    throw new RepositoryValidationError("All the documents of one bank line must belong to the same business. Match them on separate lines.");
  }
  const businessId = [...businesses][0] as string;
  const links: Array<{ journalLineId: number; entryId: string; kind: LinkKind; documentId: string }> = [];
  for (const { doc, amountPaise } of chosen) {
    if (doc.kind === "INVOICE") {
      const payment = repository.recordPayment(doc.id, amountPaise, line.txnDate, {
        moneyAccount: line.accountCode, paymentMode, paymentReference: line.reference,
      }, { ...(confirmBackdatedMonth === true ? { confirmBackdatedMonth: true } : {}) });
      const entryId = `je-payment-${payment.id}`;
      links.push({ journalLineId: bankJournalLineId(db, entryId, line.accountCode), entryId, kind: "PAYMENT", documentId: payment.id });
    } else {
      const payment = repository.recordSupplierPayment({
        billId: doc.id, amountPaise, paidOn: line.txnDate,
        moneyAccount: line.accountCode, paymentMode, paymentReference: line.reference,
        ...(confirmBackdatedMonth === true ? { confirmBackdatedMonth: true } : {}),
      });
      const entryId = `je-supplier-payment-${payment.id}`;
      links.push({ journalLineId: bankJournalLineId(db, entryId, line.accountCode), entryId, kind: "SUPPLIER_PAYMENT", documentId: payment.id });
    }
  }
  for (const l of links) insertLink(db, line, l.journalLineId, l.entryId, l.kind, l.documentId, true);
  setStatus(db, id, "MATCHED", businessId);
  audit(db, "BANK_LINE_MATCHED", line, {
    beforeValues: { status: line.status },
    afterValues: {
      status: "MATCHED", posted: true,
      documents: chosen.map((c) => ({ kind: c.doc.kind, id: c.doc.id, number: c.doc.number, amountPaise: c.amountPaise })),
    },
  });
}

function matchPostedLines(db: Database.Database, id: string, journalLineIds: readonly number[]): void {
  const line = getStatementLine(db, id);
  requireForReview(line);
  if (new Set(journalLineIds).size !== journalLineIds.length) {
    throw new RepositoryValidationError("A journal line is listed twice.");
  }
  const available = new Map(candidateJournalLines(db, line, false).map((r) => [r.id, r]));
  const chosen: CandidateRow[] = [];
  let sum = 0;
  for (const jid of journalLineIds) {
    const linked = db
      .prepare("SELECT line_id FROM bank_statement_line_links WHERE journal_line_id = ?")
      .get(jid) as { line_id: string } | undefined;
    if (linked !== undefined) {
      throw new RepositoryValidationError(`Journal line ${jid} is already matched to another bank line. A line can be matched only once.`);
    }
    const row = available.get(jid);
    if (row === undefined) {
      throw new RepositoryValidationError(
        `Journal line ${jid} cannot be matched to this bank line: it must be on ${line.accountCode} in this company, in the same direction, dated within 30 days before to 5 days after ${line.txnDate}, not cancelled and not in a finished reconciliation.`,
      );
    }
    sum += row.signed;
    chosen.push(row);
  }
  if (sum !== line.amountPaise) {
    throw new RepositoryValidationError(
      `The chosen journal lines add up to ${rupees(sum)} but the bank line is ${rupees(line.amountPaise)}. They must add up to the same signed amount.`,
    );
  }
  for (const row of chosen) insertLink(db, line, row.id, row.entry_id, "EXISTING", null, false);
  const allTransfers = chosen.every((r) => r.source_type === "INTERNAL_TRANSFER");
  const status: StatementLineStatus = allTransfers ? "TRANSFERRED" : "MATCHED";
  setStatus(db, id, status);
  audit(db, "BANK_LINE_MATCHED", line, {
    beforeValues: { status: line.status },
    afterValues: { status, posted: false, journalLineIds: chosen.map((r) => r.id) },
  });
}

// ---- exclude / undo ---------------------------------------------------------------------------------------

/** Exclude: the line is not for the books (for example a duplicate of another line). Posts nothing. */
export function excludeLine(ctx: ReviewContext, id: string, reason?: string): StatementLine {
  const db = dbOf(ctx);
  return db.transaction(() => {
    const line = getStatementLine(db, id);
    requireForReview(line);
    setStatus(db, id, "EXCLUDED");
    const why = reason?.trim();
    audit(db, "BANK_LINE_EXCLUDED", line, {
      beforeValues: { status: line.status },
      afterValues: { status: "EXCLUDED" },
      ...(why === undefined || why === "" ? {} : { reason: why }),
    });
    return getStatementLine(db, id);
  })();
}

function assertNotReconciled(db: Database.Database, links: readonly StatementLineLink[]): void {
  const stmt = db.prepare(
    `SELECT r.status AS status, r.statement_end_date AS statement_end_date
       FROM bank_reconciliation_lines t JOIN bank_reconciliations r ON r.id = t.reconciliation_id
      WHERE t.journal_line_id = ? AND r.status IN ('IN_PROGRESS', 'FINISHED')
      ORDER BY r.status = 'FINISHED' DESC LIMIT 1`,
  );
  for (const link of links) {
    const hit = stmt.get(link.journalLineId) as { status: string; statement_end_date: string } | undefined;
    if (hit !== undefined) {
      throw new RepositoryValidationError(
        hit.status === "FINISHED"
          ? `This line is part of the finished reconciliation for the statement dated ${hit.statement_end_date}. Undo that reconciliation first.`
          : `This line is ticked in the reconciliation in progress for the statement dated ${hit.statement_end_date}. Untick it first.`,
      );
    }
  }
}

/**
 * Undo: any resolved line goes back to FOR_REVIEW. Entries the feed posted are cancelled through their
 * own door (reversal, never an edit): a reason and confirm are required. Links only: just unlinked.
 * Refused while a linked journal line is ticked in an in-progress reconciliation or is part of a
 * finished one.
 */
export function undoLine(ctx: ReviewContext, id: string, input: { reason?: string | undefined; confirm?: boolean | undefined } = {}): ReviewResult {
  const db = dbOf(ctx);
  const first = getStatementLine(db, id);
  if (first.status === "FOR_REVIEW") {
    throw new RepositoryValidationError("This bank line is already FOR_REVIEW; there is nothing to undo.");
  }
  const posted = linksOfLine(db, id).some((l) => l.postedByFeed);
  const work = (): void => {
    const line = getStatementLine(db, id);
    const links = linksOfLine(db, id);
    assertNotReconciled(db, links);
    const reason = input.reason?.trim() ?? "";
    if (posted && reason === "") {
      throw new RepositoryValidationError("A reason is required to undo a line that was posted to the books.");
    }
    // Unlink FIRST: every cancel door refuses an entry that is still matched to a bank line
    // (assertNotOnBankLine), so that no other screen can leave this line pointing at cancelled money.
    db.prepare("DELETE FROM bank_statement_line_links WHERE line_id = ?").run(id);
    const cancelled = new Set<string>();
    for (const link of links) {
      if (!link.postedByFeed || link.documentId === null) continue;
      const key = `${link.linkKind}:${link.documentId}`;
      if (cancelled.has(key)) continue;
      cancelled.add(key);
      if (link.linkKind === "VOUCHER") cancelVoucher(db, link.documentId, reason);
      else if (link.linkKind === "INTERNAL_TRANSFER") cancelInternalTransfer(db, link.documentId, reason);
      else if (link.linkKind === "PAYMENT") repositoryOf(ctx).cancelPayment(link.documentId, reason);
      else if (link.linkKind === "SUPPLIER_PAYMENT") repositoryOf(ctx).cancelSupplierPayment(link.documentId, reason);
    }
    setStatus(db, id, "FOR_REVIEW");
    audit(db, "BANK_LINE_UNDONE", line, {
      beforeValues: {
        status: line.status,
        links: links.map((l) => ({ journalLineId: l.journalLineId, journalEntryId: l.journalEntryId, linkKind: l.linkKind, documentId: l.documentId, postedByFeed: l.postedByFeed })),
      },
      afterValues: { status: "FOR_REVIEW", cancelledDocuments: [...cancelled] },
      ...(reason === "" ? {} : { reason }),
    });
  };
  return execute(db, id, posted && input.confirm !== true, work);
}

// ---- the queue --------------------------------------------------------------------------------------------

/** The lines of one account (default FOR_REVIEW), oldest first, each with its links and bank-rule suggestion. */
export function listReviewQueue(
  ctx: ReviewContext,
  filter: { companyId: string; accountCode: string; status?: StatementLineStatus | undefined },
  suggest?: ((line: StatementLine) => LineSuggestion | null) | undefined,
): ReviewQueueEntry[] {
  const db = dbOf(ctx);
  return listStatementLines(db, { companyId: filter.companyId, accountCode: filter.accountCode, status: filter.status ?? "FOR_REVIEW" })
    .map((line) => ({ line, links: linksOfLine(db, line.id), suggestion: suggest === undefined ? null : suggest(line) }));
}
