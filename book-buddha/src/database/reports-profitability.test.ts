import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";
import { itemProfitability, type ItemProfitabilityReport } from "./reports-profitability.js";
import { salesByItem } from "./reports-sales.js";

/**
 * Session 12, report 6: item profitability. Money is paise. "Today" is frozen at 2026-07-01 (IST);
 * only `Date` is faked. Every database is a throwaway in-memory one.
 *
 * THE WORLD
 *   Atlas (tracked)  3 @ Rs 50.00 (opening, 2026-04-02) then 10 @ Rs 60.00 (2026-04-10)
 *   Design (service, not tracked)
 *   INV-1  Fair One  2026-05-10  Atlas 5 @ Rs 90 = Rs 450. FIFO: 3 @ 50 + 2 @ 60 = Rs 270 cost (TWO layers)
 *   INV-2  Fair Two  2026-06-10  Atlas 2 @ Rs 90 = Rs 180 (cost 2 @ 60 = Rs 120) + Design 1 @ Rs 1,000
 *   INV-3  no fair   2026-06-15  Atlas 1 @ Rs 90 (cost Rs 60) - then CANCELLED today. Counts for nothing.
 *   CN-1   on INV-1  2026-06-20  returns 2 Atlas, finalized. Stock goes back at the layers INV-1 took
 *                                them from: 2 @ Rs 50 = Rs 100. Revenue back: 2 @ Rs 90 = Rs 180.
 *   CN-2   on INV-2  2026-06-25  returns 1 Atlas (cost Rs 60), finalized, then CANCELLED. Its
 *                                SALE_REVERSAL (+60) and its cancellation's SALE (-60) net to nil.
 *
 *   Atlas COGS, no filter  = 270 + 120 - 100 + 0 = Rs 290.   Atlas net sales = 450 + 180 - 180 = Rs 450.
 *   Journal COGS           = 270 + 120 + 60 - 60 - 100 + 60 - 60 = Rs 290, the same.
 */
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
  const atlas = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const design = repository.createItem({ companyId, name: "Design", unit: "job", trackStock: false });
  const fair1 = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair One" });
  const fair2 = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair Two" });

  repository.addStockMovement({ itemId: atlas, movementType: "OPENING", quantity: 3, unitCostPaise: 5000, occurredOn: "2026-04-02" });
  repository.addStockMovement({ itemId: atlas, movementType: "OPENING", quantity: 10, unitCostPaise: 6000, occurredOn: "2026-04-10" });

  const sell = (id: string, date: string, lines: Array<{ itemId: string; quantity: number; unitPricePaise: number }>, fairId?: string): void => {
    repository.saveDraft({
      id, number: id, businessId, customerId, invoiceDate: date, paymentAccount: "RECEIVABLES", status: "DRAFT",
      taxType: "NONE", taxRateBasisPoints: 0,
      ...(fairId === undefined ? {} : { fairId }),
      lines: lines.map((line) => ({ ...line, description: "Line" })),
    });
    repository.finalizeInvoice(id);
  };
  const returnGoods = (noteId: string, invoiceId: string, date: string, quantity: number): void => {
    repository.saveCreditNote({
      id: noteId, invoiceId, number: noteId, reason: "Returned", status: "DRAFT", noteDate: date,
      lines: [{ itemId: atlas, description: "Atlas", quantity, unitPricePaise: 9000 }],
    });
    repository.finalizeCreditNote(noteId, { confirmBackdatedMonth: true });
  };
  return { repository, businessId, atlas, design, fair1, fair2, sell, returnGoods };
}
type World = ReturnType<typeof world>;

function fullWorld(): World {
  const w = world();
  w.sell("INV-1", "2026-05-10", [{ itemId: w.atlas, quantity: 5, unitPricePaise: 9000 }], w.fair1);
  w.sell("INV-2", "2026-06-10", [
    { itemId: w.atlas, quantity: 2, unitPricePaise: 9000 },
    { itemId: w.design, quantity: 1, unitPricePaise: 100000 },
  ], w.fair2);
  w.sell("INV-3", "2026-06-15", [{ itemId: w.atlas, quantity: 1, unitPricePaise: 9000 }]);
  w.repository.cancelInvoice("INV-3");
  w.returnGoods("CN-1", "INV-1", "2026-06-20", 2);
  w.returnGoods("CN-2", "INV-2", "2026-06-25", 1);
  w.repository.cancelCreditNote("CN-2");
  return w;
}

