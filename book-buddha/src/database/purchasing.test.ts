import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";
import { migrations, runMigrations } from "./migrations.js";
import type { Invoice } from "../accounting/types.js";

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  supplierId: string;
  stockItemId: string;
  serviceItemId: string;
}

function setup(accountingBasis: "CASH" | "ACCRUAL" = "ACCRUAL"): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House", gstin: "07AAAAA0000A1Z5" });
  const stockItemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const serviceItemId = repository.createItem({ companyId, name: "Freight", unit: "job", trackStock: false });
  return { repository, companyId, businessId, supplierId, stockItemId, serviceItemId };
}

/** debit - credit for one account from the trial balance (0 when the account has no lines). */
function balance(repository: AccountingRepository, account: string): number {
  const row = repository.getTrialBalance().find((entry) => entry.account === account);
  return row === undefined ? 0 : row.debitPaise - row.creditPaise;
}

function trialBalanceIsBalanced(repository: AccountingRepository): boolean {
  const rows = repository.getTrialBalance();
  return rows.reduce((t, r) => t + r.debitPaise, 0) === rows.reduce((t, r) => t + r.creditPaise, 0);
}

function sell(world: World, id: string, quantity: number, unitPricePaise: number): void {
  const { repository, companyId, businessId, stockItemId } = world;
  const customerId = repository.createCustomer({ companyId, name: `Customer ${id}` });
  const invoice: Invoice = {
    id,
    number: id,
    businessId,
    customerId,
    paymentAccount: "CASH",
    status: "DRAFT",
    lines: [{ itemId: stockItemId, description: "Atlas", quantity, unitPricePaise }],
  };
  repository.saveDraft(invoice);
  repository.finalizeInvoice(id);
}

