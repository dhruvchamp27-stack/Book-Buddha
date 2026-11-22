import type Database from "better-sqlite3";
import { taxGroupsFor, type TaxGroup } from "../accounting/engine.js";
import { ROUND_OFF_ACCOUNT } from "./chart-accounts-schema.js";
import { RepositoryValidationError } from "./errors.js";
import { assertReportFairExists, reportConditions } from "./report-filters-sql.js";

/**
 * R7 part one: the sales and credit-note reports (spec section 13).
 *
 * Every function takes a `better-sqlite3` handle first, so it can be wired into the repository and
 * the HTTP API without this file touching either. All are ACCRUAL ONLY: a cash-basis figure would
 * have to call `AccountingRepository.deriveCashView`, which needs the repository, and writing a
 * second proportional formula is exactly how defects S3-4 and S3-5 happened.
 *
 * HOW SALES ARE READ. From the POSTED JOURNAL, never from invoice lines, so a report and the ledger
 * cannot disagree (the way getReceivables reads credit notes):
 *   - "sales" = the lines of any account whose chart_accounts.type is INCOME - never a list of
 *     codes, so an income account the user creates is counted;
 *   - "GST" = the lines of any account whose chart_accounts.role is OUTPUT_GST;
 *   - an entry belongs to a credit note when its id starts `je-credit-note-` (the same test
 *     getReceivables uses). That prefix deliberately includes a cancelled note's reversal, so a
 *     cancelled note nets back to nothing with no special case.
 *   - the invoice ROUND-OFF account (an INCOME account, I-Q11) is left out of every sales figure BY
 *     CODE, through `ROUND_OFF_ACCOUNT`, so a rounding is never reported as a sale;
 *   - everything is dated and filtered on journal_entries.entry_date (the transaction date),
 *     never on created_at (the posting timestamp).
 *
 * FILTERS are applied in SQL. `reportConditions` (alias `je`) supplies business, fair and dates;
 * customer and item are added here as further bound conditions in the same shape.
 */

