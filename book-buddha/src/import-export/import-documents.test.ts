import { describe, expect, it } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import type { ImportContext, ImportKindDefinition, MappedRow, UnitOutcome } from "./import-engine.js";
import { DOCUMENT_IMPORT_KINDS } from "./import-documents.js";
import { todayAt } from "../database/test-clock.js";

/**
 * R10-D. Each test calls a definition's `post(context, rows)` directly, inside
 * `repository.db.transaction(...)`, exactly as the engine does (one unit = one transaction), with
 * hand-built mapped rows. Cells are RUPEES as text, like a file; every expectation is PAISE.
 */
const kindOf = (name: string): ImportKindDefinition => {
  const found = DOCUMENT_IMPORT_KINDS.find((k) => k.kind === name);
  if (found === undefined) throw new Error(`no kind ${name}`);
  return found;
};

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  supplierId: string;
  atlasId: string;
  freightId: string;
}

function world(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2025-12-01"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  repository.createCustomer({ companyId, name: "Acme Books" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  const atlasId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const freightId = repository.createItem({ companyId, name: "Freight", unit: "job", trackStock: false });
  // 10 Atlas at Rs 500, dated well before any document below.
  repository.addStockMovement({ itemId: atlasId, movementType: "OPENING", quantity: 10, unitCostPaise: 50_000, businessId, occurredOn: "2026-01-01" });
  return { repository, companyId, businessId, supplierId, atlasId, freightId };
}

const ctx = (w: World, dateFormat: ImportContext["dateFormat"] = "YYYY-MM-DD"): ImportContext => ({
  repository: w.repository, companyId: w.companyId, businessId: w.businessId, dateFormat,
});

const row = (rowNumber: number, values: Record<string, string>): MappedRow => ({ rowNumber, values });

/** One unit, in its own transaction, as the engine runs it: a throw rolls the unit back. */
function post(w: World, kind: string, rows: readonly MappedRow[], context: ImportContext = ctx(w)): UnitOutcome {
  const definition = kindOf(kind);
  return w.repository.db.transaction(() => definition.post(context, rows))();
}

/** What the engine does to a whole file: group by `groupBy` in first-seen order, one unit each. */
function postFile(w: World, kind: string, rows: readonly MappedRow[]): Array<UnitOutcome | { status: "FAILED"; message: string }> {
  const definition = kindOf(kind);
  const units: MappedRow[][] = [];
  const byKey = new Map<string, MappedRow[]>();
  for (const r of rows) {
    const key = definition.groupBy === undefined ? "" : r.values[definition.groupBy] ?? "";
    const existing = key === "" ? undefined : byKey.get(key);
    if (existing !== undefined) existing.push(r);
    else {
      const unit = [r];
      units.push(unit);
      if (key !== "") byKey.set(key, unit);
    }
  }
  return units.map((unit) => {
    try {
      return post(w, kind, unit);
    } catch (error) {
      return { status: "FAILED" as const, message: error instanceof Error ? error.message : String(error) };
    }
  });
}

const failureOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the unit to fail, but it succeeded");
};

const trial = (w: World, account: string): number => {
  const found = w.repository.getTrialBalance({ businessId: w.businessId }).find((r) => r.account === account);
  return found === undefined ? 0 : found.debitPaise - found.creditPaise;
};
const trialBalanced = (w: World): boolean => {
  const rows = w.repository.getTrialBalance({ businessId: w.businessId });
  return rows.reduce((t, r) => t + r.debitPaise, 0) === rows.reduce((t, r) => t + r.creditPaise, 0);
};
const atlasOnHand = (w: World): number => w.repository.getStockBalances().find((b) => b.itemId === w.atlasId)?.quantity ?? -1;

/** Header cells of an invoice, to repeat on every row of a document. */
const head = (number: string, extra: Record<string, string> = {}): Record<string, string> => ({
  number, invoiceDate: "2026-11-01", customer: "Acme Books", ...extra,
});

/** The 3-line invoice: Atlas 2 x 1000, Freight 1 x 500.50, "Binding" 3 x 100; 18% GST. */
const THREE_LINES = (number: string, first = 2): MappedRow[] => {
  const tax = { taxType: "CGST_SGST", taxRate: "18%" };
  return [
    row(first, { ...head(number, tax), item: "Atlas", quantity: "2", unitPrice: "1000" }),
    row(first + 1, { ...head(number, tax), item: "Freight", quantity: "1", unitPrice: "500.50" }),
    row(first + 2, { ...head(number, tax), description: "Binding", quantity: "3", unitPrice: "100" }),
  ];
};
const THREE_LINE_TOTAL = 330_459; // subtotal 280,050 + 18% (50,409), in paise

