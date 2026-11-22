import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";
import type { AgeingReport } from "./repository.js";
import type { Invoice } from "../accounting/types.js";
import { todayAt } from "./test-clock.js";

/**
 * R7b — ageing of what is owed, and the filters the open-item reports never had.
 *
 * Both ageing reports read the SAME open-items query as getReceivables / getPayables and
 * getOpenCustomerItems / getOpenSupplierItems, so what is outstanding has one definition. The
 * tie-out tests below check that against the control account on the ledger, which is the thing
 * that would actually catch a second definition drifting.
 *
 * Every date here is chosen to land exactly ON a band boundary, measured from 2026-07-01:
 *
 *   INV-30  2026-06-01   30 days  -> 0-30        10000
 *   INV-31  2026-05-31   31 days  -> 31-60       20000
 *   INV-60  2026-05-02   60 days  -> 31-60       30000
 *   INV-61  2026-05-01   61 days  -> 61-90       40000
 *   INV-91  2026-04-01   91 days  -> Over 90     50000
 *
 * So the bands hold 10000 / 50000 / 40000 / 50000 and the total is 150000.
 */

const AS_AT = "2026-07-01";

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  otherBusinessId: string;
  customerId: string;
  otherCustomerId: string;
  supplierId: string;
  itemId: string;
}

function setup(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2026-01-01"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const otherBusinessId = repository.createBusiness({ companyId, name: "Stationery" });
  const customerId = repository.createCustomer({ companyId, name: "Asha" });
  const otherCustomerId = repository.createCustomer({ companyId, name: "Biju" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: false });
  return { repository, companyId, businessId, otherBusinessId, customerId, otherCustomerId, supplierId, itemId };
}

function invoice(w: World, id: string, date: string, paise: number, opts: { businessId?: string; customerId?: string } = {}): Invoice {
  return {
    id, number: id,
    businessId: opts.businessId ?? w.businessId,
    customerId: opts.customerId ?? w.customerId,
    invoiceDate: date,
    status: "DRAFT",
    paymentAccount: "RECEIVABLES",
    taxType: "NONE",
    taxRateBasisPoints: 0,
    lines: [{ itemId: w.itemId, description: "Novel", quantity: 1, unitPricePaise: paise }],
  };
}

const ON_THE_BOUNDARY = [
  ["INV-30", "2026-06-01", 10000],
  ["INV-31", "2026-05-31", 20000],
  ["INV-60", "2026-05-02", 30000],
  ["INV-61", "2026-05-01", 40000],
  ["INV-91", "2026-04-01", 50000],
] as const;

function books(): World {
  const w = setup();
  for (const [id, date, paise] of ON_THE_BOUNDARY) {
    w.repository.saveDraft(invoice(w, id, date, paise));
    w.repository.finalizeInvoice(id);
  }
  return w;
}