export interface SalesReportFilter {
  readonly businessId?: string;
  readonly fairId?: string;
  readonly customerId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface SalesTotals {
  readonly invoicedPaise: number;
  readonly creditNotesPaise: number;
  /** Invoiced less credit notes. */
  readonly netSalesPaise: number;
  /** Distinct FINALIZED invoices with sales posted in the period. */
  readonly invoiceCount: number;
  /** Distinct FINALIZED credit notes dated in the period. */
  readonly creditNoteCount: number;
}

export interface SalesByCustomerRow extends SalesTotals { readonly customerId: string | null; readonly customerName: string }
export interface SalesByBusinessRow extends SalesTotals { readonly businessId: string | null; readonly businessName: string }
export interface SalesByFairRow extends SalesTotals { readonly fairId: string | null; readonly fairName: string }
export interface SalesByTaxRow extends SalesTotals {
  /** NONE, CGST_SGST, IGST (an invoice with a zero rate is NONE) or UNATTRIBUTED (no invoice behind the entry). */
  readonly taxType: string;
  readonly taxRateBasisPoints: number;
  readonly taxInvoicedPaise: number;
  readonly taxCreditNotesPaise: number;
  /** GST kept: invoiced less credit notes. This is the figure that ties to a GST return. */
  readonly taxPaise: number;
}
export interface SalesReport<Row> { readonly rows: readonly Row[]; readonly totals: SalesTotals }

/** Credit notes and returns are per item, so the item filter is meaningful here (and only here). */
export interface CreditNoteReportFilter extends SalesReportFilter { readonly itemId?: string }

export interface CreditNoteReportRow {
  readonly creditNoteId: string;
  readonly number: string;
  readonly status: string;
  /** The note's journal date: when it was FINALIZED (S4-8), not when the draft was saved. */
  readonly date: string;
  readonly reason: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly businessId: string | null;
  readonly fairId: string | null;
  readonly taxablePaise: number;
  readonly taxPaise: number;
  /** Everything the note takes off the books, GST included. */
  readonly valuePaise: number;
  /** The part set against what the customer still owed on the bill (value less refundable_paise). */
  readonly offsetPaise: number;
  /** The part that was NOT owed on the bill, fixed at finalize time and read as stored. */
  readonly refundablePaise: number;
  readonly refundedPaise: number;
  readonly appliedPaise: number;
  /** Refundable less refunded less applied; always 0 for a cancelled note (as getCreditNoteBalance). */
  readonly outstandingPaise: number;
}
export interface CreditNoteReport {
  readonly rows: readonly CreditNoteReportRow[];
  /** Cancelled notes are listed but left out of the totals: their entries were reversed. */
  readonly totals: {
    readonly valuePaise: number;
    readonly offsetPaise: number;
    readonly refundedPaise: number;
    readonly appliedPaise: number;
    readonly outstandingPaise: number;
  };
}

export interface SalesReturnRow {
  readonly creditNoteId: string;
  readonly creditNoteNumber: string;
  readonly date: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly itemId: string | null;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitPricePaise: number;
  /** quantity x unit price, before GST. */
  readonly valuePaise: number;
}
export interface SalesReturnByItemRow {
  readonly itemId: string | null;
  readonly itemName: string;
  readonly quantity: number;
  readonly valuePaise: number;
  readonly creditNoteCount: number;
}
export interface SalesReturnReport {
  readonly rows: readonly SalesReturnRow[];
  readonly byItem: readonly SalesReturnByItemRow[];
  readonly totalValuePaise: number;
}

/**
 * The item filter is only honest where a row is per item. The journal has no item dimension, and an
 * item-filtered sales figure would need an invented rule for spreading an invoice's discount, extra
 * charge and GST across its lines - so these reports refuse it rather than quietly ignore it.
 */
function refuseItemFilter(reportName: string, filter: object): void {
  if ((filter as { itemId?: unknown }).itemId !== undefined) {
    throw new RepositoryValidationError(
      `${reportName} cannot be filtered by item: sales are posted per invoice, not per item. Use the sales-by-item or returns report.`,
    );
  }
}

/**
 * reportConditions (business, fair, dates - all on `je`) plus extra fixed conditions and their
 * parameters, in that order. reportConditions validates the dates, so none of that is repeated here.
 */
function withConditions(db: Database.Database, filter: SalesReportFilter, extras: ReadonlyArray<{ sql: string; param?: string }>): { where: string; params: string[] } {
  assertReportFairExists(db, filter.fairId);
  const base = reportConditions(filter);
  const sql = extras.map((extra) => extra.sql);
  const params = [...base.params, ...extras.flatMap((extra) => (extra.param === undefined ? [] : [extra.param]))];
  if (sql.length === 0) return { where: base.where, params };
  return { where: base.where === "" ? `WHERE ${sql.join(" AND ")}` : `${base.where} AND ${sql.join(" AND ")}`, params };
}

const IS_NOTE = "je.id LIKE 'je-credit-note-%'";

interface AggregateRow {
  group_id: string | null;
  group_name: string | null;
  tax_kind?: string;
  tax_rate_bp?: number;
  // salesByTax reads ONE ROW PER JOURNAL ENTRY so it can split each entry across its rate groups.
  inv_id?: string | null;
  note_id?: string | null;
  inv_tax_type?: string | null;
  inv_rate?: number | null;
  inv_discount?: number | null;
  inv_extra?: number | null;
  invoiced: number;
  credited: number;
  tax_invoiced: number;
  tax_credited: number;
  invoice_count: number;
  note_count: number;
}

function totalsOf(row: AggregateRow): SalesTotals {
  return {
    invoicedPaise: row.invoiced,
    creditNotesPaise: row.credited,
    netSalesPaise: row.invoiced - row.credited,
    invoiceCount: row.invoice_count,
    creditNoteCount: row.note_count,
  };
}

function sumTotals(rows: readonly SalesTotals[]): SalesTotals {
  const sum = (pick: (row: SalesTotals) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  return {
    invoicedPaise: sum((r) => r.invoicedPaise),
    creditNotesPaise: sum((r) => r.creditNotesPaise),
    netSalesPaise: sum((r) => r.netSalesPaise),
    invoiceCount: sum((r) => r.invoiceCount),
    creditNoteCount: sum((r) => r.creditNoteCount),
  };
}

/**
 * One aggregate over journal lines on income (and, for the tax report, output-GST) accounts. The
 * account class comes from a JOIN to chart_accounts. invoices is LEFT-joined so income that cannot
 * be traced to an invoice still lands in a row of its own instead of vanishing.
 */
function aggregate(
  db: Database.Database,
  filter: SalesReportFilter,
  shape: { select: string; joins: string; groupBy: string; orderBy: string; includeTax: boolean },
): AggregateRow[] {
  const extras: Array<{ sql: string; param?: string }> = [{ sql: "je.source_type = 'INVOICE'" }];
  if (filter.customerId !== undefined) extras.push({ sql: "i.customer_id = ?", param: filter.customerId });
  const { where, params } = withConditions(db, filter, extras);
  // I-Q11: the round-off account is INCOME but is a rounding, not a sale - out BY CODE, never a bare string.
  const notRoundOff = `ca.code <> '${ROUND_OFF_ACCOUNT}'`;
  const accountTest = shape.includeTax ? `(ca.type = 'INCOME' OR ca.role = 'OUTPUT_GST') AND ${notRoundOff}` : `ca.type = 'INCOME' AND ${notRoundOff}`;
  const sql = `
    SELECT ${shape.select},
           COALESCE(SUM(CASE WHEN ca.type = 'INCOME' AND NOT (${IS_NOTE}) THEN jl.credit_paise - jl.debit_paise ELSE 0 END), 0) AS invoiced,
           COALESCE(SUM(CASE WHEN ca.type = 'INCOME' AND ${IS_NOTE} THEN jl.debit_paise - jl.credit_paise ELSE 0 END), 0) AS credited,
           COALESCE(SUM(CASE WHEN ca.role = 'OUTPUT_GST' AND NOT (${IS_NOTE}) THEN jl.credit_paise - jl.debit_paise ELSE 0 END), 0) AS tax_invoiced,
           COALESCE(SUM(CASE WHEN ca.role = 'OUTPUT_GST' AND ${IS_NOTE} THEN jl.debit_paise - jl.credit_paise ELSE 0 END), 0) AS tax_credited,
           COUNT(DISTINCT CASE WHEN NOT (${IS_NOTE}) AND je.is_reversal = 0 AND i.status = 'FINALIZED' THEN i.id END) AS invoice_count,
           COUNT(DISTINCT CASE WHEN ${IS_NOTE} AND je.is_reversal = 0 AND cn.status = 'FINALIZED' THEN cn.id END) AS note_count
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_entry_id = je.id
      JOIN chart_accounts ca ON ca.code = jl.account AND ${accountTest}
      LEFT JOIN invoices i ON i.id = je.source_id
      LEFT JOIN credit_notes cn ON je.id = 'je-credit-note-' || cn.id
      ${shape.joins}
      ${where}
     GROUP BY ${shape.groupBy}
     ORDER BY ${shape.orderBy}`;
  return db.prepare(sql).all(...params) as AggregateRow[];
}

/** Net sales per customer: invoiced less credit notes, with invoice count. */
export function salesByCustomer(db: Database.Database, filter: SalesReportFilter = {}): SalesReport<SalesByCustomerRow> {
  refuseItemFilter("Sales by customer", filter);
  const rows = aggregate(db, filter, {
    select: "i.customer_id AS group_id, COALESCE(c.name, '(Unknown customer)') AS group_name",
    joins: "LEFT JOIN customers c ON c.id = i.customer_id",
    groupBy: "i.customer_id",
    orderBy: "i.customer_id IS NULL, group_name, i.customer_id",
    includeTax: false,
  }).map((row) => ({ customerId: row.group_id, customerName: row.group_name ?? "(Unknown customer)", ...totalsOf(row) }));
  return { rows, totals: sumTotals(rows) };
}

/** Net sales per business. */
export function salesByBusiness(db: Database.Database, filter: SalesReportFilter = {}): SalesReport<SalesByBusinessRow> {
  refuseItemFilter("Sales by business", filter);
  const rows = aggregate(db, filter, {
    select: "je.business_id AS group_id, COALESCE(b.name, '(No business)') AS group_name",
    joins: "LEFT JOIN businesses b ON b.id = je.business_id",
    groupBy: "je.business_id",
    orderBy: "je.business_id IS NULL, group_name, je.business_id",
    includeTax: false,
  }).map((row) => ({ businessId: row.group_id, businessName: row.group_name ?? "(No business)", ...totalsOf(row) }));
  return { rows, totals: sumTotals(rows) };
}

/** Net sales per fair, with sales that carry no fair shown as their own "(No fair)" row, last. */
export function salesByFair(db: Database.Database, filter: SalesReportFilter = {}): SalesReport<SalesByFairRow> {
  refuseItemFilter("Sales by fair", filter);
  const rows = aggregate(db, filter, {
    select: "je.fair_id AS group_id, COALESCE(f.name, '(No fair)') AS group_name",
    joins: "LEFT JOIN fairs f ON f.id = je.fair_id",
    groupBy: "je.fair_id",
    orderBy: "je.fair_id IS NULL, group_name, je.fair_id",
    includeTax: false,
  }).map((row) => ({ fairId: row.group_id, fairName: row.group_name ?? "(No fair)", ...totalsOf(row) }));
  return { rows, totals: sumTotals(rows) };
}

/** Splits a signed total over weights in whole paise (largest remainder, ties to the earlier), so the parts sum exactly. */
function allocateByWeight(total: number, weights: readonly number[]): number[] {
  const parts = weights.map(() => 0);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0 || parts.length === 0) return parts;
  if (weightSum <= 0) { parts[0] = total; return parts; }
  const magnitude = Math.abs(total);
  const sign = total < 0 ? -1 : 1;
  const remainders: Array<{ index: number; remainder: bigint }> = [];
  let assigned = 0;
  weights.forEach((weight, index) => {
    const product = BigInt(magnitude) * BigInt(Math.max(weight, 0));
    const share = Number(product / BigInt(weightSum));
    parts[index] = share;
    assigned += share;
    remainders.push({ index, remainder: product % BigInt(weightSum) });
  });
  remainders.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; i < magnitude - assigned; i += 1) {
    const target = remainders[i % remainders.length] as { index: number };
    parts[target.index] = (parts[target.index] as number) + 1;
  }
  return parts.map((part) => sign * part);
}

