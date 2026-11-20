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
import type { AccountingRepository } from "../database/repository.js";

export const EXPORT_DATASETS = [
  "customers", "suppliers", "items", "invoices", "credit-notes", "payments",
  "purchase-bills", "supplier-payments", "stock-movements", "journal-entries", "trial-balance",
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export interface ExportScope {
  readonly companyId?: string;
  readonly businessId?: string;
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
    "Discount", "Extra charge", "Tax type", "Tax rate", "Fair", "Notes",
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
    const tail = (): string[] => [
      money(invoice.discountPaise ?? 0), money(invoice.extraChargePaise ?? 0), invoice.taxType ?? "NONE",
      formatBasisPoints(invoice.taxRateBasisPoints ?? 0),
      invoice.fairId === undefined ? "" : l.fairs.get(invoice.fairId) ?? "", text(invoice.notes),
    ];
    if (invoice.lines.length === 0) rows.push([...head(), "", "", "", "", ...tail()]);
    for (const line of invoice.lines) {
      rows.push([...head(), itemName(l, line.itemId), line.description, int(line.quantity), money(line.unitPricePaise), ...tail()]);
    }
  }
  return table(columns, rows, ["Invoice date", "Due date", "Quantity", "Unit price", "Discount", "Extra charge", "Tax rate"]);
}

function creditNotesTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Number", "Credit note date", "Invoice number", "Customer", "Status", "Reason", "Item", "Description", "Quantity", "Unit price"];
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
      rows.push([...head(), itemName(l, line.itemId), line.description, int(line.quantity), money(line.unitPricePaise)]);
    }
  }
  return table(columns, rows, ["Credit note date", "Quantity", "Unit price"]);
}

function paymentsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Payment ID", "Invoice number", "Customer", "Paid on", "Amount", "Account", "Status", "Cancelled on", "Cancellation reason"];
  const l = lookups(repository);
  const businesses = businessIdsInScope(repository, scope);
  const rows: string[][] = [];
  for (const summary of [...repository.listInvoices()].reverse()) {
    if (!businesses.has(summary.businessId)) continue;
    for (const p of repository.listPayments(summary.id)) {
      rows.push([
        p.id, summary.number, l.customers.get(summary.customerId) ?? "", isoDay(p.paidAt), money(p.amountPaise),
        p.paymentAccount, p.cancelledAt === null ? "Active" : "Cancelled", isoDay(p.cancelledAt), text(p.cancellationReason),
      ]);
    }
  }
  return table(columns, rows, ["Paid on", "Amount", "Cancelled on"]);
}

function purchaseBillsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = [
    "Number", "Supplier invoice number", "Bill date", "Due date", "Supplier", "Status", "Item", "Description", "Quantity",
    "Unit price", "Discount", "Extra charge", "Tax type", "Tax rate", "Payment account", "Fair", "Notes",
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
    const tail = (): string[] => [
      money(bill.discountPaise), money(bill.extraChargePaise), bill.taxType, formatBasisPoints(bill.taxRateBasisPoints),
      text(bill.paymentAccount), bill.fairId === undefined ? "" : l.fairs.get(bill.fairId) ?? "", text(bill.notes),
    ];
    if (bill.lines.length === 0) rows.push([...head(), "", "", "", "", ...tail()]);
    for (const line of bill.lines) {
      rows.push([...head(), itemName(l, line.itemId), line.description, int(line.quantity), money(line.unitPricePaise), ...tail()]);
    }
  }
  return table(columns, rows, ["Bill date", "Due date", "Quantity", "Unit price", "Discount", "Extra charge", "Tax rate"]);
}

function supplierPaymentsTable(repository: AccountingRepository, scope: ExportScope): ExportTable {
  const columns = ["Payment ID", "Supplier", "Bill number", "Paid on", "Amount", "Account", "Status", "Cancelled on", "Cancellation reason"];
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
  const filter = scope.businessId === undefined ? {} : { businessId: scope.businessId };
  const rows = repository.getTrialBalance(filter).map((r) => [r.account, money(r.debitPaise), money(r.creditPaise)]);
  return table(columns, rows, ["Debit", "Credit"]);
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
