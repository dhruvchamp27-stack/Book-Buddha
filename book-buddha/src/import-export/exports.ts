/**
 * Exports (R10-B): turns the books into plain tables that open in a spreadsheet and that the
 * importer can read back.
 *
 * Every dataset is `{ columns, rows }` where every cell is already a display STRING. Money is stored
 * as whole paise (integers) and written as rupees with two decimals, no grouping, by integer
 * arithmetic only (`1234.50`, `-12.00`) - never through a float. Dates are ISO (YYYY-MM-DD).
 *
 * Datasets and their headers (the customer / supplier / item / invoice headers are FIXED: they are
 * the importer's labels and must not change):
 *
 * - customers:  Name, Email, Phone, Phone 2, Classification, GSTIN, Website, Billing address,
 *               Shipping address, Notes, Customer number, Active
 * - suppliers:  the same minus Customer number
 * - items:      Name, Unit, Track stock, Description, Selling price, Cost price, MRP, Reorder level, Active
 * - invoices:   Number, Invoice date, Due date, Customer, Status, Item, Description, Quantity,
 *               Unit price, Discount, Extra charge, Tax type, Tax rate, Fair, Notes
 *               (one row per LINE; the header fields repeat on every line of the same invoice)
 * - credit-notes:      Number, Credit note date, Invoice number, Customer, Status, Reason, Item,
 *                      Description, Quantity, Unit price   (one row per line)
 * - payments:          Payment ID, Invoice number, Customer, Paid on, Amount, Account, Status,
 *                      Cancelled on, Cancellation reason
 * - purchase-bills:    Number, Supplier invoice number, Bill date, Due date, Supplier, Status, Item,
 *                      Description, Quantity, Unit price, Discount, Extra charge, Tax type, Tax rate,
 *                      Payment account, Fair, Notes   (one row per line)
 * - supplier-payments: Payment ID, Supplier, Bill number, Paid on, Amount, Account, Status,
 *                      Cancelled on, Cancellation reason
 * - stock-movements:   Date, Item, Movement type, Quantity change, Unit cost, Value, Source ID, Fair
 * - journal-entries:   Entry date, Entry ID, Source type, Source ID, Description, Reversal, Account,
 *                      Debit, Credit  (one row per journal line, in entry-date order)
 * - trial-balance:     Account, Debit, Credit  (balances, one row per account)
 * Report datasets (Q18), flattened one row per line with totals as labelled rows, each taking its
 * /reports route's filters as query parameters (businessId, fairId, customerId, itemId, fromDate,
 * toDate, asAtDate, basis - see REPORT_PARAMS):
 * - profit-and-loss:   Section, Account, Debit, Credit, Amount
 * - balance-sheet:     Section, Account, Debit, Credit, Amount
 * - customer-statement:        Customer, Date, Type, Reference, Reversal, Amount, Balance  (customerId required)
 * - customer-balance-detail:   Customer, Kind, Number, Date, Due date, Fair, Total, Settled, Outstanding
 * - collections:       As at, Customer, Email, Phone, Phone 2, Kind, Number, Date, Due on, Due date basis,
 *                      Days overdue, Fair, Total, Outstanding
 * - stock-ageing:      As at, Item, Unit, then quantity and value per age band, Quantity, Value
 * - inventory-valuation-detail: As at, Item, Unit, Received on, Date basis, Age days, Quantity, Unit cost, Value, Source ID
 * - item-profitability:        Item, Unit, Net quantity, Net sales, Cost of goods sold, Gross margin
 *
 * Scope: `companyId` / `businessId` narrow every dataset. The journal comes from the general ledger
 * (Entry date is the business date, not the time it was written) and is filtered by business; a
 * company scope is all of that company's businesses. The trial balance honours `businessId` only
 * (the repository's own filter).
 *
 * CSV: UTF-8 with a BOM, CRLF line ends, RFC 4180 quoting. A TEXT cell that begins with `=`, `+`,
 * `-`, `@`, tab or CR gets a leading `'` so a spreadsheet never runs it as a formula; numeric and
 * date columns are never touched (a legitimate `-12.00` stays `-12.00`). JSON carries the same
 * columns and the same strings but is NOT prefixed: it is for programs, which do not execute formulas,
 * and it stays exactly what is in the books.
 */