/** The signed entry total over the groups: exactly each group's own figure when they add up, else by taxable share. */
function allocateAcross(total: number, exact: readonly number[], weights: readonly number[]): number[] {
  if (total === 0) return exact.map(() => 0);
  if (Math.abs(total) === exact.reduce((sum, part) => sum + part, 0)) return exact.map((part) => Math.sign(total) * part);
  return allocateByWeight(total, weights);
}

/**
 * Net sales and GST kept, per tax treatment (type and rate). Both come from the journal, so
 * `taxPaise` summed over the rows equals the P&L's GST-on-sales for the same filter.
 *
 * I-2 (I-Q1, I-Q9). A document can now hold several rates, and the journal line carries no rate tag,
 * so each posted ENTRY is split across its document's RATE GROUPS (worked out from the document's
 * own lines by the same engine that posted it) and the entry's real journal figures are allocated
 * over them - exactly where they add up, else by taxable share (a clamped credit-note tax). An
 * exempt 0% line therefore lands in its own `NONE / 0` row. For a single-rate document there is one
 * group and every figure is the journal's, unchanged.
 */
export function salesByTax(db: Database.Database, filter: SalesReportFilter = {}): SalesReport<SalesByTaxRow> {
  refuseItemFilter("Sales by tax", filter);
  const entries = aggregate(db, filter, {
    select: `je.id AS group_id, NULL AS group_name, i.id AS inv_id, cn.id AS note_id,
             i.tax_type AS inv_tax_type, i.tax_rate_basis_points AS inv_rate,
             i.discount_paise AS inv_discount, i.extra_charge_paise AS inv_extra`,
    joins: "",
    groupBy: "je.id",
    orderBy: "je.entry_date, je.id",
    includeTax: true,
  });
  const invoiceLines = db.prepare("SELECT quantity, unit_price_paise AS unitPricePaise, tax_rate_basis_points AS taxRateBasisPoints FROM invoice_lines WHERE invoice_id = ? ORDER BY id");
  const noteLines = db.prepare("SELECT quantity, unit_price_paise AS unitPricePaise, tax_rate_basis_points AS taxRateBasisPoints FROM credit_note_lines WHERE credit_note_id = ? ORDER BY id");
  type Bucket = { kind: string; rate: number; invoiced: number; credited: number; taxInvoiced: number; taxCredited: number; invoiceCount: number; noteCount: number };
  const buckets = new Map<string, Bucket>();
  const bucketFor = (kind: string, rate: number): Bucket => {
    const key = `${kind}|${rate}`;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = { kind, rate, invoiced: 0, credited: 0, taxInvoiced: 0, taxCredited: 0, invoiceCount: 0, noteCount: 0 };
      buckets.set(key, bucket);
    }
    return bucket;
  };
  const kindOf = (taxType: string | null | undefined, rate: number): string => (taxType === undefined || taxType === null || taxType === "NONE" || rate === 0 ? "NONE" : taxType);
  const totals = { invoiced: 0, credited: 0, invoiceCount: 0, noteCount: 0 };
  for (const entry of entries) {
    totals.invoiced += entry.invoiced; totals.credited += entry.credited;
    totals.invoiceCount += entry.invoice_count; totals.noteCount += entry.note_count;
    if (entry.inv_id === null || entry.inv_id === undefined) {
      const bucket = bucketFor("UNATTRIBUTED", 0);
      bucket.invoiced += entry.invoiced; bucket.credited += entry.credited;
      bucket.taxInvoiced += entry.tax_invoiced; bucket.taxCredited += entry.tax_credited;
      bucket.invoiceCount += entry.invoice_count; bucket.noteCount += entry.note_count;
      continue;
    }
    const taxType = entry.inv_tax_type ?? "NONE";
    const headerRate = entry.inv_rate ?? 0;
    const isNote = entry.note_id !== null && entry.note_id !== undefined;
    let groups: readonly TaxGroup[] = [];
    try {
      const lines = (isNote ? noteLines.all(entry.note_id) : invoiceLines.all(entry.inv_id)) as Array<{ quantity: number; unitPricePaise: number; taxRateBasisPoints: number }>;
      if (lines.length > 0) {
        groups = taxGroupsFor(lines, headerRate, taxType as "NONE" | "CGST_SGST" | "IGST", isNote ? 0 : entry.inv_discount ?? 0, isNote ? 0 : entry.inv_extra ?? 0);
      }
    } catch {
      groups = [];
    }
    // Nothing to split by (no lines, or a legacy document the engine would now refuse): the header, as before.
    if (groups.length === 0) groups = [{ rateBasisPoints: taxType === "NONE" ? 0 : headerRate, taxablePaise: 0, taxPaise: 0 }];
    const taxable = groups.map((group) => group.taxablePaise);
    const taxes = groups.map((group) => group.taxPaise);
    const invoiced = allocateAcross(entry.invoiced, taxable, taxable);
    const credited = allocateAcross(entry.credited, taxable, taxable);
    const taxInvoiced = allocateAcross(entry.tax_invoiced, taxes, taxable);
    const taxCredited = allocateAcross(entry.tax_credited, taxes, taxable);
    groups.forEach((group, index) => {
      const bucket = bucketFor(kindOf(taxType, group.rateBasisPoints), taxType === "NONE" ? 0 : group.rateBasisPoints);
      bucket.invoiced += invoiced[index] as number; bucket.credited += credited[index] as number;
      bucket.taxInvoiced += taxInvoiced[index] as number; bucket.taxCredited += taxCredited[index] as number;
      // A document is counted once in EACH rate row it touches; the report's totals count it once.
      if (groups.length === 1 || group.taxablePaise > 0) { bucket.invoiceCount += entry.invoice_count; bucket.noteCount += entry.note_count; }
    });
  }
  const rows = [...buckets.values()]
    .sort((left, right) => (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : left.rate - right.rate))
    .map((bucket): SalesByTaxRow => ({
      taxType: bucket.kind,
      taxRateBasisPoints: bucket.rate,
      invoicedPaise: bucket.invoiced,
      creditNotesPaise: bucket.credited,
      netSalesPaise: bucket.invoiced - bucket.credited,
      invoiceCount: bucket.invoiceCount,
      creditNoteCount: bucket.noteCount,
      taxInvoicedPaise: bucket.taxInvoiced,
      taxCreditNotesPaise: bucket.taxCredited,
      taxPaise: bucket.taxInvoiced - bucket.taxCredited,
    }));
  return {
    rows,
    totals: {
      invoicedPaise: totals.invoiced, creditNotesPaise: totals.credited, netSalesPaise: totals.invoiced - totals.credited,
      invoiceCount: totals.invoiceCount, creditNoteCount: totals.noteCount,
    },
  };
}

