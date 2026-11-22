import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";
import { todayAt } from "./test-clock.js";

/** S17-10: a bill discount applies to stock items only; too big, or no stock at all, is refused. */

const OVER =
  "The bill discount (Rs 800.00) is more than the value of the stock items on this bill (Rs 700.00). " +
  "A bill discount applies to stock items only — lower the discount or check the lines.";
const NO_STOCK =
  "This bill has no stock items, so it cannot carry a bill discount. A bill discount applies to stock items only.";

function setup() {
  const repository = new AccountingRepository(":memory:", todayAt("2026-05-10"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  const stockItemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: true });
  const serviceItemId = repository.createItem({ companyId, name: "Design", unit: "job", trackStock: false });
  return { repository, businessId, supplierId, stockItemId, serviceItemId };
}
type World = ReturnType<typeof setup>;

// Hand figure: 2 x Rs 250 + 1 x Rs 200 = Rs 700.00 of stock.
const stockLines = (w: World) => [
  { itemId: w.stockItemId, description: "Novel", quantity: 2, unitPricePaise: 25000 },
  { itemId: w.stockItemId, description: "Atlas", quantity: 1, unitPricePaise: 20000 },
];
const bill = (w: World, discountPaise: number, lines: ReturnType<typeof stockLines>, number = "B1") => ({
  businessId: w.businessId, supplierId: w.supplierId, number, billDate: "2026-05-10",
  paymentAccount: "PAYABLES" as const, discountPaise, lines,
});

const NOTHING_PAYABLE =
  "The bill discount equals the whole bill, so nothing is payable. Record free stock as a stock adjustment instead.";

