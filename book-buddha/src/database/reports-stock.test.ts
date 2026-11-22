import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";
import { AGEING_BANDS } from "./ageing-bands.js";
import {
  inventoryValuationDetail, stockAgeing,
  type InventoryValuationDetailReport, type StockAgeingReport,
} from "./reports-stock.js";
import { datedStockLayers } from "./stock-layers.js";

/**
 * Session 12, reports 4 and 5: stock ageing and inventory valuation detail. Money is paise.
 *
 * "Today" is frozen at 2026-07-01 (IST) so every layer can be placed a known number of days back.
 * Only `Date` is faked, never timers. Every database here is a throwaway in-memory one.
 *
 * THE WORLD (as at 2026-07-01)
 *   Atlas   OPENING     10 @ Rs 50   dated 2026-04-02 (90 days)   -> sold down by 4, 6 left
 *           BILL-A      20 @ Rs 60   dated 2026-06-01 (30 days)
 *           ADJUSTMENT   5 @ Rs 70   dated 2026-05-31 (31 days)
 *   Globe   source-less PURCHASE 8 @ Rs 10, entered today (nothing dates it but the insertion)
 *   Atlas buckets: 0-30 = 20 (Rs 1,200) | 31-60 = 5 (Rs 350) | 61-90 = 6 (Rs 300)
 *   Atlas total 31 units, Rs 1,850.  Globe 8 units, Rs 80, in 0-30.
 */
const AS_AT = "2026-07-01";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-01T06:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function world() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  const atlas = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const globe = repository.createItem({ companyId, name: "Globe", unit: "each", trackStock: true });
  const sell = (id: string, itemId: string, quantity: number, unitPricePaise: number): void => {
    repository.saveDraft({
      id, number: id, businessId, customerId, paymentAccount: "CASH", status: "DRAFT",
      lines: [{ itemId, description: "Sale", quantity, unitPricePaise }],
    });
    repository.finalizeInvoice(id);
  };
  return { repository, companyId, businessId, customerId, supplierId, atlas, globe, sell };
}
type World = ReturnType<typeof world>;

function stockTheWorld(w: World): void {
  const r = w.repository;
  r.addStockMovement({ itemId: w.atlas, movementType: "OPENING", quantity: 10, unitCostPaise: 5000, occurredOn: "2026-04-02" });
  const bill = r.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number: "BILL-A", billDate: "2026-06-01", paymentAccount: "PAYABLES",
    lines: [{ itemId: w.atlas, description: "Atlas", quantity: 20, unitPricePaise: 6000 }],
  });
  r.finalizePurchaseBill(bill.id);
  r.addStockMovement({ itemId: w.atlas, movementType: "ADJUSTMENT", quantity: 5, unitCostPaise: 7000, occurredOn: "2026-05-31" });
  // S17: the door refuses a bare PURCHASE; this old-database shape (source-less, posts nothing) is
  // inserted by hand so the ageing and valuation figures stay as they were.
  r.db
    .prepare("INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at) VALUES ('legacy-purchase', ?, NULL, 'PURCHASE', 8, 1000, ?)")
    .run(w.globe, new Date().toISOString());
  w.sell("INV-1", w.atlas, 4, 9000); // FIFO: 4 off the oldest (opening) lot.
}

function ageingFor(report: ReturnType<typeof stockAgeing>, itemId: string) {
  const row = report.rows.find((candidate) => candidate.itemId === itemId);
  if (row === undefined) throw new Error(`no ageing row for ${itemId}`);
  return row;
}

