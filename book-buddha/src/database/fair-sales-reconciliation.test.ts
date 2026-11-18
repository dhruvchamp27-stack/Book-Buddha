import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";

/**
 * SESSION 9 - the two routes that gave two answers.
 *
 * THE DEFECT, measured on 2026-11-18 before a line was changed. `/reports/fair-sales` rebuilt the
 * sales figure from the invoice LINES on its own:
 *   - it ADDED GST into the total, as though tax collected for the government were the fair's income;
 *   - it IGNORED credit notes completely, so a return never came off;
 *   - it took no filters at all, so a fair's figure could not be cut by business, customer or date.
 * On a two-invoice fair (Rs 1,000 + Rs 1,000 with 18% GST, less Rs 300 and Rs 200 of credit notes)
 * it answered Rs 2,180 where BOTH `/reports/sales-by-fair` and `/reports/profit-and-loss?fairId=`
 * answered Rs 1,500 on the very same books. Rs 680 of the gap was Rs 180 of GST plus Rs 500 of
 * credit notes. `/reports/sales-by-item` had the same two holes: no filters, no credit notes.
 *
 * THE FIX. `getFairSales` no longer computes anything - it reads `salesByFair`, the journal-based
 * report, and merges it over the full list of fairs so a fair with nothing posted still shows as a
 * zero row. `salesByItem` must read document lines (the journal has no item dimension), but it now
 * takes its business / fair / date filter from the invoice's own posted entry, and nets credit
 * notes off using salesReturnReport's query rather than a second one of its own.
 *
 * THE RULE THIS FILE ENFORCES: three routes answer "what did this fair sell". They must agree.
 *
 * Only `Date` is faked (never timers) - a credit note is dated from the clock at finalize (S4-8).
 */

const PAISE = (rupees: number): number => rupees * 100;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T06:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * THE WORKED WORLD (Rs). Fair Three deliberately has nothing against it.
 *   INV1  Fair One  Books A  Alpha  10 Jan  Atlas 1 @ 1,000              no GST
 *   INV4  Fair One  Books A  Alpha  20 Jan  Atlas 1 @ 1,000              + 18% GST (180)
 *   INV5  Fair One  Books A  Alpha  25 Jan  Globe 2 @   500  TRACKED     no GST
 *   INV2  Fair Two  Books B  Beta   10 Feb  Atlas 1 @   500              no GST
 *   CN1   on INV1, finalized 15 Feb, Atlas 1 @ 300
 *   CN2   on INV4, finalized 20 Feb, Atlas 1 @ 200 (+ 36 GST)
 *
 * Fair One: invoiced 3,000, credit notes 500, NET 2,500.  Fair Two: 500.  Fair Three: nil.
 * Globe is TRACKED ON PURPOSE: a tracked-stock invoice posts TWO journal entries (the sale and
 * COGS) under one source_id, and a naive join would count its lines twice.
 */
function world() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const bizA = repository.createBusiness({ companyId, name: "Books A" });
  const bizB = repository.createBusiness({ companyId, name: "Books B" });
  const alpha = repository.createCustomer({ companyId, name: "Alpha School" });
  const beta = repository.createCustomer({ companyId, name: "Beta School" });
  const supplier = repository.createSupplier({ companyId, name: "Paper House" });
  const atlas = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: false });
  const globe = repository.createItem({ companyId, name: "Globe", unit: "each", trackStock: true });
  const fair1 = repository.createFair({ companyId, hostCustomerId: alpha, name: "Fair One" });
  const fair2 = repository.createFair({ companyId, hostCustomerId: beta, name: "Fair Two" });
  const fair3 = repository.createFair({ companyId, hostCustomerId: alpha, name: "Fair Three" });

  const bill = repository.createPurchaseBill({
    id: "PB1", businessId: bizA, supplierId: supplier, number: "PB1", billDate: "2026-01-01", paymentAccount: "CASH",
    lines: [{ itemId: globe, description: "Globe", quantity: 10, unitPricePaise: PAISE(100) }],
  });
  repository.finalizePurchaseBill(bill.id);

  const invoice = (o: {
    id: string; businessId: string; customerId: string; fairId: string; date: string;
    itemId: string; quantity: number; rupees: number; gst?: boolean;
  }): void => {
    repository.saveDraft({
      id: o.id, number: o.id, businessId: o.businessId, customerId: o.customerId, invoiceDate: o.date,
      status: "DRAFT", paymentAccount: "RECEIVABLES", fairId: o.fairId,
      taxType: o.gst === true ? "CGST_SGST" : "NONE", taxRateBasisPoints: o.gst === true ? 1800 : 0,
      lines: [{ itemId: o.itemId, description: "Line", quantity: o.quantity, unitPricePaise: PAISE(o.rupees) }],
    });
    repository.finalizeInvoice(o.id);
  };
  const note = (id: string, invoiceId: string, rupees: number, on: string): void => {
    vi.setSystemTime(new Date(`${on}T06:00:00.000Z`));
    repository.saveCreditNote({
      id, invoiceId, number: id, reason: "Return", status: "DRAFT",
      lines: [{ itemId: atlas, description: "Returned", quantity: 1, unitPricePaise: PAISE(rupees) }],
    });
    repository.finalizeCreditNote(id);
  };

  invoice({ id: "INV1", businessId: bizA, customerId: alpha, fairId: fair1, date: "2026-01-10", itemId: atlas, quantity: 1, rupees: 1000 });
  invoice({ id: "INV4", businessId: bizA, customerId: alpha, fairId: fair1, date: "2026-01-20", itemId: atlas, quantity: 1, rupees: 1000, gst: true });
  invoice({ id: "INV5", businessId: bizA, customerId: alpha, fairId: fair1, date: "2026-01-25", itemId: globe, quantity: 2, rupees: 500 });
  invoice({ id: "INV2", businessId: bizB, customerId: beta, fairId: fair2, date: "2026-02-10", itemId: atlas, quantity: 1, rupees: 500 });
  note("CN1", "INV1", 300, "2026-02-15");
  note("CN2", "INV4", 200, "2026-02-20");
  return { repository, companyId, bizA, bizB, alpha, beta, atlas, globe, fair1, fair2, fair3 };
}