interface NoteRow {
  id: string;
  number: string;
  status: string;
  reason: string;
  refundable_paise: number;
  entry_date: string;
  business_id: string | null;
  fair_id: string | null;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  value_paise: number;
  taxable_paise: number;
  tax_paise: number;
  refunded: number;
  applied: number;
}

/**
 * Every credit note dated in the period (a note is dated by its FINALIZE entry, `je-credit-note-<id>`),
 * cancelled ones included and marked. The offset / refundable split is READ from
 * credit_notes.refundable_paise, never recomputed: the books fix it at finalize time from the balance
 * then outstanding, and a recomputation disagrees when a payment and a note share a day. Refunds and
 * applications are summed to date (as getCreditNoteBalance does) in correlated subqueries, so a note
 * with several of each never fans out into duplicate rows.
 */
export function creditNoteReport(db: Database.Database, filter: CreditNoteReportFilter = {}): CreditNoteReport {
  // F: a credit note kept as history has no entry and is never reported (the inner join drops it too).
  const extras: Array<{ sql: string; param?: string }> = [{ sql: "cn.before_opening = 0" }];
  if (filter.customerId !== undefined) extras.push({ sql: "i.customer_id = ?", param: filter.customerId });
  if (filter.itemId !== undefined) {
    extras.push({ sql: "EXISTS (SELECT 1 FROM credit_note_lines l WHERE l.credit_note_id = cn.id AND l.item_id = ?)", param: filter.itemId });
  }
  const { where, params } = withConditions(db, filter, extras);
  const lineSum = (expression: string, test: string): string =>
    `(SELECT COALESCE(SUM(${expression}), 0) FROM journal_lines jl JOIN chart_accounts ca ON ca.code = jl.account WHERE jl.journal_entry_id = je.id AND ${test})`;
  const rows = (db.prepare(
    `SELECT cn.id, cn.number, cn.status, cn.reason, cn.refundable_paise,
            je.entry_date, je.business_id, je.fair_id,
            i.id AS invoice_id, i.number AS invoice_number, i.customer_id, c.name AS customer_name,
            -- Everything the note takes off the books: every debit, less a round-off CREDIT (a rounded-down
            -- invoice being put back) which lowers what the customer is credited.
            (SELECT COALESCE(SUM(jl.debit_paise), 0) FROM journal_lines jl WHERE jl.journal_entry_id = je.id)
              - (SELECT COALESCE(SUM(jl.credit_paise), 0) FROM journal_lines jl WHERE jl.journal_entry_id = je.id AND jl.account = '${ROUND_OFF_ACCOUNT}') AS value_paise,
            -- I-Q11: the round-off account is INCOME but is not a sale, so it is out of the taxable figure BY CODE.
            ${lineSum("jl.debit_paise - jl.credit_paise", `ca.type = 'INCOME' AND ca.code <> '${ROUND_OFF_ACCOUNT}'`)} AS taxable_paise,
            ${lineSum("jl.debit_paise - jl.credit_paise", "ca.role = 'OUTPUT_GST'")} AS tax_paise,
            (SELECT COALESCE(SUM(r.amount_paise), 0) FROM credit_note_refunds r WHERE r.credit_note_id = cn.id) AS refunded,
            (SELECT COALESCE(SUM(a.amount_paise), 0) FROM credit_note_applications a WHERE a.credit_note_id = cn.id) AS applied
       FROM credit_notes cn
       JOIN journal_entries je ON je.id = 'je-credit-note-' || cn.id
       JOIN invoices i ON i.id = cn.invoice_id
       JOIN customers c ON c.id = i.customer_id
       ${where}
      ORDER BY je.entry_date, cn.number, cn.id`,
  ).all(...params) as NoteRow[]).map((row): CreditNoteReportRow => ({
    creditNoteId: row.id,
    number: row.number,
    status: row.status,
    date: row.entry_date,
    reason: row.reason,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    businessId: row.business_id,
    fairId: row.fair_id,
    taxablePaise: row.taxable_paise,
    taxPaise: row.tax_paise,
    valuePaise: row.value_paise,
    offsetPaise: row.value_paise - row.refundable_paise,
    refundablePaise: row.refundable_paise,
    refundedPaise: row.refunded,
    appliedPaise: row.applied,
    outstandingPaise: row.status === "CANCELLED" ? 0 : row.refundable_paise - row.refunded - row.applied,
  }));
  const live = rows.filter((row) => row.status !== "CANCELLED");
  const sum = (pick: (row: CreditNoteReportRow) => number): number => live.reduce((total, row) => total + pick(row), 0);
  return {
    rows,
    totals: {
      valuePaise: sum((r) => r.valuePaise),
      offsetPaise: sum((r) => r.offsetPaise),
      refundedPaise: sum((r) => r.refundedPaise),
      appliedPaise: sum((r) => r.appliedPaise),
      outstandingPaise: sum((r) => r.outstandingPaise),
    },
  };
}