describe("stock ageing and inventory valuation detail", () => {
  it("TIE-OUT: the ageing buckets sum to getInventoryValuation, per item and in total", () => {
    const w = world();
    try {
      stockTheWorld(w);
      const valuation = w.repository.getInventoryValuation();
      const report = stockAgeing(w.repository.db, { asAtDate: AS_AT });

      // Row for row, in the same order as the valuation summary.
      expect(report.rows.map((row) => row.itemId)).toEqual(valuation.map((row) => row.itemId));
      for (const summary of valuation) {
        const row = ageingFor(report, summary.itemId);
        expect(row.quantity).toBe(summary.quantity);
        expect(row.valuePaise).toBe(summary.valuePaise);
        expect(row.buckets.reduce((sum, bucket) => sum + bucket.quantity, 0)).toBe(summary.quantity);
        expect(row.buckets.reduce((sum, bucket) => sum + bucket.valuePaise, 0)).toBe(summary.valuePaise);
      }
      expect(report.totals.quantity).toBe(valuation.reduce((sum, row) => sum + row.quantity, 0));
      expect(report.totals.valuePaise).toBe(valuation.reduce((sum, row) => sum + row.valuePaise, 0));
      expect(report.totals.buckets.reduce((sum, bucket) => sum + bucket.valuePaise, 0)).toBe(report.totals.valuePaise);

      // Hand figures: Atlas 31 units Rs 1,850; Globe 8 units Rs 80.
      expect(ageingFor(report, w.atlas).quantity).toBe(31);
      expect(ageingFor(report, w.atlas).valuePaise).toBe(185000);
      expect(report.totals.valuePaise).toBe(185000 + 8000);
    } finally {
      w.repository.close();
    }
  });

  it("TIE-OUT: the valuation detail rows group back to getInventoryValuation, per item and in total", () => {
    const w = world();
    try {
      stockTheWorld(w);
      const valuation = w.repository.getInventoryValuation();
      const detail = inventoryValuationDetail(w.repository.db, { asAtDate: AS_AT });

      for (const summary of valuation) {
        const rows = detail.rows.filter((row) => row.itemId === summary.itemId);
        expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(summary.quantity);
        expect(rows.reduce((sum, row) => sum + row.valuePaise, 0)).toBe(summary.valuePaise);
        for (const row of rows) expect(row.valuePaise).toBe(row.quantity * row.unitCostPaise);
      }
      expect(detail.totals.quantity).toBe(valuation.reduce((sum, row) => sum + row.quantity, 0));
      expect(detail.totals.valuePaise).toBe(valuation.reduce((sum, row) => sum + row.valuePaise, 0));

      // Four surviving lots: Atlas opening (6 left), Atlas bill, Atlas adjustment, Globe purchase.
      expect(detail.rows).toHaveLength(4);
      // Item name, then oldest first.
      expect(detail.rows.map((row) => [row.itemName, row.receivedOn])).toEqual([
        ["Atlas", "2026-04-02"], ["Atlas", "2026-05-31"], ["Atlas", "2026-06-01"], ["Globe", "2026-07-01"],
      ]);
      expect(detail.rows.map((row) => row.dateBasis)).toEqual(["JOURNAL", "JOURNAL", "BILL", "ENTRY_INSTANT"]);
      expect(detail.rows.map((row) => row.ageDays)).toEqual([90, 31, 30, 0]);
    } finally {
      w.repository.close();
    }
  });

  it("opening stock ages from its journal date (90 days ago), not from today", () => {
    const w = world();
    try {
      stockTheWorld(w);
      const atlas = ageingFor(stockAgeing(w.repository.db, { asAtDate: AS_AT }), w.atlas);
      const byKey = new Map(atlas.buckets.map((bucket) => [bucket.label, bucket] as const));
      // The opening lot (6 left of 10 @ Rs 50) is Rs 300 in 61-90, and NOT in 0-30, although its
      // row was inserted today.
      expect(byKey.get("61-90 days")?.quantity).toBe(6);
      expect(byKey.get("61-90 days")?.valuePaise).toBe(30000);
      // 0-30 holds only the 20 units of BILL-A (30 days); the adjustment (31 days) is in 31-60.
      expect(byKey.get("0-30 days")?.quantity).toBe(20);
      expect(byKey.get("0-30 days")?.valuePaise).toBe(120000);
      expect(byKey.get("31-60 days")?.quantity).toBe(5);
      expect(byKey.get("31-60 days")?.valuePaise).toBe(35000);
      expect(byKey.get("Over 90 days")?.quantity).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("a purchase is dated by its bill, not by the day the stock row was inserted", () => {
    const w = world();
    try {
      stockTheWorld(w);
      const billLayer = datedStockLayers(w.repository.db, w.atlas).find((layer) => layer.dateBasis === "BILL");
      expect(billLayer?.receivedOn).toBe("2026-06-01");
      expect(billLayer?.quantity).toBe(20);
    } finally {
      w.repository.close();
    }
  });

  it("a source-less PURCHASE falls back to ENTRY_INSTANT and is counted in both reports", () => {
    const w = world();
    try {
      stockTheWorld(w);
      const globe = datedStockLayers(w.repository.db, w.globe);
      expect(globe).toHaveLength(1);
      expect(globe[0]?.dateBasis).toBe("ENTRY_INSTANT");
      expect(globe[0]?.receivedOn).toBe("2026-07-01");
      expect(globe[0]?.sourceId).toBeNull();

      const report = stockAgeing(w.repository.db, { asAtDate: AS_AT });
      expect(report.entryInstantLayerCount).toBe(1);
      expect(inventoryValuationDetail(w.repository.db, { asAtDate: AS_AT }).entryInstantLayerCount).toBe(1);
      // ...and it IS in the buckets, only flagged: Globe's Rs 80 sits in 0-30.
      expect(ageingFor(report, w.globe).buckets[0]?.valuePaise).toBe(8000);
    } finally {
      w.repository.close();
    }
  });

  it("FIFO order is not disturbed by dates: a back-dated opening layer is still consumed in insertion order", () => {
    // Two worlds, identical but for the opening layer's date. The sale must consume the same lots
    // at the same costs in both, and post the same COGS; receivedOn is a label and nothing more.
    const run = (occurredOn: string | undefined) => {
      const w = world();
      try {
        const r = w.repository;
        // The first layer goes in FIRST (so it is first in FIFO) at Rs 1. (S17: OPENING, not a bare PURCHASE.)
        r.addStockMovement({ itemId: w.atlas, movementType: "OPENING", quantity: 5, unitCostPaise: 100 });
        vi.setSystemTime(new Date("2026-07-01T07:00:00.000Z"));
        // The opening layer goes in LATER, optionally dated months earlier, at Rs 3.
        r.addStockMovement({
          itemId: w.atlas, movementType: "OPENING", quantity: 5, unitCostPaise: 300,
          ...(occurredOn === undefined ? {} : { occurredOn }),
        });
        vi.setSystemTime(new Date("2026-07-01T08:00:00.000Z"));
        w.sell("INV-1", w.atlas, 5, 900);

        const sales = r.db
          .prepare("SELECT quantity_delta, unit_cost_paise FROM stock_movements WHERE movement_type = 'SALE' ORDER BY rowid")
          .all();
        const cogs = r.db
          .prepare(
            `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS net
               FROM journal_lines jl WHERE jl.account = 'COGS'`,
          )
          .get() as { net: number };
        const survivors = datedStockLayers(r.db, w.atlas);
        return { sales, cogsPaise: cogs.net, survivors: survivors.map((layer) => [layer.quantity, layer.unitCostPaise]), receivedOn: survivors.map((layer) => layer.receivedOn) };
      } finally {
        w.repository.close();
        vi.setSystemTime(new Date("2026-07-01T06:00:00.000Z"));
      }
    };

    const undated = run(undefined);
    const backDated = run("2026-01-01");

    // The oldest-INSERTED lot (5 @ Rs 1) went first, not the oldest-DATED one: COGS is Rs 5, not Rs 15.
    expect(backDated.cogsPaise).toBe(500);
    expect(backDated.sales).toEqual([{ quantity_delta: -5, unit_cost_paise: 100 }]);
    expect(backDated.survivors).toEqual([[5, 300]]);
    // Identical to the world where nothing was back-dated; only the label differs.
    expect(backDated.cogsPaise).toBe(undated.cogsPaise);
    expect(backDated.sales).toEqual(undated.sales);
    expect(backDated.survivors).toEqual(undated.survivors);
    expect(backDated.receivedOn).toEqual(["2026-01-01"]);
    expect(undated.receivedOn).toEqual(["2026-07-01"]);
  });

  it("boundary: a layer exactly 30 days old is in 0-30 and exactly 31 days old is in 31-60", () => {
    const w = world();
    try {
      w.repository.addStockMovement({ itemId: w.atlas, movementType: "OPENING", quantity: 3, unitCostPaise: 1000, occurredOn: "2026-06-01" }); // 30 days
      w.repository.addStockMovement({ itemId: w.atlas, movementType: "OPENING", quantity: 7, unitCostPaise: 1000, occurredOn: "2026-05-31" }); // 31 days
      const buckets = new Map(ageingFor(stockAgeing(w.repository.db, { asAtDate: AS_AT }), w.atlas).buckets.map((bucket) => [bucket.label, bucket] as const));
      expect(buckets.get("0-30 days")?.quantity).toBe(3);
      expect(buckets.get("31-60 days")?.quantity).toBe(7);
    } finally {
      w.repository.close();
    }
  });

  it("boundary: exactly 90 days is 61-90 and exactly 91 days is Over 90 days", () => {
    const w = world();
    try {
      w.repository.addStockMovement({ itemId: w.atlas, movementType: "OPENING", quantity: 2, unitCostPaise: 100, occurredOn: "2026-04-02" }); // 90 days
      w.repository.addStockMovement({ itemId: w.atlas, movementType: "OPENING", quantity: 5, unitCostPaise: 100, occurredOn: "2026-04-01" }); // 91 days
      const buckets = new Map(ageingFor(stockAgeing(w.repository.db, { asAtDate: AS_AT }), w.atlas).buckets.map((bucket) => [bucket.label, bucket.quantity] as const));
      expect(buckets.get("61-90 days")).toBe(2);
      expect(buckets.get("Over 90 days")).toBe(5);
    } finally {
      w.repository.close();
    }
  });

  it("uses the shared age bands, so stock ageing cannot drift from the customer and supplier reports", () => {
    const w = world();
    try {
      const report = stockAgeing(w.repository.db, { asAtDate: AS_AT });
      expect(report.totals.buckets.map((bucket) => bucket.label)).toEqual(AGEING_BANDS.map((band) => band.label));
    } finally {
      w.repository.close();
    }
  });

  it("returned goods age from the credit note's date and are NOT counted as a fallback", () => {
    const w = world();
    try {
      w.repository.addStockMovement({ itemId: w.atlas, movementType: "OPENING", quantity: 10, unitCostPaise: 5000, occurredOn: "2026-04-02" });
      w.repository.saveDraft({
        id: "INV-R", number: "INV-R", businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", status: "DRAFT",
        taxType: "NONE", taxRateBasisPoints: 0,
        lines: [{ itemId: w.atlas, description: "Atlas", quantity: 4, unitPricePaise: 9000 }],
      });
      w.repository.finalizeInvoice("INV-R");
      w.repository.saveCreditNote({
        id: "CN-R", invoiceId: "INV-R", number: "CN-R", reason: "Returned", status: "DRAFT", noteDate: "2026-06-20",
        lines: [{ itemId: w.atlas, description: "Atlas", quantity: 3, unitPricePaise: 9000 }],
      });
      w.repository.finalizeCreditNote("CN-R", { confirmBackdatedMonth: true });

      const layers = datedStockLayers(w.repository.db, w.atlas);
      const returned = layers.find((layer) => layer.dateBasis === "CREDIT_NOTE");
      expect(returned?.sourceId).toBe("CN-R");
      expect(returned?.receivedOn).toBe("2026-06-20");
      expect(returned?.quantity).toBe(3);
      expect(layers.some((layer) => layer.dateBasis === "ENTRY_INSTANT")).toBe(false);
      const report = stockAgeing(w.repository.db, { asAtDate: AS_AT });
      expect(report.entryInstantLayerCount).toBe(0);
      // 11 days old -> 0-30; and the report still ties to the valuation.
      const row = ageingFor(report, w.atlas);
      expect(row.buckets[0]?.quantity).toBe(3);
      expect(row.quantity).toBe(w.repository.getInventoryValuation().find((v) => v.itemId === w.atlas)?.quantity);
    } finally {
      w.repository.close();
    }
  });
  it("an as-at date before a layer's date ages it as 0 and counts it, rather than dropping it", () => {
    const w = world();
    try {
      stockTheWorld(w);
      const report = stockAgeing(w.repository.db, { asAtDate: "2026-05-01" });
      // Received after 1 May: the bill (1 June), the adjustment (31 May) and Globe's row (1 July).
      expect(report.futureDatedLayerCount).toBe(3);
      expect(report.totals.valuePaise).toBe(185000 + 8000); // still ties to the valuation
    } finally {
      w.repository.close();
    }
  });

  it("an invalid as-at date is refused; no date means today in IST", () => {
    const w = world();
    try {
      expect(() => stockAgeing(w.repository.db, { asAtDate: "2026-02-30" })).toThrow(RepositoryValidationError);
      expect(() => inventoryValuationDetail(w.repository.db, { asAtDate: "tomorrow" })).toThrow(RepositoryValidationError);
      expect(stockAgeing(w.repository.db).asAtDate).toBe("2026-07-01");
      expect(inventoryValuationDetail(w.repository.db).asAtDate).toBe("2026-07-01");
    } finally {
      w.repository.close();
    }
  });
});

/**
 * The R7b lesson: a report that is written and tested but never reached over HTTP is a report the
 * app cannot show. These two live here rather than in `reports-wiring.test.ts` because only this
 * file has stock on the shelf — that fixture's items are all `trackStock: false`, so both reports
 * would answer an empty body there and prove nothing.
 */
describe("the two stock reports are reachable over HTTP", () => {
  const get = (w: World) => {
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    return async (url: string) => app.inject({ method: "GET", url });
  };

  it("answers on both routes with exactly the figures the repository gives", async () => {
    const w = world();
    try {
      stockTheWorld(w);
      const http = get(w);

      const ageing = await http(`/reports/stock-ageing?asAtDate=${AS_AT}`);
      expect(ageing.statusCode).toBe(200);
      expect(ageing.json()).toEqual(JSON.parse(JSON.stringify(w.repository.getStockAgeing({ asAtDate: AS_AT }))));

      const detail = await http(`/reports/inventory-valuation-detail?asAtDate=${AS_AT}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual(
        JSON.parse(JSON.stringify(w.repository.getInventoryValuationDetail({ asAtDate: AS_AT }))),
      );

      // And the one figure a reader would check by hand: Rs 1,930 of stock in all.
      expect(ageing.json<StockAgeingReport>().totals.valuePaise).toBe(193000);
      expect(detail.json<InventoryValuationDetailReport>().totals.valuePaise).toBe(193000);
    } finally {
      w.repository.close();
    }
  });

  it("with no as-at date both answer for today, and both tie to /reports/inventory-valuation", async () => {
    const w = world();
    try {
      stockTheWorld(w);
      const http = get(w);

      const ageing = (await http("/reports/stock-ageing")).json<StockAgeingReport>();
      const detail = (await http("/reports/inventory-valuation-detail")).json<InventoryValuationDetailReport>();
      expect(ageing.asAtDate).toBe(AS_AT);
      expect(detail.asAtDate).toBe(AS_AT);

      const valuation = (await http("/reports/inventory-valuation"))
        .json<Array<{ itemId: string; quantity: number; valuePaise: number }>>();
      const valuationTotal = valuation.reduce((sum, row) => sum + row.valuePaise, 0);
      expect(ageing.totals.valuePaise).toBe(valuationTotal);
      expect(detail.totals.valuePaise).toBe(valuationTotal);
    } finally {
      w.repository.close();
    }
  });

  it("refuses a bad date, and refuses a parameter it does not understand rather than ignoring it", async () => {
    const w = world();
    try {
      const http = get(w);
      expect((await http("/reports/stock-ageing?asAtDate=2026-02-30")).statusCode).toBe(400);
      // A FIFO lot has no business dimension. Accepting `businessId` here and quietly dropping it
      // would answer a different question than the one asked, so `strict()` rejects it.
      expect((await http("/reports/stock-ageing?businessId=b-1")).statusCode).toBe(400);
      expect((await http("/reports/inventory-valuation-detail?fairId=f-1")).statusCode).toBe(400);
    } finally {
      w.repository.close();
    }
  });
});
