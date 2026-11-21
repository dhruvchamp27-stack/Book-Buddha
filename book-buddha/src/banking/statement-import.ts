import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";
import {
  CodecError,
  normaliseName,
  parseDate,
  parseRupeesToPaise,
  parseTabular,
  type DateFormat,
  type ParsedTabular,
} from "../import-export/codec.js";
import { stripFormulaGuard } from "../import-export/import-engine.js";
import { assertMoneyAccount, companyOfBusiness } from "./money-accounts.js";
import { fingerprintOf, insertStatementLine } from "./statement-lines.js";

/**
 * R12e: read a bank statement file (CSV or JSON) for ONE bank account and hold its lines in the
 * review queue as FOR_REVIEW. Nothing enters the books: this file posts no journal entry.
 *
 * SIGN WARNING. A bank statement's "Debit" / "Withdrawal" column is money OUT of the bank account,
 * which is stored here as a NEGATIVE amount. In the books' own language a bank debit is the
 * opposite (money IN). On a statement, "Credit" / "Deposit" is money IN = POSITIVE. This module
 * always speaks the statement's language.
 *
 * Reuses the R10 codec (CSV/JSON reading, rupee parsing, date parsing) and the same shape as the R10
 * engine: inspect, then preview (the commit path inside a transaction that always rolls back), then commit.
 */

export const STATEMENT_FIELDS = ["date", "description", "amount", "direction", "withdrawal", "deposit", "reference", "balance"] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];
/** { field: header name in the file }. */
export type StatementColumnMap = Partial<Record<StatementField, string>>;

const SAMPLE_ROWS = 10;

// ------------------------------------------------------------------ inspect

const SYNONYMS: Record<StatementField, readonly string[]> = {
  date: ["Date", "Txn Date", "Transaction Date", "Tran Date"],
  description: ["Narration", "Description", "Particulars", "Remarks", "Details"],
  reference: ["Chq./Ref.No.", "Ref No", "Cheque No", "Reference", "UTR"],
  withdrawal: ["Withdrawal Amt.", "Withdrawal", "Debit", "Debit Amount"],
  deposit: ["Deposit Amt.", "Deposit", "Credit", "Credit Amount"],
  balance: ["Closing Balance", "Balance"],
  amount: ["Amount"],
  direction: ["Dr/Cr", "Cr/Dr", "Type"],
};

export interface StatementInspection {
  readonly format: "CSV" | "JSON";
  readonly encoding: string;
  readonly delimiter: string | null;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly sampleRows: ReadonlyArray<{ rowNumber: number; cells: readonly string[] }>;
  readonly suggestedMap: StatementColumnMap;
}

function readFile(fileName: string, bytes: Uint8Array): ParsedTabular {
  try {
    return parseTabular({ fileName, bytes });
  } catch (error) {
    if (error instanceof CodecError) throw new RepositoryValidationError(`${fileName}: ${error.message}`);
    throw error;
  }
}

export function suggestStatementMap(headers: readonly string[]): StatementColumnMap {
  const taken = new Set<string>();
  const map: Record<string, string> = {};
  for (const field of STATEMENT_FIELDS) {
    const wanted = new Set(SYNONYMS[field].map(normaliseName));
    const header = headers.find((h) => !taken.has(h) && wanted.has(normaliseName(h)));
    if (header !== undefined) {
      map[field] = header;
      taken.add(header);
    }
  }
  return map as StatementColumnMap;
}

export function inspectStatement(input: { fileName: string; bytes: Uint8Array }): StatementInspection {
  const parsed = readFile(input.fileName, input.bytes);
  return {
    format: parsed.format,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter,
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    sampleRows: parsed.rows.slice(0, SAMPLE_ROWS).map((r) => ({ rowNumber: r.rowNumber, cells: r.cells })),
    suggestedMap: suggestStatementMap(parsed.headers),
  };
}

