import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { purchaseEntry } from "../accounting/engine.js";
import { ROUND_OFF_ACCOUNT } from "./chart-accounts-schema.js";
import { AccountingRepository } from "./repository.js";
import { todayAt } from "./test-clock.js";

/**
 * I-3 (ruling I-Q6, S18-6): a round-off the owner TYPES on a bill or expense so it matches the total the
 * supplier printed. Nothing is calculated. Sign convention: round_off = the total the owner wants less
 * the total the lines compute to. A bill's settlement is a CREDIT, so a positive round-off is a DEBIT to
 * ROUND_OFF (paying more than computed is a cost); negative mirrors it.
 *
 * The hand figures: 100 x Rs 25.00 at 18% = 2,500.00 + 450.00 GST = 2,950.00 computed.
 */

interface World {
  repository: AccountingRepository;
  businessId: string;
  supplierId: string;
  stockItemId: string;
}

function setup(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2026-01-01"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  const stockItemId = repository.createItem({ companyId, name: "Notebook", unit: "each", trackStock: true });
  return { repository, businessId, supplierId, stockItemId };
}

interface Line { account: string; debit: number; credit: number }

/** The lines of the entry a document posted, in posting order, as account / debit / credit. */
function linesOf(repository: AccountingRepository, entryId: string): Line[] {
  return (repository.db
    .prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
    .all(entryId) as Array<{ account: string; debit_paise: number; credit_paise: number }>)
    .map((row) => ({ account: row.account, debit: row.debit_paise, credit: row.credit_paise }));
}

const dr = (account: string, debit: number): Line => ({ account, debit, credit: 0 });
const cr = (account: string, credit: number): Line => ({ account, debit: 0, credit });

function bill(w: World, number: string, roundOffPaise?: number) {
  return w.repository.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number, billDate: "2026-05-10",
    paymentAccount: "PAYABLES", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
    ...(roundOffPaise === undefined ? {} : { roundOffPaise }),
    lines: [{ itemId: w.stockItemId, description: "Notebook", quantity: 100, unitPricePaise: 2500 }],
  });
}

function netByAccount(repository: AccountingRepository): Map<string, number> {
  const rows = repository.db
    .prepare("SELECT account, SUM(debit_paise) - SUM(credit_paise) AS net FROM journal_lines GROUP BY account")
    .all() as Array<{ account: string; net: number }>;
  return new Map(rows.map((row) => [row.account, row.net]));
}