import { RepositoryValidationError, type AccountingRepository, type ReportAccountRow } from "../database/repository.js";

export const EXPORT_DATASETS = [
  "customers", "suppliers", "items", "invoices", "credit-notes", "payments",
  "purchase-bills", "supplier-payments", "stock-movements", "journal-entries", "trial-balance",
  "profit-and-loss", "balance-sheet", "customer-statement", "customer-balance-detail", "collections",
  "stock-ageing", "inventory-valuation-detail", "item-profitability",
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export interface ExportScope {
  readonly companyId?: string;
  readonly businessId?: string;
  /** Report filters (the report datasets only; see REPORT_PARAMS for who takes which). */
  readonly fairId?: string;
  readonly customerId?: string;
  readonly itemId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly asAtDate?: string;
  readonly basis?: "CASH" | "ACCRUAL";
}

export interface ExportTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Indexes of columns that hold numbers or dates: exempt from the formula guard. */
  readonly nonTextColumns: readonly number[];
}

export function isExportDataset(value: string): value is ExportDataset {
  return (EXPORT_DATASETS as readonly string[]).includes(value);
}

// ---- cell formatting --------------------------------------------------------------------------

/** Integer paise -> rupees with two decimals, no grouping. Integer arithmetic only. */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error(`Amount ${paise} is not a whole number of paise.`);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${negative ? "-" : ""}${rupees}.${rest < 10 ? "0" : ""}${rest}`;
}

const money = (paise: number | null | undefined): string => (paise === null || paise === undefined ? "" : formatPaise(paise));
const text = (value: string | null | undefined): string => value ?? "";
/** F: the "Before opening" cell - "Yes" for a document or payment kept as history, blank otherwise. */
const beforeOpeningCell = (flag: boolean | undefined): string => (flag === true ? "Yes" : "");
const yesNo = (value: boolean): string => (value ? "Yes" : "No");
const int = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value));

/** Basis points -> percent text by integer arithmetic: 1800 -> "18", 250 -> "2.5", 125 -> "1.25". */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const frac = Math.abs(basisPoints % 100);
  if (frac === 0) return String(whole);
  const digits = (frac < 10 ? "0" : "") + String(frac);
  return `${whole}.${digits.replace(/0$/, "")}`;
}

/** Timestamps and dates -> the YYYY-MM-DD part when the value starts like an ISO date. */
function isoDay(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

function table(columns: readonly string[], rows: string[][], nonText: readonly string[] = []): ExportTable {
  return { columns, rows, nonTextColumns: nonText.map((name) => columns.indexOf(name)).filter((i) => i >= 0) };
}

// ---- datasets ---------------------------------------------------------------------------------

const PARTY_COLUMNS = [
  "Name", "Email", "Phone", "Phone 2", "Classification", "GSTIN", "Website", "Billing address",
  "Shipping address", "Notes",
] as const;

function businessIdsInScope(repository: AccountingRepository, scope: ExportScope): Set<string> {
  const ids = repository.listBusinesses(scope.companyId).map((b) => b.id);
  const set = new Set(ids);
  if (scope.businessId !== undefined) return new Set(set.has(scope.businessId) ? [scope.businessId] : []);
  return set;
}

function customersTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = [...PARTY_COLUMNS, "Customer number", "Active"];
  const rows = repository.listCustomers(scope.companyId).map((c) => [
    c.name, text(c.email), text(c.phone), text(c.phone2), text(c.classification), text(c.gstin), text(c.website),
    text(c.billingAddress), text(c.shippingAddress), text(c.internalNotes), text(c.customerNumber), yesNo(c.active),
  ]);
  return table(columns, rows, ["Active"]);
}

function suppliersTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = [...PARTY_COLUMNS, "Active"];
  const rows = repository.listSuppliers(scope.companyId).map((s) => [
    s.name, text(s.email), text(s.phone), text(s.phone2), text(s.classification), text(s.gstin), text(s.website),
    text(s.billingAddress), text(s.shippingAddress), text(s.internalNotes), yesNo(s.active),
  ]);
  return table(columns, rows, ["Active"]);
}

function itemsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Name", "Unit", "Track stock", "Description", "Selling price", "Cost price", "MRP", "Reorder level", "Active"];
  const rows = repository.listItems(scope.companyId).map((i) => [
    i.name, i.unit, yesNo(i.trackStock), text(i.description), money(i.sellingPricePaise), money(i.costPricePaise),
    money(i.mrpPaise), int(i.reorderThreshold), yesNo(i.active),
  ]);
  return table(columns, rows, ["Track stock", "Selling price", "Cost price", "MRP", "Reorder level", "Active"]);
}

interface Lookups {
  readonly customers: Map<string, string>;
  readonly suppliers: Map<string, string>;
  readonly items: Map<string, string>;
  readonly fairs: Map<string, string>;
}

function lookups(repository: AccountingRepository): Lookups {
  return {
    customers: new Map(repository.listCustomers().map((c) => [c.id, c.name])),
    suppliers: new Map(repository.listSuppliers().map((s) => [s.id, s.name])),
    items: new Map(repository.listItems().map((i) => [i.id, i.name])),
    fairs: new Map(repository.listFairs().map((f) => [f.id, f.name])),
  };
}

const itemName = (l: Lookups, itemId: string | undefined | null): string => (itemId === undefined || itemId === null ? "" : l.items.get(itemId) ?? "");

function invoicesTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = [
    "Number", "Invoice date", "Due date", "Customer", "Status", "Item", "Description", "Quantity", "Unit price",
    "Discount", "Extra charge", "Tax type", "Tax rate", "Fair", "Notes", "Before opening",
  ];
  const l = lookups(repository);
  const businesses = businessIdsInScope(repository, scope);
  const rows: string[][] = [];
  const summaries = [...repository.listInvoices()].filter((s) => businesses.has(s.businessId));
  // Oldest first reads naturally in a spreadsheet; the list itself is newest first.
  for (const summary of summaries.reverse()) {
    const invoice = repository.getInvoice(summary.id);
    const head = (): string[] => [
      invoice.number, isoDay(invoice.invoiceDate), isoDay(invoice.dueDate), l.customers.get(invoice.customerId) ?? "",
      invoice.status,
    ];
    // I-Q1: the Tax rate cell is PER ROW - each line's own rate (the document's, for a document with no lines).
    const tail = (lineRateBp: number | undefined): string[] => [
      money(invoice.discountPaise ?? 0), money(invoice.extraChargePaise ?? 0), invoice.taxType ?? "NONE",
      formatBasisPoints(lineRateBp ?? invoice.taxRateBasisPoints ?? 0),
      invoice.fairId === undefined ? "" : l.fairs.get(invoice.fairId) ?? "", text(invoice.notes),
      beforeOpeningCell(invoice.beforeOpening),
    ];
    if (invoice.lines.length === 0) rows.push([...head(), "", "", "", "", ...tail(undefined)]);
    for (const line of invoice.lines) {
      rows.push([...head(), itemName(l, line.itemId), line.description, int(line.quantity), money(line.unitPricePaise), ...tail(line.taxRateBasisPoints)]);
    }
  }
  return table(columns, rows, ["Invoice date", "Due date", "Quantity", "Unit price", "Discount", "Extra charge", "Tax rate"]);
}

function creditNotesTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Number", "Credit note date", "Invoice number", "Customer", "Status", "Reason", "Item", "Description", "Quantity", "Unit price", "Before opening"];
  const l = lookups(repository);
  const businesses = businessIdsInScope(repository, scope);
  const invoices = new Map(repository.listInvoices().filter((s) => businesses.has(s.businessId)).map((s) => [s.id, s]));
  const rows: string[][] = [];
  for (const summary of [...repository.listCreditNotes()].reverse()) {
    const invoice = invoices.get(summary.invoiceId);
    if (invoice === undefined) continue; // outside the requested scope
    const note = repository.getCreditNote(summary.id);
    const head = (): string[] => [
      note.number, isoDay(note.noteDate ?? summary.createdAt), invoice.number, l.customers.get(invoice.customerId) ?? "",
      note.status, note.reason,
    ];
    for (const line of note.lines) {
      rows.push([...head(), itemName(l, line.itemId), line.description, int(line.quantity), money(line.unitPricePaise), beforeOpeningCell(note.beforeOpening)]);
    }
  }
  return table(columns, rows, ["Credit note date", "Quantity", "Unit price"]);
}

function paymentsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Payment ID", "Invoice number", "Customer", "Paid on", "Amount", "Account", "Status", "Cancelled on", "Cancellation reason", "Money account", "Payment mode", "Reference", "Before opening"];
  const l = lookups(repository);
  const businesses = businessIdsInScope(repository, scope);
  const rows: string[][] = [];
  for (const summary of [...repository.listInvoices()].reverse()) {
    if (!businesses.has(summary.businessId)) continue;
    for (const p of repository.listPayments(summary.id)) {
      rows.push([
        p.id, summary.number, l.customers.get(summary.customerId) ?? "", isoDay(p.paidAt), money(p.amountPaise),
        p.paymentAccount, p.cancelledAt === null ? "Active" : "Cancelled", isoDay(p.cancelledAt), text(p.cancellationReason),
        p.moneyAccount, text(p.paymentMode), text(p.paymentReference), beforeOpeningCell(p.beforeOpening),
      ]);
    }
  }
  return table(columns, rows, ["Paid on", "Amount", "Cancelled on"]);
}

function purchaseBillsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = [
    "Number", "Supplier invoice number", "Bill date", "Due date", "Supplier", "Status", "Item", "Description", "Quantity",
    "Unit price", "Discount", "Extra charge", "Tax type", "Tax rate", "Payment account", "Fair", "Notes", "Before opening",
  ];
  const l = lookups(repository);
  const businesses = businessIdsInScope(repository, scope);
  const rows: string[][] = [];
  for (const bill of repository.listPurchaseBills()) {
    if (!businesses.has(bill.businessId)) continue;
    const head = (): string[] => [
      bill.number, text(bill.supplierInvoiceNumber), isoDay(bill.billDate), isoDay(bill.dueDate),
      l.suppliers.get(bill.supplierId) ?? "", bill.status,
    ];
    const tail = (lineRateBp: number | undefined): string[] => [
      money(bill.discountPaise), money(bill.extraChargePaise), bill.taxType, formatBasisPoints(lineRateBp ?? bill.taxRateBasisPoints),
      text(bill.paymentAccount), bill.fairId === undefined ? "" : l.fairs.get(bill.fairId) ?? "", text(bill.notes),
      beforeOpeningCell(bill.beforeOpening),
    ];
    if (bill.lines.length === 0) rows.push([...head(), "", "", "", "", ...tail(undefined)]);
    for (const line of bill.lines) {
      rows.push([...head(), itemName(l, line.itemId), line.description, int(line.quantity), money(line.unitPricePaise), ...tail(line.taxRateBasisPoints)]);
    }
  }
  return table(columns, rows, ["Bill date", "Due date", "Quantity", "Unit price", "Discount", "Extra charge", "Tax rate"]);
}

function supplierPaymentsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Payment ID", "Supplier", "Bill number", "Paid on", "Amount", "Account", "Status", "Cancelled on", "Cancellation reason", "Money account", "Payment mode", "Reference", "Before opening"];
  const l = lookups(repository);
  const companySuppliers = scope.companyId === undefined ? undefined : new Set(repository.listSuppliers(scope.companyId).map((s) => s.id));
  const bills = new Map(repository.listPurchaseBills().map((b) => [b.id, b]));
  const businesses = scope.businessId === undefined ? undefined : businessIdsInScope(repository, scope);
  const rows: string[][] = [];
  for (const p of repository.listSupplierPayments()) {
    if (companySuppliers !== undefined && !companySuppliers.has(p.supplierId)) continue;
    const bill = p.billId === null ? undefined : bills.get(p.billId);
    // A business filter keeps payments of that business's bills; expense payments have no business.
    if (businesses !== undefined && (bill === undefined || !businesses.has(bill.businessId))) continue;
    rows.push([
      p.id, l.suppliers.get(p.supplierId) ?? "", bill?.number ?? "", isoDay(p.paidAt), money(p.amountPaise), p.paymentAccount,
      p.cancelledAt === null ? "Active" : "Cancelled", isoDay(p.cancelledAt), text(p.cancellationReason),
      p.moneyAccount, text(p.paymentMode), text(p.paymentReference), beforeOpeningCell(p.beforeOpening),
    ]);
  }
  return table(columns, rows, ["Paid on", "Amount", "Cancelled on"]);
}

function stockMovementsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Date", "Item", "Movement type", "Quantity change", "Unit cost", "Value", "Source ID", "Fair"];
  const l = lookups(repository);
  const itemsInScope = scope.companyId === undefined ? undefined : new Set(repository.listItems(scope.companyId).map((i) => i.id));
  const rows: string[][] = [];
  for (const m of repository.listStockMovements()) {
    if (itemsInScope !== undefined && !itemsInScope.has(m.itemId)) continue;
    rows.push([
      isoDay(m.occurredAt), itemName(l, m.itemId), m.movementType, int(m.quantityDelta), money(m.unitCostPaise),
      money(m.quantityDelta * m.unitCostPaise), text(m.sourceId), m.fairId === undefined ? "" : l.fairs.get(m.fairId) ?? "",
    ]);
  }
  return table(columns, rows, ["Date", "Quantity change", "Unit cost", "Value"]);
}

function journalEntriesTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Entry date", "Entry ID", "Source type", "Source ID", "Description", "Reversal", "Account", "Debit", "Credit"];
  // The ledger filters by one business; a company scope is every business of that company.
  const businessIds = scope.businessId === undefined && scope.companyId === undefined ? undefined : [...businessIdsInScope(repository, scope)];
  const ledger = businessIds === undefined
    ? [...repository.getGeneralLedger()]
    : businessIds.flatMap((businessId) => [...repository.getGeneralLedger({ businessId })])
        .sort((x, y) => (x.entryDate < y.entryDate ? -1 : x.entryDate > y.entryDate ? 1 : x.postedAt < y.postedAt ? -1 : x.postedAt > y.postedAt ? 1 : 0));
  const rows = ledger.map((r) => [
    r.entryDate, r.journalEntryId, r.sourceType, r.sourceId, r.description, yesNo(r.isReversal), r.account,
    money(r.debitPaise), money(r.creditPaise),
  ]);
  return table(columns, rows, ["Entry date", "Reversal", "Debit", "Credit"]);
}

function trialBalanceTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Account", "Debit", "Credit"];
  const rows = repository.getTrialBalance(reportFilter("trial-balance", scope)).map((r) => [r.account, money(r.debitPaise), money(r.creditPaise)]);
  return table(columns, rows, ["Debit", "Credit"]);
}

// ---- report datasets (Q18) --------------------------------------------------------------------
//
// Each report dataset takes the SAME filters as its /reports route (see REPORT_PARAMS) and is built
// from the same repository method, so a figure in the file is the figure on the screen. Nested
// report shapes are flattened to one row per line; totals are rows labelled in the first text column.
// A filter the report does not take is refused (400), exactly as the strict /reports route refuses it,
// rather than silently ignored. `companyId` is accepted on every dataset and ignored by the reports
// (a report is read for one business or all of them).

type ReportParam = "businessId" | "fairId" | "customerId" | "itemId" | "fromDate" | "toDate" | "asAtDate" | "basis";

const REPORT_PARAMS: Readonly<Record<string, readonly ReportParam[]>> = {
  "trial-balance": ["businessId", "fairId", "asAtDate"],
  "profit-and-loss": ["businessId", "fairId", "fromDate", "toDate", "basis"],
  "balance-sheet": ["businessId", "asAtDate"],
  "customer-statement": ["customerId", "businessId", "fairId"],
  "customer-balance-detail": ["businessId", "customerId", "fairId", "asAtDate"],
  "collections": ["businessId", "customerId", "fairId", "asAtDate"],
  "stock-ageing": ["asAtDate"],
  "inventory-valuation-detail": ["asAtDate"],
  "item-profitability": ["businessId", "fairId", "itemId", "fromDate", "toDate"],
};

/** The filters the dataset takes, as a plain object with no undefined values. Refuses the ones it does not take. */
function reportFilter(dataset: string, scope: ExportScope): Record<string, string> {
  const allowed = REPORT_PARAMS[dataset] ?? [];
  const given: Record<ReportParam, string | undefined> = {
    businessId: scope.businessId, fairId: scope.fairId, customerId: scope.customerId, itemId: scope.itemId,
    fromDate: scope.fromDate, toDate: scope.toDate, asAtDate: scope.asAtDate, basis: scope.basis,
  };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(given) as Array<[ReportParam, string | undefined]>) {
    if (value === undefined) continue;
    if (!allowed.includes(key)) {
      throw new RepositoryValidationError(
        `The ${dataset} export does not take "${key}". It takes: ${allowed.length === 0 ? "no filters" : allowed.join(", ")}.`,
      );
    }
    out[key] = value;
  }
  return out;
}

const AMOUNT_COLUMNS = ["Debit", "Credit", "Amount"] as const;

function accountSection(section: string, rows: readonly ReportAccountRow[]): string[][] {
  return rows.map((r) => [section, r.account, money(r.debitPaise), money(r.creditPaise), money(r.balancePaise)]);
}

function profitAndLossTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const report = repository.getProfitAndLoss(reportFilter("profit-and-loss", scope));
  const rows: string[][] = [
    ["Basis", report.basis, "", "", ""],
    ...accountSection("Income", report.income),
    ["Total", "Total income", "", "", money(report.totalIncomePaise)],
    ...accountSection("Expenses", report.expenses),
    ["Total", "Total expenses", "", "", money(report.totalExpensesPaise)],
    ["Total", "Net profit", "", "", money(report.netProfitPaise)],
    ["Memo", "Gross sales including GST", "", "", money(report.grossSalesPaise)],
    ["Memo", "GST on sales", "", "", money(report.gstOnSalesPaise)],
  ];
  return table(["Section", "Account", "Debit", "Credit", "Amount"], rows, [...AMOUNT_COLUMNS]);
}

function balanceSheetTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const report = repository.getBalanceSheet(reportFilter("balance-sheet", scope));
  const rows: string[][] = [
    ...accountSection("Assets", report.assets),
    ["Total", "Total assets", "", "", money(report.totalAssetsPaise)],
    ...accountSection("Liabilities", report.liabilities),
    ["Total", "Total liabilities", "", "", money(report.totalLiabilitiesPaise)],
    ...accountSection("Equity", report.equity),
    ["Total", "Total equity", "", "", money(report.totalEquityPaise)],
    ["Memo", "Retained earnings", "", "", money(report.retainedEarnings.totalPaise)],
  ];
  const split = report.retainedEarnings.split;
  if (split !== null) {
    rows.push(["Memo", "Retained earnings brought forward", "", "", money(split.broughtForwardPaise)]);
    rows.push(["Memo", "Profit for the year", "", "", money(split.profitForYearPaise)]);
  }
  return table(["Section", "Account", "Debit", "Credit", "Amount"], rows, [...AMOUNT_COLUMNS]);
}

function customerStatementTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const filter = reportFilter("customer-statement", scope);
  if (filter["customerId"] === undefined) throw new RepositoryValidationError("The customer-statement export needs a customerId.");
  const report = repository.getCustomerStatement({
    customerId: filter["customerId"],
    ...(filter["businessId"] === undefined ? {} : { businessId: filter["businessId"] }),
    ...(filter["fairId"] === undefined ? {} : { fairId: filter["fairId"] }),
  });
  const rows: string[][] = report.rows.map((r) => [
    report.customerName, r.date, r.type, r.reference, yesNo(r.isReversal), money(r.amountPaise), money(r.balancePaise),
  ]);
  rows.push([report.customerName, "", "TOTAL", "Closing balance (what the customer owes)", "", "", money(report.closingBalancePaise)]);
  rows.push([report.customerName, "", "TOTAL", "Unapplied credit (owed to the customer, not netted)", "", "", money(report.unappliedCreditPaise)]);
  rows.push([report.customerName, "", "TOTAL", "Opening balances left out by the fair filter", "", "", money(report.excludedOpeningBalancesPaise)]);
  return table(["Customer", "Date", "Type", "Reference", "Reversal", "Amount", "Balance"], rows, ["Date", "Reversal", "Amount", "Balance"]);
}

function customerBalanceDetailTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const report = repository.getCustomerBalanceDetail(reportFilter("customer-balance-detail", scope));
  const fairs = lookups(repository).fairs;
  const rows: string[][] = [];
  for (const group of report.groups) {
    for (const i of group.items) {
      rows.push([
        group.customerName, i.kind, i.number, i.date, isoDay(i.dueDate), i.fairId === null ? "" : fairs.get(i.fairId) ?? "",
        money(i.totalPaise), money(i.settledPaise), money(i.outstandingPaise),
      ]);
    }
    rows.push([group.customerName, "SUBTOTAL", "Subtotal", "", "", "", "", "", money(group.subtotalPaise)]);
  }
  rows.push(["", "TOTAL", "Report total", "", "", "", "", "", money(report.totalPaise)]);
  rows.push(["", "TOTAL", "Opening balances left out by the fair filter", "", "", "", "", "", money(report.excludedOpeningBalancesPaise)]);
  return table(
    ["Customer", "Kind", "Number", "Date", "Due date", "Fair", "Total", "Settled", "Outstanding"], rows,
    ["Date", "Due date", "Total", "Settled", "Outstanding"],
  );
}

function collectionsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const report = repository.getCollections(reportFilter("collections", scope));
  const fairs = lookups(repository).fairs;
  const rows: string[][] = report.rows.map((r) => [
    report.asAtDate, r.customerName, text(r.email), text(r.phone), text(r.phone2), r.kind, r.number, r.date, r.dueOn,
    r.dueDateBasis, int(r.daysOverdue), r.fairId === null ? "" : fairs.get(r.fairId) ?? "", money(r.totalPaise), money(r.outstandingPaise),
  ]);
  rows.push([report.asAtDate, "", "", "", "", "TOTAL", "Total overdue", "", "", "", "", "", "", money(report.totalOverduePaise)]);
  return table(
    ["As at", "Customer", "Email", "Phone", "Phone 2", "Kind", "Number", "Date", "Due on", "Due date basis", "Days overdue", "Fair", "Total", "Outstanding"],
    rows, ["As at", "Date", "Due on", "Days overdue", "Total", "Outstanding"],
  );
}

function stockAgeingTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const report = repository.getStockAgeing(reportFilter("stock-ageing", scope));
  const bands = report.totals.buckets.map((b) => b.label);
  const columns = ["As at", "Item", "Unit", ...bands.flatMap((b) => [`${b} quantity`, `${b} value`]), "Quantity", "Value"];
  const rows: string[][] = report.rows.map((r) => [
    report.asAtDate, r.itemName, r.unit,
    ...r.buckets.flatMap((b) => [int(b.quantity), money(b.valuePaise)]), int(r.quantity), money(r.valuePaise),
  ]);
  rows.push([
    report.asAtDate, "Total", "",
    ...report.totals.buckets.flatMap((b) => [int(b.quantity), money(b.valuePaise)]), int(report.totals.quantity), money(report.totals.valuePaise),
  ]);
  return table(columns, rows, columns.filter((c) => c !== "Item" && c !== "Unit"));
}

function inventoryValuationDetailTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const report = repository.getInventoryValuationDetail(reportFilter("inventory-valuation-detail", scope));
  const rows: string[][] = report.rows.map((r) => [
    report.asAtDate, r.itemName, r.unit, r.receivedOn, r.dateBasis, int(r.ageDays), int(r.quantity),
    money(r.unitCostPaise), money(r.valuePaise), text(r.sourceId),
  ]);
  rows.push([report.asAtDate, "Total", "", "", "", "", int(report.totals.quantity), "", money(report.totals.valuePaise), ""]);
  return table(
    ["As at", "Item", "Unit", "Received on", "Date basis", "Age days", "Quantity", "Unit cost", "Value", "Source ID"],
    rows, ["As at", "Received on", "Age days", "Quantity", "Unit cost", "Value"],
  );
}

function itemProfitabilityTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const report = repository.getItemProfitability(reportFilter("item-profitability", scope));
  const rows: string[][] = report.rows.map((r) => [
    r.itemName, text(r.unit), int(r.netQuantity), money(r.netSalesPaise), money(r.cogsPaise), money(r.grossMarginPaise),
  ]);
  rows.push(["Total", "", "", money(report.totals.netSalesPaise), money(report.totals.cogsPaise), money(report.totals.grossMarginPaise)]);
  return table(["Item", "Unit", "Net quantity", "Net sales", "Cost of goods sold", "Gross margin"], rows, ["Net quantity", "Net sales", "Cost of goods sold", "Gross margin"]);
}

export function buildExport(repository: AccountingRepository, dataset: ExportDataset, scope: ExportScope = {}): ExportTable {
  switch (dataset) {
    case "customers": return customersTable(repository, scope);
    case "suppliers": return suppliersTable(repository, scope);
    case "items": return itemsTable(repository, scope);
    case "invoices": return invoicesTable(repository, scope);
    case "credit-notes": return creditNotesTable(repository, scope);
    case "payments": return paymentsTable(repository, scope);
    case "purchase-bills": return purchaseBillsTable(repository, scope);
    case "supplier-payments": return supplierPaymentsTable(repository, scope);
    case "stock-movements": return stockMovementsTable(repository, scope);
    case "journal-entries": return journalEntriesTable(repository, scope);
    case "trial-balance": return trialBalanceTable(repository, scope);
    case "profit-and-loss": return profitAndLossTable(repository, scope);
    case "balance-sheet": return balanceSheetTable(repository, scope);
    case "customer-statement": return customerStatementTable(repository, scope);
    case "customer-balance-detail": return customerBalanceDetailTable(repository, scope);
    case "collections": return collectionsTable(repository, scope);
    case "stock-ageing": return stockAgeingTable(repository, scope);
    case "inventory-valuation-detail": return inventoryValuationDetailTable(repository, scope);
    case "item-profitability": return itemProfitabilityTable(repository, scope);
  }
}

// ---- encoders ---------------------------------------------------------------------------------

const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string, guard: boolean): string {
  const safe = guard && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 BOM, CRLF line ends, RFC 4180 quoting, formula guard on text columns only. */
export function toCsv(exported: ExportTable): string {
  const nonText = new Set(exported.nonTextColumns);
  const lines = [exported.columns.map((c) => csvCell(c, false)).join(",")];
  for (const row of exported.rows) lines.push(row.map((cell, i) => csvCell(cell, !nonText.has(i))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export interface JsonExport {
  readonly dataset: string;
  readonly exportedAt: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, string>[];
}

export function toJsonExport(dataset: string, exported: ExportTable, exportedAt: string): JsonExport {
  return {
    dataset,
    exportedAt,
    columns: exported.columns,
    rows: exported.rows.map((row) => Object.fromEntries(exported.columns.map((column, i) => [column, row[i] ?? ""]))),
  };
}
