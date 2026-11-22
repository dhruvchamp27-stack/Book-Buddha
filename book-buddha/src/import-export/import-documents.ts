/**
 * Document imports (R10-D): invoices, purchase bills, credit notes and the payments against them.
 *
 * Every kind here is scope BUSINESS. A document is POSTED (finalized) on its own date, through
 * exactly the repository methods a person uses by hand (`saveDraft` + `finalizeInvoice`,
 * `createPurchaseBill` + `finalizePurchaseBill`, `saveCreditNote` + `finalizeCreditNote`,
 * `recordPayment`, `recordSupplierPayment`), so the double entry, the FIFO stock and the audit
 * trail all happen underneath (rulings S14-3). Nothing is posted to the journal from here.
 *
 * Fields per kind (labels match the exports so an exported file imports straight back):
 *  - invoices:          Number*, Invoice date*, Due date, Customer*, Status, Item, Description,
 *                       Quantity*, Unit price*, Discount, Extra charge, Tax type, Tax rate, Fair, Notes
 *  - purchase-bills:    Number*, Supplier invoice number, Bill date*, Due date, Supplier*, Status, Item,
 *                       Description, Quantity*, Unit price*, Discount, Extra charge, Tax type, Tax rate,
 *                       Payment account, Fair, Notes
 *  - credit-notes:      Number*, Invoice number*, Note date*, Reason*, Item, Description, Quantity*,
 *                       Unit price*   (the export calls the date "Credit note date"; a synonym)
 *  - expenses:          Number*, Expense date*, Supplier, Category, Status, Description*, Amount*, Tax type,
 *                       Tax rate, Payment account, Money account, Payment mode, Reference, Fair
 *                       (grouped by Number; lines are folded into one expense - see expensesKind)
 *  - payments:          Invoice number*, Amount*, Paid on*, Status
 *  - supplier-payments: Bill number*, Amount*, Paid on*, Status
 *  (* = required.) Invoices, bills and credit notes are grouped by Number: one unit = one document.
 *
 * Choices the spec left open (all recorded here, none silent):
 *  - Payment account. An imported invoice is a CREDIT invoice ("RECEIVABLES") and an imported bill is
 *    "PAYABLES" unless the bill's Payment account cell says CASH. That is the only way a payment can
 *    be recorded against it later (the repository refuses payments on cash documents).
 *  - Opening date = `repository.openingDateOf` (the latest `asAt` among the business's live general,
 *    customer and supplier opening sets). A row dated on or before it is KEPT AS HISTORY (F): not
 *    refused, not journalled, reported as "kept as history (before opening date)". A reversed
 *    opening set no longer counts.
 *  - A later row of a document may leave a header cell BLANK (not a disagreement); a different
 *    non-blank value, or a value where the first row was blank, fails the unit naming the field.
 *  - A Status cell that is not blank / Finalized / Active (e.g. Cancelled, Draft) is SKIPPED: the
 *    importer posts live documents only, it never resurrects a cancelled one.
 *  - A document whose number already exists is SKIPPED before any other check, so re-running a file
 *    is always safe, whatever has changed since.
 *  - Speed. "Already exists" and name lookups would otherwise re-read whole lists once per document
 *    (quadratic). Each run keeps ONE index per list, built on first use and cached against the
 *    run's context object (the engine hands every unit the same one). A document is added to an
 *    index only AFTER all its writes have succeeded (the last step of `post`), so a unit that
 *    throws - and is rolled back by its savepoint - never leaves a ghost entry behind.
 *  - Equal payments (same document, amount, IST day) WITHIN one file all import; an equal payment
 *    already in the books before the run (an earlier import or hand-entered) is a duplicate. This is
 *    count-based (S16-3): each run snapshots the live equal-payment counts per document the first
 *    time it meets it, and the k-th equal row of the file is skipped only if the snapshot holds >= k.
 *    So re-importing a file skips every row, and a file with two equal rows of which one already
 *    exists imports one. The snapshot is never updated by the run's own rows, so preview == commit.
 */
import { randomUUID } from "node:crypto";
import type { CreditNote, Invoice, InvoiceTaxType, PurchasePaymentAccount } from "../accounting/types.js";
import type { AccountingRepository } from "../database/repository.js";
import {
  normaliseName,
  parseDate,
  parseQuantity,
  parseRupeesToPaise,
  parseTaxRateToBasisPoints,
} from "./codec.js";
import {
  ImportRowError,
  type ImportContext,
  type ImportField,
  type ImportKindDefinition,
  type MappedRow,
  type UnitOutcome,
} from "./import-engine.js";