// -------------------------------------------------------------------- dates

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The codec's three layouts, plus DD/MM/YY (-> 20YY) and DD-MMM-YYYY / DD MMM YYYY. */
export function parseStatementDate(text: string, format: DateFormat): string {
  const s = text.trim();
  const twoDigitYear = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(s);
  if (twoDigitYear) {
    return parseDate(`${twoDigitYear[1]}/${twoDigitYear[2]}/20${twoDigitYear[3]}`, "DD/MM/YYYY");
  }
  const named = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(s);
  if (named) {
    const month = MONTHS.indexOf((named[2] ?? "").slice(0, 3).toLowerCase());
    if (month < 0) throw new CodecError(`"${s}" has an unknown month name "${named[2]}".`);
    return parseDate(`${named[1]}/${month + 1}/${named[3]}`, "DD/MM/YYYY");
  }
  return parseDate(s, format);
}

// ------------------------------------------------------------------ amounts

/** A signed amount cell; a trailing Dr/Cr (any case) sets the direction. Dr = out (negative). */
function parseSignedCell(cell: string): number {
  const s = cell.trim();
  const suffix = /^(.*?)\s*(dr|cr)\.?$/i.exec(s);
  if (suffix && (suffix[1] ?? "") !== "") {
    const magnitude = Math.abs(parseRupeesToPaise(suffix[1] ?? "", { allowNegative: true }));
    return (suffix[2] ?? "").toLowerCase() === "dr" ? -magnitude : magnitude;
  }
  return parseRupeesToPaise(s, { allowNegative: true });
}

const OUT_WORDS = new Set(["DR", "DEBIT", "D", "WITHDRAWAL"]);
const IN_WORDS = new Set(["CR", "CREDIT", "C", "DEPOSIT"]);

type Layout = "SIGNED" | "AMOUNT_DIRECTION" | "WITHDRAWAL_DEPOSIT";

function chooseLayout(map: StatementColumnMap): Layout {
  const hasAmount = map.amount !== undefined;
  const hasSplit = map.withdrawal !== undefined || map.deposit !== undefined;
  if (hasAmount && hasSplit) {
    throw new RepositoryValidationError("Map either one Amount column or Withdrawal/Deposit columns, not both.");
  }
  if (hasAmount) return map.direction !== undefined ? "AMOUNT_DIRECTION" : "SIGNED";
  if (map.direction !== undefined) {
    throw new RepositoryValidationError("A Direction column needs an Amount column too.");
  }
  if (hasSplit) return "WITHDRAWAL_DEPOSIT";
  throw new RepositoryValidationError("Map the amount: an Amount column, or Withdrawal and/or Deposit columns.");
}

// --------------------------------------------------------------------- run

export type StatementOutcomeStatus = "ADDED" | "DUPLICATE" | "FAILED";
export type StatementOrder = "OLDEST_FIRST" | "NEWEST_FIRST" | "UNKNOWN";

export interface StatementOutcome {
  readonly rowNumber: number;
  readonly status: StatementOutcomeStatus;
  readonly message?: string;
  readonly txnDate?: string;
  readonly amountPaise?: number;
  readonly description?: string;
}

export interface StatementImportResult {
  readonly mode: "PREVIEW" | "COMMIT";
  readonly rowsInFile: number;
  readonly added: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly outcomes: StatementOutcome[];
  /** Sum of the ADDED lines that are money in / out (out as a positive number). */
  readonly totalInPaise: number;
  readonly totalOutPaise: number;
  readonly order: StatementOrder;
  /** File rows whose running balance does not follow from the row before (warnings only). */
  readonly balanceBreaks: number[];
  /** The import row written by a commit; null for a preview. */
  readonly importId: string | null;
}

export interface StatementImportInput {
  readonly companyId: string;
  readonly accountCode: string;
  readonly businessId?: string | null | undefined;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly columnMap: Readonly<Record<string, string>>;
  readonly dateFormat: DateFormat;
}

interface GoodRow {
  readonly rowNumber: number;
  readonly txnDate: string;
  readonly description: string;
  readonly reference: string | null;
  readonly amountPaise: number;
  readonly balancePaise: number | null;
}
interface BadRow { readonly rowNumber: number; readonly message: string; readonly description?: string }

