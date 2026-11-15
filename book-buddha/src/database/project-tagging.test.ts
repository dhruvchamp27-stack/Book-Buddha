import { describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";
import { applyProjectDimensionSchema } from "./project-dimension-schema.js";
import { buildApi } from "../api/server.js";

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  customerId: string;
  supplierId: string;
  stockItemId: string;
  fairA: string;
  fairB: string;
}

function setup(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  const stockItemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const fairA = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair A" });
  const fairB = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair B" });
  return { repository, companyId, businessId, customerId, supplierId, stockItemId, fairA, fairB };
}

function fairOf(repository: AccountingRepository, entryId: string): string | null {
  const row = repository.db.prepare("SELECT fair_id FROM journal_entries WHERE id = ?").get(entryId) as { fair_id: string | null } | undefined;
  if (row === undefined) throw new Error(`No journal entry ${entryId}`);
  return row.fair_id;
}

function entryFairs(repository: AccountingRepository): Record<string, string | null> {
  const rows = repository.db.prepare("SELECT id, fair_id FROM journal_entries ORDER BY id").all() as Array<{ id: string; fair_id: string | null }>;
  return Object.fromEntries(rows.map((r) => [r.id, r.fair_id]));
}

function buy(w: World, id: string, quantity: number, unitPricePaise: number, fairId?: string): void {
  const bill = w.repository.createPurchaseBill({
    id, businessId: w.businessId, supplierId: w.supplierId, number: id, billDate: "2026-11-01", paymentAccount: "CASH",
    ...(fairId === undefined ? {} : { fairId }),
    lines: [{ itemId: w.stockItemId, description: "Atlas", quantity, unitPricePaise }],
  });
  w.repository.finalizePurchaseBill(bill.id);
}

function sell(w: World, id: string, quantity: number, unitPricePaise: number, fairId?: string, account: "CASH" | "RECEIVABLES" = "CASH"): void {
  w.repository.saveDraft({
    id, number: id, businessId: w.businessId, customerId: w.customerId, paymentAccount: account, status: "DRAFT",
    ...(fairId === undefined ? {} : { fairId }),
    lines: [{ itemId: w.stockItemId, description: "Atlas", quantity, unitPricePaise }],
  });
  w.repository.finalizeInvoice(id);
}

function creditNote(w: World, id: string, invoiceId: string, quantity: number, unitPricePaise: number): void {
  w.repository.saveCreditNote({
    id, invoiceId, number: id, reason: "Returned", status: "DRAFT",
    lines: [{ itemId: w.stockItemId, description: "Atlas", quantity, unitPricePaise }],
  });
  w.repository.finalizeCreditNote(id);
}

