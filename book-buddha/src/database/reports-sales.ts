import type Database from "better-sqlite3";
import { RepositoryValidationError } from "./errors.js";
import { reportConditions } from "./report-filters-sql.js";

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
function withConditions(filter: SalesReportFilter, extras: ReadonlyArray<{ sql: string; param?: string }>): { where: string; params: string[] } {
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
  const { where, params } = withConditions(filter, extras);
  const accountTest = shape.includeTax ? "(ca.type = 'INCOME' OR ca.role = 'OUTPUT_GST')" : "ca.type = 'INCOME'";
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

/**
 * Net sales and GST kept, per tax treatment (type and rate). Both come from the journal, so
 * `taxPaise` summed over the rows equals the P&L's GST-on-sales for the same filter.
 */
export function salesByTax(db: Database.Database, filter: SalesReportFilter = {}): SalesReport<SalesByTaxRow> {
  refuseItemFilter("Sales by tax", filter);
  const rows = aggregate(db, filter, {
    select: `CASE WHEN i.id IS NULL THEN 'UNATTRIBUTED'
                  WHEN i.tax_type = 'NONE' OR i.tax_rate_basis_points = 0 THEN 'NONE'
                  ELSE i.tax_type END AS tax_kind,
             CASE WHEN i.id IS NULL OR i.tax_type = 'NONE' OR i.tax_rate_basis_points = 0 THEN 0
                  ELSE i.tax_rate_basis_points END AS tax_rate_bp,
             NULL AS group_id, NULL AS group_name`,
    joins: "",
    groupBy: "tax_kind, tax_rate_bp",
    orderBy: "tax_kind, tax_rate_bp",
    includeTax: true,
  }).map((row) => ({
    taxType: row.tax_kind ?? "NONE",
    taxRateBasisPoints: row.tax_rate_bp ?? 0,
    ...totalsOf(row),
    taxInvoicedPaise: row.tax_invoiced,
    taxCreditNotesPaise: row.tax_credited,
    taxPaise: row.tax_invoiced - row.tax_credited,
  }));
  return { rows, totals: sumTotals(rows) };
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
  const extras: Array<{ sql: string; param?: string }> = [];
  if (filter.customerId !== undefined) extras.push({ sql: "i.customer_id = ?", param: filter.customerId });
  if (filter.itemId !== undefined) {
    extras.push({ sql: "EXISTS (SELECT 1 FROM credit_note_lines l WHERE l.credit_note_id = cn.id AND l.item_id = ?)", param: filter.itemId });
  }
  const { where, params } = withConditions(filter, extras);
  const lineSum = (expression: string, test: string): string =>
    `(SELECT COALESCE(SUM(${expression}), 0) FROM journal_lines jl JOIN chart_accounts ca ON ca.code = jl.account WHERE jl.journal_entry_id = je.id AND ${test})`;
  const rows = (db.prepare(
    `SELECT cn.id, cn.number, cn.status, cn.reason, cn.refundable_paise,
            je.entry_date, je.business_id, je.fair_id,
            i.id AS invoice_id, i.number AS invoice_number, i.customer_id, c.name AS customer_name,
            (SELECT COALESCE(SUM(jl.debit_paise), 0) FROM journal_lines jl WHERE jl.journal_entry_id = je.id) AS value_paise,
            ${lineSum("jl.debit_paise - jl.credit_paise", "ca.type = 'INCOME'")} AS taxable_paise,
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
  const extras: Array<{ sql: string; param?: string }> = [{ sql: "cn.status = 'FINALIZED'" }];
  if (filter.customerId !== undefined) extras.push({ sql: "i.customer_id = ?", param: filter.customerId });
  if (filter.itemId !== undefined) extras.push({ sql: "l.item_id = ?", param: filter.itemId });
  const { where, params } = withConditions(filter, extras);
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
