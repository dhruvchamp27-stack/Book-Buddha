import { describe, expect, it } from "vitest";
import { AccountingRepository } from "./repository.js";
import type { Invoice } from "../accounting/types.js";

function createRepository(): AccountingRepository {
  return new AccountingRepository();
}

function createDraft(repository: AccountingRepository, accountingBasis: "CASH" | "ACCRUAL" = "ACCRUAL"): Invoice {
  const companyId = repository.createCompany({ name: "Test Company", accountingBasis });
  const businessId = repository.createBusiness({
    companyId,
    name: "Book Business",
  });
  const customerId = repository.createCustomer({
    companyId,
    name: "Test Customer",
  });
  const itemId = repository.createItem({
    companyId,
    name: "Book",
    unit: "each",
    trackStock: false,
  });
  return {
    id: "invoice-1",
    number: "INV-001/26-27",
    businessId,
    customerId,
    paymentAccount: "CASH",
    status: "DRAFT",
    lines: [{ itemId, description: "Book", quantity: 2, unitPricePaise: 12500 }],
  };
}

describe("AccountingRepository", () => {
  it("persists the master records and atomically finalizes an invoice", () => {
    const repository = createRepository();
    try {
      const invoice = createDraft(repository);
      repository.saveDraft(invoice);

      expect(repository.getInvoice(invoice.id).lines[0]?.itemId).toBeDefined();
      const journalEntry = repository.finalizeInvoice(invoice.id);
      expect(repository.getInvoice(invoice.id).status).toBe("FINALIZED");
      expect(journalEntry.lines).toHaveLength(2);
      expect(repository.listAuditEvents(invoice.id)).toHaveLength(1);
    } finally {
      repository.close();
    }
  });

  it("converts a quotation into a separate draft invoice", () => {
    const repository = createRepository();
    try {
      const quotation = { ...createDraft(repository), id: "quotation-1", number: "QUO-001", status: "QUOTATION" as const };
      repository.saveDraft(quotation);
      const converted = repository.convertQuotation(quotation.id);

      expect(converted.status).toBe("DRAFT");
      expect(converted.id).not.toBe(quotation.id);
      expect(converted.number).toBe("INV-QUO-001");
      expect(repository.getInvoice(quotation.id).convertedInvoiceId).toBe(converted.id);
      expect(() => repository.convertQuotation(quotation.id)).toThrow("already been converted");
    } finally {
      repository.close();
    }
  });

  it("stores a reversal and audit event when an invoice is cancelled", () => {
    const repository = createRepository();
    try {
      const invoice = createDraft(repository);
      repository.saveDraft(invoice);
      repository.finalizeInvoice(invoice.id);

      const reversal = repository.cancelInvoice(invoice.id);
      expect(reversal.isReversal).toBe(true);
      expect(repository.getInvoice(invoice.id).status).toBe("CANCELLED");
      expect(repository.listAuditEvents(invoice.id).map((event) => event.action)).toEqual([
        "invoice.finalized",
        "invoice.cancelled",
      ]);
    } finally {
      repository.close();
    }
  });

  it("rolls back finalization when persistence fails", () => {
    const repository = createRepository();
    try {
      const invoice = createDraft(repository);
      repository.saveDraft(invoice);
      repository.db
        .prepare("CREATE TRIGGER fail_journal_insert BEFORE INSERT ON journal_entries BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
        .run();

      expect(() => repository.finalizeInvoice(invoice.id)).toThrow("forced failure");
      expect(repository.getInvoice(invoice.id).status).toBe("DRAFT");
      expect(repository.listAuditEvents(invoice.id)).toHaveLength(0);
    } finally {
      repository.close();
    }
  });

  it("builds profit and loss, balance sheet, and general ledger reports", () => {
    const repository = createRepository();
    try {
      const invoice = createDraft(repository);
      repository.saveDraft(invoice);
      repository.finalizeInvoice(invoice.id);

      expect(repository.getProfitAndLoss()).toMatchObject({
        totalIncomePaise: 25000,
        totalExpensesPaise: 0,
        netProfitPaise: 25000,
      });
      expect(repository.getBalanceSheet()).toMatchObject({
        totalAssetsPaise: 25000,
        totalLiabilitiesPaise: 0,
        totalEquityPaise: 25000,
      });
      expect(repository.getGeneralLedger()).toHaveLength(2);
      expect(repository.getGeneralLedger()[0]).toMatchObject({
        sourceId: invoice.id,
        account: "CASH",
        debitPaise: 25000,
      });
    } finally {
      repository.close();
    }
  });

  it("records partial payments and reports the remaining receivable", () => {
    const repository = createRepository();
    try {
      const invoice = { ...createDraft(repository), paymentAccount: "RECEIVABLES" as const };
      repository.saveDraft(invoice);
      repository.finalizeInvoice(invoice.id);

      const payment = repository.recordPayment(invoice.id, 10000);
      expect(payment.amountPaise).toBe(10000);
      expect(repository.getReceivables()[0]).toMatchObject({
        invoiceId: invoice.id,
        totalPaise: 25000,
        paidPaise: 10000,
        outstandingPaise: 15000,
      });

      expect(repository.listPayments(invoice.id)).toHaveLength(1);
      expect(repository.listJournalEntries()).toHaveLength(2);
      expect(() => repository.recordPayment(invoice.id, 20000)).toThrow(
        "Payment cannot exceed the invoice outstanding balance.",
      );
    } finally {
      repository.close();
    }
  });

  it("recognizes cash-basis receivable sales when payment is received", () => {
    const repository = createRepository();
    try {
      const invoice = { ...createDraft(repository, "CASH"), paymentAccount: "RECEIVABLES" as const };
      repository.saveDraft(invoice);
      const pending = repository.finalizeInvoice(invoice.id);

      expect(pending.lines).toHaveLength(0);
      expect(repository.getProfitAndLoss().totalIncomePaise).toBe(0);

      repository.recordPayment(invoice.id, 10000);
      expect(repository.getProfitAndLoss().totalIncomePaise).toBe(10000);
      expect(repository.getGeneralLedger()).toEqual(expect.arrayContaining([
        expect.objectContaining({ account: "CASH", debitPaise: 10000 }),
        expect.objectContaining({ account: "SALES", creditPaise: 10000 }),
      ]));
    } finally {
      repository.close();
    }
  });

  it("links fairs to their host customer and invoice", () => {
    const repository = createRepository();
    try {
      const companyId = repository.createCompany({ name: "Fair Company" });
      const businessId = repository.createBusiness({ companyId, name: "Fair Business" });
      const customerId = repository.createCustomer({ companyId, name: "Fair Host" });
      const fairId = repository.createFair({
        companyId,
        hostCustomerId: customerId,
        name: "Winter Book Fair",
      });
      repository.saveDraft({
        id: "fair-invoice",
        number: "INV-FAIR",
        businessId,
        customerId,
        fairId,
        buyerName: "Buyer One",
        buyerContact: "buyer@example.test",
        paymentAccount: "CASH",
        status: "DRAFT",
        lines: [{ description: "Book", quantity: 1, unitPricePaise: 1000 }],
      });
      expect(repository.listFairs(companyId)[0]).toMatchObject({
        id: fairId,
        hostCustomerId: customerId,
      });
      expect(repository.getInvoice("fair-invoice")).toMatchObject({
        fairId,
        buyerName: "Buyer One",
        buyerContact: "buyer@example.test",
      });
    } finally {
      repository.close();
    }
  });

  it("tracks FIFO stock and prevents tracked items from going negative", () => {
    const repository = createRepository();
    try {
      const companyId = repository.createCompany({ name: "Stock Company" });
      const businessId = repository.createBusiness({ companyId, name: "Stock Business" });
      const customerId = repository.createCustomer({ companyId, name: "Stock Customer" });
      const itemId = repository.createItem({ companyId, name: "Stock Book", unit: "each", trackStock: true });
      repository.addStockMovement({ itemId, movementType: "OPENING", quantity: 2, unitCostPaise: 1000 });
      repository.addStockMovement({ itemId, movementType: "PURCHASE", quantity: 2, unitCostPaise: 1500 });
      const invoice: Invoice = {
        id: "stock-invoice",
        number: "INV-STOCK",
        businessId,
        customerId,
        paymentAccount: "CASH",
        status: "DRAFT",
        lines: [{ itemId, description: "Stock Book", quantity: 3, unitPricePaise: 3000 }],
      };
      repository.saveDraft(invoice);
      repository.finalizeInvoice(invoice.id);
      expect(repository.getStockBalances()[0]).toMatchObject({
        itemId,
        quantity: 1,
        valuePaise: 1500,
      });
      expect(repository.getProfitAndLoss()).toMatchObject({
        totalExpensesPaise: 3500,
        netProfitPaise: 9000 - 3500,
      });
      expect(repository.getTrialBalance()).toEqual(expect.arrayContaining([
        expect.objectContaining({ account: "COGS", debitPaise: 3500 }),
        expect.objectContaining({ account: "INVENTORY", creditPaise: 3500 }),
      ]));
      expect(repository.listJournalEntries()).toHaveLength(2);

      const another = { ...invoice, id: "stock-invoice-2", number: "INV-STOCK-2" };
      repository.saveDraft(another);
      expect(() => repository.finalizeInvoice(another.id)).toThrow("Insufficient stock");
    } finally {
      repository.close();
    }
  });
});