describe("I-3: a typed round-off on a bill", () => {
  it("+37 paise: the settlement credit grows by 37 and Dr ROUND_OFF carries it", () => {
    const w = setup();
    try {
      const created = bill(w, "BILL-1", 37);
      expect(created.roundOffPaise).toBe(37);
      w.repository.finalizePurchaseBill(created.id);
      expect(linesOf(w.repository, `je-bill-${created.id}`)).toEqual([
        dr("INVENTORY", 250000),
        dr("INPUT_CGST", 22500),
        dr("INPUT_SGST", 22500),
        dr(ROUND_OFF_ACCOUNT, 37),
        cr("PAYABLES", 295037),
      ]);
      // Read back as its OWN field: the computed figures are untouched.
      const read = w.repository.getPurchaseBill(created.id);
      expect(read).toMatchObject({ subtotalPaise: 250000, taxPaise: 45000, totalPaise: 295000, roundOffPaise: 37 });
    } finally {
      w.repository.close();
    }
  });

  it("-37 paise: the settlement credit shrinks by 37 and Cr ROUND_OFF carries it", () => {
    const w = setup();
    try {
      const created = bill(w, "BILL-1", -37);
      w.repository.finalizePurchaseBill(created.id);
      expect(linesOf(w.repository, `je-bill-${created.id}`)).toEqual([
        dr("INVENTORY", 250000),
        dr("INPUT_CGST", 22500),
        dr("INPUT_SGST", 22500),
        cr(ROUND_OFF_ACCOUNT, 37),
        cr("PAYABLES", 294963),
      ]);
      expect(w.repository.getPurchaseBill(created.id)).toMatchObject({ totalPaise: 295000, roundOffPaise: -37 });
    } finally {
      w.repository.close();
    }
  });

  it("0 or none: posts NO ROUND_OFF line at all", () => {
    const w = setup();
    try {
      const typedZero = bill(w, "BILL-1", 0);
      const omitted = bill(w, "BILL-2");
      expect(omitted.roundOffPaise).toBe(0);
      for (const created of [typedZero, omitted]) {
        w.repository.finalizePurchaseBill(created.id);
        const lines = linesOf(w.repository, `je-bill-${created.id}`);
        expect(lines.some((line) => line.account === ROUND_OFF_ACCOUNT)).toBe(false);
        expect(lines).toEqual([
          dr("INVENTORY", 250000), dr("INPUT_CGST", 22500), dr("INPUT_SGST", 22500), cr("PAYABLES", 295000),
        ]);
      }
    } finally {
      w.repository.close();
    }
  });

  it("a cancelled bill reverses its round-off with the rest: every account nets to zero", () => {
    const w = setup();
    try {
      const created = bill(w, "BILL-1", 37);
      w.repository.finalizePurchaseBill(created.id);
      w.repository.cancelPurchaseBill(created.id);
      for (const [account, net] of netByAccount(w.repository)) expect([account, net]).toEqual([account, 0]);
      expect(netByAccount(w.repository).has(ROUND_OFF_ACCOUNT)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("a bill finalized before v35 (round-off 0 by the column default) is unchanged", () => {
    const w = setup();
    try {
      const created = bill(w, "BILL-OLD");
      // Exactly what a pre-v35 row looks like: nothing was ever written to the column.
      expect(w.repository.db.prepare("SELECT round_off_paise AS r FROM purchase_bills WHERE id = ?").get(created.id)).toEqual({ r: 0 });
      w.repository.finalizePurchaseBill(created.id);
      expect(linesOf(w.repository, `je-bill-${created.id}`).map((l) => l.account)).not.toContain(ROUND_OFF_ACCOUNT);
      expect(w.repository.getPurchaseBill(created.id).roundOffPaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("refuses +/-100 and a fraction in the repository, and the database CHECK refuses it too", () => {
    const w = setup();
    try {
      for (const bad of [100, -100, 250, 12.5]) {
        expect(() => bill(w, "BILL-X", bad)).toThrow("A round-off must be a whole number of paise, under Rs 1 either way.");
      }
      // 99 is the widest allowed.
      expect(bill(w, "BILL-99", 99).roundOffPaise).toBe(99);
      expect(bill(w, "BILL-M99", -99).roundOffPaise).toBe(-99);
      // The CHECK holds on its own, beneath the friendly message.
      const created = bill(w, "BILL-DB");
      expect(() => w.repository.db.prepare("UPDATE purchase_bills SET round_off_paise = 100 WHERE id = ?").run(created.id))
        .toThrow(/CHECK constraint failed/);
      expect(() => w.repository.db.prepare("UPDATE purchase_bills SET round_off_paise = -100 WHERE id = ?").run(created.id))
        .toThrow(/CHECK constraint failed/);
    } finally {
      w.repository.close();
    }
  });
});

describe("I-3: a typed round-off on an expense", () => {
  it("+15 paise on Rs 2,000.00, posted then cancelled: every account nets to zero, round-off included", () => {
    const w = setup();
    try {
      const expense = w.repository.createExpense({
        businessId: w.businessId, number: "EXP-1", expenseDate: "2026-05-10", description: "Stall rent",
        amountPaise: 200000, paymentAccount: "CASH", roundOffPaise: 15,
      });
      expect(expense).toMatchObject({ totalPaise: 200000, roundOffPaise: 15 });
      w.repository.finalizeExpense(expense.id);
      expect(linesOf(w.repository, `je-expense-${expense.id}`)).toEqual([
        dr("EXPENSE", 200000), dr(ROUND_OFF_ACCOUNT, 15), cr("CASH", 200015),
      ]);
      w.repository.cancelExpense(expense.id);
      for (const [account, net] of netByAccount(w.repository)) expect([account, net]).toEqual([account, 0]);
    } finally {
      w.repository.close();
    }
  });

  it("-15 paise mirrors it, and an expense with no round-off posts none", () => {
    const w = setup();
    try {
      const minus = w.repository.createExpense({
        businessId: w.businessId, number: "EXP-1", expenseDate: "2026-05-10", description: "Stall rent",
        amountPaise: 200000, paymentAccount: "CASH", roundOffPaise: -15,
      });
      w.repository.finalizeExpense(minus.id);
      expect(linesOf(w.repository, `je-expense-${minus.id}`)).toEqual([
        dr("EXPENSE", 200000), cr(ROUND_OFF_ACCOUNT, 15), cr("CASH", 199985),
      ]);
      const none = w.repository.createExpense({
        businessId: w.businessId, number: "EXP-2", expenseDate: "2026-05-10", description: "Stall rent",
        amountPaise: 200000, paymentAccount: "CASH",
      });
      w.repository.finalizeExpense(none.id);
      expect(linesOf(w.repository, `je-expense-${none.id}`)).toEqual([dr("EXPENSE", 200000), cr("CASH", 200000)]);
    } finally {
      w.repository.close();
    }
  });

  it("refuses +/-100 and the database CHECK refuses it too", () => {
    const w = setup();
    try {
      for (const bad of [100, -100]) {
        expect(() => w.repository.createExpense({
          businessId: w.businessId, number: "EXP-X", expenseDate: "2026-05-10", description: "x",
          amountPaise: 1000, paymentAccount: "CASH", roundOffPaise: bad,
        })).toThrow("A round-off must be a whole number of paise, under Rs 1 either way.");
      }
      const ok = w.repository.createExpense({
        businessId: w.businessId, number: "EXP-OK", expenseDate: "2026-05-10", description: "x",
        amountPaise: 1000, paymentAccount: "CASH",
      });
      expect(() => w.repository.db.prepare("UPDATE expenses SET round_off_paise = 100 WHERE id = ?").run(ok.id))
        .toThrow(/CHECK constraint failed/);
    } finally {
      w.repository.close();
    }
  });
});

describe("I-3: the engine", () => {
  it("purchaseEntry takes the round-off as given and refuses one of a rupee or more", () => {
    const base = {
      entryId: "e", sourceId: "s", sourceType: "PURCHASE_BILL" as const, description: "d",
      inventoryPaise: 0, expensePaise: 1000, taxType: "NONE" as const, taxRateBasisPoints: 0,
      paymentAccount: "CASH" as const,
    };
    const result = purchaseEntry({ ...base, roundOffPaise: 20 });
    expect(result.totalPaise).toBe(1000); // the computed total, never folded
    expect(result.entry.lines.map((l) => [l.account, l.debitPaise, l.creditPaise]))
      .toEqual([["EXPENSE", 1000, 0], [ROUND_OFF_ACCOUNT, 20, 0], ["CASH", 0, 1020]]);
    expect(() => purchaseEntry({ ...base, roundOffPaise: 100 })).toThrow(/under Rs 1/);
  });
});

describe("I-3: over HTTP", () => {
  it("takes roundOffPaise on a bill and an expense, reads it back, and refuses +/-100 with a 400", async () => {
    const repository = new AccountingRepository(":memory:", todayAt("2026-01-01"));
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
      const businessId = repository.createBusiness({ companyId, name: "Books" });
      const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
      const itemId = repository.createItem({ companyId, name: "Notebook", unit: "each", trackStock: true });
      const billBody = {
        businessId, supplierId, number: "BILL-1", billDate: "2026-05-10", paymentAccount: "PAYABLES",
        taxType: "CGST_SGST", taxRateBasisPoints: 1800,
        lines: [{ itemId, description: "Notebook", quantity: 100, unitPricePaise: 2500 }],
      };

      const created = await app.inject({ method: "POST", url: "/purchase-bills", payload: { ...billBody, roundOffPaise: 37 } });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ roundOffPaise: 37, totalPaise: 295000 });
      const fetched = await app.inject({ method: "GET", url: `/purchase-bills/${created.json<{ id: string }>().id}` });
      expect(fetched.json()).toMatchObject({ roundOffPaise: 37, totalPaise: 295000 });

      const omitted = await app.inject({ method: "POST", url: "/purchase-bills", payload: { ...billBody, number: "BILL-2" } });
      expect(omitted.json()).toMatchObject({ roundOffPaise: 0 });

      const expense = await app.inject({
        method: "POST", url: "/expenses",
        payload: { businessId, number: "EXP-1", description: "Rent", amountPaise: 200000, paymentAccount: "CASH", roundOffPaise: -15 },
      });
      expect(expense.statusCode).toBe(201);
      expect(expense.json()).toMatchObject({ roundOffPaise: -15, totalPaise: 200000 });

      const message = "A round-off must be a whole number of paise, under Rs 1 either way (from -99 to 99).";
      for (const bad of [100, -100, 12.5]) {
        const refused = await app.inject({ method: "POST", url: "/purchase-bills", payload: { ...billBody, number: "BILL-X", roundOffPaise: bad } });
        expect(refused.statusCode).toBe(400);
        expect(JSON.stringify(refused.json())).toContain(message);
        const refusedExpense = await app.inject({
          method: "POST", url: "/expenses",
          payload: { businessId, number: "EXP-X", description: "Rent", amountPaise: 1000, paymentAccount: "CASH", roundOffPaise: bad },
        });
        expect(refusedExpense.statusCode).toBe(400);
        expect(JSON.stringify(refusedExpense.json())).toContain(message);
      }
    } finally {
      await app.close();
      repository.close();
    }
  });
});

/**
 * The payables side MUST tie to the ledger. The first cut of I-3 posted the round-off to the ledger but
 * left `outstanding` on the computed total, so a +37 bill showed PAYABLES 295,037 in the ledger and
 * 295,000 owed in the payables listing, the full ledger amount could not be paid, and a -37 bill kept
 * 37 paise outstanding for ever. These are the tests that catch that.
 */
describe("I-Q6: the payables subledger ties to its control account", () => {
  /**
   * What the ledger says the supplier is owed: the PAYABLES credit balance. Queried as credit less
   * debit rather than negating the other way round, because negating a zero gives -0 and `toBe(0)`
   * compares with Object.is, which tells -0 and +0 apart.
   */
  const ledgerOwed = (w: World): number =>
    (w.repository.db.prepare(
      "SELECT COALESCE(SUM(credit_paise), 0) - COALESCE(SUM(debit_paise), 0) AS n FROM journal_lines WHERE account = 'PAYABLES'",
    ).get() as { n: number }).n;

  it("a +37 bill is owed 2,950.37 in the ledger, in payables, in open items and on the statement", () => {
    const w = setup();
    try {
      const b = bill(w, "PB-TIE-37", 37);
      w.repository.finalizePurchaseBill(b.id);

      expect(ledgerOwed(w)).toBe(295037);
      const payables = w.repository.getPayables({ businessId: w.businessId });
      expect(payables).toHaveLength(1);
      expect(payables[0]).toMatchObject({ totalPaise: 295037, outstandingPaise: 295037, paidPaise: 0 });
      expect(w.repository.getOpenSupplierItems({ businessId: w.businessId })[0])
        .toMatchObject({ totalPaise: 295037, outstandingPaise: 295037 });
      expect(w.repository.getSupplierStatement(w.supplierId).closingBalancePaise).toBe(295037);
      // The bill RECORD still keeps them apart, exactly as the owner asked.
      expect(w.repository.getPurchaseBill(b.id)).toMatchObject({ totalPaise: 295000, roundOffPaise: 37 });
    } finally {
      w.repository.close();
    }
  });

  it("the full owed 2,950.37 can be paid and clears to zero; a paisa more is refused", () => {
    const w = setup();
    try {
      const b = bill(w, "PB-PAY-37", 37);
      w.repository.finalizePurchaseBill(b.id);

      expect(() => w.repository.recordSupplierPayment({
        billId: b.id, amountPaise: 295038, paidOn: "2026-05-12", moneyAccount: "CASH",
      })).toThrow(/Payment cannot exceed the outstanding balance/);

      w.repository.recordSupplierPayment({ billId: b.id, amountPaise: 295037, paidOn: "2026-05-12", moneyAccount: "CASH" });
      expect(ledgerOwed(w)).toBe(0);
      expect(w.repository.getPayables({ businessId: w.businessId })).toHaveLength(0);
      expect(w.repository.getSupplierStatement(w.supplierId).closingBalancePaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("a -37 bill is owed 2,949.63 and leaves NOTHING outstanding once that is paid", () => {
    const w = setup();
    try {
      const b = bill(w, "PB-TIE-MINUS", -37);
      w.repository.finalizePurchaseBill(b.id);

      expect(ledgerOwed(w)).toBe(294963);
      expect(w.repository.getPayables({ businessId: w.businessId })[0]).toMatchObject({ outstandingPaise: 294963 });

      w.repository.recordSupplierPayment({ billId: b.id, amountPaise: 294963, paidOn: "2026-05-12", moneyAccount: "CASH" });
      expect(ledgerOwed(w)).toBe(0);
      // The defect this pins: before the fix this left 37 paise owed for ever.
      expect(w.repository.getPayables({ businessId: w.businessId })).toHaveLength(0);
    } finally {
      w.repository.close();
    }
  });

  it("a round-off and a purchase return on the same bill: outstanding is owed less what went back", () => {
    const w = setup();
    try {
      const b = bill(w, "PB-RET-37", 37);
      w.repository.finalizePurchaseBill(b.id);
      const billLineId = (w.repository.db
        .prepare("SELECT id FROM purchase_bill_lines WHERE bill_id = ?")
        .get(b.id) as { id: number }).id;

      // 10 of the 100 notebooks go back: 10 x 25.00 = 250.00 plus its 18% GST = 295.00.
      const ret = w.repository.createPurchaseReturn({
        billId: b.id, reason: "10 damaged", returnDate: "2026-05-15",
        lines: [{ itemId: w.stockItemId, description: "Notebook", quantity: 10, unitPricePaise: 2500, reversesBillLineId: billLineId }],
      });
      w.repository.finalizePurchaseReturn(ret.id);

      // The ledger and the listing must agree, whatever the return took off.
      const owed = ledgerOwed(w);
      const payables = w.repository.getPayables({ businessId: w.businessId });
      expect(payables).toHaveLength(1);
      expect(payables[0]?.outstandingPaise).toBe(owed);
      expect(w.repository.getSupplierStatement(w.supplierId).closingBalancePaise).toBe(owed);
      // And the round-off is still in there: owed is 29,500 less than the un-returned 295,037.
      expect(owed).toBe(295037 - 29500);
    } finally {
      w.repository.close();
    }
  });
});