class PreviewRollback extends Error {
  public readonly result: StatementImportResult;
  public constructor(result: StatementImportResult) {
    super("preview rollback");
    this.result = result;
  }
}

export function previewStatement(db: Database.Database, input: StatementImportInput): StatementImportResult {
  return run(db, input, "PREVIEW");
}

export function commitStatement(db: Database.Database, input: StatementImportInput): StatementImportResult {
  return run(db, input, "COMMIT");
}

function run(db: Database.Database, input: StatementImportInput, mode: "PREVIEW" | "COMMIT"): StatementImportResult {
  const { companyId, accountCode } = input;
  const company = db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId);
  if (company === undefined) throw new RepositoryValidationError(`Company ${companyId} was not found.`);
  const account = assertMoneyAccount(db, accountCode, companyId);
  if (account.role !== "BANK") {
    throw new RepositoryValidationError(`${account.name} is a cash account; only a bank account has a statement.`);
  }
  const businessId = input.businessId === undefined || input.businessId === null || input.businessId === "" ? null : input.businessId;
  if (businessId !== null && companyOfBusiness(db, businessId) !== companyId) {
    throw new RepositoryValidationError("That business belongs to another company.");
  }

  const parsed = readFile(input.fileName, input.bytes);
  const map = validateMap(parsed.headers, input.columnMap);
  const layout = chooseLayout(map);
  const index = (field: StatementField): number => (map[field] === undefined ? -1 : parsed.headers.indexOf(map[field] as string));
  const col = {
    date: index("date"), description: index("description"), amount: index("amount"), direction: index("direction"),
    withdrawal: index("withdrawal"), deposit: index("deposit"), reference: index("reference"), balance: index("balance"),
  };
  const cell = (cells: readonly string[], i: number): string => (i < 0 ? "" : stripFormulaGuard((cells[i] ?? "").trim()));

  // 1. Read every row: good or failed, never stops.
  const good: GoodRow[] = [];
  const bad: BadRow[] = [];
  for (const row of parsed.rows) {
    const description = cell(row.cells, col.description);
    try {
      if (cell(row.cells, col.date) === "") throw new CodecError("The date is blank.");
      const txnDate = parseStatementDate(cell(row.cells, col.date), input.dateFormat);
      if (description === "") throw new CodecError("The description is blank.");
      const amountPaise = readAmount(layout, row.cells, col, cell);
      let balancePaise: number | null = null;
      const balanceText = cell(row.cells, col.balance);
      if (balanceText !== "") {
        try { balancePaise = parseSignedCell(balanceText); } catch { balancePaise = null; }
      }
      const reference = cell(row.cells, col.reference);
      good.push({ rowNumber: row.rowNumber, txnDate, description, reference: reference === "" ? null : reference, amountPaise, balancePaise });
    } catch (error) {
      if (!(error instanceof CodecError)) throw error;
      bad.push({ rowNumber: row.rowNumber, message: error.message, ...(description === "" ? {} : { description }) });
    }
  }

  // 2. Order and balance check.
  const { order, breaks } = checkBalances(good);

  // 3. Duplicates, in file order: the k-th occurrence of a fingerprint in this file is a duplicate
  //    when the account already holds at least k lines with it (any status).
  const heldCache = new Map<string, number>();
  const seenInFile = new Map<string, number>();
  const count = db.prepare("SELECT COUNT(*) AS n FROM bank_statement_lines WHERE company_id = ? AND account_code = ? AND fingerprint = ?");
  const fresh: GoodRow[] = [];
  const outcomes: StatementOutcome[] = [];
  for (const row of good) {
    const fingerprint = fingerprintOf({ accountCode, ...row });
    let held = heldCache.get(fingerprint);
    if (held === undefined) {
      held = (count.get(companyId, accountCode, fingerprint) as { n: number }).n;
      heldCache.set(fingerprint, held);
    }
    const k = (seenInFile.get(fingerprint) ?? 0) + 1;
    seenInFile.set(fingerprint, k);
    const shown = { txnDate: row.txnDate, amountPaise: row.amountPaise, description: row.description };
    if (held >= k) {
      outcomes.push({ rowNumber: row.rowNumber, status: "DUPLICATE", message: "Already imported.", ...shown });
    } else {
      fresh.push(row);
      outcomes.push({ rowNumber: row.rowNumber, status: "ADDED", ...shown });
    }
  }
  for (const b of bad) {
    outcomes.push({ rowNumber: b.rowNumber, status: "FAILED", message: b.message, ...(b.description === undefined ? {} : { description: b.description }) });
  }
  outcomes.sort((a, b) => a.rowNumber - b.rowNumber);

  const duplicates = outcomes.filter((o) => o.status === "DUPLICATE").length;
  const result: StatementImportResult = {
    mode,
    rowsInFile: parsed.rows.length,
    added: fresh.length,
    duplicates,
    failed: bad.length,
    outcomes,
    totalInPaise: fresh.filter((r) => r.amountPaise > 0).reduce((sum, r) => sum + r.amountPaise, 0),
    totalOutPaise: fresh.filter((r) => r.amountPaise < 0).reduce((sum, r) => sum - r.amountPaise, 0),
    order,
    balanceBreaks: breaks,
    importId: null,
  };

  // 4. Write inside a transaction. A preview throws at the end so everything rolls back.
  const chronological = order === "NEWEST_FIRST" ? [...fresh].reverse() : fresh;
  try {
    return db.transaction((): StatementImportResult => {
      const importId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO bank_statement_imports
           (id, company_id, account_code, file_name, default_business_id, rows_in_file, lines_added, lines_skipped, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(importId, companyId, accountCode, input.fileName, businessId, result.rowsInFile, result.added, duplicates + bad.length, now);
      for (const row of chronological) {
        insertStatementLine(db, {
          companyId, accountCode, importId, rowNumber: row.rowNumber, txnDate: row.txnDate, description: row.description,
          reference: row.reference, amountPaise: row.amountPaise, balancePaise: row.balancePaise, businessId,
        });
      }
      appendAuditEvent(db, {
        action: "BANK_STATEMENT_IMPORTED",
        entityId: importId,
        entityType: "bank_statement_import",
        companyId,
        occurredAt: now,
        afterValues: {
          accountCode, fileName: input.fileName, rowsInFile: result.rowsInFile, added: result.added,
          duplicates, failed: bad.length, businessId,
        },
      });
      const final: StatementImportResult = { ...result, importId: mode === "COMMIT" ? importId : null };
      if (mode === "PREVIEW") throw new PreviewRollback(final);
      return final;
    })();
  } catch (error) {
    if (error instanceof PreviewRollback) return error.result;
    throw error;
  }
}