/**
 * The returns themselves, one row per credit-note line, plus the same figures per item. Cancelled
 * notes are not returns and are left out. Value is quantity x unit price (before GST, as the note's
 * own lines carry it). Lines with no item stay in, named by their description.
 */
export function salesReturnReport(db: Database.Database, filter: CreditNoteReportFilter = {}): SalesReturnReport {
  const extras: Array<{ sql: string; param?: string }> = [{ sql: "cn.status = 'FINALIZED'" }, { sql: "cn.before_opening = 0" }];
  if (filter.customerId !== undefined) extras.push({ sql: "i.customer_id = ?", param: filter.customerId });
  if (filter.itemId !== undefined) extras.push({ sql: "l.item_id = ?", param: filter.itemId });
  const { where, params } = withConditions(db, filter, extras);
  const from = `
      FROM credit_note_lines l
      JOIN credit_notes cn ON cn.id = l.credit_note_id
      JOIN journal_entries je ON je.id = 'je-credit-note-' || cn.id
      JOIN invoices i ON i.id = cn.invoice_id
      JOIN customers c ON c.id = i.customer_id
      LEFT JOIN items it ON it.id = l.item_id
      ${where}`;
  const rows = (db.prepare(
    `SELECT cn.id AS credit_note_id, cn.number AS credit_note_number, je.entry_date,
            i.id AS invoice_id, i.number AS invoice_number, i.customer_id, c.name AS customer_name,
            l.item_id, COALESCE(it.name, l.description) AS item_name,
            l.quantity, l.unit_price_paise, l.quantity * l.unit_price_paise AS value_paise
       ${from}
      ORDER BY je.entry_date, cn.number, cn.id, l.id`,
  ).all(...params) as Array<{
    credit_note_id: string; credit_note_number: string; entry_date: string; invoice_id: string; invoice_number: string;
    customer_id: string; customer_name: string; item_id: string | null; item_name: string;
    quantity: number; unit_price_paise: number; value_paise: number;
  }>).map((row): SalesReturnRow => ({
    creditNoteId: row.credit_note_id,
    creditNoteNumber: row.credit_note_number,
    date: row.entry_date,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    itemId: row.item_id,
    itemName: row.item_name,
    quantity: row.quantity,
    unitPricePaise: row.unit_price_paise,
    valuePaise: row.value_paise,
  }));
  const byItem = (db.prepare(
    `SELECT l.item_id, COALESCE(it.name, l.description) AS item_name,
            SUM(l.quantity) AS quantity, SUM(l.quantity * l.unit_price_paise) AS value_paise,
            COUNT(DISTINCT cn.id) AS note_count
       ${from}
      GROUP BY l.item_id, CASE WHEN l.item_id IS NULL THEN l.description END
      ORDER BY item_name, l.item_id`,
  ).all(...params) as Array<{ item_id: string | null; item_name: string; quantity: number; value_paise: number; note_count: number }>)
    .map((row): SalesReturnByItemRow => ({
      itemId: row.item_id, itemName: row.item_name, quantity: row.quantity, valuePaise: row.value_paise, creditNoteCount: row.note_count,
    }));
  return { rows, byItem, totalValuePaise: rows.reduce((total, row) => total + row.valuePaise, 0) };
}