describe("S18-1: a discount that leaves nothing payable is refused", () => {
  const count = (w: World) =>
    (w.repository.db.prepare("SELECT COUNT(*) AS c FROM purchase_bills").get() as { c: number }).c;

  it("refuses at save an all-stock bill whose discount equals the stock value; nothing saved", () => {
    const w = setup();
    try {
      expect(() => w.repository.createPurchaseBill(bill(w, 70000, stockLines(w)))).toThrow(NOTHING_PAYABLE);
      expect(count(w)).toBe(0);
    } finally { w.repository.close(); }
  });

  it("refuses at finalize (backstop) a draft that reached the nil-payable state directly", () => {
    // The app has no draft-bill edit path, so the state is forced as the other refusals here do.
    const w = setup();
    try {
      const saved = w.repository.createPurchaseBill(bill(w, 10000, stockLines(w)));
      w.repository.db.prepare("UPDATE purchase_bills SET discount_paise = 70000 WHERE id = ?").run(saved.id);
      expect(() => w.repository.finalizePurchaseBill(saved.id)).toThrow(NOTHING_PAYABLE);
      expect(w.repository.getPurchaseBill(saved.id).status).toBe("DRAFT");
    } finally { w.repository.close(); }
  });

  it("returns 400 with the message over HTTP", async () => {
    const w = setup();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const response = await app.inject({
        method: "POST", url: "/purchase-bills",
        payload: { businessId: w.businessId, supplierId: w.supplierId, number: "B1", billDate: "2026-05-10", paymentAccount: "PAYABLES", discountPaise: 70000, lines: stockLines(w) },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain(NOTHING_PAYABLE);
    } finally {
      await app.close();
      w.repository.close();
    }
  });

  it("still saves and posts when freight keeps the payable above zero (journal balanced)", () => {
    const w = setup();
    try {
      const lines = [...stockLines(w), { itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 5000 }];
      const saved = w.repository.createPurchaseBill(bill(w, 70000, lines));
      const entry = w.repository.finalizePurchaseBill(saved.id);
      const debit = entry.lines.reduce((s, l) => s + l.debitPaise, 0);
      const credit = entry.lines.reduce((s, l) => s + l.creditPaise, 0);
      expect(debit).toBe(credit);
      expect(w.repository.getPurchaseBill(saved.id).totalPaise).toBe(5000);
    } finally { w.repository.close(); }
  });

  it("still saves and posts a discount one paisa below the stock value", () => {
    const w = setup();
    try {
      const saved = w.repository.createPurchaseBill(bill(w, 69999, stockLines(w)));
      const entry = w.repository.finalizePurchaseBill(saved.id);
      expect(entry.lines.reduce((s, l) => s + l.debitPaise, 0)).toBe(entry.lines.reduce((s, l) => s + l.creditPaise, 0));
      expect(w.repository.getPurchaseBill(saved.id).totalPaise).toBe(1);
    } finally { w.repository.close(); }
  });
});

describe("S17-10: bill discount versus stock value", () => {
  it("refuses a save with Rs 800.00 discount on Rs 700.00 of stock, with the exact message", () => {
    const w = setup();
    try {
      expect(() => w.repository.createPurchaseBill(bill(w, 80000, stockLines(w)))).toThrow(OVER);
    } finally { w.repository.close(); }
  });

  it("states the hand figure: 2 x 250 + 1 x 200 is Rs 700.00", () => {
    const w = setup();
    try {
      expect(() => w.repository.createPurchaseBill(bill(w, 70001, stockLines(w)))).toThrow(/stock items on this bill \(Rs 700\.00\)/);
    } finally { w.repository.close(); }
  });

  it("counts only the stock lines: a non-stock line does not raise the allowed discount", () => {
    const w = setup();
    try {
      const lines = [...stockLines(w), { itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 90000 }];
      expect(() => w.repository.createPurchaseBill(bill(w, 80000, lines))).toThrow(OVER);
    } finally { w.repository.close(); }
  });

  it("allows a discount equal to the stock value (stock at nil cost) when the bill has other lines", () => {
    const w = setup();
    try {
      const lines = [...stockLines(w), { itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 90000 }];
      const saved = w.repository.createPurchaseBill(bill(w, 70000, lines));
      w.repository.finalizePurchaseBill(saved.id);
      const cost = w.repository.db
        .prepare("SELECT COALESCE(SUM(quantity_delta * unit_cost_paise), 0) AS c FROM stock_movements WHERE item_id = ?")
        .get(w.stockItemId) as { c: number };
      expect(cost.c).toBe(0);
    } finally { w.repository.close(); }
  });

  it("allows a smaller discount", () => {
    const w = setup();
    try {
      const saved = w.repository.createPurchaseBill(bill(w, 10000, stockLines(w)));
      expect(() => w.repository.finalizePurchaseBill(saved.id)).not.toThrow();
    } finally { w.repository.close(); }
  });

  it("refuses at finalize when a draft already holds an excess discount (written directly)", () => {
    const w = setup();
    try {
      const saved = w.repository.createPurchaseBill(bill(w, 10000, stockLines(w)));
      w.repository.db.prepare("UPDATE purchase_bills SET discount_paise = 80000 WHERE id = ?").run(saved.id);
      expect(() => w.repository.finalizePurchaseBill(saved.id)).toThrow(OVER);
      // Nothing was posted or finalized.
      expect(w.repository.getPurchaseBill(saved.id).status).toBe("DRAFT");
    } finally { w.repository.close(); }
  });

  it("refuses at finalize when the stock lines were cut below the discount (written directly)", () => {
    const w = setup();
    try {
      const saved = w.repository.createPurchaseBill(bill(w, 60000, stockLines(w)));
      w.repository.db.prepare("UPDATE purchase_bill_lines SET unit_price_paise = 1000 WHERE bill_id = ?").run(saved.id);
      expect(() => w.repository.finalizePurchaseBill(saved.id)).toThrow(/The bill discount \(Rs 600\.00\) is more than the value of the stock items on this bill \(Rs 30\.00\)/);
    } finally { w.repository.close(); }
  });
});

describe("S17-10: a bill with no stock lines", () => {
  it("refuses Rs 50.00 discount at save", () => {
    const w = setup();
    try {
      const lines = [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }];
      expect(() => w.repository.createPurchaseBill(bill(w, 5000, lines))).toThrow(NO_STOCK);
      // A line with no item at all is not stock either.
      const free = [{ description: "Freight", quantity: 1, unitPricePaise: 100000 }] as unknown as ReturnType<typeof stockLines>;
      expect(() => w.repository.createPurchaseBill(bill(w, 5000, free, "B2"))).toThrow(NO_STOCK);
    } finally { w.repository.close(); }
  });

  it("refuses Rs 50.00 discount at finalize when it reached the draft directly", () => {
    const w = setup();
    try {
      const lines = [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }];
      const saved = w.repository.createPurchaseBill(bill(w, 0, lines));
      w.repository.db.prepare("UPDATE purchase_bills SET discount_paise = 5000 WHERE id = ?").run(saved.id);
      expect(() => w.repository.finalizePurchaseBill(saved.id)).toThrow(NO_STOCK);
    } finally { w.repository.close(); }
  });

  it("allows a zero discount", () => {
    const w = setup();
    try {
      const lines = [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }];
      const saved = w.repository.createPurchaseBill(bill(w, 0, lines));
      expect(() => w.repository.finalizePurchaseBill(saved.id)).not.toThrow();
    } finally { w.repository.close(); }
  });
});

describe("S17-10: over HTTP", () => {
  const post = async (discountPaise: number, withStock: boolean) => {
    const w = setup();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const lines = withStock
        ? stockLines(w)
        : [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }];
      return await app.inject({
        method: "POST", url: "/purchase-bills",
        payload: { businessId: w.businessId, supplierId: w.supplierId, number: "B1", billDate: "2026-05-10", paymentAccount: "PAYABLES", discountPaise, lines },
      });
    } finally {
      await app.close();
      w.repository.close();
    }
  };

  it("returns 400 with the over-stock message", async () => {
    const response = await post(80000, true);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(OVER);
  });

  it("returns 400 with the no-stock message", async () => {
    const response = await post(5000, false);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(NO_STOCK);
  });
});