function validateMap(headers: readonly string[], columnMap: Readonly<Record<string, string>>): StatementColumnMap {
  const problems: string[] = [];
  const fields = new Set<string>(STATEMENT_FIELDS);
  for (const [key, header] of Object.entries(columnMap)) {
    if (!fields.has(key)) problems.push(`"${key}" is not a statement field`);
    else if (!headers.includes(header)) problems.push(`the column "${header}" (for ${key}) is not in the file`);
  }
  if (columnMap.date === undefined) problems.push("a Date column must be mapped");
  if (columnMap.description === undefined) problems.push("a Description column must be mapped");
  if (problems.length > 0) throw new RepositoryValidationError(`The column map is not usable: ${problems.join("; ")}.`);
  return columnMap as StatementColumnMap;
}

function readAmount(
  layout: Layout,
  cells: readonly string[],
  col: { amount: number; direction: number; withdrawal: number; deposit: number },
  cell: (cells: readonly string[], i: number) => string,
): number {
  if (layout === "SIGNED") {
    const text = cell(cells, col.amount);
    if (text === "") throw new CodecError("The amount is blank.");
    const paise = parseSignedCell(text);
    if (paise === 0) throw new CodecError("The amount is zero.");
    return paise;
  }
  if (layout === "AMOUNT_DIRECTION") {
    const text = cell(cells, col.amount);
    if (text === "") throw new CodecError("The amount is blank.");
    const magnitude = Math.abs(parseSignedCell(text));
    if (magnitude === 0) throw new CodecError("The amount is zero.");
    const word = cell(cells, col.direction).toUpperCase().replace(/\.$/, "");
    if (OUT_WORDS.has(word)) return -magnitude;
    if (IN_WORDS.has(word)) return magnitude;
    throw new CodecError(`"${cell(cells, col.direction)}" is not a direction; use Dr or Cr.`);
  }
  const wdText = cell(cells, col.withdrawal);
  const depText = cell(cells, col.deposit);
  const wd = wdText === "" ? 0 : parseRupeesToPaise(wdText);
  const dep = depText === "" ? 0 : parseRupeesToPaise(depText);
  if (wd !== 0 && dep !== 0) throw new CodecError("Both a withdrawal and a deposit are filled; a line is one or the other.");
  if (wd === 0 && dep === 0) throw new CodecError("Neither a withdrawal nor a deposit has an amount.");
  return wd !== 0 ? -wd : dep;
}

