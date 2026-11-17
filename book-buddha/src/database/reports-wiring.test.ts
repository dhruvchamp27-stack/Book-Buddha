import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";
import type { CreditNote, Invoice } from "../accounting/types.js";

/**
 * R7b — `reports-sales.ts` and `reports-transactions.ts` were written and tested and then never
 * wired up: nothing outside their own tests imported them, so not one of these reports could be
 * reached from the running app. These tests call every new route OVER HTTP, which is the check
 * session 7 missed on the R4c backfill route (it had never once executed in a test).
 *
 * They also pin the one thing the General Ledger used to get wrong: `date` was the POSTING
 * timestamp, so a back-dated entry appeared under today. It is now `postedAt`, and `entryDate`
 * is the transaction date.
 */

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  otherBusinessId: string;
  customerId: string;
  otherCustomerId: string;
  itemId: string;
  fairId: string;
}

function setup(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const otherBusinessId = repository.createBusiness({ companyId, name: "Stationery" });
  const customerId = repository.createCustomer({ companyId, name: "Asha" });
  const otherCustomerId = repository.createCustomer({ companyId, name: "Biju" });
  const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: false });
  const fairId = repository.createFair({ companyId, hostCustomerId: customerId, name: "Kochi Fair" });
  return { repository, companyId, businessId, otherBusinessId, customerId, otherCustomerId, itemId, fairId };
}

function invoice(
  w: World, id: string, opts: { businessId?: string; customerId?: string; date: string; paise: number; fairId?: string },
): Invoice {
  return {
    id, number: id,
    businessId: opts.businessId ?? w.businessId,
    customerId: opts.customerId ?? w.customerId,
    invoiceDate: opts.date,
    status: "DRAFT",
    paymentAccount: "RECEIVABLES",
    taxType: "NONE",
    taxRateBasisPoints: 0,
    ...(opts.fairId === undefined ? {} : { fairId: opts.fairId }),
    lines: [{ itemId: w.itemId, description: "Novel", quantity: 1, unitPricePaise: opts.paise }],
  };
}

/**
 * Hand-worked books, all ACCRUAL, no GST:
 *
 *   INV-1  2026-05-10  Books       Asha   60000   tagged to the Kochi fair
 *   INV-2  2026-06-20  Books       Biju   30000
 *   INV-3  2026-07-05  Stationery  Asha   10000
 *   CN-1   against INV-1, 20000 returned
 *
 * So: all sales 100000 gross, 20000 returned, 80000 net. Books is 90000 gross / 70000 net.
 * Asha is 70000 gross / 50000 net. The Kochi fair is 60000 gross / 40000 net.
 */
function books(): World {
  const w = setup();
  w.repository.saveDraft(invoice(w, "INV-1", { date: "2026-05-10", paise: 60000, fairId: w.fairId }));
  w.repository.finalizeInvoice("INV-1");
  w.repository.saveDraft(invoice(w, "INV-2", { date: "2026-06-20", paise: 30000, customerId: w.otherCustomerId }));
  w.repository.finalizeInvoice("INV-2");
  w.repository.saveDraft(invoice(w, "INV-3", { date: "2026-07-05", paise: 10000, businessId: w.otherBusinessId }));
  w.repository.finalizeInvoice("INV-3");

  const note: CreditNote = {
    id: "CN-1", invoiceId: "INV-1", number: "CN-1", reason: "Returned", status: "DRAFT",
    lines: [{ itemId: w.itemId, description: "Returned", quantity: 1, unitPricePaise: 20000 }],
  };
  w.repository.saveCreditNote(note);
  w.repository.finalizeCreditNote("CN-1");
  return w;
}

function api(w: World) {
  const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
  return async (url: string) => app.inject({ method: "GET", url });
}

/** Every route R7b added. Each must answer 200 and agree with the repository method behind it. */
const WIRED_ROUTES = [
  "/reports/sales-by-customer",
  "/reports/sales-by-business",
  "/reports/sales-by-fair",
  "/reports/sales-by-tax",
  "/reports/credit-notes",
  "/reports/sales-returns",
  "/reports/transactions",
  "/reports/transaction-detail",
  "/reports/stock-movements",
] as const;