describe("purchase bills", () => {
  it("posts inventory, expense and split input GST for a cash bill and ties to the FIFO lot", () => {
    const world = setup();
    const { repository } = world;
    try {
      const bill = repository.createPurchaseBill({
        businessId: world.businessId,
        supplierId: world.supplierId,
        number: "PB-1",
        billDate: "2026-11-01",
        paymentAccount: "CASH",
        taxType: "CGST_SGST",
        taxRateBasisPoints: 1800,
        lines: [
          { itemId: world.stockItemId, description: "Atlas", quantity: 10, unitPricePaise: 5000 },
          { itemId: world.serviceItemId, description: "Freight", quantity: 2, unitPricePaise: 1000 },
        ],
      });
      expect(bill).toMatchObject({ status: "DRAFT", subtotalPaise: 52000, taxPaise: 9360, totalPaise: 61360 });
      expect(repository.getTrialBalance()).toEqual([]);

      const entry = repository.finalizePurchaseBill(bill.id);
      expect(entry.lines).toEqual([
        { account: "INVENTORY", debitPaise: 50000, creditPaise: 0 },
        { account: "EXPENSE", debitPaise: 2000, creditPaise: 0 },
        { account: "INPUT_CGST", debitPaise: 4680, creditPaise: 0 },
        { account: "INPUT_SGST", debitPaise: 4680, creditPaise: 0 },
        { account: "CASH", debitPaise: 0, creditPaise: 61360 },
      ]);
      expect(balance(repository, "INVENTORY")).toBe(50000);
      expect(balance(repository, "EXPENSE")).toBe(2000);
      expect(balance(repository, "INPUT_CGST")).toBe(4680);
      expect(balance(repository, "INPUT_SGST")).toBe(4680);
      expect(balance(repository, "CASH")).toBe(-61360);
      expect(trialBalanceIsBalanced(repository)).toBe(true);
      expect(repository.getGeneralLedger().every((row) => row.sourceType === "PURCHASE_BILL")).toBe(true);

      // FIFO sub-ledger lot at unit cost ties to the INVENTORY ledger.
      expect(repository.listStockMovements(world.stockItemId)).toMatchObject([
        { movementType: "PURCHASE", quantityDelta: 10, unitCostPaise: 5000, sourceId: bill.id },
      ]);
      const valuation = repository.getInventoryValuation();
      expect(valuation.reduce((t, r) => t + r.valuePaise, 0)).toBe(balance(repository, "INVENTORY"));

      expect(repository.getPurchaseBill(bill.id).status).toBe("FINALIZED");
      expect(repository.listAuditEvents(bill.id).map((e) => e.action)).toEqual(["purchase_bill.created", "purchase_bill.finalized"]);
      expect(() => repository.finalizePurchaseBill(bill.id)).toThrow(RepositoryValidationError);
    } finally {
      repository.close();
    }
  });

  it("splits odd input GST with CGST = floor(tax/2) and posts IGST in one line", () => {
    const world = setup();
    const { repository } = world;
    try {
      const odd = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-ODD", billDate: "2026-11-01",
        paymentAccount: "CASH", taxType: "CGST_SGST", taxRateBasisPoints: 500,
        lines: [{ description: "Misc", quantity: 1, unitPricePaise: 10010 }],
      });
      const oddEntry = repository.finalizePurchaseBill(odd.id);
      expect(oddEntry.lines).toEqual([
        { account: "EXPENSE", debitPaise: 10010, creditPaise: 0 },
        { account: "INPUT_CGST", debitPaise: 250, creditPaise: 0 },
        { account: "INPUT_SGST", debitPaise: 251, creditPaise: 0 },
        { account: "CASH", debitPaise: 0, creditPaise: 10511 },
      ]);
      const igst = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-IGST", billDate: "2026-11-01",
        paymentAccount: "CASH", taxType: "IGST", taxRateBasisPoints: 1800,
        lines: [{ description: "Misc", quantity: 1, unitPricePaise: 10000 }],
      });
      repository.finalizePurchaseBill(igst.id);
      expect(balance(repository, "INPUT_IGST")).toBe(1800);
      expect(trialBalanceIsBalanced(repository)).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("posts a PAYABLES bill, takes supplier payments, rejects overpayment and feeds the reports", () => {
    const world = setup();
    const { repository } = world;
    try {
      const bill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-2", billDate: "2026-10-01",
        paymentAccount: "PAYABLES", taxType: "IGST", taxRateBasisPoints: 1800,
        lines: [{ description: "Paper", quantity: 1, unitPricePaise: 10000 }],
      });
      repository.finalizePurchaseBill(bill.id);
      expect(balance(repository, "PAYABLES")).toBe(-11800);
      expect(repository.getPayables()).toMatchObject([
        { documentType: "BILL", documentId: bill.id, totalPaise: 11800, paidPaise: 0, outstandingPaise: 11800 },
      ]);
      expect(repository.getPayables()[0]?.ageDays).toBeGreaterThanOrEqual(0);

      const payment = repository.recordSupplierPayment({ billId: bill.id, amountPaise: 5000 });
      expect(payment).toMatchObject({ supplierId: world.supplierId, billId: bill.id, expenseId: null, amountPaise: 5000 });
      expect(balance(repository, "PAYABLES")).toBe(-6800);
      expect(balance(repository, "CASH")).toBe(-5000);
      expect(repository.getPayables()[0]).toMatchObject({ paidPaise: 5000, outstandingPaise: 6800 });
      expect(() => repository.recordSupplierPayment({ billId: bill.id, amountPaise: 6801 })).toThrow("outstanding");
      expect(() => repository.recordSupplierPayment({ billId: bill.id, amountPaise: 0 })).toThrow(RepositoryValidationError);
      expect(() => repository.recordSupplierPayment({ amountPaise: 10 })).toThrow("exactly one");

      const statement = repository.getSupplierStatement(world.supplierId);
      expect(statement.rows.map((r) => [r.type, r.amountPaise, r.balancePaise])).toEqual([
        ["BILL", 11800, 11800],
        ["PAYMENT", -5000, 6800],
      ]);
      expect(statement.closingBalancePaise).toBe(6800);

      repository.recordSupplierPayment({ billId: bill.id, amountPaise: 6800 });
      expect(balance(repository, "PAYABLES")).toBe(0);
      expect(repository.getPayables()).toEqual([]);
      expect(() => repository.recordSupplierPayment({ billId: bill.id, amountPaise: 1 })).toThrow("outstanding");
      expect(repository.listSupplierPayments({ supplierId: world.supplierId })).toHaveLength(2);
      expect(trialBalanceIsBalanced(repository)).toBe(true);

      const cashBill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-3", billDate: "2026-11-01",
        paymentAccount: "CASH", lines: [{ description: "Tape", quantity: 1, unitPricePaise: 100 }],
      });
      repository.finalizePurchaseBill(cashBill.id);
      expect(() => repository.recordSupplierPayment({ billId: cashBill.id, amountPaise: 10 })).toThrow("payable later");
    } finally {
      repository.close();
    }
  });

  it("cancels with an exact reversal and restores stock via PURCHASE_REVERSAL", () => {
    const world = setup();
    const { repository } = world;
    try {
      const bill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-4", billDate: "2026-11-01",
        paymentAccount: "CASH", taxType: "CGST_SGST", taxRateBasisPoints: 1200,
        lines: [
          { itemId: world.stockItemId, description: "Atlas", quantity: 3, unitPricePaise: 700 },
          { description: "Service", quantity: 1, unitPricePaise: 333 },
        ],
      });
      expect(() => repository.cancelPurchaseBill(bill.id)).toThrow("Only finalized");
      const original = repository.finalizePurchaseBill(bill.id);
      const reversal = repository.cancelPurchaseBill(bill.id);
      expect(reversal.isReversal).toBe(true);
      expect(reversal.lines).toEqual(original.lines.map((l) => ({ account: l.account, debitPaise: l.creditPaise, creditPaise: l.debitPaise })));
      for (const account of ["INVENTORY", "EXPENSE", "INPUT_CGST", "INPUT_SGST", "CASH"]) {
        expect(balance(repository, account)).toBe(0);
      }
      expect(repository.getPurchaseBill(bill.id).status).toBe("CANCELLED");
      expect(repository.getInventoryValuation()[0]).toMatchObject({ quantity: 0, valuePaise: 0 });
      expect(repository.listStockMovements(world.stockItemId).map((m) => m.movementType)).toEqual(["PURCHASE", "PURCHASE_REVERSAL"]);
      expect(repository.listAuditEvents(bill.id).map((e) => e.action)).toContain("purchase_bill.cancelled");
      expect(() => repository.cancelPurchaseBill(bill.id)).toThrow("Only finalized");
      expect(trialBalanceIsBalanced(repository)).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("refuses cancel when this bill's own lot was partly sold, even if later purchases restock the item", () => {
    const world = setup();
    const { repository } = world;
    try {
      // Older lot (opening stock, no GL): 5 @ 100.
      repository.addStockMovement({ itemId: world.stockItemId, movementType: "OPENING", quantity: 5, unitCostPaise: 100 });
      const billA = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-A", billDate: "2026-11-01",
        paymentAccount: "CASH", lines: [{ itemId: world.stockItemId, description: "Atlas", quantity: 10, unitPricePaise: 200 }],
      });
      repository.finalizePurchaseBill(billA.id);
      // Selling 7 sells out the older lot (5) and 2 of bill A's lot.
      sell(world, "sale-1", 7, 1000);
      const billB = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-B", billDate: "2026-11-02",
        paymentAccount: "CASH", lines: [{ itemId: world.stockItemId, description: "Atlas", quantity: 20, unitPricePaise: 300 }],
      });
      repository.finalizePurchaseBill(billB.id);
      // 28 units are on hand in total (more than the 10 bill A bought) but A's own lot has only 8 left.
      expect(repository.getStockBalances()[0]?.quantity).toBe(28);
      const before = repository.getTrialBalance();
      expect(() => repository.cancelPurchaseBill(billA.id)).toThrow("already been sold");
      expect(repository.getTrialBalance()).toEqual(before);
      expect(repository.getPurchaseBill(billA.id).status).toBe("FINALIZED");

      // Bill B's lot is intact: cancelling it removes B's lot, NOT the oldest remaining lot (A).
      repository.cancelPurchaseBill(billB.id);
      const valuation = repository.getInventoryValuation()[0];
      expect(valuation).toMatchObject({ quantity: 8, valuePaise: 8 * 200 });
    } finally {
      repository.close();
    }
  });

  it("ties FIFO valuation to the INVENTORY ledger for a bill-only purchase-then-sale flow", () => {
    const world = setup();
    const { repository } = world;
    try {
      const bill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-T", billDate: "2026-11-01",
        paymentAccount: "PAYABLES", taxType: "IGST", taxRateBasisPoints: 500,
        lines: [{ itemId: world.stockItemId, description: "Atlas", quantity: 10, unitPricePaise: 500 }],
      });
      repository.finalizePurchaseBill(bill.id);
      sell(world, "sale-t", 4, 900);
      const valuationTotal = repository.getInventoryValuation().reduce((t, r) => t + r.valuePaise, 0);
      expect(valuationTotal).toBe(6 * 500);
      expect(balance(repository, "INVENTORY")).toBe(valuationTotal);
      expect(balance(repository, "COGS")).toBe(4 * 500);
    } finally {
      repository.close();
    }
  });

  it("refuses to cancel a bill that already has supplier payments", () => {
    const world = setup();
    const { repository } = world;
    try {
      const bill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-P", billDate: "2026-11-01",
        paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: 1000 }],
      });
      repository.finalizePurchaseBill(bill.id);
      repository.recordSupplierPayment({ billId: bill.id, amountPaise: 100 });
      expect(() => repository.cancelPurchaseBill(bill.id)).toThrow("supplier payments");
      expect(balance(repository, "PAYABLES")).toBe(-900);
    } finally {
      repository.close();
    }
  });
});