export interface SalesByItemRow {
  /** null for a line that names no item (a typed-in service line); the row is then named by its description. */
  readonly itemId: string | null;
  readonly itemName: string;
  /** null where there is no item behind the row. */
  readonly unit: string | null;
  /** Quantity invoiced on FINALIZED invoices. */
  readonly quantity: number;
  /** Quantity x unit price invoiced, BEFORE invoice-level discount, extra charge and GST. */
  readonly salesPaise: number;
  /** Quantity returned on FINALIZED credit notes. */
  readonly returnedQuantity: number;
  readonly returnsPaise: number;
  readonly netQuantity: number;
  readonly netSalesPaise: number;
}

/**
 * Sales per item (spec section 13).
 *
 * Unlike every other report in this file this one reads DOCUMENT LINES, not the journal, because
 * the journal has no item dimension (see the file header). To keep it in the same world as the
 * journal reports, its business, fair and date filters come from the invoice's OWN POSTED ENTRY,
 * joined as `je` - so `sales-by-item?fairId=X` covers exactly the invoices that
 * `sales-by-fair?fairId=X` counts, rather than a second, privately-invented idea of which
 * invoices belong to a fair.
 *
 * An invoice posts up to TWO entries (the sale, and COGS when a line tracks stock) under the same
 * source_id with the same dimensions, so they are collapsed with GROUP BY source_id before the
 * join. Joining the raw table would count every tracked-stock invoice twice.
 *
 * Returns come from salesReturnReport's own byItem query, so a return cannot be counted there and
 * missed here. Until session 9 this report ignored credit notes completely and took no filters at
 * all, which is what let it disagree with the rest of section 13.
 *
 * WHAT THIS IS NOT. Line value is quantity x unit price. Invoice-level discount, extra charge and
 * GST are NOT spread across the lines (there is no honest rule for doing so - see
 * `refuseItemFilter`), so the column total here does NOT equal net sales from the journal, and is
 * not meant to. Dates follow each document: an invoice sits on its own entry date, a credit note
 * on the date it was finalized (S8-4), so a January sale returned in February shows as a sale in
 * January and a return in February.
 */