const invoiceCount = (w: World): number => w.repository.listInvoices(w.businessId).length;

describe("document import kinds: shape", () => {
  it("offers invoices, purchase-bills, credit-notes, payments and supplier-payments, all BUSINESS scope", () => {
    expect(DOCUMENT_IMPORT_KINDS.map((k) => k.kind)).toEqual(["invoices", "purchase-bills", "credit-notes", "payments", "supplier-payments", "expenses"]);
    for (const k of DOCUMENT_IMPORT_KINDS) expect(k.scope).toBe("BUSINESS");
    expect(kindOf("invoices").groupBy).toBe("number");
    expect(kindOf("purchase-bills").groupBy).toBe("number");
    expect(kindOf("credit-notes").groupBy).toBe("number");
    expect(kindOf("payments").groupBy).toBeUndefined();
    expect(kindOf("supplier-payments").groupBy).toBeUndefined();
  });

  it("uses the export's invoice labels so an exported file maps straight back", () => {
    const labels = kindOf("invoices").fields.map((f) => f.label);
    expect(labels).toEqual([
      "Number", "Invoice date", "Due date", "Customer", "Status", "Item", "Description", "Quantity", "Unit price",
      "Discount", "Extra charge", "Tax type", "Tax rate", "Fair", "Notes", "Before opening", // F: accepted, ignored
    ]);
    expect(kindOf("credit-notes").fields.map((f) => f.label)).toEqual([
      "Number", "Invoice number", "Note date", "Reason", "Status", "Item", "Description", "Quantity", "Unit price", "Before opening",
    ]);
    expect(kindOf("payments").fields.filter((f) => f.required).map((f) => f.label)).toEqual(["Invoice number", "Amount", "Paid on"]);
  });
});