describe("expenses", () => {
  it("finalizes, pays and cancels expenses with input tax", () => {
    const world = setup();
    const { repository } = world;
    try {
      const categoryId = repository.createExpenseCategory({ companyId: world.companyId, name: "Rent" });
      expect(() => repository.createExpenseCategory({ companyId: world.companyId, name: "rent" })).toThrow("already exists");
      expect(repository.listExpenseCategories(world.companyId)).toMatchObject([{ id: categoryId, name: "Rent", active: true }]);

      const cash = repository.createExpense({
        businessId: world.businessId, categoryId, number: "EX-1", expenseDate: "2026-11-01", description: "Stall rent",
        amountPaise: 10000, taxType: "CGST_SGST", taxRateBasisPoints: 1800, paymentAccount: "CASH",
      });
      const entry = repository.finalizeExpense(cash.id);
      expect(entry.lines).toEqual([
        { account: "EXPENSE", debitPaise: 10000, creditPaise: 0 },
        { account: "INPUT_CGST", debitPaise: 900, creditPaise: 0 },
        { account: "INPUT_SGST", debitPaise: 900, creditPaise: 0 },
        { account: "CASH", debitPaise: 0, creditPaise: 11800 },
      ]);
      expect(balance(repository, "EXPENSE")).toBe(10000);
      expect(repository.getProfitAndLoss()).toMatchObject({ totalExpensesPaise: 10000, netProfitPaise: -10000 });

      repository.cancelExpense(cash.id);
      expect(balance(repository, "EXPENSE")).toBe(0);
      expect(balance(repository, "CASH")).toBe(0);
      expect(repository.getExpense(cash.id).status).toBe("CANCELLED");

      const credit = repository.createExpense({
        businessId: world.businessId, supplierId: world.supplierId, number: "EX-2", expenseDate: "2026-11-02",
        description: "Courier", amountPaise: 2000, paymentAccount: "PAYABLES",
      });
      repository.finalizeExpense(credit.id);
      expect(balance(repository, "PAYABLES")).toBe(-2000);
      repository.recordSupplierPayment({ expenseId: credit.id, amountPaise: 500 });
      expect(repository.getPayables()).toMatchObject([{ documentType: "EXPENSE", outstandingPaise: 1500 }]);
      expect(() => repository.cancelExpense(credit.id)).toThrow("supplier payments");
      expect(repository.getSupplierStatement(world.supplierId).closingBalancePaise).toBe(1500);
      expect(trialBalanceIsBalanced(repository)).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("balance sheet satisfies assets = liabilities + equity after bills with expense lines and expenses", () => {
    const world = setup();
    const { repository } = world;
    try {
      const cashBill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-BS1", billDate: "2026-11-01",
        paymentAccount: "CASH", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
        lines: [
          { itemId: world.stockItemId, description: "Atlas", quantity: 10, unitPricePaise: 5000 },
          { description: "Freight", quantity: 1, unitPricePaise: 2501 },
        ],
      });
      repository.finalizePurchaseBill(cashBill.id);
      const creditBill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-BS2", billDate: "2026-11-01",
        paymentAccount: "PAYABLES", taxType: "IGST", taxRateBasisPoints: 500,
        lines: [{ description: "Printing", quantity: 3, unitPricePaise: 1234 }],
      });
      repository.finalizePurchaseBill(creditBill.id);
      const expense = repository.createExpense({
        businessId: world.businessId, supplierId: world.supplierId, number: "EX-BS", expenseDate: "2026-11-03",
        description: "Fees", amountPaise: 999, paymentAccount: "PAYABLES",
      });
      repository.finalizeExpense(expense.id);
      repository.recordSupplierPayment({ billId: creditBill.id, amountPaise: 1000 });
      sell(world, "sale-bs", 2, 8000);

      expect(balance(repository, "PAYABLES")).toBe(-(3 * 1234 + 185 - 1000 + 999));
      expect(balance(repository, "INPUT_IGST")).toBe(185);
      const sheet = repository.getBalanceSheet();
      // Liability rows carry credit-negative balances, so owed amount = -totalLiabilitiesPaise.
      expect(sheet.totalAssetsPaise).toBe(-sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
      expect(sheet.assets.map((r) => r.account)).toEqual(expect.arrayContaining(["INPUT_CGST", "INPUT_SGST", "INPUT_IGST", "INVENTORY"]));
      expect(sheet.liabilities.map((r) => r.account)).toContain("PAYABLES");
      const pl = repository.getProfitAndLoss();
      expect(sheet.totalEquityPaise).toBe(pl.netProfitPaise);
      expect(pl.expenses.map((r) => r.account)).toEqual(expect.arrayContaining(["COGS", "EXPENSE"]));
    } finally {
      repository.close();
    }
  });
});

