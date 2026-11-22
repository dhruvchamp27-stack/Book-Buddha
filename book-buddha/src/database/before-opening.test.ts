import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { buildExport } from "../import-export/exports.js";
import { DOCUMENT_IMPORT_KINDS } from "../import-export/import-documents.js";
import type { ImportContext, MappedRow } from "../import-export/import-engine.js";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";

/**
 * F (owner rulings S16-2(c), Q13, S17-12): a document or payment dated ON or BEFORE the business's
 * opening date is kept as HISTORY - visible, linked, flagged "Before opening" - but NEVER journalled,
 * never moves stock, and is left out of every total and report. The opening balances stay the books'
 * only figure for that period.
 *
 * Figures are PAISE in code, the rupee figure in a comment.
 */

const OPENING = "2025-03-31";
const CONFIRM = { confirmBeforeOpening: true } as const;
const NEEDS_CONFIRM = `This is dated on or before your opening date (${OPENING}). It will be kept as history and not posted. Send it again with confirmBeforeOpening to continue.`;

function world() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  const novel = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: false });
  const atlas = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  let counter = 0;
  const draftInvoice = (paise: number, date: string, itemId = novel, quantity = 1): string => {
    const id = `INV-${++counter}`;
    repository.saveDraft({
      id, number: id, businessId, customerId, paymentAccount: "RECEIVABLES", status: "DRAFT",
      taxType: "NONE", taxRateBasisPoints: 0, invoiceDate: date,
      lines: [{ itemId, description: "Line", quantity, unitPricePaise: paise }],
    });
    return id;
  };
  const draftBill = (paise: number, date: string, itemId = novel, quantity = 1): string => {
    const bill = repository.createPurchaseBill({
      businessId, supplierId, number: `BILL-${++counter}`, billDate: date, paymentAccount: "PAYABLES",
      lines: [{ itemId, description: "Line", quantity, unitPricePaise: paise }],
    });
    return bill.id;
  };
  const openCustomer = (paise: number): void => {
    repository.saveOpeningCustomerBalance({ id: "OCB-1", businessId, customerId, asAt: OPENING, amountPaise: paise, incomePaise: 0 });
  };
  const openSupplier = (paise: number): void => {
    repository.saveOpeningSupplierBalance({ id: "OSB-1", businessId, supplierId, asAt: OPENING, amountPaise: paise });
  };
  const trial = (account: string): number => {
    const found = repository.getTrialBalance({ businessId }).find((r) => r.account === account);
    return found === undefined ? 0 : found.debitPaise - found.creditPaise;
  };
  const entriesFor = (sourceId: string): number =>
    (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE source_id = ? OR id LIKE ?").get(sourceId, `%${sourceId}%`) as { n: number }).n;
  const entryCount = (): number =>
    (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
  const stockMovements = (): number =>
    (repository.db.prepare("SELECT COUNT(*) AS n FROM stock_movements").get() as { n: number }).n;
  const audited = (action: string, entityId: string): boolean =>
    repository.db.prepare("SELECT 1 FROM audit_events WHERE action = ? AND entity_id = ?").get(action, entityId) !== undefined;
  return {
    repository, companyId, businessId, customerId, supplierId, novel, atlas,
    draftInvoice, draftBill, openCustomer, openSupplier, trial, entriesFor, entryCount, stockMovements, audited,
  };
}

describe("F: the opening date", () => {
  it("is the latest live opening as-at over general, customer and supplier sets; none means no rule", () => {
    const w = world();
    expect(w.repository.openingDateOf(w.businessId)).toBeUndefined();
    expect(w.repository.isBeforeOpening(w.businessId, "1999-01-01")).toBe(false);
    w.openCustomer(100_000);
    expect(w.repository.openingDateOf(w.businessId)).toBe(OPENING);
    expect(w.repository.isBeforeOpening(w.businessId, OPENING)).toBe(true);
    expect(w.repository.isBeforeOpening(w.businessId, "2025-04-01")).toBe(false);
    w.repository.saveOpeningSupplierBalance({ id: "OSB-9", businessId: w.businessId, supplierId: w.supplierId, asAt: "2025-06-30", amountPaise: 1 });
    expect(w.repository.openingDateOf(w.businessId)).toBe("2025-06-30");
  });

  it("is frozen on a document: an invoice posted before any opening stays posted when one is set later", () => {
    const w = world();
    const id = w.draftInvoice(50_000, "2025-03-01");
    w.repository.finalizeInvoice(id);
    w.openCustomer(100_000);
    expect(w.repository.getInvoice(id).beforeOpening).toBe(false);
    expect(w.entriesFor(`je-${id}`)).toBeGreaterThan(0);
  });
});

describe("F: the hand figure - Rs 10,000 opening balance and a Rs 10,000 invoice dated before it", () => {
  it("is kept once: visible and flagged, never journalled, receivables stay Rs 10,000, sales unchanged", () => {
    const w = world();
    w.openCustomer(1_000_000); // Rs 10,000.00
    const id = w.draftInvoice(1_000_000, "2025-03-15");
    const before = w.entryCount();
    const entry = w.repository.finalizeInvoice(id, CONFIRM);
    expect(entry.lines).toEqual([]); // nothing was posted
    expect(w.entryCount()).toBe(before);
    expect(w.entriesFor(id)).toBe(0);

    const invoice = w.repository.getInvoice(id);
    expect(invoice).toMatchObject({ status: "FINALIZED", beforeOpening: true });
    expect(w.repository.listInvoices(w.businessId).find((i) => i.id === id)).toMatchObject({ beforeOpening: true, status: "FINALIZED" });
    expect(w.audited("invoice.recorded_as_history", id)).toBe(true);

    const receivables = w.repository.getReceivables({ businessId: w.businessId });
    expect(receivables.reduce((t, r) => t + r.outstandingPaise, 0)).toBe(1_000_000); // once, not 2,000,000
    expect(w.repository.getCustomerStatement({ businessId: w.businessId, customerId: w.customerId }).closingBalancePaise).toBe(1_000_000);
    expect(w.trial("RECEIVABLES")).toBe(1_000_000);
    expect(w.repository.getProfitAndLoss({ businessId: w.businessId }).totalIncomePaise).toBe(0);
    expect(w.repository.getSalesByItem({ businessId: w.businessId })).toEqual([]);
  });

  it("over HTTP: refused with the exact message until confirmBeforeOpening is sent", async () => {
    const w = world();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      w.openCustomer(1_000_000);
      const id = w.draftInvoice(1_000_000, "2025-03-15");
      const refused = await app.inject({ method: "POST", url: `/invoices/${id}/finalize` });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toEqual({ error: NEEDS_CONFIRM });
      expect(w.repository.getInvoice(id).status).toBe("DRAFT");

      const kept = await app.inject({ method: "POST", url: `/invoices/${id}/finalize`, payload: { confirmBeforeOpening: true } });
      expect(kept.statusCode).toBe(200);
      expect(kept.json().journalEntry.lines).toEqual([]);
      expect((await app.inject({ method: "GET", url: `/invoices/${id}` })).json()).toMatchObject({ beforeOpening: true });

      // A customer payment dated before the opening is history too, and needs the same confirmation.
      const pay = { amountPaise: 400_000, paidOn: "2025-03-20" };
      const payRefused = await app.inject({ method: "POST", url: `/invoices/${id}/payments`, payload: pay });
      expect(payRefused.statusCode).toBe(400);
      expect(payRefused.json()).toEqual({ error: NEEDS_CONFIRM });
      const paid = await app.inject({ method: "POST", url: `/invoices/${id}/payments`, payload: { ...pay, confirmBeforeOpening: true } });
      expect(paid.statusCode).toBe(201);
      expect(paid.json()).toMatchObject({ beforeOpening: true });
      expect((await app.inject({ method: "GET", url: `/invoices/${id}/payments` })).json()).toHaveLength(1);

      // Supplier side over HTTP.
      const billId = w.draftBill(300_000, "2025-03-10");
      const billRefused = await app.inject({ method: "POST", url: `/purchase-bills/${billId}/finalize` });
      expect(billRefused.json()).toEqual({ error: NEEDS_CONFIRM });
      expect((await app.inject({ method: "POST", url: `/purchase-bills/${billId}/finalize`, payload: { confirmBeforeOpening: true } })).statusCode).toBe(200);
      const sp = { billId, amountPaise: 100_000, paidOn: "2025-03-25" };
      expect((await app.inject({ method: "POST", url: "/supplier-payments", payload: sp })).json()).toEqual({ error: NEEDS_CONFIRM });
      const spOk = await app.inject({ method: "POST", url: "/supplier-payments", payload: { ...sp, confirmBeforeOpening: true } });
      expect(spOk.statusCode).toBe(201);
      expect(spOk.json()).toMatchObject({ beforeOpening: true });
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});

describe("F: the boundary and the other documents", () => {
  it("dated ON the opening date is history; the day after posts normally", () => {
    const w = world();
    w.openCustomer(100_000);
    const on = w.draftInvoice(10_000, OPENING);
    const after = w.draftInvoice(10_000, "2025-04-01");
    expect(() => w.repository.finalizeInvoice(on)).toThrow(NEEDS_CONFIRM);
    w.repository.finalizeInvoice(on, CONFIRM);
    w.repository.finalizeInvoice(after); // no confirmation needed, and none asked for
    expect(w.repository.getInvoice(on).beforeOpening).toBe(true);
    expect(w.repository.getInvoice(after).beforeOpening).toBe(false);
    expect(w.entriesFor(`je-${on}`)).toBe(0);
    expect(w.entriesFor(`je-${after}`)).toBe(1);
  });

  it("a history bill moves no stock; a history invoice of a stock item needs none and takes none", () => {
    const w = world();
    w.openCustomer(100_000);
    const billId = w.draftBill(50_000, "2025-03-10", w.atlas, 4);
    w.repository.finalizePurchaseBill(billId, CONFIRM);
    expect(w.repository.getPurchaseBill(billId)).toMatchObject({ status: "FINALIZED", beforeOpening: true });
    expect(w.stockMovements()).toBe(0);
    expect(w.repository.getInventoryValuation().reduce((t, r) => t + r.valuePaise, 0)).toBe(0);
    expect(w.entriesFor(billId)).toBe(0);
    expect(w.audited("purchase_bill.recorded_as_history", billId)).toBe(true);

    // Nothing on hand, yet a history invoice of 3 Atlas finalizes - and consumes nothing.
    const invoiceId = w.draftInvoice(90_000, "2025-03-12", w.atlas, 3);
    w.repository.finalizeInvoice(invoiceId, CONFIRM);
    expect(w.stockMovements()).toBe(0);
    expect(w.entriesFor(invoiceId)).toBe(0);
    // The same sale dated after the opening still needs the stock.
    const live = w.draftInvoice(90_000, "2025-04-12", w.atlas, 3);
    expect(() => w.repository.finalizeInvoice(live)).toThrow();
  });

  it("a history expense posts nothing, and can be cancelled without a reversal", () => {
    const w = world();
    w.openCustomer(100_000);
    const expense = w.repository.createExpense({
      businessId: w.businessId, supplierId: w.supplierId, number: "EXP-1", expenseDate: "2025-03-05",
      description: "Tape", amountPaise: 20_000, paymentAccount: "PAYABLES",
    });
    expect(() => w.repository.finalizeExpense(expense.id)).toThrow(NEEDS_CONFIRM);
    const before = w.entryCount();
    w.repository.finalizeExpense(expense.id, CONFIRM);
    expect(w.entryCount()).toBe(before);
    expect(w.repository.getExpense(expense.id)).toMatchObject({ status: "FINALIZED", beforeOpening: true });
    expect(w.audited("expense.recorded_as_history", expense.id)).toBe(true);
    w.repository.cancelExpense(expense.id);
    expect(w.repository.getExpense(expense.id).status).toBe("CANCELLED");
    expect(w.entryCount()).toBe(before);
  });
});

describe("F: reports leave history out", () => {
  it("payables, the supplier statement, ageing and the cash view show only the opening balance", () => {
    const w = world();
    w.openSupplier(500_000); // Rs 5,000
    const billId = w.draftBill(500_000, "2025-03-10");
    w.repository.finalizePurchaseBill(billId, CONFIRM);
    const expense = w.repository.createExpense({
      businessId: w.businessId, supplierId: w.supplierId, number: "EXP-1", expenseDate: "2025-03-05",
      description: "Tape", amountPaise: 20_000, paymentAccount: "PAYABLES",
    });
    w.repository.finalizeExpense(expense.id, CONFIRM);
    w.repository.recordSupplierPayment({ billId, amountPaise: 100_000, paidOn: "2025-03-20", ...CONFIRM });

    expect(w.repository.listPurchaseBills({ businessId: w.businessId })).toHaveLength(1); // still listed
    expect(w.repository.listExpenses({ businessId: w.businessId })).toHaveLength(1);
    expect(w.repository.listSupplierPayments({ supplierId: w.supplierId })).toHaveLength(1);

    const payables = w.repository.getPayables({ businessId: w.businessId });
    expect(payables.map((r) => r.documentType)).toEqual(["OPENING"]);
    expect(payables.reduce((t, r) => t + r.outstandingPaise, 0)).toBe(500_000);
    const statement = w.repository.getSupplierStatement(w.supplierId);
    expect(statement.rows.map((r) => r.type)).toEqual(["OPENING"]);
    expect(statement.closingBalancePaise).toBe(500_000);
    expect(w.repository.getPayablesAgeing({ businessId: w.businessId }).totalOutstandingPaise).toBe(500_000);
    expect(w.trial("PAYABLES")).toBe(-500_000);

    const cash = w.repository.deriveCashView({ businessId: w.businessId });
    expect(cash.recognitions).toEqual([]);
    expect(cash.invoiceCollections).toEqual([]);
  });

  it("the cash view and sales-by-item skip a history invoice and its payment", () => {
    const w = world();
    w.openCustomer(1_000_000);
    const id = w.draftInvoice(1_000_000, "2025-03-15");
    w.repository.finalizeInvoice(id, CONFIRM);
    w.repository.recordPayment(id, 1_000_000, "2025-03-20", {}, CONFIRM);
    const cash = w.repository.deriveCashView({ businessId: w.businessId });
    expect(cash.recognitions).toEqual([]);
    expect(cash.invoiceCollections).toEqual([]);
    expect(w.repository.getSalesByItem({})).toEqual([]);
    expect(w.repository.getCustomerBalanceDetail({ businessId: w.businessId }).groups.flatMap((g) => g.items.map((i) => i.kind))).toEqual(["OPENING"]);
  });

  it("a credit note kept as history posts nothing and adds nothing to the credit balance or the note reports", () => {
    const w = world();
    w.openCustomer(100_000);
    const id = w.draftInvoice(100_000, "2025-06-01"); // posted: after the opening
    w.repository.finalizeInvoice(id);
    const before = { receivables: w.trial("RECEIVABLES"), entries: w.entryCount() };
    // A note dated ON the opening date (before its own invoice) is history.
    w.repository.saveCreditNote({
      id: "CN-H", invoiceId: id, reason: "Return", noteDate: OPENING, status: "DRAFT",
      lines: [{ description: "Return", quantity: 1, unitPricePaise: 100 }],
    });
    expect(() => w.repository.finalizeCreditNote("CN-H", { confirmBackdatedMonth: true })).toThrow(NEEDS_CONFIRM);
    const entry = w.repository.finalizeCreditNote("CN-H", { confirmBackdatedMonth: true, confirmBeforeOpening: true });
    expect(entry.lines).toEqual([]);
    expect(w.repository.getCreditNote("CN-H")).toMatchObject({ status: "FINALIZED", beforeOpening: true });
    expect(w.repository.listCreditNotes({ invoiceId: id })[0]).toMatchObject({ beforeOpening: true });
    expect(w.audited("credit_note.recorded_as_history", "CN-H")).toBe(true);
    expect({ receivables: w.trial("RECEIVABLES"), entries: w.entryCount() }).toEqual(before);
    expect(w.repository.getCustomerStatement({ businessId: w.businessId, customerId: w.customerId }).unappliedCreditPaise).toBe(0);
    expect(w.repository.getCreditNoteReport({ businessId: w.businessId }).rows).toEqual([]);
    expect(w.repository.getSalesReturnReport({ businessId: w.businessId }).rows).toEqual([]);
    // History cannot be refunded or applied either.
    expect(() => w.repository.recordCreditNoteRefund({ id: "R1", creditNoteId: "CN-H", amountPaise: 1, refundedOn: "2025-07-01" })).toThrow(RepositoryValidationError);
    // ...but it can be cancelled, with no reversal.
    w.repository.cancelCreditNote("CN-H");
    expect(w.repository.getCreditNote("CN-H").status).toBe("CANCELLED");
    expect(w.entryCount()).toBe(before.entries);
  });
});

describe("F: payments against history", () => {
  it("a history payment against a history invoice is listed and changes no balance", () => {
    const w = world();
    w.openCustomer(1_000_000);
    const id = w.draftInvoice(1_000_000, "2025-03-15");
    w.repository.finalizeInvoice(id, CONFIRM);
    expect(() => w.repository.recordPayment(id, 400_000, "2025-03-20")).toThrow(NEEDS_CONFIRM);
    const before = { cash: w.trial("CASH"), receivables: w.trial("RECEIVABLES"), entries: w.entryCount() };
    const payment = w.repository.recordPayment(id, 400_000, "2025-03-20", {}, CONFIRM);
    expect(payment.beforeOpening).toBe(true);
    expect(w.repository.listPayments(id)).toMatchObject([{ id: payment.id, beforeOpening: true, cancelledAt: null }]);
    expect({ cash: w.trial("CASH"), receivables: w.trial("RECEIVABLES"), entries: w.entryCount() }).toEqual(before);
    expect(w.repository.getReceivables({ businessId: w.businessId }).reduce((t, r) => t + r.outstandingPaise, 0)).toBe(1_000_000);
    expect(w.audited("payment.recorded_as_history", id)).toBe(true);
    // The history invoice cannot take more than its own total in history payments.
    expect(() => w.repository.recordPayment(id, 700_000, "2025-03-21", {}, CONFIRM)).toThrow(/cannot exceed/);
  });

  it("a payment dated AFTER the opening on a history invoice is refused (customer), bill and expense (supplier)", () => {
    const w = world();
    w.openCustomer(1_000_000);
    const id = w.draftInvoice(1_000_000, "2025-03-15");
    w.repository.finalizeInvoice(id, CONFIRM);
    const customerMessage =
      "This invoice is dated before your opening date and is kept as history. Record this money as a receipt against the customer's opening balance instead.";
    expect(() => w.repository.recordPayment(id, 100_000, "2025-04-02")).toThrow(customerMessage);
    expect(() => w.repository.recordPayment(id, 100_000, "2025-04-02", {}, CONFIRM)).toThrow(customerMessage);

    const billId = w.draftBill(300_000, "2025-03-10");
    w.repository.finalizePurchaseBill(billId, CONFIRM);
    expect(() => w.repository.recordSupplierPayment({ billId, amountPaise: 100_000, paidOn: "2025-04-02", ...CONFIRM })).toThrow(
      "This bill is dated before your opening date and is kept as history. Record this money as a settlement against the supplier's opening balance instead.",
    );
    const expense = w.repository.createExpense({
      businessId: w.businessId, supplierId: w.supplierId, number: "EXP-1", expenseDate: "2025-03-05",
      description: "Tape", amountPaise: 20_000, paymentAccount: "PAYABLES",
    });
    w.repository.finalizeExpense(expense.id, CONFIRM);
    expect(() => w.repository.recordSupplierPayment({ expenseId: expense.id, amountPaise: 1_000, paidOn: "2025-04-02", ...CONFIRM })).toThrow(
      "This expense is dated before your opening date and is kept as history. Record this money as a settlement against the supplier's opening balance instead.",
    );
  });

  it("a credit note on a history invoice and a purchase return on a history bill are refused", () => {
    const w = world();
    w.openCustomer(100_000);
    const id = w.draftInvoice(100_000, "2025-03-15");
    w.repository.finalizeInvoice(id, CONFIRM);
    expect(() => w.repository.saveCreditNote({
      id: "CN-X", invoiceId: id, reason: "Return", noteDate: "2025-06-01", status: "DRAFT",
      lines: [{ description: "Return", quantity: 1, unitPricePaise: 100 }],
    })).toThrow(
      "This invoice is kept as history (dated before your opening date), so it cannot take a credit note. Adjust the customer's opening balance instead.",
    );
    const billId = w.draftBill(100_000, "2025-03-10", w.atlas, 2);
    w.repository.finalizePurchaseBill(billId, CONFIRM);
    expect(() => w.repository.createPurchaseReturn({
      billId, reason: "Wrong", returnDate: "2025-06-01", lines: [{ itemId: w.atlas, description: "Atlas", quantity: 1, unitPricePaise: 100_000 }],
    })).toThrow(
      "This bill is kept as history (dated before your opening date), so it cannot take a return. Adjust the supplier's opening balance instead.",
    );
  });

  it("a payment dated on or before the opening on an invoice that WAS posted is refused (it would count against the books)", () => {
    const w = world();
    const id = w.draftInvoice(100_000, "2025-03-01");
    w.repository.finalizeInvoice(id); // no opening yet: posted
    w.openCustomer(100_000);
    expect(() => w.repository.recordPayment(id, 1_000, OPENING, {}, CONFIRM)).toThrow(/was posted to the books/);
  });
});

describe("F: cancelling history", () => {
  it("a history invoice and a history payment cancel with an audit event and NO reversal entry", () => {
    const w = world();
    w.openCustomer(1_000_000);
    const id = w.draftInvoice(1_000_000, "2025-03-15");
    w.repository.finalizeInvoice(id, CONFIRM);
    const payment = w.repository.recordPayment(id, 400_000, "2025-03-20", {}, CONFIRM);
    const entries = w.entryCount();

    expect(() => w.repository.cancelInvoice(id)).toThrow(/payments/); // payment stands: cancel it first
    const reversal = w.repository.cancelPayment(payment.id, "keyed twice");
    expect(reversal.lines).toEqual([]);
    expect(w.repository.listPayments(id)[0]).toMatchObject({ beforeOpening: true, cancellationReason: "keyed twice" });
    expect(w.repository.listPayments(id)[0]?.cancelledAt).not.toBeNull();
    expect(w.audited("invoice.payment_cancelled", id)).toBe(true);

    expect(w.repository.cancelInvoice(id).lines).toEqual([]);
    expect(w.repository.getInvoice(id)).toMatchObject({ status: "CANCELLED", beforeOpening: true });
    expect(w.audited("invoice.cancelled", id)).toBe(true);
    expect(w.entryCount()).toBe(entries); // nothing posted, nothing reversed
    expect(w.trial("RECEIVABLES")).toBe(1_000_000);
  });

  it("a history bill, its supplier payment and a history purchase return path cancel the same way", () => {
    const w = world();
    w.openSupplier(500_000);
    const billId = w.draftBill(300_000, "2025-03-10");
    w.repository.finalizePurchaseBill(billId, CONFIRM);
    const payment = w.repository.recordSupplierPayment({ billId, amountPaise: 100_000, paidOn: "2025-03-20", ...CONFIRM });
    const entries = w.entryCount();
    expect(() => w.repository.cancelPurchaseBill(billId)).toThrow(/supplier payments/);
    expect(w.repository.cancelSupplierPayment(payment.id).lines).toEqual([]);
    expect(w.audited("supplier.payment_cancelled", billId)).toBe(true);
    expect(w.repository.cancelPurchaseBill(billId).lines).toEqual([]);
    expect(w.repository.getPurchaseBill(billId).status).toBe("CANCELLED");
    expect(w.entryCount()).toBe(entries);
  });
});

describe("F: opening-balance receipts and settlements - ON the as-at date is already inside the balance", () => {
  it("refuses a receipt dated on the opening date, accepts the day after", () => {
    const w = world();
    w.openCustomer(1_000_000);
    const message = `This receipt is dated on or before the opening date (${OPENING}), so it is already included in the opening balance.`;
    expect(() => w.repository.recordOpeningBalanceReceipt({
      id: "RC-1", openingCustomerBalanceId: "OCB-1", amountPaise: 100_000, receivedOn: OPENING, paymentAccount: "CASH",
    })).toThrow(message);
    expect(() => w.repository.recordOpeningBalanceReceipt({
      id: "RC-1", openingCustomerBalanceId: "OCB-1", amountPaise: 100_000, receivedOn: "2025-03-01", paymentAccount: "CASH",
    })).toThrow(message);
    w.repository.recordOpeningBalanceReceipt({
      id: "RC-2", openingCustomerBalanceId: "OCB-1", amountPaise: 100_000, receivedOn: "2025-04-01", paymentAccount: "CASH",
    });
  });

  it("refuses a settlement dated on the opening date, accepts the day after", () => {
    const w = world();
    w.openSupplier(500_000);
    const message = `This settlement is dated on or before the opening date (${OPENING}), so it is already included in the opening balance.`;
    expect(() => w.repository.recordOpeningBalanceSettlement({
      id: "ST-1", openingSupplierBalanceId: "OSB-1", amountPaise: 100_000, paidOn: OPENING, paymentAccount: "CASH",
    })).toThrow(message);
    w.repository.recordOpeningBalanceSettlement({
      id: "ST-2", openingSupplierBalanceId: "OSB-1", amountPaise: 100_000, paidOn: "2025-04-01", paymentAccount: "CASH",
    });
  });
});

describe("F: imports keep pre-opening rows as history", () => {
  const importKind = (name: string) => {
    const kind = DOCUMENT_IMPORT_KINDS.find((k) => k.kind === name);
    if (kind === undefined) throw new Error(`no kind ${name}`);
    return kind;
  };
  const row = (rowNumber: number, values: Record<string, string>): MappedRow => ({ rowNumber, values });
  const run = (w: ReturnType<typeof world>, name: string, rows: MappedRow[]) => {
    const context: ImportContext = { repository: w.repository, companyId: w.companyId, businessId: w.businessId, dateFormat: "YYYY-MM-DD" };
    return w.repository.db.transaction(() => importKind(name).post(context, rows))();
  };

  it("a pre-opening invoice row is kept (not refused), and importing the file again changes nothing", () => {
    const w = world();
    w.openCustomer(1_000_000);
    const invoiceRow = row(2, { number: "OLD-1", invoiceDate: "2025-03-15", customer: "Host School", description: "Books", quantity: "1", unitPrice: "10000" });
    expect(run(w, "invoices", [invoiceRow])).toEqual({ status: "CREATED", reference: "OLD-1", message: "kept as history (before opening date)" });
    const [kept] = w.repository.listInvoices(w.businessId);
    expect(kept).toMatchObject({ number: "OLD-1", beforeOpening: true, status: "FINALIZED" });
    expect(w.trial("RECEIVABLES")).toBe(1_000_000);

    expect(run(w, "invoices", [invoiceRow])).toEqual({ status: "SKIPPED", reference: "OLD-1", message: "already exists" });
    expect(w.repository.listInvoices(w.businessId)).toHaveLength(1);
    expect(w.trial("RECEIVABLES")).toBe(1_000_000);

    // Its payment, dated before the opening, is kept the same way - and importing it again is skipped.
    const payRow = row(2, { invoiceNumber: "OLD-1", amount: "4000", paidOn: "2025-03-20" });
    expect(run(w, "payments", [payRow]).message).toBe("kept as history (before opening date)");
    expect(run(w, "payments", [payRow]).status).toBe("SKIPPED");
    expect(w.repository.listPayments(kept?.id ?? "")).toHaveLength(1);
    // A payment dated after the opening on that history invoice is refused (S17-12).
    expect(() => run(w, "payments", [row(3, { invoiceNumber: "OLD-1", amount: "100", paidOn: "2025-04-05" })])).toThrow(/kept as history/);
  });
});

describe("F: exports", () => {
  it("document exports carry a Before opening column: Yes for history, blank otherwise", () => {
    const w = world();
    w.openCustomer(1_000_000);
    w.openSupplier(100_000);
    const history = w.draftInvoice(10_000, "2025-03-15");
    const posted = w.draftInvoice(10_000, "2025-04-15");
    w.repository.finalizeInvoice(history, CONFIRM);
    w.repository.finalizeInvoice(posted);
    w.repository.recordPayment(history, 5_000, "2025-03-20", {}, CONFIRM);
    const billId = w.draftBill(10_000, "2025-03-10");
    w.repository.finalizePurchaseBill(billId, CONFIRM);
    w.repository.recordSupplierPayment({ billId, amountPaise: 1_000, paidOn: "2025-03-20", ...CONFIRM });

    for (const dataset of ["invoices", "payments", "purchase-bills", "supplier-payments", "credit-notes"] as const) {
      expect(buildExport(w.repository, dataset).columns.at(-1), dataset).toBe("Before opening");
    }
    const invoices = buildExport(w.repository, "invoices");
    const byNumber = new Map(invoices.rows.map((r) => [r[0], r.at(-1)]));
    expect(byNumber.get(history)).toBe("Yes");
    expect(byNumber.get(posted)).toBe("");
    expect(buildExport(w.repository, "payments").rows.map((r) => r.at(-1))).toEqual(["Yes"]);
    expect(buildExport(w.repository, "purchase-bills").rows.map((r) => r.at(-1))).toEqual(["Yes"]);
    expect(buildExport(w.repository, "supplier-payments").rows.map((r) => r.at(-1))).toEqual(["Yes"]);
  });
});