// ---------------------------------------------------------------- small helpers
const field = (key: string, label: string, required: boolean, synonyms: readonly string[] = []): ImportField => ({
  key, label, required, synonyms,
});

const val = (row: MappedRow, key: string): string => (row.values[key] ?? "").trim();

/** Run a parser; on failure say which row and which column. */
function parsed<T>(row: MappedRow, label: string, text: string, parse: (t: string) => T): T {
  try {
    return parse(text);
  } catch (error) {
    throw new ImportRowError(`Row ${row.rowNumber}: ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireValue(row: MappedRow, key: string, label: string): string {
  const v = val(row, key);
  if (v === "") throw new ImportRowError(`Row ${row.rowNumber}: "${label}" is required but is blank.`);
  return v;
}

function businessOf(context: ImportContext): string {
  if (context.businessId === undefined || context.businessId === "") {
    throw new ImportRowError("Choose a business: documents are always imported into one business.");
  }
  return context.businessId;
}

/**
 * The exports now carry a "Before opening" column (Yes / blank). It is accepted on import so an
 * exported file maps straight back, and IGNORED: whether a row is history is decided afresh from
 * its date and the business's opening date, never from this cell.
 */
const BEFORE_OPENING_FIELD: ImportField = field("beforeOpening", "Before opening", false);

/** What the preview / commit says of a row that was kept as history instead of being posted. */
const HISTORY_MESSAGE = "kept as history (before opening date)";

/**
 * F (S16-2(c), Q13): a row dated on or before the business's opening date is kept as HISTORY - not
 * refused. The rule itself is the repository's (`openingDateOf`, the one place that decides it);
 * document runs never write opening balances, so the date is read once per run.
 */
function isHistoryDate(context: ImportContext, businessId: string, date: string): boolean {
  const cache = cacheOf(context);
  cache.openingDate ??= { value: context.repository.openingDateOf(businessId) };
  const opening = cache.openingDate.value;
  return opening !== undefined && date <= opening;
}

/** Not blank / Finalized / Active means "do not post this row as a live document". */
function inactiveStatus(text: string): boolean {
  const s = text.trim().toUpperCase();
  return !(s === "" || s === "FINALIZED" || s === "FINALISED" || s === "ACTIVE");
}

/**
 * Header cells come from the first row of the document. A later non-blank cell that differs
 * (or fills a cell the first row left blank) fails the unit and names the field.
 */
function checkHeader(rows: readonly MappedRow[], fields: readonly ImportField[], keys: readonly string[], number: string): void {
  const first = rows[0];
  if (first === undefined) return;
  for (const key of keys) {
    const label = fields.find((f) => f.key === key)?.label ?? key;
    const base = val(first, key);
    for (const row of rows.slice(1)) {
      const v = val(row, key);
      if (v !== "" && normaliseName(v) !== normaliseName(base)) {
        throw new ImportRowError(
          `Row ${row.rowNumber}: "${label}" is "${v}" but row ${first.rowNumber} has "${base}". Every row of ${number} must agree on "${label}".`,
        );
      }
    }
  }
}

function parseTaxType(row: MappedRow, text: string): InvoiceTaxType {
  const s = text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (s === "" || s === "NONE") return "NONE";
  if (s === "CGST_SGST" || s === "SGST_CGST") return "CGST_SGST";
  if (s === "IGST") return "IGST";
  throw new ImportRowError(`Row ${row.rowNumber}: Tax type: "${text.trim()}" is not NONE, CGST_SGST or IGST.`);
}

interface Lookups {
  customer(name: string): { id: string };
  supplier(name: string): { id: string };
  item(name: string): { id: string; name: string };
  fair(name: string): { id: string };
  category(name: string): { id: string };
}

// ---------------------------------------------------------------- per-run indexes (speed)
interface NumberedRef { readonly id: string; readonly number: string }
interface NamedRef { readonly id: string; readonly name: string }
interface RunCache {
  invoices?: Map<string, NumberedRef>;
  bills?: Map<string, NumberedRef>;
  expenses?: Map<string, NumberedRef>;
  creditNotes?: Set<string>;
  openingDate?: { value: string | undefined };
  lists?: Partial<Record<"customers" | "suppliers" | "items" | "fairs" | "categories", Map<string, NamedRef[]>>>;
  /** Payments: per document, live equal-payment counts as they stood BEFORE this run touched it. */
  paymentSnapshots?: Map<string, Map<string, number>>;
  /** Payments: how many equal rows of this file have been seen so far, per document|amount|day. */
  paymentSeen?: Map<string, number>;
}
const runCaches = new WeakMap<ImportContext, RunCache>();
function cacheOf(context: ImportContext): RunCache {
  let cache = runCaches.get(context);
  if (cache === undefined) {
    cache = {};
    runCaches.set(context, cache);
  }
  return cache;
}

function invoiceIndex(context: ImportContext, businessId: string): Map<string, NumberedRef> {
  const cache = cacheOf(context);
  if (cache.invoices === undefined) {
    const map = new Map<string, NumberedRef>();
    for (const i of context.repository.listInvoices(businessId)) map.set(normaliseName(i.number), { id: i.id, number: i.number });
    cache.invoices = map;
  }
  return cache.invoices;
}

function billIndex(context: ImportContext, businessId: string): Map<string, NumberedRef> {
  const cache = cacheOf(context);
  if (cache.bills === undefined) {
    const map = new Map<string, NumberedRef>();
    for (const b of context.repository.listPurchaseBills({ businessId })) map.set(normaliseName(b.number), { id: b.id, number: b.number });
    cache.bills = map;
  }
  return cache.bills;
}

function expenseIndex(context: ImportContext, businessId: string): Map<string, NumberedRef> {
  const cache = cacheOf(context);
  if (cache.expenses === undefined) {
    const map = new Map<string, NumberedRef>();
    for (const e of context.repository.listExpenses({ businessId })) map.set(normaliseName(e.number), { id: e.id, number: e.number });
    cache.expenses = map;
  }
  return cache.expenses;
}

/** Normalised numbers of the business's credit notes. */
function creditNoteIndex(context: ImportContext, businessId: string): Set<string> {
  const cache = cacheOf(context);
  if (cache.creditNotes === undefined) {
    const invoiceIds = new Set([...invoiceIndex(context, businessId).values()].map((i) => i.id));
    cache.creditNotes = new Set(
      context.repository.listCreditNotes().filter((n) => invoiceIds.has(n.invoiceId)).map((n) => normaliseName(n.number)),
    );
  }
  return cache.creditNotes;
}

function lookups(context: ImportContext): Lookups {
  const r = context.repository;
  const one = (which: "customers" | "suppliers" | "items" | "fairs" | "categories", kindName: string, load: () => readonly NamedRef[], name: string): NamedRef => {
    const cache = cacheOf(context);
    cache.lists ??= {};
    let byName = cache.lists[which];
    if (byName === undefined) {
      byName = new Map();
      for (const x of load()) {
        const key = normaliseName(x.name);
        byName.set(key, [...(byName.get(key) ?? []), x]);
      }
      cache.lists[which] = byName;
    }
    const hits = byName.get(normaliseName(name)) ?? [];
    if (hits.length === 0) throw new ImportRowError(`${kindName} "${name}" was not found.`);
    if (hits.length > 1) throw new ImportRowError(`More than one ${kindName.toLowerCase()} is named "${name}"; rename one so the file can name it.`);
    return hits[0] as NamedRef;
  };
  return {
    customer: (n) => one("customers", "Customer", () => r.listCustomers(context.companyId), n),
    supplier: (n) => one("suppliers", "Supplier", () => r.listSuppliers(context.companyId), n),
    item: (n) => one("items", "Item", () => r.listItems(context.companyId), n),
    fair: (n) => one("fairs", "Fair", () => r.listFairs(context.companyId), n),
    category: (n) => one("categories", "Expense category", () => r.listExpenseCategories(context.companyId), n),
  };
}

interface ParsedLine { itemId?: string; description: string; quantity: number; unitPricePaise: number }

function readLines(rows: readonly MappedRow[], look: Lookups): ParsedLine[] {
  return rows.map((row) => {
    const itemName = val(row, "item");
    const item = itemName === "" ? undefined : look.item(itemName);
    const description = val(row, "description") !== "" ? val(row, "description") : item?.name ?? "";
    if (description === "") throw new ImportRowError(`Row ${row.rowNumber}: give a Description or an Item for this line.`);
    return {
      ...(item === undefined ? {} : { itemId: item.id }),
      description,
      quantity: parsed(row, "Quantity", requireValue(row, "quantity", "Quantity"), parseQuantity),
      unitPricePaise: parsed(row, "Unit price", requireValue(row, "unitPrice", "Unit price"), (t) => parseRupeesToPaise(t)),
    };
  });
}

const optionalMoney = (row: MappedRow, key: string, label: string): number => {
  const v = val(row, key);
  return v === "" ? 0 : parsed(row, label, v, (t) => parseRupeesToPaise(t));
};

const optionalRate = (row: MappedRow): number => {
  const v = val(row, "taxRate");
  return v === "" ? 0 : parsed(row, "Tax rate", v, parseTaxRateToBasisPoints);
};

const created = (reference: string, message?: string): UnitOutcome =>
  ({ status: "CREATED", reference, ...(message === undefined ? {} : { message }) });
const skipped = (reference: string, message: string): UnitOutcome => ({ status: "SKIPPED", reference, message });

// ---------------------------------------------------------------- invoices
const INVOICE_FIELDS: readonly ImportField[] = [
  field("number", "Number", true, ["Invoice number", "Invoice no", "Invoice #"]),
  field("invoiceDate", "Invoice date", true, ["Date"]),
  field("dueDate", "Due date", false, ["Due"]),
  field("customer", "Customer", true, ["Customer name", "Bill to"]),
  field("status", "Status", false),
  field("item", "Item", false, ["Item name", "Product"]),
  field("description", "Description", false, ["Particulars"]),
  field("quantity", "Quantity", true, ["Qty"]),
  field("unitPrice", "Unit price", true, ["Price", "Rate"]),
  field("discount", "Discount", false),
  field("extraCharge", "Extra charge", false, ["Extra charges", "Freight"]),
  field("taxType", "Tax type", false, ["GST type"]),
  field("taxRate", "Tax rate", false, ["GST rate", "GST %", "Tax %"]),
  field("fair", "Fair", false, ["Project"]),
  field("notes", "Notes", false, ["Remarks"]),
  BEFORE_OPENING_FIELD,
];
const INVOICE_HEADER_KEYS = ["customer", "invoiceDate", "dueDate", "discount", "extraCharge", "taxType", "taxRate", "fair"];

const invoicesKind: ImportKindDefinition = {
  kind: "invoices",
  scope: "BUSINESS",
  fields: INVOICE_FIELDS,
  groupBy: "number",
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const repo = context.repository;
    const first = rows[0] as MappedRow;
    const number = requireValue(first, "number", "Number");
    const wanted = normaliseName(number);
    const invoices = invoiceIndex(context, businessId);
    if (invoices.has(wanted)) return skipped(number, "already exists");
    if (inactiveStatus(val(first, "status"))) return skipped(number, `status is "${val(first, "status")}"; only finalized documents are imported`);
    checkHeader(rows, INVOICE_FIELDS, INVOICE_HEADER_KEYS, number);

    const look = lookups(context);
    const customer = look.customer(requireValue(first, "customer", "Customer"));
    const invoiceDate = parsed(first, "Invoice date", requireValue(first, "invoiceDate", "Invoice date"), (t) => parseDate(t, context.dateFormat));
    const dueText = val(first, "dueDate");
    const dueDate = dueText === "" ? undefined : parsed(first, "Due date", dueText, (t) => parseDate(t, context.dateFormat));
    const history = isHistoryDate(context, businessId, invoiceDate);
    const fairName = val(first, "fair");
    const fair = fairName === "" ? undefined : look.fair(fairName);
    const taxType = parseTaxType(first, val(first, "taxType"));
    const notes = val(first, "notes");
    const lines = readLines(rows, look);

    const id = randomUUID();
    const invoice: Invoice = {
      id,
      number,
      businessId,
      customerId: customer.id,
      invoiceDate,
      ...(dueDate === undefined ? {} : { dueDate }),
      discountPaise: optionalMoney(first, "discount", "Discount"),
      extraChargePaise: optionalMoney(first, "extraCharge", "Extra charge"),
      ...(notes === "" ? {} : { notes }),
      taxType,
      taxRateBasisPoints: optionalRate(first),
      ...(fair === undefined ? {} : { fairId: fair.id }),
      paymentAccount: "RECEIVABLES",
      status: "DRAFT",
      lines,
    };
    repo.saveDraft(invoice);
    repo.finalizeInvoice(id, { confirmBeforeOpening: true });
    invoices.set(wanted, { id, number }); // last step, nothing below can throw: a rolled-back unit leaves no entry
    return created(number, history ? HISTORY_MESSAGE : undefined);
  },
};

// ---------------------------------------------------------------- purchase bills
const BILL_FIELDS: readonly ImportField[] = [
  field("number", "Number", true, ["Bill number", "Bill no", "Bill #"]),
  field("supplierInvoiceNumber", "Supplier invoice number", false, ["Supplier invoice", "Vendor invoice number"]),
  field("billDate", "Bill date", true, ["Date"]),
  field("dueDate", "Due date", false, ["Due"]),
  field("supplier", "Supplier", true, ["Supplier name", "Vendor"]),
  field("status", "Status", false),
  field("item", "Item", false, ["Item name", "Product"]),
  field("description", "Description", false, ["Particulars"]),
  field("quantity", "Quantity", true, ["Qty"]),
  field("unitPrice", "Unit price", true, ["Price", "Rate", "Cost"]),
  field("discount", "Discount", false),
  field("extraCharge", "Extra charge", false, ["Extra charges", "Freight"]),
  field("taxType", "Tax type", false, ["GST type"]),
  field("taxRate", "Tax rate", false, ["GST rate", "GST %", "Tax %"]),
  field("paymentAccount", "Payment account", false),
  // R12b. Only meaningful on a bill paid at once (Payment account CASH): which cash/bank account.
  field("moneyAccount", "Money account", false, ["Paid from", "Bank account"]),
  field("paymentMode", "Payment mode", false, ["Mode"]),
  field("paymentReference", "Reference", false, ["Payment reference", "UTR", "Cheque number"]),
  field("fair", "Fair", false, ["Project"]),
  field("notes", "Notes", false, ["Remarks"]),
  BEFORE_OPENING_FIELD,
];
const BILL_HEADER_KEYS = [
  "supplier", "billDate", "dueDate", "supplierInvoiceNumber", "discount", "extraCharge", "taxType", "taxRate", "paymentAccount",
  "moneyAccount", "paymentMode", "paymentReference", "fair",
];

const purchaseBillsKind: ImportKindDefinition = {
  kind: "purchase-bills",
  scope: "BUSINESS",
  fields: BILL_FIELDS,
  groupBy: "number",
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const repo = context.repository;
    const first = rows[0] as MappedRow;
    const number = requireValue(first, "number", "Number");
    const wanted = normaliseName(number);
    const bills = billIndex(context, businessId);
    if (bills.has(wanted)) return skipped(number, "already exists");
    if (inactiveStatus(val(first, "status"))) return skipped(number, `status is "${val(first, "status")}"; only finalized documents are imported`);
    checkHeader(rows, BILL_FIELDS, BILL_HEADER_KEYS, number);

    const look = lookups(context);
    const supplier = look.supplier(requireValue(first, "supplier", "Supplier"));
    const billDate = parsed(first, "Bill date", requireValue(first, "billDate", "Bill date"), (t) => parseDate(t, context.dateFormat));
    const dueText = val(first, "dueDate");
    const dueDate = dueText === "" ? undefined : parsed(first, "Due date", dueText, (t) => parseDate(t, context.dateFormat));
    const history = isHistoryDate(context, businessId, billDate);
    const fairName = val(first, "fair");
    const fair = fairName === "" ? undefined : look.fair(fairName);
    const taxType = parseTaxType(first, val(first, "taxType"));
    const accountText = val(first, "paymentAccount").toUpperCase();
    if (accountText !== "" && accountText !== "CASH" && accountText !== "PAYABLES") {
      throw new ImportRowError(`Row ${first.rowNumber}: Payment account: "${val(first, "paymentAccount")}" is not CASH or PAYABLES.`);
    }
    const paymentAccount: PurchasePaymentAccount = accountText === "CASH" ? "CASH" : "PAYABLES";
    const supplierInvoiceNumber = val(first, "supplierInvoiceNumber");
    const notes = val(first, "notes");
    const moneyAccount = val(first, "moneyAccount");
    const paymentMode = val(first, "paymentMode");
    const paymentReference = val(first, "paymentReference");
    const lines = readLines(rows, look);

    const bill = repo.createPurchaseBill({
      ...(moneyAccount === "" ? {} : { moneyAccount }),
      ...(paymentMode === "" ? {} : { paymentMode }),
      ...(paymentReference === "" ? {} : { paymentReference }),
      businessId,
      supplierId: supplier.id,
      number,
      ...(supplierInvoiceNumber === "" ? {} : { supplierInvoiceNumber }),
      billDate,
      ...(dueDate === undefined ? {} : { dueDate }),
      ...(notes === "" ? {} : { notes }),
      taxType,
      taxRateBasisPoints: optionalRate(first),
      discountPaise: optionalMoney(first, "discount", "Discount"),
      extraChargePaise: optionalMoney(first, "extraCharge", "Extra charge"),
      paymentAccount,
      ...(fair === undefined ? {} : { fairId: fair.id }),
      lines,
    });
    repo.finalizePurchaseBill(bill.id, { confirmBeforeOpening: true });
    bills.set(wanted, { id: bill.id, number }); // last step: see the header note on indexes
    return created(number, history ? HISTORY_MESSAGE : undefined);
  },
};

// ---------------------------------------------------------------- expenses
/**
 * Expenses (Q17, S17-4c). An expense is ONE amount with ONE description in the books, so a file's
 * lines are folded into it: the Amounts are summed and the Descriptions joined with "; ". The
 * expense KEEPS the file's Number. Supplier and Category are matched by name (blank = none). A blank
 * Payment account means PAYABLES when a Supplier is named and CASH when not (an expense payable later
 * must name a supplier).
 */
const EXPENSE_FIELDS: readonly ImportField[] = [
  field("number", "Number", true, ["Expense number", "Expense no", "Expense #", "Voucher number", "Voucher no"]),
  field("expenseDate", "Expense date", true, ["Date"]),
  field("supplier", "Supplier", false, ["Supplier name", "Vendor", "Paid to"]),
  field("category", "Category", false, ["Expense category", "Head", "Account head"]),
  field("status", "Status", false),
  field("description", "Description", true, ["Particulars", "Narration", "Details"]),
  field("amount", "Amount", true, ["Line amount", "Value", "Cost"]),
  field("taxType", "Tax type", false, ["GST type"]),
  field("taxRate", "Tax rate", false, ["GST rate", "GST %", "Tax %"]),
  field("paymentAccount", "Payment account", false),
  field("moneyAccount", "Money account", false, ["Paid from", "Bank account"]),
  field("paymentMode", "Payment mode", false, ["Mode"]),
  field("paymentReference", "Reference", false, ["Payment reference", "UTR", "Cheque number"]),
  field("fair", "Fair", false, ["Project"]),
];
const EXPENSE_HEADER_KEYS = [
  "expenseDate", "supplier", "category", "taxType", "taxRate", "paymentAccount", "moneyAccount", "paymentMode", "paymentReference", "fair",
];

const expensesKind: ImportKindDefinition = {
  kind: "expenses",
  scope: "BUSINESS",
  fields: EXPENSE_FIELDS,
  groupBy: "number",
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const repo = context.repository;
    const first = rows[0] as MappedRow;
    const number = requireValue(first, "number", "Number");
    const wanted = normaliseName(number);
    const expenses = expenseIndex(context, businessId);
    if (expenses.has(wanted)) return skipped(number, "already exists");
    if (inactiveStatus(val(first, "status"))) return skipped(number, `status is "${val(first, "status")}"; only finalized documents are imported`);
    checkHeader(rows, EXPENSE_FIELDS, EXPENSE_HEADER_KEYS, number);

    const look = lookups(context);
    const supplierName = val(first, "supplier");
    const supplier = supplierName === "" ? undefined : look.supplier(supplierName);
    const categoryName = val(first, "category");
    const category = categoryName === "" ? undefined : look.category(categoryName);
    const expenseDate = parsed(first, "Expense date", requireValue(first, "expenseDate", "Expense date"), (t) => parseDate(t, context.dateFormat));
    const history = isHistoryDate(context, businessId, expenseDate);
    const fairName = val(first, "fair");
    const fair = fairName === "" ? undefined : look.fair(fairName);
    const taxType = parseTaxType(first, val(first, "taxType"));
    const accountText = val(first, "paymentAccount").toUpperCase();
    if (accountText !== "" && accountText !== "CASH" && accountText !== "PAYABLES") {
      throw new ImportRowError(`Row ${first.rowNumber}: Payment account: "${val(first, "paymentAccount")}" is not CASH or PAYABLES.`);
    }
    const paymentAccount: PurchasePaymentAccount = accountText === "" ? (supplier === undefined ? "CASH" : "PAYABLES") : (accountText as PurchasePaymentAccount);
    const moneyAccount = val(first, "moneyAccount");
    const paymentMode = val(first, "paymentMode");
    const paymentReference = val(first, "paymentReference");

    let amountPaise = 0;
    const descriptions: string[] = [];
    for (const r of rows) {
      descriptions.push(requireValue(r, "description", "Description"));
      amountPaise += parsed(r, "Amount", requireValue(r, "amount", "Amount"), (t) => parseRupeesToPaise(t));
    }

    const expense = repo.createExpense({
      ...(moneyAccount === "" ? {} : { moneyAccount }),
      ...(paymentMode === "" ? {} : { paymentMode }),
      ...(paymentReference === "" ? {} : { paymentReference }),
      businessId,
      ...(supplier === undefined ? {} : { supplierId: supplier.id }),
      ...(category === undefined ? {} : { categoryId: category.id }),
      ...(fair === undefined ? {} : { fairId: fair.id }),
      number,
      expenseDate,
      description: descriptions.join("; "),
      amountPaise,
      taxType,
      taxRateBasisPoints: optionalRate(first),
      paymentAccount,
    });
    repo.finalizeExpense(expense.id, { confirmBeforeOpening: true });
    expenses.set(wanted, { id: expense.id, number }); // last step: see the header note on indexes
    return created(number, history ? HISTORY_MESSAGE : undefined);
  },
};

// ---------------------------------------------------------------- credit notes
const CREDIT_NOTE_FIELDS: readonly ImportField[] = [
  field("number", "Number", true, ["Credit note number", "Credit note no"]),
  field("invoiceNumber", "Invoice number", true, ["Invoice", "Against invoice"]),
  field("noteDate", "Note date", true, ["Credit note date", "Date"]),
  field("reason", "Reason", true),
  field("status", "Status", false),
  field("item", "Item", false, ["Item name", "Product"]),
  field("description", "Description", false, ["Particulars"]),
  field("quantity", "Quantity", true, ["Qty"]),
  field("unitPrice", "Unit price", true, ["Price", "Rate"]),
  BEFORE_OPENING_FIELD,
];
const CREDIT_NOTE_HEADER_KEYS = ["invoiceNumber", "noteDate", "reason"];

const creditNotesKind: ImportKindDefinition = {
  kind: "credit-notes",
  scope: "BUSINESS",
  fields: CREDIT_NOTE_FIELDS,
  groupBy: "number",
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const repo = context.repository;
    const first = rows[0] as MappedRow;
    const number = requireValue(first, "number", "Number");
    const invoices = invoiceIndex(context, businessId);
    const notes = creditNoteIndex(context, businessId);
    const wanted = normaliseName(number);
    if (notes.has(wanted)) return skipped(number, "already exists");
    if (inactiveStatus(val(first, "status"))) return skipped(number, `status is "${val(first, "status")}"; only finalized documents are imported`);
    checkHeader(rows, CREDIT_NOTE_FIELDS, CREDIT_NOTE_HEADER_KEYS, number);

    const invoiceNumber = requireValue(first, "invoiceNumber", "Invoice number");
    const invoice = invoices.get(normaliseName(invoiceNumber));
    if (invoice === undefined) throw new ImportRowError(`Invoice "${invoiceNumber}" was not found in this business.`);
    const noteDate = parsed(first, "Note date", requireValue(first, "noteDate", "Note date"), (t) => parseDate(t, context.dateFormat));
    const history = isHistoryDate(context, businessId, noteDate);
    const lines = readLines(rows, lookups(context));

    const id = randomUUID();
    const note: CreditNote = {
      id,
      invoiceId: invoice.id,
      number,
      reason: requireValue(first, "reason", "Reason"),
      noteDate,
      status: "DRAFT",
      lines,
    };
    repo.saveCreditNote(note);
    // The preview is the user's confirmation that a date in an earlier month is what they mean.
    repo.finalizeCreditNote(id, { confirmBackdatedMonth: true, confirmBeforeOpening: true });
    notes.add(wanted); // last step: see the header note on indexes
    return created(number, history ? HISTORY_MESSAGE : undefined);
  },
};

// ---------------------------------------------------------------- payments
/** The IST calendar date of a stored payment instant (payments are stored at 12:00 IST). */
const istDay = (instant: string): string => new Date(Date.parse(instant) + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Repeated-payment rule (S16-3). `existing` are the document's live payments as listed NOW; the
 * snapshot of their equal-payment counts is taken the first time this run meets the document
 * (before any of this run's rows for it is posted) and never updated, so it behaves identically in
 * the preview and the commit. The k-th equal row of the file is a duplicate only if the snapshot
 * holds at least k equal payments.
 */
function isRepeatOfEarlierPayment(
  context: ImportContext,
  documentId: string,
  existing: () => ReadonlyArray<{ amountPaise: number; paidAt: string; cancelledAt: string | null }>,
  amountPaise: number,
  paidOn: string,
): boolean {
  const cache = cacheOf(context);
  const snapshots = (cache.paymentSnapshots ??= new Map());
  let snapshot = snapshots.get(documentId);
  if (snapshot === undefined) {
    snapshot = new Map<string, number>();
    for (const p of existing()) {
      if (p.cancelledAt !== null) continue;
      const key = `${p.amountPaise}|${istDay(p.paidAt)}`;
      snapshot.set(key, (snapshot.get(key) ?? 0) + 1);
    }
    snapshots.set(documentId, snapshot);
  }
  const seen = (cache.paymentSeen ??= new Map());
  const seenKey = `${documentId}|${amountPaise}|${paidOn}`;
  const k = (seen.get(seenKey) ?? 0) + 1;
  seen.set(seenKey, k);
  return (snapshot.get(`${amountPaise}|${paidOn}`) ?? 0) >= k;
}

const PAYMENT_FIELDS: readonly ImportField[] = [
  field("invoiceNumber", "Invoice number", true, ["Invoice", "Invoice no"]),
  field("amount", "Amount", true, ["Paid", "Payment amount"]),
  field("paidOn", "Paid on", true, ["Date", "Payment date"]),
  field("status", "Status", false),
  BEFORE_OPENING_FIELD,
];

const paymentsKind: ImportKindDefinition = {
  kind: "payments",
  scope: "BUSINESS",
  fields: PAYMENT_FIELDS,
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const repo = context.repository;
    const row = rows[0] as MappedRow;
    const invoiceNumber = requireValue(row, "invoiceNumber", "Invoice number");
    const reference = invoiceNumber;
    if (inactiveStatus(val(row, "status"))) return skipped(reference, `status is "${val(row, "status")}"; cancelled payments are not imported`);
    const invoice = invoiceIndex(context, businessId).get(normaliseName(invoiceNumber));
    if (invoice === undefined) throw new ImportRowError(`Invoice "${invoiceNumber}" was not found in this business.`);
    const amountPaise = parsed(row, "Amount", requireValue(row, "amount", "Amount"), (t) => parseRupeesToPaise(t));
    const paidOn = parsed(row, "Paid on", requireValue(row, "paidOn", "Paid on"), (t) => parseDate(t, context.dateFormat));
    if (isRepeatOfEarlierPayment(context, invoice.id, () => repo.listPayments(invoice.id), amountPaise, paidOn)) {
      return skipped(reference, "already exists");
    }
    const history = isHistoryDate(context, businessId, paidOn);
    repo.recordPayment(invoice.id, amountPaise, paidOn, {}, { confirmBeforeOpening: true });
    return created(reference, history ? HISTORY_MESSAGE : undefined);
  },
};

const SUPPLIER_PAYMENT_FIELDS: readonly ImportField[] = [
  field("billNumber", "Bill number", true, ["Bill", "Bill no"]),
  field("amount", "Amount", true, ["Paid", "Payment amount"]),
  field("paidOn", "Paid on", true, ["Date", "Payment date"]),
  field("status", "Status", false),
  BEFORE_OPENING_FIELD,
];

const supplierPaymentsKind: ImportKindDefinition = {
  kind: "supplier-payments",
  scope: "BUSINESS",
  fields: SUPPLIER_PAYMENT_FIELDS,
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const repo = context.repository;
    const row = rows[0] as MappedRow;
    const billNumber = requireValue(row, "billNumber", "Bill number");
    const reference = billNumber;
    if (inactiveStatus(val(row, "status"))) return skipped(reference, `status is "${val(row, "status")}"; cancelled payments are not imported`);
    const bill = billIndex(context, businessId).get(normaliseName(billNumber));
    if (bill === undefined) throw new ImportRowError(`Bill "${billNumber}" was not found in this business.`);
    const amountPaise = parsed(row, "Amount", requireValue(row, "amount", "Amount"), (t) => parseRupeesToPaise(t));
    const paidOn = parsed(row, "Paid on", requireValue(row, "paidOn", "Paid on"), (t) => parseDate(t, context.dateFormat));
    if (isRepeatOfEarlierPayment(context, bill.id, () => repo.listSupplierPayments({ billId: bill.id }), amountPaise, paidOn)) {
      return skipped(reference, "already exists");
    }
    const history = isHistoryDate(context, businessId, paidOn);
    repo.recordSupplierPayment({ billId: bill.id, amountPaise, paidOn, confirmBeforeOpening: true });
    return created(reference, history ? HISTORY_MESSAGE : undefined);
  },
};

export const DOCUMENT_IMPORT_KINDS: readonly ImportKindDefinition[] = [
  invoicesKind,
  purchaseBillsKind,
  creditNotesKind,
  paymentsKind,
  supplierPaymentsKind,
  expensesKind,
];