describe("validation and ownership", () => {
  it("refuses PAYABLES bills and expenses for cash-basis companies", () => {
    const world = setup("CASH");
    const { repository } = world;
    try {
      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-C", billDate: "2026-11-01",
        paymentAccount: "PAYABLES", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }],
      })).toThrow("cash-basis");
      expect(() => repository.createExpense({
        businessId: world.businessId, supplierId: world.supplierId, number: "EX-C", expenseDate: "2026-11-01",
        description: "x", amountPaise: 100, paymentAccount: "PAYABLES",
      })).toThrow("cash-basis");
      // CASH is allowed.
      const bill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "PB-C2", billDate: "2026-11-01",
        paymentAccount: "CASH", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }],
      });
      expect(repository.finalizePurchaseBill(bill.id).lines).toHaveLength(2);
    } finally {
      repository.close();
    }
  });

  it("enforces company ownership of supplier, items, categories and payable suppliers", () => {
    const world = setup();
    const { repository } = world;
    try {
      const otherCompany = repository.createCompany({ name: "Other" });
      const otherSupplier = repository.createSupplier({ companyId: otherCompany, name: "Other Supplier" });
      const otherItem = repository.createItem({ companyId: otherCompany, name: "Other Item", unit: "each", trackStock: true });
      const otherCategory = repository.createExpenseCategory({ companyId: otherCompany, name: "Other Cat" });
      const line = { description: "x", quantity: 1, unitPricePaise: 100 };

      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: otherSupplier, number: "B", billDate: "2026-11-01", paymentAccount: "CASH", lines: [line],
      })).toThrow("same company");
      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "B", billDate: "2026-11-01", paymentAccount: "CASH",
        lines: [{ ...line, itemId: otherItem }],
      })).toThrow("same company");
      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: "missing", number: "B", billDate: "2026-11-01", paymentAccount: "CASH", lines: [line],
      })).toThrow("not found");
      expect(() => repository.createExpense({
        businessId: world.businessId, categoryId: otherCategory, number: "E", expenseDate: "2026-11-01", description: "x", amountPaise: 100, paymentAccount: "CASH",
      })).toThrow("same company");
      expect(() => repository.createExpense({
        businessId: world.businessId, supplierId: otherSupplier, number: "E", expenseDate: "2026-11-01", description: "x", amountPaise: 100, paymentAccount: "CASH",
      })).toThrow("same company");
      expect(() => repository.createExpense({
        businessId: world.businessId, number: "E", expenseDate: "2026-11-01", description: "x", amountPaise: 100, paymentAccount: "PAYABLES",
      })).toThrow("must name a supplier");

      // Supplier on a payment always comes from the target document.
      const bill = repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "B-OK", billDate: "2026-11-01", paymentAccount: "PAYABLES", lines: [line],
      });
      repository.finalizePurchaseBill(bill.id);
      expect(repository.recordSupplierPayment({ billId: bill.id, amountPaise: 50 }).supplierId).toBe(world.supplierId);
      expect(repository.listSupplierPayments({ supplierId: otherSupplier })).toEqual([]);

      // Bad inputs.
      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "B", billDate: "2026-02-31", paymentAccount: "CASH", lines: [line],
      })).toThrow("YYYY-MM-DD");
      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "B", billDate: "2026-11-01", paymentAccount: "CASH",
        taxType: "NONE", taxRateBasisPoints: 500, lines: [line],
      })).toThrow("requires a tax type");
      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "B", billDate: "2026-11-01", paymentAccount: "CASH",
        lines: [{ ...line, unitPricePaise: 1.5 }],
      })).toThrow("whole paise");
      expect(() => repository.createPurchaseBill({
        businessId: world.businessId, supplierId: world.supplierId, number: "B", billDate: "2026-11-01", paymentAccount: "CASH", lines: [],
      })).toThrow("at least one line");
    } finally {
      repository.close();
    }
  });
});

