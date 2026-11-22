import { describe, expect, it } from "vitest";
import { AccountingRepository } from "./repository.js";
import type { Invoice } from "../accounting/types.js";
import { financialYearLabel } from "../banking/internal-transfers.js";

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
      // S17-4/S17-8: the next INV number (the quotation's own QUO-001 is a different series), linked both ways.
      expect(converted.number).toBe(`INV-001/${financialYearLabel(converted.invoiceDate ?? "")}`);
      expect(repository.getInvoice(quotation.id).convertedInvoiceId).toBe(converted.id);
      expect(repository.getInvoice(converted.id).sourceQuotationId).toBe(quotation.id);
      expect(repository.getInvoice(quotation.id).convertedInvoiceIds).toEqual([converted.id]);
      expect(repository.getInvoice(quotation.id).sourceQuotationId).toBeNull();
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

  it("presents liabilities credit-normal so assets = liabilities + equity with GST and payables", () => {
    const repository = createRepository();
    try {
      const invoice: Invoice = {
        ...createDraft(repository),
        paymentAccount: "RECEIVABLES",
        taxType: "CGST_SGST",
        taxRateBasisPoints: 1800,
      };
      repository.saveDraft(invoice);
      repository.finalizeInvoice(invoice.id);
      const business = repository.listBusinesses()[0]!;
      const supplierId = repository.createSupplier({ companyId: business.companyId, name: "Paper House" });
      const bill = repository.createPurchaseBill({
        businessId: business.id,
        supplierId,
        number: "PB-BS",
        billDate: "2026-11-01",
        paymentAccount: "PAYABLES",
        lines: [{ description: "Printing", quantity: 1, unitPricePaise: 7000 }],
      });
      repository.finalizePurchaseBill(bill.id);

      const sheet = repository.getBalanceSheet();
      const accounts = sheet.liabilities.map((row) => row.account);
      expect(accounts).toEqual(expect.arrayContaining(["OUTPUT_CGST", "OUTPUT_SGST", "PAYABLES"]));
      expect(sheet.liabilities.every((row) => row.balancePaise >= 0)).toBe(true);
      expect(sheet.liabilities.find((row) => row.account === "PAYABLES")?.balancePaise).toBe(7000);
      expect(sheet.totalLiabilitiesPaise).toBeGreaterThan(0);
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
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
        /Payment cannot exceed the invoice outstanding balance of 15000 paise/,
      );
    } finally {
      repository.close();
    }
  });

  it("recognizes receivable sales in full at finalize for a cash-basis company; payments only move CASH/RECEIVABLES", () => {
    const repository = createRepository();
    try {
      const invoice = { ...createDraft(repository, "CASH"), paymentAccount: "RECEIVABLES" as const };
      repository.saveDraft(invoice);
      const posted = repository.finalizeInvoice(invoice.id);

      expect(posted.lines).toEqual([
        { account: "RECEIVABLES", debitPaise: 25000, creditPaise: 0 },
        { account: "SALES", debitPaise: 0, creditPaise: 25000 },
      ]);
      expect(repository.getProfitAndLoss().totalIncomePaise).toBe(25000);

      repository.recordPayment(invoice.id, 10000);
      expect(repository.getProfitAndLoss().totalIncomePaise).toBe(25000);
      expect(repository.getGeneralLedger()).toEqual(expect.arrayContaining([
        expect.objectContaining({ account: "CASH", debitPaise: 10000 }),
        expect.objectContaining({ account: "RECEIVABLES", creditPaise: 10000 }),
      ]));
      const payment = repository.listJournalEntries().find((entry) => entry.id.startsWith("je-payment-"));
      expect(payment?.lines).toEqual([
        { account: "CASH", debitPaise: 10000, creditPaise: 0 },
        { account: "RECEIVABLES", debitPaise: 0, creditPaise: 10000 },
      ]);

      // A part-paid invoice cannot be cancelled, exactly as a part-paid bill cannot:
      // reversing the full 25000 while the 10000 receipt stands would leave RECEIVABLES
      // at -10000 and the cash unaccounted for.
      expect(() => repository.cancelInvoice(invoice.id)).toThrow("cannot be cancelled");
      expect(repository.getInvoice(invoice.id).status).toBe("FINALIZED");
      const receivable = repository.getTrialBalance().find((row) => row.account === "RECEIVABLES");
      expect((receivable?.debitPaise ?? 0) - (receivable?.creditPaise ?? 0)).toBe(15000);
      // Cancelling an UNPAID receivable invoice still works: covered above by
      // "reverses a finalized invoice and restores stock".
    } finally {
      repository.close();
    }
  });

  it("posts identical journal lines for a part-paid GST receivable invoice on a CASH-basis and an ACCRUAL-basis company", () => {
    const run = (basis: "CASH" | "ACCRUAL"): string[] => {
      const repository = createRepository();
      try {
        const invoice = {
          ...createDraft(repository, basis),
          paymentAccount: "RECEIVABLES" as const,
          taxType: "CGST_SGST" as const,
          taxRateBasisPoints: 1800,
        };
        repository.saveDraft(invoice);
        repository.finalizeInvoice(invoice.id);
        repository.recordPayment(invoice.id, 10000);
        repository.recordPayment(invoice.id, 1);
        return repository.listJournalEntries()
          .map((entry) => JSON.stringify({
            description: entry.description,
            sourceType: entry.sourceType ?? null,
            isReversal: entry.isReversal,
            lines: entry.lines.map((line) => [line.account, line.debitPaise, line.creditPaise]),
          }))
          .sort();
      } finally {
        repository.close();
      }
    };
    const cash = run("CASH");
    const accrual = run("ACCRUAL");
    // 1 finalize entry + 2 payment entries
    expect(cash).toHaveLength(3);
    expect(cash).toEqual(accrual);
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
      // S17: the door refuses a bare PURCHASE, so this old-database shape (a source-less PURCHASE
      // row that posted nothing) is inserted by hand. Every figure below is unchanged.
      repository.db
        .prepare("INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at) VALUES ('legacy-purchase', ?, NULL, 'PURCHASE', 2, 1500, ?)")
        .run(itemId, new Date().toISOString());
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
      // S10-5: the trial balance reports NET balances. COGS is one-sided, so it is unchanged at
      // Dr 3500. INVENTORY moved Dr 2000 (the opening movement) against Cr 3500 (the cost of the
      // sale) and therefore nets to a CREDIT of 1500 - a negative inventory in the ledger while
      // 1500 of stock is actually held. That is not a netting artefact: it is the known
      // uncovered-purchase-movement gap (S7-1(d)), where a bare PURCHASE movement posts nothing
      // but is still consumed by FIFO. Netting makes it visible instead of hiding it inside the
      // gross columns, which is the point of the change.
      expect(repository.getTrialBalance()).toEqual(expect.arrayContaining([
        expect.objectContaining({ account: "COGS", debitPaise: 3500 }),
        expect.objectContaining({ account: "INVENTORY", debitPaise: 0, creditPaise: 1500 }),
      ]));
      // 2 before R4c (the invoice and its cost). The OPENING movement above now posts a third
      // (Dr INVENTORY 2000 / Cr OPENING_BALANCE_EQUITY); the bare PURCHASE still posts nothing.
      expect(repository.listJournalEntries()).toHaveLength(3);
      expect(repository.getTrialBalance().find((r) => r.account === "OPENING_BALANCE_EQUITY"))
        .toMatchObject({ debitPaise: 0, creditPaise: 2000 }); // 2 @ 1000
      // The P&L is untouched by it: opening stock is EQUITY, never income or expense (S5-3).
      expect(repository.getProfitAndLoss().netProfitPaise).toBe(9000 - 3500);

      const another = { ...invoice, id: "stock-invoice-2", number: "INV-STOCK-2" };
      repository.saveDraft(another);
      expect(() => repository.finalizeInvoice(another.id)).toThrow("Insufficient stock");
    } finally {
      repository.close();
    }
  });
});
