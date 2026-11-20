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
 *  - payments:          Invoice number*, Amount*, Paid on*, Status
 *  - supplier-payments: Bill number*, Amount*, Paid on*, Status
 *  (* = required.) Invoices, bills and credit notes are grouped by Number: one unit = one document.
 *
 * Choices the spec left open (all recorded here, none silent):
 *  - Payment account. An imported invoice is a CREDIT invoice ("RECEIVABLES") and an imported bill is
 *    "PAYABLES" unless the bill's Payment account cell says CASH. That is the only way a payment can
 *    be recorded against it later (the repository refuses payments on cash documents).
 *  - Opening-balance date = the latest `asAt` among the business's general opening sets and its
 *    customer and supplier opening balances. A REVERSED opening set no longer counts, so it does not
 *    block the dates it used to cover.
 *  - A later row of a document may leave a header cell BLANK (not a disagreement); a different
 *    non-blank value, or a value where the first row was blank, fails the unit naming the field.
 *  - A Status cell that is not blank / Finalized / Active (e.g. Cancelled, Draft) is SKIPPED: the
 *    importer posts live documents only, it never resurrects a cancelled one.
 *  - A document whose number already exists is SKIPPED before any other check, so re-running a file
 *    is always safe, whatever has changed since.
 *  - A payment identical in document, amount and date to a non-cancelled one is SKIPPED, which also
 *    means two genuinely equal payments on the same day are imported once. That is the S14-3 rule.
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

/** Latest as-at date over the business's live opening sets (general, customer, supplier). */
function latestOpeningDate(repository: AccountingRepository, businessId: string): string | undefined {
  const dates = [
    ...repository.getOpeningBalances(businessId).filter((s) => s.reversedAt === null).map((s) => s.asAt),
    ...repository.listOpeningCustomerBalances(businessId).filter((s) => s.reversedAt === null).map((s) => s.asAt),
    ...repository.listOpeningSupplierBalances(businessId).filter((s) => s.reversedAt === null).map((s) => s.asAt),
  ];
  return dates.reduce<string | undefined>((latest, d) => (latest === undefined || d > latest ? d : latest), undefined);
}

function assertAfterOpening(context: ImportContext, businessId: string, date: string, what: string): void {
  const opening = latestOpeningDate(context.repository, businessId);
  if (opening !== undefined && date <= opening) {
    throw new ImportRowError(
      `${what}: dated on or before the opening balances of ${opening} — would count twice (the document is dated ${date}).`,
    );
  }
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
}