describe("migration v4", () => {
  it("upgrades a v3 database keeping journals, stock order and triggers, with FK integrity", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    expect(runMigrations(db, migrations.filter((m) => m.version <= 3))).toEqual([1, 2, 3]);
    db.exec(`
      INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', '2026-01-01');
      INSERT INTO businesses (id, company_id, name, created_at) VALUES ('b1', 'c1', 'Biz', '2026-01-01');
      INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu1', 'c1', 'Cust', '2026-01-01');
      INSERT INTO items (id, company_id, name, unit, track_stock, created_at) VALUES ('it1', 'c1', 'Item', 'each', 1, '2026-01-01');
      INSERT INTO invoices (id, business_id, customer_id, number, payment_account, status, created_at)
        VALUES ('inv1', 'b1', 'cu1', 'INV-1', 'CASH', 'FINALIZED', '2026-01-01');
      INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at) VALUES ('je1', 'inv1', 'Invoice', 0, '2026-01-01');
      INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je1', 'CASH', 100, 0), ('je1', 'SALES', 0, 100);
      INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at)
        VALUES ('zzz', 'it1', NULL, 'OPENING', 5, 10, '2026-01-01T00:00:00.000Z'), ('aaa', 'it1', NULL, 'OPENING', 3, 20, '2026-01-01T00:00:00.000Z');
      CREATE TRIGGER no_delete_entries BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT, 'immutable'); END;
    `);

    expect(runMigrations(db)).toEqual([4]);

    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT source_type FROM journal_entries WHERE id = 'je1'").get()).toEqual({ source_type: "INVOICE" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()).toEqual({ n: 2 });
    expect((db.prepare("SELECT id FROM stock_movements ORDER BY occurred_at, rowid").all() as Array<{ id: string }>).map((r) => r.id)).toEqual(["zzz", "aaa"]);
    expect(() => db.prepare("DELETE FROM journal_entries WHERE id = 'je1'").run()).toThrow("immutable");
    for (const index of ["idx_journal_entries_source", "idx_journal_entries_source_type", "idx_stock_movements_item", "idx_stock_movements_source"]) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)).toBeDefined();
    }
    for (const table of ["suppliers", "purchase_bills", "purchase_bill_lines", "expense_categories", "expenses", "supplier_payments"]) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeDefined();
    }
    // New accounts / source ids that are not invoices are now accepted.
    db.prepare("INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type) VALUES ('je2', 'bill-x', 'Bill', 0, '2026-01-02', 'PURCHASE_BILL')").run();
    db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je2', 'PAYABLES', 0, 5)").run();
    db.prepare("INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at) VALUES ('r1', 'it1', 'bill-x', 'PURCHASE_REVERSAL', -1, 10, '2026-01-03')").run();
    // Re-running the guarded body is a no-op.
    expect(runMigrations(db)).toEqual([]);
  });
});