function rowOf(report: ItemProfitabilityReport, itemId: string) {
  const row = report.rows.find((candidate) => candidate.itemId === itemId);
  if (row === undefined) throw new Error(`no row for ${itemId}`);
  return row;
}

function cogsLedger(w: World): number {
  return (w.repository.db.prepare(
    `SELECT COALESCE(SUM(jl.debit_paise - jl.credit_paise), 0) AS net
       FROM journal_lines jl WHERE jl.account = 'COGS'`,
  ).get() as { net: number }).net;
}

describe("item profitability", () => {
  it("TIE-OUT: with no filter, total COGS equals the COGS account in the journal, exactly", () => {
    const w = fullWorld();
    try {
      const report = itemProfitability(w.repository.db);
      expect(cogsLedger(w)).toBe(29000);
      expect(report.totals.cogsPaise).toBe(cogsLedger(w));
    } finally {
      w.repository.close();
    }
  });

  it("TIE-OUT: each row's net sales equals salesByItem for the same filter", () => {
    const w = fullWorld();
    try {
      for (const filter of [{}, { fairId: w.fair1 }, { fairId: w.fair2 }, { fromDate: "2026-06-01", toDate: "2026-06-30" }, { businessId: w.businessId }]) {
        const report = itemProfitability(w.repository.db, filter);
        const sales = salesByItem(w.repository.db, filter);
        for (const row of report.rows) {
          const match = sales.find((candidate) => candidate.itemId === row.itemId && candidate.itemName === row.itemName);
          expect(row.netSalesPaise).toBe(match?.netSalesPaise ?? 0);
          expect(row.netQuantity).toBe(match?.netQuantity ?? 0);
        }
        // Every item salesByItem reports with revenue is present here.
        for (const sale of sales.filter((candidate) => candidate.netSalesPaise !== 0)) {
          expect(report.rows.some((row) => row.itemId === sale.itemId)).toBe(true);
        }
      }
    } finally {
      w.repository.close();
    }
  });

  it("hand figures: the two-layer sale costs 3 @ 50.00 + 2 @ 60.00 = 270.00", () => {
    const w = world();
    try {
      w.sell("INV-1", "2026-05-10", [{ itemId: w.atlas, quantity: 5, unitPricePaise: 9000 }]);
      const row = rowOf(itemProfitability(w.repository.db), w.atlas);
      // 3 * 5000 + 2 * 6000 = 15000 + 12000 = 27000 paise.
      expect(row.cogsPaise).toBe(27000);
      expect(row.netSalesPaise).toBe(45000); // 5 * 9000
      expect(row.grossMarginPaise).toBe(18000); // 450.00 - 270.00
      expect(row.netQuantity).toBe(5);
    } finally {
      w.repository.close();
    }
  });

  it("hand figures: the full world, per item", () => {
    const w = fullWorld();
    try {
      const report = itemProfitability(w.repository.db);
      const atlas = rowOf(report, w.atlas);
      // COGS 270 + 120 - 100 + 0 = 290.00; sales 450 + 180 - 180 = 450.00; margin 160.00; units 5 + 2 - 2 = 5.
      expect(atlas.cogsPaise).toBe(29000);
      expect(atlas.netSalesPaise).toBe(45000);
      expect(atlas.grossMarginPaise).toBe(16000);
      expect(atlas.netQuantity).toBe(5);
      expect(atlas.unit).toBe("each");
    } finally {
      w.repository.close();
    }
  });

  it("a cancelled invoice contributes no revenue and no COGS", () => {
    const w = world();
    try {
      w.sell("INV-3", "2026-06-15", [{ itemId: w.atlas, quantity: 1, unitPricePaise: 9000 }]);
      expect(rowOf(itemProfitability(w.repository.db), w.atlas).cogsPaise).toBe(5000);
      w.repository.cancelInvoice("INV-3");
      const report = itemProfitability(w.repository.db);
      expect(report.rows).toEqual([]);
      expect(report.totals).toEqual({ netSalesPaise: 0, cogsPaise: 0, grossMarginPaise: 0 });
      // The journal agrees: the sale and its reversal net to nothing.
      expect(cogsLedger(w)).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("a credit note with goods back reduces COGS by the returned layers' cost; cancelling it restores it", () => {
    const w = world();
    try {
      w.sell("INV-1", "2026-05-10", [{ itemId: w.atlas, quantity: 5, unitPricePaise: 9000 }]);
      expect(rowOf(itemProfitability(w.repository.db), w.atlas).cogsPaise).toBe(27000);

      w.returnGoods("CN-1", "INV-1", "2026-06-20", 2);
      // The 2 returned units go back at the cost of the layer they came from: 2 @ 50.00 = 100.00.
      const afterNote = itemProfitability(w.repository.db);
      expect(rowOf(afterNote, w.atlas).cogsPaise).toBe(27000 - 10000);
      expect(afterNote.totals.cogsPaise).toBe(cogsLedger(w));

      w.repository.cancelCreditNote("CN-1");
      const afterCancel = itemProfitability(w.repository.db);
      expect(rowOf(afterCancel, w.atlas).cogsPaise).toBe(27000);
      expect(afterCancel.totals.cogsPaise).toBe(cogsLedger(w));
    } finally {
      w.repository.close();
    }
  });

  it("R7.2 guard: a cancelled credit note's SALE row (source = the NOTE) is counted, not dropped", () => {
    const w = world();
    try {
      w.sell("INV-2", "2026-06-10", [{ itemId: w.atlas, quantity: 2, unitPricePaise: 9000 }]);
      const before = rowOf(itemProfitability(w.repository.db), w.atlas).cogsPaise;
      w.returnGoods("CN-2", "INV-2", "2026-06-25", 1);
      w.repository.cancelCreditNote("CN-2");

      // The note's own SALE row exists and has the NOTE as its source, not an invoice.
      const saleRowsUnderNote = w.repository.db
        .prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE source_id = 'CN-2' AND movement_type = 'SALE'")
        .get() as { n: number };
      expect(saleRowsUnderNote.n).toBe(1);

      const after = itemProfitability(w.repository.db);
      expect(rowOf(after, w.atlas).cogsPaise).toBe(before);
      expect(after.totals.cogsPaise).toBe(cogsLedger(w));
    } finally {
      w.repository.close();
    }
  });

  it("a non-stock item shows its revenue with cogsPaise 0", () => {
    const w = fullWorld();
    try {
      const design = rowOf(itemProfitability(w.repository.db), w.design);
      expect(design.netSalesPaise).toBe(100000);
      expect(design.cogsPaise).toBe(0);
      expect(design.grossMarginPaise).toBe(100000);
      expect(design.unit).toBe("job");
    } finally {
      w.repository.close();
    }
  });

  it("fair filter: each fair's own figures; an unknown fair THROWS", () => {
    const w = fullWorld();
    try {
      // Fair One: INV-1 and the finalized note CN-1 (dated from the note's own entry, on INV-1's fair).
      const one = itemProfitability(w.repository.db, { fairId: w.fair1 });
      expect(one.rows).toHaveLength(1);
      expect(rowOf(one, w.atlas)).toMatchObject({ cogsPaise: 27000 - 10000, netSalesPaise: 45000 - 18000, netQuantity: 3 });

      // Fair Two: INV-2 (Atlas 2, Design) and the cancelled CN-2, which nets to nothing.
      const two = itemProfitability(w.repository.db, { fairId: w.fair2 });
      expect(rowOf(two, w.atlas)).toMatchObject({ cogsPaise: 12000, netSalesPaise: 18000, netQuantity: 2 });
      expect(rowOf(two, w.design)).toMatchObject({ cogsPaise: 0, netSalesPaise: 100000 });

      // The unassigned (cancelled) invoice is in neither; the fairs add up to the consolidated total.
      const all = itemProfitability(w.repository.db);
      expect(one.totals.cogsPaise + two.totals.cogsPaise).toBe(all.totals.cogsPaise);
      expect(one.totals.netSalesPaise + two.totals.netSalesPaise).toBe(all.totals.netSalesPaise);

      expect(() => itemProfitability(w.repository.db, { fairId: "no-such-fair" })).toThrow(RepositoryValidationError);
    } finally {
      w.repository.close();
    }
  });

  it("an invoice on no fair appears only in the consolidated view", () => {
    const w = world();
    try {
      w.sell("INV-9", "2026-06-15", [{ itemId: w.atlas, quantity: 1, unitPricePaise: 9000 }]);
      expect(rowOf(itemProfitability(w.repository.db), w.atlas).cogsPaise).toBe(5000);
      expect(itemProfitability(w.repository.db, { fairId: w.fair1 }).rows).toEqual([]);
    } finally {
      w.repository.close();
    }
  });

  it("date filter: a sale outside the range is excluded from BOTH revenue and COGS", () => {
    const w = fullWorld();
    try {
      // May only: INV-1 alone.
      const may = itemProfitability(w.repository.db, { fromDate: "2026-05-01", toDate: "2026-05-31" });
      expect(may.rows).toHaveLength(1);
      expect(rowOf(may, w.atlas)).toMatchObject({ cogsPaise: 27000, netSalesPaise: 45000 });

      // June only: INV-2 (cogs 120, sales 180) + CN-1 (cogs -100, returns -180) + CN-2 (nets to 0).
      // INV-1 (May) is out of both sides.
      const june = itemProfitability(w.repository.db, { fromDate: "2026-06-01", toDate: "2026-06-30" });
      expect(rowOf(june, w.atlas)).toMatchObject({ cogsPaise: 12000 - 10000, netSalesPaise: 18000 - 18000, netQuantity: 0 });
      expect(rowOf(june, w.design).netSalesPaise).toBe(100000);

      // A window with nothing in it is an empty report.
      expect(itemProfitability(w.repository.db, { fromDate: "2026-08-01", toDate: "2026-08-31" }).rows).toEqual([]);
    } finally {
      w.repository.close();
    }
  });

  it("itemId filter narrows to one item", () => {
    const w = fullWorld();
    try {
      const report = itemProfitability(w.repository.db, { itemId: w.atlas });
      expect(report.rows.map((row) => row.itemId)).toEqual([w.atlas]);
      expect(report.totals.cogsPaise).toBe(29000);
    } finally {
      w.repository.close();
    }
  });

  it("totals are the sum of the rows, margin is sales less cost, rows are sorted, notes carry both sentences", () => {
    const w = fullWorld();
    try {
      const report = itemProfitability(w.repository.db);
      expect(report.totals.netSalesPaise).toBe(report.rows.reduce((sum, row) => sum + row.netSalesPaise, 0));
      expect(report.totals.cogsPaise).toBe(report.rows.reduce((sum, row) => sum + row.cogsPaise, 0));
      expect(report.totals.grossMarginPaise).toBe(report.totals.netSalesPaise - report.totals.cogsPaise);
      for (const row of report.rows) expect(row.grossMarginPaise).toBe(row.netSalesPaise - row.cogsPaise);
      expect(report.rows.map((row) => row.itemName)).toEqual(["Atlas", "Design"]);
      expect(report.notes).toHaveLength(2);
      expect(report.notes[0]).toMatch(/not spread across lines/);
      expect(report.notes[0]).toMatch(/Sales by Item, not to net sales in the journal/);
      expect(report.notes[1]).toMatch(/cancellation posts on the day it happens/);
      expect(report.notes[1]).toMatch(/keep the document's date/);
    } finally {
      w.repository.close();
    }
  });

  it("a free-text line with no item appears with cogsPaise 0, and an item with COGS but no sales in range still appears", () => {
    const w = world();
    try {
      w.repository.saveDraft({
        id: "INV-T", number: "INV-T", businessId: w.businessId,
        customerId: (w.repository.db.prepare("SELECT id FROM customers LIMIT 1").get() as { id: string }).id,
        invoiceDate: "2026-06-01", paymentAccount: "RECEIVABLES", status: "DRAFT", taxType: "NONE", taxRateBasisPoints: 0,
        lines: [{ description: "Courier", quantity: 1, unitPricePaise: 5000 }],
      });
      w.repository.finalizeInvoice("INV-T");
      const report = itemProfitability(w.repository.db);
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]).toMatchObject({ itemId: null, itemName: "Courier", cogsPaise: 0, netSalesPaise: 5000 });

      // Stock sold on INV-1 (May), returned in June: filter to June, where Atlas has a return and no sale.
      w.sell("INV-1", "2026-05-10", [{ itemId: w.atlas, quantity: 2, unitPricePaise: 9000 }]);
      w.returnGoods("CN-1", "INV-1", "2026-06-20", 1);
      const june = itemProfitability(w.repository.db, { fromDate: "2026-06-10", toDate: "2026-06-30" });
      expect(rowOf(june, w.atlas)).toMatchObject({ cogsPaise: -5000, netSalesPaise: -9000, netQuantity: -1 });
    } finally {
      w.repository.close();
    }
  });
});