/**
 * Checks the running balance in file order and in reverse. The direction that holds sets `order`;
 * rows where neither holds are reported as breaks (warnings only). Only rows with an amount and a
 * balance take part; failed rows are skipped.
 */
function checkBalances(rows: readonly GoodRow[]): { order: StatementOrder; breaks: number[] } {
  const withBalance = rows.filter((r) => r.balancePaise !== null);
  if (withBalance.length < 2) return { order: "UNKNOWN", breaks: [] };
  const forward: number[] = [];
  const reverse: number[] = [];
  for (let i = 1; i < withBalance.length; i += 1) {
    const prev = withBalance[i - 1] as GoodRow;
    const row = withBalance[i] as GoodRow;
    // Oldest first: this row's balance = the previous row's balance + this row's amount.
    if ((prev.balancePaise as number) + row.amountPaise !== row.balancePaise) forward.push(row.rowNumber);
    // Newest first: the previous (newer) row's balance = this (older) row's balance + the newer row's amount.
    if ((row.balancePaise as number) + prev.amountPaise !== prev.balancePaise) reverse.push(prev.rowNumber);
  }
  const pairs = withBalance.length - 1;
  if (forward.length < reverse.length && forward.length < pairs) return { order: "OLDEST_FIRST", breaks: forward };
  if (reverse.length < forward.length && reverse.length < pairs) return { order: "NEWEST_FIRST", breaks: reverse };
  return { order: "UNKNOWN", breaks: [] };
}

// ------------------------------------------------------------------ history

export interface StatementImportRecord {
  readonly id: string;
  readonly companyId: string;
  readonly accountCode: string;
  readonly fileName: string;
  readonly defaultBusinessId: string | null;
  readonly rowsInFile: number;
  readonly linesAdded: number;
  readonly linesSkipped: number;
  readonly importedAt: string;
}

/** Imports of one account, newest first. */
export function listStatementImports(db: Database.Database, companyId: string, accountCode: string): StatementImportRecord[] {
  const rows = db
    .prepare("SELECT * FROM bank_statement_imports WHERE company_id = ? AND account_code = ? ORDER BY imported_at DESC, rowid DESC")
    .all(companyId, accountCode) as Array<{
      id: string; company_id: string; account_code: string; file_name: string; default_business_id: string | null;
      rows_in_file: number; lines_added: number; lines_skipped: number; imported_at: string;
    }>;
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    accountCode: r.account_code,
    fileName: r.file_name,
    defaultBusinessId: r.default_business_id,
    rowsInFile: r.rows_in_file,
    linesAdded: r.lines_added,
    linesSkipped: r.lines_skipped,
    importedAt: r.imported_at,
  }));
}