describe("invoices", () => {
  it("a 3-line invoice in 3 rows becomes one posted invoice, ledger balanced, receivable equals its total", () => {
    const w = world();
    const outcome = post(w, "invoices", THREE_LINES("INV-1"));
    expect(outcome).toEqual({ status: "CREATED", reference: "INV-1" });

    const [only, ...rest] = w.repository.listInvoices(w.businessId);
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ number: "INV-1", status: "FINALIZED", paymentAccount: "RECEIVABLES", taxType: "CGST_SGST", taxRateBasisPoints: 1800 });
    const invoice = w.repository.getInvoice(only?.id ?? "");
    expect(invoice.lines).toEqual([
      { itemId: w.atlasId, description: "Atlas", quantity: 2, unitPricePaise: 100_000 },
      { itemId: w.freightId, description: "Freight", quantity: 1, unitPricePaise: 50_050 },
      { description: "Binding", quantity: 3, unitPricePaise: 10_000 },
    ]);
    expect(trialBalanced(w)).toBe(true);
    expect(trial(w, "RECEIVABLES")).toBe(THREE_LINE_TOTAL);
    expect(atlasOnHand(w)).toBe(8); // the Atlas line reduced stock through FIFO
    // Posted on its own date, not today's.
    const dates = w.repository.db
      .prepare("SELECT DISTINCT entry_date FROM journal_entries WHERE business_id = ? AND entry_date >= '2026-02-01'")
      .all(w.businessId);
    expect(dates).toEqual([{ entry_date: "2026-11-01" }]);
  });

  it("two invoices interleaved in a file group correctly", () => {
    const w = world();
    const a = THREE_LINES("INV-A", 2);
    const b = [
      row(3, { ...head("INV-B"), description: "Poster", quantity: "1", unitPrice: "200" }),
      row(5, { ...head("INV-B"), description: "Frame", quantity: "2", unitPrice: "50" }),
    ];
    // a1, b1, a2, b2, a3  - rows of one invoice are not next to each other.
    const file = [a[0] as MappedRow, b[0] as MappedRow, a[1] as MappedRow, b[1] as MappedRow, a[2] as MappedRow];
    const outcomes = postFile(w, "invoices", file);
    expect(outcomes).toEqual([
      { status: "CREATED", reference: "INV-A" },
      { status: "CREATED", reference: "INV-B" },
    ]);
    const byNumber = new Map(w.repository.listInvoices(w.businessId).map((i) => [i.number, w.repository.getInvoice(i.id)]));
    expect(byNumber.get("INV-A")?.lines).toHaveLength(3);
    expect(byNumber.get("INV-B")?.lines).toEqual([
      { description: "Poster", quantity: 1, unitPricePaise: 20_000 },
      { description: "Frame", quantity: 2, unitPricePaise: 5_000 },
    ]);
    expect(trial(w, "RECEIVABLES")).toBe(THREE_LINE_TOTAL + 30_000);
  });

  it("a later row that disagrees with the first fails the unit, naming the field", () => {
    const w = world();
    w.repository.createCustomer({ companyId: w.companyId, name: "Beta Schools" });
    const cases: Array<[string, Record<string, string>]> = [
      ["Customer", { customer: "Beta Schools" }],
      ["Invoice date", { invoiceDate: "2026-11-02" }],
      ["Due date", { dueDate: "2026-12-01" }],
      ["Discount", { discount: "10" }],
      ["Extra charge", { extraCharge: "10" }],
      ["Tax type", { taxType: "IGST" }],
      ["Tax rate", { taxRate: "12" }],
      ["Fair", { fair: "Some Fair" }],
    ];
    for (const [label, change] of cases) {
      const rows = [
        row(2, { ...head("INV-X", { dueDate: "2026-11-30", discount: "5", extraCharge: "5", taxType: "CGST_SGST", taxRate: "18", fair: "" }), description: "One", quantity: "1", unitPrice: "100" }),
        row(3, { ...head("INV-X", { dueDate: "2026-11-30", discount: "5", extraCharge: "5", taxType: "CGST_SGST", taxRate: "18", fair: "" }), ...change, description: "Two", quantity: "1", unitPrice: "100" }),
      ];
      const message = failureOf(() => post(w, "invoices", rows));
      expect(message, label).toContain(`"${label}"`);
      expect(message, label).toContain("Row 3");
    }
    expect(invoiceCount(w)).toBe(0);
  });

  it("a blank header cell on a later row is not a disagreement", () => {
    const w = world();
    const rows = [
      row(2, { ...head("INV-B", { taxType: "NONE" }), description: "One", quantity: "1", unitPrice: "100" }),
      row(3, { number: "INV-B", description: "Two", quantity: "1", unitPrice: "100" }),
    ];
    expect(post(w, "invoices", rows).status).toBe("CREATED");
    expect(trial(w, "RECEIVABLES")).toBe(20_000);
  });

  it("a document dated on or before the general opening balances is kept as history (F), and the day after posts", () => {
    const w = world();
    w.repository.saveOpeningBalances({
      id: "ob1", businessId: w.businessId, asAt: "2026-03-31",
      lines: [{ account: "CASH", debitPaise: 1_000_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 1_000_000 }],
    });
    const line = { description: "Book", quantity: "1", unitPrice: "100" };
    const on = post(w, "invoices", [row(2, { ...head("INV-ON", { invoiceDate: "2026-03-31" }), ...line })]);
    expect(on).toEqual({ status: "CREATED", reference: "INV-ON", message: "kept as history (before opening date)" });
    expect(post(w, "invoices", [row(2, { ...head("INV-BEFORE", { invoiceDate: "2025-12-01" }), ...line })]).message).toContain("kept as history");
    // Kept and flagged, but never journalled: nothing is owed on the books for them.
    expect(invoiceCount(w)).toBe(2);
    expect(w.repository.listInvoices(w.businessId).every((i) => i.beforeOpening)).toBe(true);
    expect(trial(w, "RECEIVABLES")).toBe(0);
    expect(post(w, "invoices", [row(2, { ...head("INV-AFTER", { invoiceDate: "2026-04-01" }), ...line })])).toEqual({ status: "CREATED", reference: "INV-AFTER" });
    expect(trial(w, "RECEIVABLES")).toBeGreaterThan(0);
  });

  it("a customer opening balance date and a supplier opening balance date also make documents history (F)", () => {
    const w = world();
    const customerId = w.repository.listCustomers(w.companyId)[0]?.id ?? "";
    w.repository.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId, asAt: "2026-06-30", amountPaise: 500_000, incomePaise: 0 });
    const line = { description: "Book", quantity: "1", unitPrice: "100" };
    expect(post(w, "invoices", [row(2, { ...head("INV-1", { invoiceDate: "2026-06-30" }), ...line })]).message).toBe("kept as history (before opening date)");
    expect(post(w, "invoices", [row(2, { ...head("INV-2", { invoiceDate: "2026-07-01" }), ...line })])).toEqual({ status: "CREATED", reference: "INV-2" });

    const w2 = world();
    w2.repository.saveOpeningSupplierBalance({ id: "osb1", businessId: w2.businessId, supplierId: w2.supplierId, asAt: "2026-08-31", amountPaise: 300_000 });
    const bill = { supplier: "Paper House", description: "Paper", quantity: "1", unitPrice: "100" };
    expect(post(w2, "purchase-bills", [row(2, { number: "PB-1", billDate: "2026-08-31", ...bill })]).message).toBe("kept as history (before opening date)");
    expect(post(w2, "purchase-bills", [row(2, { number: "PB-2", billDate: "2026-09-01", ...bill })])).toEqual({ status: "CREATED", reference: "PB-2" });

    const exp = { description: "Tape", amount: "50", paymentAccount: "CASH" };
    expect(post(w2, "expenses", [row(2, { number: "EXP-1", expenseDate: "2026-08-31", ...exp })]).message).toBe("kept as history (before opening date)");
    expect(post(w2, "expenses", [row(2, { number: "EXP-2", expenseDate: "2026-09-01", ...exp })])).toEqual({ status: "CREATED", reference: "EXP-2" });
  });

  it("short stock fails the unit and leaves no draft behind", () => {
    const w = world();
    const before = { trial: w.repository.getTrialBalance({ businessId: w.businessId }), stock: atlasOnHand(w) };
    const rows = [
      row(2, { ...head("INV-BIG"), description: "Poster", quantity: "1", unitPrice: "100" }),
      row(3, { ...head("INV-BIG"), item: "Atlas", quantity: "11", unitPrice: "1000" }), // only 10 on hand
    ];
    expect(failureOf(() => post(w, "invoices", rows))).not.toBe("");
    expect(invoiceCount(w)).toBe(0); // no DRAFT, no invoice
    expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM invoice_lines").get()).toEqual({ n: 0 });
    expect(w.repository.getTrialBalance({ businessId: w.businessId })).toEqual(before.trial);
    expect(atlasOnHand(w)).toBe(before.stock);
    // Exactly the 10 on hand is fine.
    expect(post(w, "invoices", [row(2, { ...head("INV-10"), item: "Atlas", quantity: "10", unitPrice: "1000" })]).status).toBe("CREATED");
    expect(atlasOnHand(w)).toBe(0);
  });

  it("re-importing the same file skips every invoice as already existing and changes nothing", () => {
    const w = world();
    const file = [...THREE_LINES("INV-A", 2), row(5, { ...head("INV-B"), description: "Poster", quantity: "1", unitPrice: "200" })];
    expect(postFile(w, "invoices", file).map((o) => o.status)).toEqual(["CREATED", "CREATED"]);
    const snapshot = { n: invoiceCount(w), rec: trial(w, "RECEIVABLES"), stock: atlasOnHand(w) };
    const again = postFile(w, "invoices", file);
    expect(again).toEqual([
      { status: "SKIPPED", reference: "INV-A", message: "already exists" },
      { status: "SKIPPED", reference: "INV-B", message: "already exists" },
    ]);
    expect({ n: invoiceCount(w), rec: trial(w, "RECEIVABLES"), stock: atlasOnHand(w) }).toEqual(snapshot);
  });

  it("fails naming an unknown customer, item or fair, and a locked financial year, leaving nothing behind", () => {
    const w = world();
    const line = { description: "Book", quantity: "1", unitPrice: "100" };
    expect(failureOf(() => post(w, "invoices", [row(2, { ...head("I1", { customer: "Nobody Ltd" }), ...line })]))).toContain("Nobody Ltd");
    expect(failureOf(() => post(w, "invoices", [row(2, { ...head("I2"), item: "Ghost Item", quantity: "1", unitPrice: "100" })]))).toContain("Ghost Item");
    expect(failureOf(() => post(w, "invoices", [row(2, { ...head("I3", { fair: "No Such Fair" }), ...line })]))).toContain("No Such Fair");

    const yearId = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2026-04-01", endsOn: "2027-03-31" });
    w.repository.setFinancialYearLocked(yearId, true);
    expect(failureOf(() => post(w, "invoices", [row(2, { ...head("I4"), ...line })]))).toMatch(/lock/i);
    expect(invoiceCount(w)).toBe(0);
    expect(trialBalanced(w)).toBe(true);
  });

  it("reads dates in the chosen format and reports a bad value with its row and column", () => {
    const w = world();
    const line = { description: "Book", quantity: "1", unitPrice: "100" };
    const dmy = ctx(w, "DD/MM/YYYY");
    expect(post(w, "invoices", [row(2, { ...head("INV-D", { invoiceDate: "05/11/2026" }), ...line })], dmy).status).toBe("CREATED");
    const [made] = w.repository.listInvoices(w.businessId);
    expect(w.repository.getInvoice(made?.id ?? "").invoiceDate).toBe("2026-11-05");
    const bad = failureOf(() => post(w, "invoices", [row(7, { ...head("INV-E", { invoiceDate: "31/02/2026" }), ...line })], dmy));
    expect(bad).toContain("Row 7");
    expect(bad).toContain("Invoice date");
  });

  it("skips a row whose Status is cancelled or draft instead of posting it live", () => {
    const w = world();
    const outcome = post(w, "invoices", [row(2, { ...head("INV-C", { status: "CANCELLED" }), description: "Book", quantity: "1", unitPrice: "100" })]);
    expect(outcome.status).toBe("SKIPPED");
    expect(invoiceCount(w)).toBe(0);
  });
});