describe("R7b: the sales and transaction reports are reachable over HTTP", () => {
  it("answers on every new route, and none of them answers empty", async () => {
    const w = books();
    try {
      const get = api(w);
      // Collected rather than asserted one at a time, so a failure names every broken route.
      const broken: string[] = [];
      for (const route of WIRED_ROUTES) {
        const response = await get(route);
        if (response.statusCode !== 200) { broken.push(`${route} -> ${response.statusCode}`); continue; }
        const body = response.json<unknown>();
        const rows = Array.isArray(body) ? body : (body as { rows?: unknown[] }).rows;
        // stock-movements is legitimately empty here (no tracked item), so it is exempt by name.
        if (route !== "/reports/stock-movements" && (!Array.isArray(rows) || rows.length === 0)) {
          broken.push(`${route} -> no rows`);
        }
      }
      expect(broken).toEqual([]);
    } finally {
      w.repository.close();
    }
  });

  it("nets credit notes off sales, by customer, business and fair, as hand-worked", async () => {
    const w = books();
    try {
      const get = api(w);

      const byCustomer = (await get("/reports/sales-by-customer"))
        .json<{ rows: Array<{ customerName: string; invoicedPaise: number; creditNotesPaise: number; netSalesPaise: number }>;
                totals: { invoicedPaise: number; creditNotesPaise: number; netSalesPaise: number } }>();
      expect(byCustomer.totals.invoicedPaise).toBe(100000);
      expect(byCustomer.totals.creditNotesPaise).toBe(20000);
      expect(byCustomer.totals.netSalesPaise).toBe(80000);
      const asha = byCustomer.rows.find((row) => row.customerName === "Asha");
      expect(asha?.invoicedPaise).toBe(70000); // INV-1 60000 + INV-3 10000
      expect(asha?.creditNotesPaise).toBe(20000);
      expect(asha?.netSalesPaise).toBe(50000);

      const byBusiness = (await get(`/reports/sales-by-business?businessId=${w.businessId}`))
        .json<{ totals: { invoicedPaise: number; netSalesPaise: number } }>();
      expect(byBusiness.totals.invoicedPaise).toBe(90000); // INV-1 + INV-2
      expect(byBusiness.totals.netSalesPaise).toBe(70000);

      const byFair = (await get(`/reports/sales-by-fair?fairId=${w.fairId}`))
        .json<{ totals: { invoicedPaise: number; netSalesPaise: number } }>();
      expect(byFair.totals.invoicedPaise).toBe(60000); // INV-1 alone
      expect(byFair.totals.netSalesPaise).toBe(40000);
    } finally {
      w.repository.close();
    }
  });

  it("filters by date, and the route gives exactly what the repository method gives", async () => {
    const w = books();
    try {
      const get = api(w);
      // June onwards: INV-2 30000 and INV-3 10000. INV-1 (May) is correctly excluded.
      const june = (await get("/reports/sales-by-customer?fromDate=2026-06-01"))
        .json<{ totals: { invoicedPaise: number; creditNotesPaise: number } }>();
      expect(june.totals.invoicedPaise).toBe(40000);
      // CN-1 IS counted here even though the invoice it reverses is dated in May, because a
      // CreditNote carries no date of its own (src/accounting/types.ts) and is therefore dated
      // the day it is finalized. A return cannot be back-dated at all. That is recorded as a
      // finding rather than changed here: giving credit notes a date is a schema change, and
      // this slice is wiring. Pinned so it cannot drift unnoticed.
      expect(june.totals.creditNotesPaise).toBe(20000);
      // The same filter dated before today still excludes it, which is the other half of the proof.
      const upToJuly = (await get("/reports/sales-by-customer?toDate=2026-07-31"))
        .json<{ totals: { creditNotesPaise: number } }>();
      expect(upToJuly.totals.creditNotesPaise).toBe(0);

      // The route is a door onto the repository method, not a second implementation.
      expect(june).toEqual(JSON.parse(JSON.stringify(w.repository.getSalesByCustomer({ fromDate: "2026-06-01" }))));
      const viaRoute = (await get("/reports/transactions")).json<unknown>();
      expect(viaRoute).toEqual(JSON.parse(JSON.stringify(w.repository.getTransactionList())));
    } finally {
      w.repository.close();
    }
  });

  it("refuses a filter it cannot honestly apply, and a bad date, rather than answering unfiltered", async () => {
    const w = books();
    try {
      const get = api(w);
      // Sales are posted per invoice, not per item, so the money reports refuse an item filter.
      expect((await get(`/reports/sales-by-customer?itemId=${w.itemId}`)).statusCode).toBe(400);
      // The returns report IS per item, so it accepts one.
      expect((await get(`/reports/sales-returns?itemId=${w.itemId}`)).statusCode).toBe(200);
      // Bad dates and unknown filters are refused everywhere.
      expect((await get("/reports/sales-by-customer?fromDate=10-05-2026")).statusCode).toBe(400);
      expect((await get("/reports/sales-by-customer?fromDate=2026-02-30")).statusCode).toBe(400);
      expect((await get("/reports/transactions?nonsense=1")).statusCode).toBe(400);
      expect((await get("/reports/sales-by-customer?fromDate=2026-07-01&toDate=2026-06-01")).statusCode).toBe(400);
    } finally {
      w.repository.close();
    }
  });

  it("reports the returns, and what each credit note still owes back", async () => {
    const w = books();
    try {
      const get = api(w);
      const returns = (await get("/reports/sales-returns"))
        .json<{ rows: Array<{ creditNoteNumber: string; valuePaise: number }>;
                byItem: Array<{ itemName: string; quantity: number; valuePaise: number }>;
                totalValuePaise: number }>();
      expect(returns.totalValuePaise).toBe(20000);
      expect(returns.rows.map((row) => row.creditNoteNumber)).toEqual(["CN-1"]);
      expect(returns.byItem).toEqual([{ itemId: w.itemId, itemName: "Novel", quantity: 1, valuePaise: 20000, creditNoteCount: 1 }]);

      const notes = (await get("/reports/credit-notes"))
        .json<{ rows: Array<{ number: string; valuePaise: number; outstandingPaise: number }> }>();
      expect(notes.rows).toHaveLength(1);
      expect(notes.rows[0]?.number).toBe("CN-1");
      expect(notes.rows[0]?.valuePaise).toBe(20000);
    } finally {
      w.repository.close();
    }
  });
});