function lookups(context: ImportContext): Lookups {
  const r = context.repository;
  const one = <T extends { id: string; name: string }>(kindName: string, list: readonly T[], name: string): T => {
    const wanted = normaliseName(name);
    const hits = list.filter((x) => normaliseName(x.name) === wanted);
    if (hits.length === 0) throw new ImportRowError(`${kindName} "${name}" was not found.`);
    if (hits.length > 1) throw new ImportRowError(`More than one ${kindName.toLowerCase()} is named "${name}"; rename one so the file can name it.`);
    return hits[0] as T;
  };
  return {
    customer: (n) => one("Customer", r.listCustomers(context.companyId), n),
    supplier: (n) => one("Supplier", r.listSuppliers(context.companyId), n),
    item: (n) => one("Item", r.listItems(context.companyId), n),
    fair: (n) => one("Fair", r.listFairs(context.companyId), n),
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
    if (repo.listInvoices(businessId).some((i) => normaliseName(i.number) === wanted)) return skipped(number, "already exists");
    if (inactiveStatus(val(first, "status"))) return skipped(number, `status is "${val(first, "status")}"; only finalized documents are imported`);
    checkHeader(rows, INVOICE_FIELDS, INVOICE_HEADER_KEYS, number);

    const look = lookups(context);
    const customer = look.customer(requireValue(first, "customer", "Customer"));
    const invoiceDate = parsed(first, "Invoice date", requireValue(first, "invoiceDate", "Invoice date"), (t) => parseDate(t, context.dateFormat));
    const dueText = val(first, "dueDate");
    const dueDate = dueText === "" ? undefined : parsed(first, "Due date", dueText, (t) => parseDate(t, context.dateFormat));
    assertAfterOpening(context, businessId, invoiceDate, `Invoice ${number}`);
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
    repo.finalizeInvoice(id);
    return created(number);
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
  field("fair", "Fair", false, ["Project"]),
  field("notes", "Notes", false, ["Remarks"]),
];
const BILL_HEADER_KEYS = [
  "supplier", "billDate", "dueDate", "supplierInvoiceNumber", "discount", "extraCharge", "taxType", "taxRate", "paymentAccount", "fair",
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
    if (repo.listPurchaseBills({ businessId }).some((b) => normaliseName(b.number) === wanted)) return skipped(number, "already exists");
    if (inactiveStatus(val(first, "status"))) return skipped(number, `status is "${val(first, "status")}"; only finalized documents are imported`);
    checkHeader(rows, BILL_FIELDS, BILL_HEADER_KEYS, number);

    const look = lookups(context);
    const supplier = look.supplier(requireValue(first, "supplier", "Supplier"));
    const billDate = parsed(first, "Bill date", requireValue(first, "billDate", "Bill date"), (t) => parseDate(t, context.dateFormat));
    const dueText = val(first, "dueDate");
    const dueDate = dueText === "" ? undefined : parsed(first, "Due date", dueText, (t) => parseDate(t, context.dateFormat));
    assertAfterOpening(context, businessId, billDate, `Bill ${number}`);
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
    const lines = readLines(rows, look);

    const bill = repo.createPurchaseBill({
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
    repo.finalizePurchaseBill(bill.id);
    return created(number);
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
    const invoices = repo.listInvoices(businessId);
    const businessInvoiceIds = new Set(invoices.map((i) => i.id));
    const wanted = normaliseName(number);
    if (repo.listCreditNotes().some((n) => businessInvoiceIds.has(n.invoiceId) && normaliseName(n.number) === wanted)) {
      return skipped(number, "already exists");
    }
    if (inactiveStatus(val(first, "status"))) return skipped(number, `status is "${val(first, "status")}"; only finalized documents are imported`);
    checkHeader(rows, CREDIT_NOTE_FIELDS, CREDIT_NOTE_HEADER_KEYS, number);

    const invoiceNumber = requireValue(first, "invoiceNumber", "Invoice number");
    const invoice = invoices.find((i) => normaliseName(i.number) === normaliseName(invoiceNumber));
    if (invoice === undefined) throw new ImportRowError(`Invoice "${invoiceNumber}" was not found in this business.`);
    const noteDate = parsed(first, "Note date", requireValue(first, "noteDate", "Note date"), (t) => parseDate(t, context.dateFormat));
    assertAfterOpening(context, businessId, noteDate, `Credit note ${number}`);
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
    repo.finalizeCreditNote(id, { confirmBackdatedMonth: true });
    return created(number);
  },
};

// ---------------------------------------------------------------- payments
/** The IST calendar date of a stored payment instant (payments are stored at 12:00 IST). */
const istDay = (instant: string): string => new Date(Date.parse(instant) + 330 * 60_000).toISOString().slice(0, 10);

const PAYMENT_FIELDS: readonly ImportField[] = [
  field("invoiceNumber", "Invoice number", true, ["Invoice", "Invoice no"]),
  field("amount", "Amount", true, ["Paid", "Payment amount"]),
  field("paidOn", "Paid on", true, ["Date", "Payment date"]),
  field("status", "Status", false),
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
    const invoice = repo.listInvoices(businessId).find((i) => normaliseName(i.number) === normaliseName(invoiceNumber));
    if (invoice === undefined) throw new ImportRowError(`Invoice "${invoiceNumber}" was not found in this business.`);
    const amountPaise = parsed(row, "Amount", requireValue(row, "amount", "Amount"), (t) => parseRupeesToPaise(t));
    const paidOn = parsed(row, "Paid on", requireValue(row, "paidOn", "Paid on"), (t) => parseDate(t, context.dateFormat));
    if (repo.listPayments(invoice.id).some((p) => p.cancelledAt === null && p.amountPaise === amountPaise && istDay(p.paidAt) === paidOn)) {
      return skipped(reference, "already exists");
    }
    assertAfterOpening(context, businessId, paidOn, `Payment for invoice ${invoiceNumber}`);
    repo.recordPayment(invoice.id, amountPaise, paidOn);
    return created(reference);
  },
};

const SUPPLIER_PAYMENT_FIELDS: readonly ImportField[] = [
  field("billNumber", "Bill number", true, ["Bill", "Bill no"]),
  field("amount", "Amount", true, ["Paid", "Payment amount"]),
  field("paidOn", "Paid on", true, ["Date", "Payment date"]),
  field("status", "Status", false),
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
    const bill = repo.listPurchaseBills({ businessId }).find((b) => normaliseName(b.number) === normaliseName(billNumber));
    if (bill === undefined) throw new ImportRowError(`Bill "${billNumber}" was not found in this business.`);
    const amountPaise = parsed(row, "Amount", requireValue(row, "amount", "Amount"), (t) => parseRupeesToPaise(t));
    const paidOn = parsed(row, "Paid on", requireValue(row, "paidOn", "Paid on"), (t) => parseDate(t, context.dateFormat));
    if (repo.listSupplierPayments({ billId: bill.id }).some((p) => p.cancelledAt === null && p.amountPaise === amountPaise && istDay(p.paidAt) === paidOn)) {
      return skipped(reference, "already exists");
    }
    assertAfterOpening(context, businessId, paidOn, `Payment for bill ${billNumber}`);
    repo.recordSupplierPayment({ billId: bill.id, amountPaise, paidOn });
    return created(reference);
  },
};

export const DOCUMENT_IMPORT_KINDS: readonly ImportKindDefinition[] = [
  invoicesKind,
  purchaseBillsKind,
  creditNotesKind,
  paymentsKind,
  supplierPaymentsKind,
];