describe("fair sales reconciles with the journal reports", () => {
  it("THE DEFECT: fair-sales, sales-by-fair and the fair P&L now give ONE answer", () => {
    const w = world();
    try {
      const fairSales = w.repository.getFairSales({ fairId: w.fair1 })[0];
      const byFair = w.repository.getSalesByFairReport({ fairId: w.fair1 }).rows[0];
      const profitAndLoss = w.repository.getProfitAndLoss({ fairId: w.fair1 });

      // The anchor. Rs 2,500 net: invoiced 3,000 less 500 of credit notes, GST excluded.
      expect(fairSales).toEqual({
        fairId: w.fair1,
        fairName: "Fair One",
        invoiceCount: 3,
        totalPaise: PAISE(2500),
        invoicedPaise: PAISE(3000),
        creditNotesPaise: PAISE(500),
        netSalesPaise: PAISE(2500),
        creditNoteCount: 2,
      });
      // ...and the same figure from the other two routes, read independently.
      expect(byFair?.netSalesPaise).toBe(PAISE(2500));
      expect(profitAndLoss.totalIncomePaise).toBe(PAISE(2500));
      expect(fairSales?.totalPaise).toBe(byFair?.netSalesPaise);
      expect(fairSales?.totalPaise).toBe(profitAndLoss.totalIncomePaise);

      // Guard against passing vacuously: the old answer must NOT come back. Rs 2,180 was the
      // two-invoice figure; here the equivalent wrong answer is 3,000 + 180 GST = Rs 3,180.
      expect(fairSales?.totalPaise).not.toBe(PAISE(3180));
    } finally {
      w.repository.close();
    }
  });

  it("every fair is listed, including one with nothing posted against it", () => {
    const w = world();
    try {
      const rows = w.repository.getFairSales();
      // Alphabetical by name: Fair One, Fair Three, Fair Two.
      expect(rows.map((row) => [row.fairName, row.totalPaise])).toEqual([
        ["Fair One", PAISE(2500)],
        ["Fair Three", 0],
        ["Fair Two", PAISE(500)],
      ]);
      // A fair with no sales is a real zero, not a missing row: the owner needs to see the fair
      // he set up and has not invoiced yet. This is the one thing sales-by-fair cannot give him.
      const empty = rows.find((row) => row.fairId === w.fair3);
      expect(empty).toEqual({
        fairId: w.fair3, fairName: "Fair Three", invoiceCount: 0, totalPaise: 0,
        invoicedPaise: 0, creditNotesPaise: 0, netSalesPaise: 0, creditNoteCount: 0,
      });
      // ...and the no-fair row that sales-by-fair adds is NOT one of these rows.
      expect(rows.every((row) => row.fairId !== null)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("fair-sales honours business, customer and date filters, and still ties to sales-by-fair", () => {
    const w = world();
    try {
      const sameAsByFair = (filter: Parameters<AccountingRepository["getFairSales"]>[0]): void => {
        const byFair = new Map(
          w.repository.getSalesByFairReport(filter).rows.map((row) => [row.fairId, row.netSalesPaise]),
        );
        for (const row of w.repository.getFairSales(filter)) {
          expect([row.fairName, row.totalPaise]).toEqual([row.fairName, byFair.get(row.fairId) ?? 0]);
        }
      };

      // Books B holds only INV2 (Fair Two, Rs 500).
      expect(w.repository.getFairSales({ businessId: w.bizB }).map((r) => [r.fairName, r.totalPaise]))
        .toEqual([["Fair One", 0], ["Fair Three", 0], ["Fair Two", PAISE(500)]]);
      sameAsByFair({ businessId: w.bizB });

      // Beta School bought only INV2.
      expect(w.repository.getFairSales({ customerId: w.beta, fairId: w.fair2 })[0]?.totalPaise).toBe(PAISE(500));
      sameAsByFair({ customerId: w.beta });

      // January only: all three Fair One invoices are in, both credit notes (February) are out.
      const january = w.repository.getFairSales({ fairId: w.fair1, fromDate: "2026-01-01", toDate: "2026-01-31" })[0];
      expect(january).toMatchObject({ invoicedPaise: PAISE(3000), creditNotesPaise: 0, netSalesPaise: PAISE(3000), creditNoteCount: 0 });
      // February only: no invoices, both notes. The notes sit in February because a credit note
      // is dated when it is FINALIZED (S8-4), not when the goods went back.
      const february = w.repository.getFairSales({ fairId: w.fair1, fromDate: "2026-02-01", toDate: "2026-02-28" })[0];
      expect(february).toMatchObject({ invoicedPaise: 0, creditNotesPaise: PAISE(500), netSalesPaise: PAISE(-500), creditNoteCount: 2 });
      sameAsByFair({ fairId: w.fair1, fromDate: "2026-02-01", toDate: "2026-02-28" });

      // The two halves partition the whole: 3,000 + (-500) = 2,500.
      expect((january?.netSalesPaise ?? 0) + (february?.netSalesPaise ?? 0)).toBe(PAISE(2500));
    } finally {
      w.repository.close();
    }
  });
});

describe("sales by item nets returns and takes the same filters", () => {
  it("deducts credit notes, and does not double-count a tracked-stock invoice", () => {
    const w = world();
    try {
      expect(w.repository.getSalesByItem()).toEqual([
        {
          itemId: w.atlas, itemName: "Atlas", unit: "each",
          // INV1 1,000 + INV4 1,000 + INV2 500
          quantity: 3, salesPaise: PAISE(2500),
          // CN1 300 + CN2 200
          returnedQuantity: 2, returnsPaise: PAISE(500),
          netQuantity: 1, netSalesPaise: PAISE(2000),
        },
        {
          itemId: w.globe, itemName: "Globe", unit: "each",
          // THE DOUBLE-COUNT GUARD. Globe tracks stock, so INV5 posted TWO journal entries under
          // one source_id. If the dimension join did not collapse them this would read 4 @ 2,000.
          quantity: 2, salesPaise: PAISE(1000),
          returnedQuantity: 0, returnsPaise: 0,
          netQuantity: 2, netSalesPaise: PAISE(1000),
        },
      ]);
    } finally {
      w.repository.close();
    }
  });

  it("filters by fair, business, customer, item and date on the same basis as the money reports", () => {
    const w = world();
    try {
      // Fair One: Atlas on INV1 and INV4 (2,000), Globe on INV5 (1,000); both notes are Fair One.
      expect(w.repository.getSalesByItem({ fairId: w.fair1 })).toEqual([
        { itemId: w.atlas, itemName: "Atlas", unit: "each", quantity: 2, salesPaise: PAISE(2000),
          returnedQuantity: 2, returnsPaise: PAISE(500), netQuantity: 0, netSalesPaise: PAISE(1500) },
        { itemId: w.globe, itemName: "Globe", unit: "each", quantity: 2, salesPaise: PAISE(1000),
          returnedQuantity: 0, returnsPaise: 0, netQuantity: 2, netSalesPaise: PAISE(1000) },
      ]);
      // Fair Two: Atlas only, nothing returned.
      expect(w.repository.getSalesByItem({ fairId: w.fair2 })).toEqual([
        { itemId: w.atlas, itemName: "Atlas", unit: "each", quantity: 1, salesPaise: PAISE(500),
          returnedQuantity: 0, returnsPaise: 0, netQuantity: 1, netSalesPaise: PAISE(500) },
      ]);
      // Business B holds only INV2.
      expect(w.repository.getSalesByItem({ businessId: w.bizB }).map((r) => [r.itemName, r.salesPaise]))
        .toEqual([["Atlas", PAISE(500)]]);
      // Customer Beta likewise.
      expect(w.repository.getSalesByItem({ customerId: w.beta }).map((r) => [r.itemName, r.salesPaise]))
        .toEqual([["Atlas", PAISE(500)]]);
      // Item filter: Globe alone, and it never appears on a credit note.
      expect(w.repository.getSalesByItem({ itemId: w.globe }).map((r) => [r.itemName, r.quantity, r.returnedQuantity]))
        .toEqual([["Globe", 2, 0]]);
      // January: everything invoiced, nothing returned yet.
      expect(w.repository.getSalesByItem({ fromDate: "2026-01-01", toDate: "2026-01-31" }).map((r) => [r.itemName, r.salesPaise, r.returnsPaise]))
        .toEqual([["Atlas", PAISE(2000), 0], ["Globe", PAISE(1000), 0]]);
      // February: INV2 was invoiced, and both notes landed.
      expect(w.repository.getSalesByItem({ fromDate: "2026-02-01", toDate: "2026-02-28" }).map((r) => [r.itemName, r.salesPaise, r.returnsPaise]))
        .toEqual([["Atlas", PAISE(500), PAISE(500)]]);
    } finally {
      w.repository.close();
    }
  });

  it("a return still shows when its item was not invoiced inside the filter", () => {
    const w = world();
    try {
      // 15-20 February holds the two credit notes and no invoice at all. A merge that started
      // from the invoice side and only decorated it would show nothing here, hiding both returns.
      const rows = w.repository.getSalesByItem({ fromDate: "2026-02-15", toDate: "2026-02-20" });
      expect(rows).toEqual([
        { itemId: w.atlas, itemName: "Atlas", unit: "each", quantity: 0, salesPaise: 0,
          returnedQuantity: 2, returnsPaise: PAISE(500), netQuantity: -2, netSalesPaise: PAISE(-500) },
      ]);
    } finally {
      w.repository.close();
    }
  });

  it("an invoice line with no item is reported under its own description, not dropped", () => {
    const w = world();
    try {
      w.repository.saveDraft({
        id: "INV9", number: "INV9", businessId: w.bizA, customerId: w.alpha, invoiceDate: "2026-03-01",
        status: "DRAFT", paymentAccount: "RECEIVABLES", fairId: w.fair3,
        lines: [{ description: "Stall hire recharge", quantity: 1, unitPricePaise: PAISE(700) }],
      });
      w.repository.finalizeInvoice("INV9");
      // The old query INNER JOINed items, so a typed-in service line was invisible here while the
      // same money was plainly in sales-by-fair. Now it is named by its description.
      expect(w.repository.getSalesByItem({ fairId: w.fair3 })).toEqual([
        { itemId: null, itemName: "Stall hire recharge", unit: null, quantity: 1, salesPaise: PAISE(700),
          returnedQuantity: 0, returnsPaise: 0, netQuantity: 1, netSalesPaise: PAISE(700) },
      ]);
      expect(w.repository.getFairSales({ fairId: w.fair3 })[0]?.totalPaise).toBe(PAISE(700));
    } finally {
      w.repository.close();
    }
  });
});

describe("over HTTP", () => {
  it("serves both routes with their filters", async () => {
    const w = world();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const fairSales = await app.inject({ method: "GET", url: `/reports/fair-sales?fairId=${w.fair1}` });
      expect(fairSales.statusCode).toBe(200);
      expect(fairSales.json<Array<{ totalPaise: number; creditNotesPaise: number }>>()[0]).toMatchObject({
        totalPaise: PAISE(2500), creditNotesPaise: PAISE(500),
      });

      const dated = await app.inject({
        method: "GET", url: `/reports/fair-sales?fairId=${w.fair1}&fromDate=2026-01-01&toDate=2026-01-31`,
      });
      expect(dated.json<Array<{ totalPaise: number }>>()[0]?.totalPaise).toBe(PAISE(3000));

      const byItem = await app.inject({ method: "GET", url: `/reports/sales-by-item?fairId=${w.fair1}` });
      expect(byItem.statusCode).toBe(200);
      expect(byItem.json<Array<{ itemName: string; netSalesPaise: number }>>().map((row) => [row.itemName, row.netSalesPaise]))
        .toEqual([["Atlas", PAISE(1500)], ["Globe", PAISE(1000)]]);

      const byItemFiltered = await app.inject({ method: "GET", url: `/reports/sales-by-item?itemId=${w.globe}` });
      expect(byItemFiltered.json<Array<{ itemName: string }>>().map((row) => row.itemName)).toEqual(["Globe"]);

      // A nonsense query is refused rather than silently ignored.
      expect((await app.inject({ method: "GET", url: "/reports/fair-sales?nope=1" })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/reports/fair-sales?fromDate=2026-13-01" })).statusCode).toBe(400);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});