describe("R7b: the General Ledger shows the transaction date, not when it was posted", () => {
  it("dates a back-dated entry by its own date, and keeps the posting instant separately", async () => {
    const w = setup();
    try {
      // Dated well in the past; it is being posted right now.
      w.repository.saveDraft(invoice(w, "OLD", { date: "2020-01-15", paise: 50000 }));
      w.repository.finalizeInvoice("OLD");

      const rows = w.repository.getGeneralLedger();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        // What a ledger column called "Date" must show.
        expect(row.entryDate).toBe("2020-01-15");
        // ...and the posting instant, which is a full timestamp and is NOT that date.
        expect(row.postedAt.slice(0, 10)).not.toBe("2020-01-15");
        expect(row.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }

      // Over HTTP too, since that is how the app reads it.
      const get = api(w);
      const overHttp = (await get("/reports/general-ledger")).json<Array<{ entryDate: string; postedAt: string }>>();
      expect(overHttp.length).toBe(rows.length);
      expect(overHttp.every((row) => row.entryDate === "2020-01-15")).toBe(true);
      // The misleading name is gone: nothing called "date" is a posting timestamp any more.
      expect(Object.keys(overHttp[0] ?? {})).not.toContain("date");
    } finally {
      w.repository.close();
    }
  });
});