describe("purchase bills and supplier payments", () => {
  const billRows = (): MappedRow[] => [
    row(2, { number: "PB-1", supplierInvoiceNumber: "SI-77", billDate: "2026-11-02", supplier: "Paper House", item: "Atlas", quantity: "5", unitPrice: "400" }),
    row(3, { number: "PB-1", supplierInvoiceNumber: "SI-77", billDate: "2026-11-02", supplier: "Paper House", item: "Freight", quantity: "1", unitPrice: "100" }),
  ];

  it("posts a bill on its own date, payable and stock in step, then skips it on re-import", () => {
    const w = world();
    expect(post(w, "purchase-bills", billRows())).toEqual({ status: "CREATED", reference: "PB-1" });
    const [bill] = w.repository.listPurchaseBills({ businessId: w.businessId });
    expect(bill).toMatchObject({ number: "PB-1", status: "FINALIZED", paymentAccount: "PAYABLES", supplierInvoiceNumber: "SI-77", billDate: "2026-11-02", totalPaise: 210_000 });
    expect(trial(w, "PAYABLES")).toBe(-210_000);
    expect(atlasOnHand(w)).toBe(15);
    expect(trialBalanced(w)).toBe(true);
    expect(postFile(w, "purchase-bills", billRows())).toEqual([{ status: "SKIPPED", reference: "PB-1", message: "already exists" }]);
    expect(w.repository.listPurchaseBills({ businessId: w.businessId })).toHaveLength(1);
  });

  it("a disagreeing supplier on a later row fails naming the field; an unknown supplier fails naming it", () => {
    const w = world();
    w.repository.createSupplier({ companyId: w.companyId, name: "Other Press" });
    const rows = billRows();
    const message = failureOf(() => post(w, "purchase-bills", [rows[0] as MappedRow, row(3, { ...(rows[1] as MappedRow).values, supplier: "Other Press" })]));
    expect(message).toContain('"Supplier"');
    expect(failureOf(() => post(w, "purchase-bills", [row(2, { number: "PB-9", billDate: "2026-11-02", supplier: "Nobody", description: "x", quantity: "1", unitPrice: "1" })]))).toContain("Nobody");
    expect(w.repository.listPurchaseBills({ businessId: w.businessId })).toHaveLength(0);
  });

  it("records a supplier payment and skips the same document, amount and date on re-import", () => {
    const w = world();
    post(w, "purchase-bills", billRows());
    const pay = row(2, { billNumber: "PB-1", amount: "500", paidOn: "2026-11-10" });
    expect(post(w, "supplier-payments", [pay])).toEqual({ status: "CREATED", reference: "PB-1" });
    expect(trial(w, "PAYABLES")).toBe(-210_000 + 50_000);
    expect(post(w, "supplier-payments", [pay])).toEqual({ status: "SKIPPED", reference: "PB-1", message: "already exists" });
    const [bill] = w.repository.listPurchaseBills({ businessId: w.businessId });
    expect(w.repository.listSupplierPayments({ billId: bill?.id ?? "" })).toHaveLength(1);
    // A different amount, and a different date, are new payments.
    expect(post(w, "supplier-payments", [row(3, { billNumber: "PB-1", amount: "600", paidOn: "2026-11-10" })]).status).toBe("CREATED");
    expect(post(w, "supplier-payments", [row(4, { billNumber: "PB-1", amount: "500", paidOn: "2026-11-11" })]).status).toBe("CREATED");
    expect(failureOf(() => post(w, "supplier-payments", [row(5, { billNumber: "PB-404", amount: "1", paidOn: "2026-11-11" })]))).toContain("PB-404");
  });
});