describe("project (fair) tagging, slice 8b", () => {
  describe("journal entries carry the fair of their source document", () => {
    it("tags the invoice finalize, COGS, payment and credit note entries with the invoice fair", () => {
      const w = setup();
      buy(w, "B0", 10, 4000);
      sell(w, "I1", 4, 10000, w.fairA, "RECEIVABLES");
      const payment = w.repository.recordPayment("I1", 10000);
      creditNote(w, "CN1", "I1", 1, 10000);
      expect(fairOf(w.repository, "je-I1")).toBe(w.fairA);
      expect(fairOf(w.repository, "je-inventory-I1")).toBe(w.fairA);
      expect(fairOf(w.repository, `je-payment-${payment.id}`)).toBe(w.fairA);
      expect(fairOf(w.repository, "je-credit-note-CN1")).toBe(w.fairA);
      expect(fairOf(w.repository, "je-credit-note-inventory-CN1")).toBe(w.fairA);
      expect(fairOf(w.repository, "je-bill-B0")).toBeNull();
    });

    it("tags the invoice cancellation reversal and inventory reversal with the invoice fair", () => {
      const w = setup();
      buy(w, "B0", 10, 4000);
      sell(w, "I1", 4, 10000, w.fairB);
      w.repository.cancelInvoice("I1");
      expect(fairOf(w.repository, "je-I1-reversal")).toBe(w.fairB);
      expect(fairOf(w.repository, "je-inventory-I1-reversal")).toBe(w.fairB);
    });

    it("tags bill and expense finalize, supplier payments and cancellations with the document fair", () => {
      const w = setup();
      const bill = w.repository.createPurchaseBill({
        id: "PB1", businessId: w.businessId, supplierId: w.supplierId, fairId: w.fairA, number: "PB1", billDate: "2026-11-01",
        paymentAccount: "PAYABLES", lines: [{ description: "Stall hire", quantity: 1, unitPricePaise: 50000 }],
      });
      const expense = w.repository.createExpense({
        id: "EX1", businessId: w.businessId, supplierId: w.supplierId, fairId: w.fairB, number: "EX1", expenseDate: "2026-11-02",
        description: "Transport", amountPaise: 20000, paymentAccount: "PAYABLES",
      });
      expect(bill.fairId).toBe(w.fairA);
      expect(expense.fairId).toBe(w.fairB);
      w.repository.finalizePurchaseBill("PB1");
      w.repository.finalizeExpense("EX1");
      const billPay = w.repository.recordSupplierPayment({ billId: "PB1", amountPaise: 10000 });
      const expensePay = w.repository.recordSupplierPayment({ expenseId: "EX1", amountPaise: 5000 });
      expect(fairOf(w.repository, "je-bill-PB1")).toBe(w.fairA);
      expect(fairOf(w.repository, "je-expense-EX1")).toBe(w.fairB);
      expect(fairOf(w.repository, `je-supplier-payment-${billPay.id}`)).toBe(w.fairA);
      expect(fairOf(w.repository, `je-supplier-payment-${expensePay.id}`)).toBe(w.fairB);

      const bill2 = w.repository.createPurchaseBill({
        id: "PB2", businessId: w.businessId, supplierId: w.supplierId, fairId: w.fairB, number: "PB2", billDate: "2026-11-03",
        paymentAccount: "CASH", lines: [{ description: "Banners", quantity: 1, unitPricePaise: 1000 }],
      });
      const expense2 = w.repository.createExpense({
        id: "EX2", businessId: w.businessId, fairId: w.fairA, number: "EX2", expenseDate: "2026-11-03",
        description: "Tea", amountPaise: 300, paymentAccount: "CASH",
      });
      w.repository.finalizePurchaseBill(bill2.id);
      w.repository.finalizeExpense(expense2.id);
      w.repository.cancelPurchaseBill("PB2");
      w.repository.cancelExpense("EX2");
      expect(fairOf(w.repository, "je-bill-PB2-reversal")).toBe(w.fairB);
      expect(fairOf(w.repository, "je-expense-EX2-reversal")).toBe(w.fairA);
    });

    it("leaves fair_id NULL for everything when no fair is used, and never throws", () => {
      const w = setup();
      expect(() => {
        buy(w, "B1", 10, 4000);
        sell(w, "I1", 2, 10000, undefined, "RECEIVABLES");
        w.repository.recordPayment("I1", 5000);
        creditNote(w, "CN1", "I1", 1, 10000);
        sell(w, "I2", 1, 10000);
        w.repository.cancelInvoice("I2");
        w.repository.createExpense({
          id: "EX1", businessId: w.businessId, supplierId: w.supplierId, number: "EX1", expenseDate: "2026-11-02",
          description: "Transport", amountPaise: 20000, paymentAccount: "PAYABLES",
        });
        w.repository.finalizeExpense("EX1");
        w.repository.recordSupplierPayment({ expenseId: "EX1", amountPaise: 100 });
      }).not.toThrow();
      const fairs = entryFairs(w.repository);
      expect(Object.keys(fairs).length).toBeGreaterThan(8);
      expect(Object.values(fairs).every((f) => f === null)).toBe(true);
      expect(w.repository.listStockMovements().every((m) => m.fairId === undefined)).toBe(true);
      expect(w.repository.getPurchaseBill("B1").fairId).toBeUndefined();
    });

    it("does not cross-contaminate two fairs under one business", () => {
      const w = setup();
      buy(w, "B0", 20, 4000);
      sell(w, "IA", 3, 10000, w.fairA);
      sell(w, "IB", 2, 10000, w.fairB);
      w.repository.cancelInvoice("IB");
      const fairs = entryFairs(w.repository);
      expect(fairs["je-IA"]).toBe(w.fairA);
      expect(fairs["je-inventory-IA"]).toBe(w.fairA);
      expect(fairs["je-IB"]).toBe(w.fairB);
      expect(fairs["je-IB-reversal"]).toBe(w.fairB);
      const a = w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE fair_id = ?").get(w.fairA) as { n: number };
      const b = w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE fair_id = ?").get(w.fairB) as { n: number };
      expect(a.n).toBe(2);
      expect(b.n).toBe(4);
      const saleFairs = w.repository.listStockMovements().filter((m) => m.movementType === "SALE").map((m) => [m.sourceId, m.fairId]);
      expect(saleFairs).toEqual([["IA", w.fairA], ["IB", w.fairB]]);
    });

    it("validates the fair in the repository: empty or unknown is refused", () => {
      const w = setup();
      const insert = (fairId: string): void =>
        (w.repository as unknown as { insertJournalEntry(e: unknown, d: unknown): void }).insertJournalEntry(
          { id: "je-x", sourceId: "x", description: "x", isReversal: false, lines: [] },
          { businessId: w.businessId, entryDate: "2026-11-01", fairId },
        );
      expect(() => insert("")).toThrow(RepositoryValidationError);
      expect(() => insert("   ")).toThrow(RepositoryValidationError);
      expect(() => insert("no-such-fair")).toThrow(/not found/);
    });
  });

  describe("stock movements carry the fair as a reporting tag only", () => {
    it("tags PURCHASE, SALE and SALE_REVERSAL (cancel and credit note) with the source fair", () => {
      const w = setup();
      buy(w, "B1", 10, 4000, w.fairA);
      sell(w, "I1", 4, 10000, w.fairB);
      creditNote(w, "CN1", "I1", 1, 10000);
      w.repository.cancelInvoice("I1");
      const moves = w.repository.listStockMovements().map((m) => [m.movementType, m.sourceId, m.fairId]);
      expect(moves).toEqual([
        ["PURCHASE", "B1", w.fairA],
        ["SALE", "I1", w.fairB],
        ["SALE_REVERSAL", "CN1", w.fairB],
        ["SALE_REVERSAL", "I1", w.fairB],
      ]);
    });

    it("lets OPENING and ADJUSTMENT take an explicit fair or none, and validates it", () => {
      const w = setup();
      const opening = w.repository.addStockMovement({ itemId: w.stockItemId, movementType: "OPENING", quantity: 5, unitCostPaise: 100, fairId: w.fairA });
      const adjust = w.repository.addStockMovement({ itemId: w.stockItemId, movementType: "ADJUSTMENT", quantity: 1, unitCostPaise: 100 });
      expect(opening.fairId).toBe(w.fairA);
      expect(adjust.fairId).toBeUndefined();
      expect(() => w.repository.addStockMovement({ itemId: w.stockItemId, movementType: "OPENING", quantity: 1, unitCostPaise: 1, fairId: "ghost" }))
        .toThrow(RepositoryValidationError);
      expect(() => w.repository.addStockMovement({ itemId: w.stockItemId, movementType: "PURCHASE", quantity: 1, unitCostPaise: 1, fairId: w.fairA }))
        .toThrow(RepositoryValidationError);
    });

    it("keeps one shared pool: quantity on hand is a single figure whatever the fairs", () => {
      const w = setup();
      buy(w, "B1", 10, 4000, w.fairA);
      buy(w, "B2", 5, 5000, w.fairB);
      sell(w, "I1", 12, 10000, w.fairB);
      const balance = w.repository.getStockBalances().find((b) => b.itemId === w.stockItemId);
      expect(balance?.quantity).toBe(3);
      expect(balance?.valuePaise).toBe(3 * 5000);
    });

    it("FIFO output is IDENTICAL with fairs attached and with none (COGS, valuation, layer consumption)", () => {
      /** The same purchase/sale/return/cancel script, with or without fairs on every document. */
      const run = (withFairs: boolean) => {
        const w = setup();
        const f = (fair: string): string | undefined => (withFairs ? fair : undefined);
        buy(w, "B1", 10, 4000, f(w.fairA));
        buy(w, "B2", 10, 5000, f(w.fairB));
        buy(w, "B3", 5, 6000);
        w.repository.addStockMovement({ itemId: w.stockItemId, movementType: "ADJUSTMENT", quantity: 2, unitCostPaise: 3000, ...(withFairs ? { fairId: w.fairA } : {}) });
        sell(w, "I1", 13, 10000, f(w.fairB));      // crosses lots, mixed-fair layers
        sell(w, "I2", 4, 10000, f(w.fairA));       // consumes across a fair boundary
        creditNote(w, "CN1", "I1", 3, 10000);
        sell(w, "I3", 6, 10000);                   // fairless sale draws on fair-tagged layers
        w.repository.cancelInvoice("I3");
        sell(w, "I4", 9, 10000, f(w.fairA));
        const trial = w.repository.getTrialBalance();
        const cogs = trial.find((r) => r.account === "COGS");
        const inventory = trial.find((r) => r.account === "INVENTORY");
        return {
          trial,
          cogs: cogs === undefined ? 0 : cogs.debitPaise - cogs.creditPaise,
          inventory: inventory === undefined ? 0 : inventory.debitPaise - inventory.creditPaise,
          balances: w.repository.getStockBalances().map(({ itemId: _ignored, ...rest }) => rest),
          // Layer consumption: the exact (item, source, type, qty, cost) sequence, in order.
          movements: w.repository.listStockMovements().map((m) => [m.itemId === w.stockItemId, m.sourceId, m.movementType, m.quantityDelta, m.unitCostPaise]),
          entryLines: w.repository.db.prepare(
            "SELECT je.id AS id, jl.account AS account, jl.debit_paise AS d, jl.credit_paise AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.id LIKE 'je-inventory-%' OR je.id LIKE 'je-credit-note-inventory-%' ORDER BY je.id, jl.rowid",
          ).all(),
          fairTagged: w.repository.listStockMovements().filter((m) => m.fairId !== undefined).length,
        };
      };
      const plain = run(false);
      const tagged = run(true);
      expect(plain.fairTagged).toBe(0);
      expect(tagged.fairTagged).toBeGreaterThan(5); // the fairs really were attached
      expect(tagged.cogs).toBe(plain.cogs);
      expect(tagged.cogs).toBeGreaterThan(0);
      expect(tagged.inventory).toBe(plain.inventory);
      expect(tagged.balances).toEqual(plain.balances);
      expect(tagged.movements).toEqual(plain.movements);
      expect(tagged.entryLines).toEqual(plain.entryLines);
      expect(tagged.trial).toEqual(plain.trial);
    });
  });

  describe("bills and expenses validate the fair", () => {
    function foreign(w: World): string {
      const otherCompany = w.repository.createCompany({ name: "Other Co" });
      const host = w.repository.createCustomer({ companyId: otherCompany, name: "Other School" });
      return w.repository.createFair({ companyId: otherCompany, hostCustomerId: host, name: "Foreign Fair" });
    }

    it("rejects a fair from a different company on a bill", () => {
      const w = setup();
      expect(() => w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, fairId: foreign(w), number: "PB", billDate: "2026-11-01",
        paymentAccount: "CASH", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }],
      })).toThrow(/same company/);
      expect(w.repository.listPurchaseBills()).toEqual([]);
    });

    it("rejects a fair from a different company on an expense", () => {
      const w = setup();
      expect(() => w.repository.createExpense({
        businessId: w.businessId, fairId: foreign(w), number: "EX", expenseDate: "2026-11-01",
        description: "x", amountPaise: 100, paymentAccount: "CASH",
      })).toThrow(/same company/);
      expect(w.repository.listExpenses()).toEqual([]);
    });

    it("rejects an unknown or empty fair on a bill and an expense", () => {
      const w = setup();
      for (const fairId of ["ghost", ""]) {
        expect(() => w.repository.createPurchaseBill({
          businessId: w.businessId, supplierId: w.supplierId, fairId, number: "PB", billDate: "2026-11-01",
          paymentAccount: "CASH", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }],
        })).toThrow(RepositoryValidationError);
        expect(() => w.repository.createExpense({
          businessId: w.businessId, fairId, number: "EX", expenseDate: "2026-11-01",
          description: "x", amountPaise: 100, paymentAccount: "CASH",
        })).toThrow(RepositoryValidationError);
      }
    });
  });

  describe("immutability", () => {
    it("refuses to change the fair of a finalized invoice through the only update path", () => {
      const w = setup();
      buy(w, "B0", 10, 4000);
      sell(w, "I1", 1, 10000, w.fairA);
      const finalized = w.repository.getInvoice("I1");
      expect(() => w.repository.updateDraft({ ...finalized, fairId: w.fairB })).toThrow(/Only draft/);
      expect(w.repository.getInvoice("I1").fairId).toBe(w.fairA);
    });

    it("offers no way to edit the fair of a bill or an expense after creation", () => {
      const repo = new AccountingRepository() as unknown as Record<string, unknown>;
      const editors = Object.getOwnPropertyNames(AccountingRepository.prototype).filter((n) => /^(update|set|edit|patch)(PurchaseBill|Expense|Bill)\b/i.test(n));
      expect(editors).toEqual([]);
      expect(typeof repo["updatePurchaseBill"]).toBe("undefined");
      expect(typeof repo["updateExpense"]).toBe("undefined");
    });
  });

  describe("forward writes agree with migration v6's backfill", () => {
    it("re-deriving every invoice entry's fair with the v6 backfill reproduces what the forward path wrote", () => {
      const w = setup();
      buy(w, "B0", 30, 4000);
      sell(w, "I1", 4, 10000, w.fairA, "RECEIVABLES");
      w.repository.recordPayment("I1", 10000);
      creditNote(w, "CN1", "I1", 1, 10000);
      sell(w, "I2", 2, 10000, w.fairB);
      w.repository.cancelInvoice("I2");
      sell(w, "I3", 2, 10000);                       // no fair
      const forward = entryFairs(w.repository);
      // Wipe the dimension on the invoice-sourced entries, then let the v6 mapping fill it back.
      w.repository.db.exec("UPDATE journal_entries SET fair_id = NULL WHERE source_type = 'INVOICE'");
      applyProjectDimensionSchema(w.repository.db);
      expect(entryFairs(w.repository)).toEqual(forward);
      expect(forward["je-I1"]).toBe(w.fairA);
      expect(forward["je-I3"]).toBeNull();
    });
  });

  describe("API", () => {
    it("accepts fairId on /purchase-bills and /expenses and rejects an empty one", async () => {
      const w = setup();
      const app = buildApi(w.repository);
      try {
        const bill = await app.inject({
          method: "POST", url: "/purchase-bills",
          payload: { businessId: w.businessId, supplierId: w.supplierId, fairId: w.fairA, number: "PB-API", paymentAccount: "CASH", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }] },
        });
        expect(bill.statusCode).toBe(201);
        expect(bill.json().fairId).toBe(w.fairA);
        const expense = await app.inject({
          method: "POST", url: "/expenses",
          payload: { businessId: w.businessId, fairId: w.fairB, number: "EX-API", description: "x", amountPaise: 100, paymentAccount: "CASH" },
        });
        expect(expense.statusCode).toBe(201);
        expect(expense.json().fairId).toBe(w.fairB);
        const plain = await app.inject({
          method: "POST", url: "/expenses",
          payload: { businessId: w.businessId, number: "EX-API-2", description: "x", amountPaise: 100, paymentAccount: "CASH" },
        });
        expect(plain.statusCode).toBe(201);
        expect(plain.json().fairId).toBeUndefined();
        const empty = await app.inject({
          method: "POST", url: "/expenses",
          payload: { businessId: w.businessId, fairId: "", number: "EX-API-3", description: "x", amountPaise: 100, paymentAccount: "CASH" },
        });
        expect(empty.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });
});