/** The RECEIVABLES (or PAYABLES) control balance straight off the journal, as a positive figure. */
function controlBalancePaise(repository: AccountingRepository, account: "RECEIVABLES" | "PAYABLES"): number {
  const row = repository.db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS balance
         FROM journal_lines jl WHERE jl.account = ?`,
    )
    .get(account) as { balance: number };
  return account === "RECEIVABLES" ? row.balance : -row.balance;
}

const amounts = (report: AgeingReport): number[] => report.buckets.map((bucket) => bucket.outstandingPaise);
const counts = (report: AgeingReport): number[] => report.buckets.map((bucket) => bucket.documentCount);

describe("R7b: ageing of what customers owe", () => {
  it("puts each document in the band its age actually falls in, on the boundary", () => {
    const w = books();
    try {
      const report = w.repository.getReceivablesAgeing({ asAtDate: AS_AT });
      expect(report.asAtDate).toBe(AS_AT);
      expect(report.buckets.map((bucket) => bucket.label))
        .toEqual(["0-30 days", "31-60 days", "61-90 days", "Over 90 days"]);
      // 30 days is the last day of the first band, 31 the first of the second, and so on.
      expect(amounts(report)).toEqual([10000, 50000, 40000, 50000]);
      expect(counts(report)).toEqual([1, 2, 1, 1]);
      expect(report.totalOutstandingPaise).toBe(150000);

      // One customer here, so the party row carries the whole lot.
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]?.partyName).toBe("Asha");
      expect(report.rows[0]?.outstandingPaise).toBe(150000);
      expect(report.rows[0]?.buckets.map((b) => b.outstandingPaise)).toEqual([10000, 50000, 40000, 50000]);
    } finally {
      w.repository.close();
    }
  });

  it("ties to the receivables control account on the ledger", () => {
    const w = books();
    try {
      // Nothing is paid yet, so everything invoiced is still outstanding and the two must agree.
      const report = w.repository.getReceivablesAgeing({ asAtDate: AS_AT });
      expect(report.totalOutstandingPaise).toBe(controlBalancePaise(w.repository, "RECEIVABLES"));
      expect(report.totalOutstandingPaise).toBe(150000);

      // Pay one off in full and one in part; the ageing must follow the ledger, not the invoice.
      w.repository.recordPayment("INV-91", 50000);
      w.repository.recordPayment("INV-61", 15000);

      const after = w.repository.getReceivablesAgeing({ asAtDate: AS_AT });
      expect(after.totalOutstandingPaise).toBe(controlBalancePaise(w.repository, "RECEIVABLES"));
      expect(after.totalOutstandingPaise).toBe(85000); // 150000 - 50000 - 15000
      // The settled invoice drops out of its band entirely; the part-paid one stays at its balance.
      expect(amounts(after)).toEqual([10000, 50000, 25000, 0]);
      expect(counts(after)).toEqual([1, 2, 1, 0]);
    } finally {
      w.repository.close();
    }
  });

  it("ages against the date it is given, not against the clock", () => {
    const w = books();
    try {
      // A month later every document is a month older, so the money moves down the bands.
      // Ages from 2026-08-01 are 61, 62, 91, 92 and 122 days, so the first two bands empty out.
      const later = w.repository.getReceivablesAgeing({ asAtDate: "2026-08-01" });
      expect(later.asAtDate).toBe("2026-08-01");
      expect(later.totalOutstandingPaise).toBe(150000); // nothing paid: the total cannot move
      expect(amounts(later)).toEqual([0, 0, 30000, 120000]);
      expect(counts(later)).toEqual([0, 0, 2, 3]);

      // Asked as at a date before any of them was raised, none of them is owed yet: a document
      // dated later did not exist then. This used to list them all at nil days old.
      const before = w.repository.getReceivablesAgeing({ asAtDate: "2026-01-01" });
      expect(before.totalOutstandingPaise).toBe(0);
      expect(amounts(before)).toEqual([0, 0, 0, 0]);
      expect(before.rows).toEqual([]);

      // Exactly on the oldest document's own date it is one day inside the first band at nil days.
      const onTheDay = w.repository.getReceivablesAgeing({ asAtDate: "2026-04-01" });
      expect(onTheDay.totalOutstandingPaise).toBe(50000); // INV-91 alone
      expect(amounts(onTheDay)).toEqual([50000, 0, 0, 0]);

      // BUT a document is only dropped when a date was actually ASKED for. With no as-at date
      // the question is "what is owed now", and an invoice dated tomorrow is owed now just the
      // same - dropping it would hide a real debt. Its age clamps at nil days instead.
      w.repository.saveDraft(invoice(w, "INV-FUTURE", "2099-01-01", 9000));
      w.repository.finalizeInvoice("INV-FUTURE");
      const asked = w.repository.getReceivablesAgeing({ asAtDate: AS_AT });
      expect(asked.totalOutstandingPaise).toBe(150000); // the 2099 invoice is excluded
      const notAsked = w.repository.getReceivablesAgeing();
      expect(notAsked.totalOutstandingPaise).toBe(159000); // ...and included
      expect(notAsked.buckets[0]?.outstandingPaise).toBeGreaterThanOrEqual(9000);
      // getReceivables follows exactly the same rule, so the two cannot disagree on the total.
      expect(w.repository.getReceivables({ asAtDate: AS_AT }).reduce((sum, row) => sum + row.outstandingPaise, 0))
        .toBe(asked.totalOutstandingPaise);
      expect(w.repository.getReceivables().reduce((sum, row) => sum + row.outstandingPaise, 0))
        .toBe(notAsked.totalOutstandingPaise);

      // Two calls with the same as-at date give the same answer, which is the point of passing it.
      expect(w.repository.getReceivablesAgeing({ asAtDate: AS_AT }))
        .toEqual(w.repository.getReceivablesAgeing({ asAtDate: AS_AT }));
      // A date that is not a date is refused rather than quietly treated as today.
      expect(() => w.repository.getReceivablesAgeing({ asAtDate: "01-07-2026" })).toThrow(/real date/);
      expect(() => w.repository.getReceivablesAgeing({ asAtDate: "2026-02-30" })).toThrow(/real date/);
    } finally {
      w.repository.close();
    }
  });

  it("filters by business and by customer, which it could not do before", () => {
    const w = books();
    try {
      // A second customer on a second business.
      w.repository.saveDraft(invoice(w, "INV-OTHER", "2026-06-01", 70000, {
        businessId: w.otherBusinessId, customerId: w.otherCustomerId,
      }));
      w.repository.finalizeInvoice("INV-OTHER");

      const everything = w.repository.getReceivablesAgeing({ asAtDate: AS_AT });
      expect(everything.totalOutstandingPaise).toBe(220000);
      expect(everything.rows.map((row) => row.partyName)).toEqual(["Asha", "Biju"]);

      const booksOnly = w.repository.getReceivablesAgeing({ asAtDate: AS_AT, businessId: w.businessId });
      expect(booksOnly.totalOutstandingPaise).toBe(150000);
      expect(booksOnly.rows.map((row) => row.partyName)).toEqual(["Asha"]);

      const bijuOnly = w.repository.getReceivablesAgeing({ asAtDate: AS_AT, customerId: w.otherCustomerId });
      expect(bijuOnly.totalOutstandingPaise).toBe(70000);
      expect(amounts(bijuOnly)).toEqual([70000, 0, 0, 0]);

      // getReceivables took the same filters for the first time in this slice.
      expect(w.repository.getReceivables({ businessId: w.businessId }).map((row) => row.invoiceNumber).sort())
        .toEqual(["INV-30", "INV-31", "INV-60", "INV-61", "INV-91"]);
      expect(w.repository.getReceivables({ customerId: w.otherCustomerId }).map((row) => row.invoiceNumber))
        .toEqual(["INV-OTHER"]);
      // ...and ages against a given date rather than today.
      const aged = w.repository.getReceivables({ asAtDate: AS_AT, customerId: w.customerId });
      expect(aged.find((row) => row.invoiceNumber === "INV-91")?.ageDays).toBe(91);
      expect(aged.find((row) => row.invoiceNumber === "INV-30")?.ageDays).toBe(30);
    } finally {
      w.repository.close();
    }
  });
});

describe("R7b: ageing of what is owed to suppliers", () => {
  it("mirrors the customer report and ties to the payables control account", () => {
    const w = setup();
    try {
      for (const [number, date, paise] of [["PB-30", "2026-06-01", 11000], ["PB-91", "2026-04-01", 22000]] as const) {
        const created = w.repository.createPurchaseBill({
          businessId: w.businessId, supplierId: w.supplierId, number, billDate: date,
          paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: paise }],
        });
        w.repository.finalizePurchaseBill(created.id);
      }

      const report = w.repository.getPayablesAgeing({ asAtDate: AS_AT });
      expect(report.asAtDate).toBe(AS_AT);
      // The same four bands, in the same order, from the same shared definition.
      expect(report.buckets.map((bucket) => bucket.label))
        .toEqual(["0-30 days", "31-60 days", "61-90 days", "Over 90 days"]);
      expect(amounts(report)).toEqual([11000, 0, 0, 22000]);
      expect(report.totalOutstandingPaise).toBe(33000);
      expect(report.totalOutstandingPaise).toBe(controlBalancePaise(w.repository, "PAYABLES"));
      expect(report.rows[0]?.partyName).toBe("Paper Co");

      // And the supplier filter, which getPayables also never had.
      expect(w.repository.getPayables({ supplierId: w.supplierId })).toHaveLength(2);
      expect(w.repository.getPayables({ businessId: w.otherBusinessId })).toHaveLength(0);
    } finally {
      w.repository.close();
    }
  });
});

describe("R7b: the ageing reports are reachable over HTTP", () => {
  it("answers on both routes, honours the filters, and refuses a bad date", async () => {
    const w = books();
    try {
      const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
      const get = async (url: string) => app.inject({ method: "GET", url });

      const receivables = (await get(`/reports/receivables-ageing?asAtDate=${AS_AT}`));
      expect(receivables.statusCode).toBe(200);
      const body = receivables.json<AgeingReport>();
      expect(body.totalOutstandingPaise).toBe(150000);
      expect(amounts(body)).toEqual([10000, 50000, 40000, 50000]);
      // The route is a door onto the method, not a second implementation.
      expect(body).toEqual(JSON.parse(JSON.stringify(w.repository.getReceivablesAgeing({ asAtDate: AS_AT }))));

      expect((await get(`/reports/payables-ageing?asAtDate=${AS_AT}`)).statusCode).toBe(200);
      expect((await get(`/reports/receivables?businessId=${w.businessId}&asAtDate=${AS_AT}`)).statusCode).toBe(200);
      expect((await get(`/reports/payables?asAtDate=${AS_AT}`)).statusCode).toBe(200);

      // Bad dates and filters that do not belong to the report are refused, not ignored.
      expect((await get("/reports/receivables-ageing?asAtDate=01-07-2026")).statusCode).toBe(400);
      expect((await get("/reports/receivables-ageing?supplierId=x")).statusCode).toBe(400);
      expect((await get("/reports/payables-ageing?customerId=x")).statusCode).toBe(400);
    } finally {
      w.repository.close();
    }
  });
});