describe("credit notes and customer payments", () => {
  it("a credit note against an imported invoice posts, restores stock, and re-import skips it", () => {
    const w = world();
    post(w, "invoices", THREE_LINES("INV-1"));
    expect(atlasOnHand(w)).toBe(8);
    const note = [
      row(2, { number: "CN-1", invoiceNumber: "INV-1", noteDate: "2026-11-05", reason: "One atlas returned", item: "Atlas", quantity: "1", unitPrice: "1000" }),
    ];
    expect(post(w, "credit-notes", note)).toEqual({ status: "CREATED", reference: "CN-1" });
    const [posted] = w.repository.listCreditNotes();
    expect(posted).toMatchObject({ number: "CN-1", invoiceNumber: "INV-1", status: "FINALIZED", subtotalPaise: 100_000, taxPaise: 18_000, totalPaise: 118_000 });
    expect(trial(w, "RECEIVABLES")).toBe(THREE_LINE_TOTAL - 118_000);
    expect(trialBalanced(w)).toBe(true);
    expect(atlasOnHand(w)).toBe(9);
    expect(post(w, "credit-notes", note)).toEqual({ status: "SKIPPED", reference: "CN-1", message: "already exists" });
    expect(w.repository.listCreditNotes()).toHaveLength(1);
  });

  it("a credit note dated on or before the opening balances is kept as history (F); an unknown invoice fails naming it", () => {
    const w = world();
    post(w, "invoices", THREE_LINES("INV-1"));
    w.repository.saveOpeningBalances({
      id: "ob1", businessId: w.businessId, asAt: "2026-11-03",
      lines: [{ account: "CASH", debitPaise: 1_000_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 1_000_000 }],
    });
    const base = { reason: "Return", description: "Binding", quantity: "1", unitPrice: "100" };
    expect(post(w, "credit-notes", [row(2, { number: "CN-1", invoiceNumber: "INV-1", noteDate: "2026-11-03", ...base })]).message).toBe("kept as history (before opening date)");
    expect(failureOf(() => post(w, "credit-notes", [row(2, { number: "CN-2", invoiceNumber: "INV-NOPE", noteDate: "2026-11-05", ...base })]))).toContain("INV-NOPE");
    // Kept (visible, flagged), but it posted nothing: receivables still stand at the whole invoice.
    expect(w.repository.listCreditNotes().map((n) => n.beforeOpening)).toEqual([true]);
    expect(trial(w, "RECEIVABLES")).toBe(THREE_LINE_TOTAL);
  });

  it("a payment is recorded against the invoice on its date, and re-importing it is skipped", () => {
    const w = world();
    post(w, "invoices", THREE_LINES("INV-1"));
    const pay = row(2, { invoiceNumber: "INV-1", amount: "1,000.00", paidOn: "2026-11-10" });
    expect(post(w, "payments", [pay])).toEqual({ status: "CREATED", reference: "INV-1" });
    expect(trial(w, "RECEIVABLES")).toBe(THREE_LINE_TOTAL - 100_000);
    expect(trial(w, "CASH")).toBe(100_000);

    expect(post(w, "payments", [pay])).toEqual({ status: "SKIPPED", reference: "INV-1", message: "already exists" });
    const [invoice] = w.repository.listInvoices(w.businessId);
    const payments = w.repository.listPayments(invoice?.id ?? "");
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amountPaise: 100_000, cancelledAt: null });
    expect(trial(w, "CASH")).toBe(100_000);
  });

  it("a cancelled payment does not block the same payment, and a cancelled row in the file is not imported", () => {
    const w = world();
    post(w, "invoices", THREE_LINES("INV-1"));
    const pay = row(2, { invoiceNumber: "INV-1", amount: "1000", paidOn: "2026-11-10" });
    post(w, "payments", [pay]);
    const [invoice] = w.repository.listInvoices(w.businessId);
    const [first] = w.repository.listPayments(invoice?.id ?? "");
    w.repository.cancelPayment(first?.id ?? "", "entered twice");
    expect(post(w, "payments", [pay]).status).toBe("CREATED");
    expect(post(w, "payments", [row(3, { ...pay.values, amount: "5", status: "Cancelled" })]).status).toBe("SKIPPED");
    expect(w.repository.listPayments(invoice?.id ?? "").filter((p) => p.cancelledAt === null)).toHaveLength(1);
  });

  it("equal payments within one file all import; the same file again imports none (S16-3, count-based)", () => {
    const w = world();
    post(w, "invoices", THREE_LINES("INV-1"));
    const pay = (n: number): MappedRow => row(n, { invoiceNumber: "INV-1", amount: "1000", paidOn: "2026-11-10" });
    const run = (): string[] => {
      const shared = ctx(w); // one context = one run, as the engine does
      return [pay(2), pay(3)].map((r) => post(w, "payments", [r], shared).status);
    };
    expect(run()).toEqual(["CREATED", "CREATED"]);
    const [invoice] = w.repository.listInvoices(w.businessId);
    expect(w.repository.listPayments(invoice?.id ?? "").filter((p) => p.cancelledAt === null)).toHaveLength(2);
    expect(run()).toEqual(["SKIPPED", "SKIPPED"]);
    expect(w.repository.listPayments(invoice?.id ?? "").filter((p) => p.cancelledAt === null)).toHaveLength(2);
  });

  it("a file with two equal rows imports one when one equal payment is already in the books", () => {
    const w = world();
    post(w, "invoices", THREE_LINES("INV-1"));
    const pay = (n: number): MappedRow => row(n, { invoiceNumber: "INV-1", amount: "1000", paidOn: "2026-11-10" });
    post(w, "payments", [pay(2)]); // an earlier import or a hand-entered payment
    const shared = ctx(w);
    expect([pay(2), pay(3)].map((r) => post(w, "payments", [r], shared).status)).toEqual(["SKIPPED", "CREATED"]);
    const [invoice] = w.repository.listInvoices(w.businessId);
    expect(w.repository.listPayments(invoice?.id ?? "").filter((p) => p.cancelledAt === null)).toHaveLength(2);
  });

  it("supplier payments follow the same count-based rule", () => {
    const w = world();
    post(w, "purchase-bills", [
      row(2, { number: "PB-1", billDate: "2026-11-02", supplier: "Paper House", item: "Atlas", quantity: "5", unitPrice: "400" }),
      row(3, { number: "PB-1", billDate: "2026-11-02", supplier: "Paper House", item: "Freight", quantity: "1", unitPrice: "100" }),
    ]);
    const pay = (n: number): MappedRow => row(n, { billNumber: "PB-1", amount: "100", paidOn: "2026-11-10" });
    const run = (): string[] => {
      const shared = ctx(w);
      return [pay(2), pay(3)].map((r) => post(w, "supplier-payments", [r], shared).status);
    };
    expect(run()).toEqual(["CREATED", "CREATED"]);
    expect(run()).toEqual(["SKIPPED", "SKIPPED"]);
  });

  it("a payment over the balance, to an unknown invoice, or dated on or before the opening of a posted invoice fails (F)", () => {
    const w = world();
    post(w, "invoices", THREE_LINES("INV-1"));
    expect(failureOf(() => post(w, "payments", [row(2, { invoiceNumber: "INV-1", amount: "99999", paidOn: "2026-11-10" })]))).toMatch(/exceed/i);
    expect(failureOf(() => post(w, "payments", [row(2, { invoiceNumber: "INV-404", amount: "1", paidOn: "2026-11-10" })]))).toContain("INV-404");
    w.repository.saveOpeningBalances({
      id: "ob1", businessId: w.businessId, asAt: "2026-11-10",
      lines: [{ account: "CASH", debitPaise: 1_000_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 1_000_000 }],
    });
    expect(failureOf(() => post(w, "payments", [row(2, { invoiceNumber: "INV-1", amount: "10", paidOn: "2026-11-10" })]))).toContain("on or before your opening date (2026-11-10)");
    const [invoice] = w.repository.listInvoices(w.businessId);
    expect(w.repository.listPayments(invoice?.id ?? "")).toHaveLength(0);
  });
});