export function salesByItem(db: Database.Database, filter: CreditNoteReportFilter = {}): readonly SalesByItemRow[] {
  const extras: Array<{ sql: string; param?: string }> = [{ sql: "inv.status = 'FINALIZED'" }, { sql: "inv.before_opening = 0" }]; // F: history is never reported
  if (filter.customerId !== undefined) extras.push({ sql: "inv.customer_id = ?", param: filter.customerId });
  if (filter.itemId !== undefined) extras.push({ sql: "il.item_id = ?", param: filter.itemId });
  const { where, params } = withConditions(db, filter, extras);
  const gross = db.prepare(
    `SELECT il.item_id, COALESCE(it.name, il.description) AS item_name,
            SUM(il.quantity) AS quantity, SUM(il.quantity * il.unit_price_paise) AS sales_paise
       FROM invoice_lines il
       JOIN invoices inv ON inv.id = il.invoice_id
       JOIN (SELECT source_id AS id, MIN(entry_date) AS entry_date, business_id, fair_id
               FROM journal_entries
              WHERE source_type = 'INVOICE' AND is_reversal = 0
              GROUP BY source_id) je ON je.id = inv.id
       LEFT JOIN items it ON it.id = il.item_id
       ${where}
      GROUP BY il.item_id, CASE WHEN il.item_id IS NULL THEN il.description END
      ORDER BY item_name, il.item_id`,
  ).all(...params) as Array<{ item_id: string | null; item_name: string; quantity: number; sales_paise: number }>;

  const units = new Map(
    (db.prepare("SELECT id, unit FROM items").all() as Array<{ id: string; unit: string }>).map((row) => [row.id, row.unit] as const),
  );
  /** An item-less line is identified by its name, exactly as salesReturnReport groups it. */
  const keyOf = (itemId: string | null, itemName: string): string => (itemId === null ? `description:${itemName}` : `item:${itemId}`);

  const merged = new Map<string, { itemId: string | null; itemName: string; quantity: number; salesPaise: number; returnedQuantity: number; returnsPaise: number }>();
  for (const row of gross) {
    merged.set(keyOf(row.item_id, row.item_name), {
      itemId: row.item_id, itemName: row.item_name,
      quantity: row.quantity, salesPaise: row.sales_paise, returnedQuantity: 0, returnsPaise: 0,
    });
  }
  for (const row of salesReturnReport(db, filter).byItem) {
    const key = keyOf(row.itemId, row.itemName);
    // A return whose item was never invoiced inside the filter still belongs in the report: it is
    // stock coming back. Dropping it would hide a return behind a date or fair filter.
    const existing = merged.get(key) ?? { itemId: row.itemId, itemName: row.itemName, quantity: 0, salesPaise: 0, returnedQuantity: 0, returnsPaise: 0 };
    merged.set(key, { ...existing, returnedQuantity: existing.returnedQuantity + row.quantity, returnsPaise: existing.returnsPaise + row.valuePaise });
  }
  return [...merged.values()]
    .map((row): SalesByItemRow => ({
      itemId: row.itemId,
      itemName: row.itemName,
      unit: row.itemId === null ? null : units.get(row.itemId) ?? null,
      quantity: row.quantity,
      salesPaise: row.salesPaise,
      returnedQuantity: row.returnedQuantity,
      returnsPaise: row.returnsPaise,
      netQuantity: row.quantity - row.returnedQuantity,
      netSalesPaise: row.salesPaise - row.returnsPaise,
    }))
    .sort((left, right) => left.itemName.localeCompare(right.itemName) || (left.itemId ?? "").localeCompare(right.itemId ?? ""));
}
