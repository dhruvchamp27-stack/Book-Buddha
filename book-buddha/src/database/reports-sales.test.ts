import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postJournalEntry } from "./ledger.js";
import { AccountingRepository } from "./repository.js";
import {
  creditNoteReport, salesByBusiness, salesByCustomer, salesByFair, salesByTax, salesReturnReport,
} from "./reports-sales.js";

/**
 * R7 part one: the sales and credit-note reports. Money is paise (Rs 1 = 100 paise).
 *
 * THE WORKED WORLD (Rs):
 *   INV1  Alpha School  Books A  Fair One  10 Jan   1,000   no GST
 *   INV2  Beta School   Books A  Fair Two  10 Feb     500   no GST
 *   INV3  Alpha School  Books B  (no fair) 10 Mar     200   no GST
 *   INV4  Alpha School  Books A  Fair One  20 Jan   1,000 + 18% CGST/SGST (GST 180)
 *   CN1   on INV1, finalized 15 Feb, returns 300 (no GST)
 *   CN2   on INV4, finalized 20 Feb, returns 200 + 36 GST
 * Net sales (invoiced less credit notes): 1,000+500+200+1,000 - 300 - 200 = 2,200. GST kept: 180 - 36 = 144.
 *
 * Only `Date` is faked (never timers), because credit notes are dated from the clock at finalize.
 */
const PAISE = (rupees: number): number => rupees * 100;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T06:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function world() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const bizA = repository.createBusiness({ companyId, name: "Books A" });
  const bizB = repository.createBusiness({ companyId, name: "Books B" });
  const alpha = repository.createCustomer({ companyId, name: "Alpha School" });
  const beta = repository.createCustomer({ companyId, name: "Beta School" });
  const itemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: false });
  const fair1 = repository.createFair({ companyId, hostCustomerId: alpha, name: "Fair One" });
  const fair2 = repository.createFair({ companyId, hostCustomerId: beta, name: "Fair Two" });
  const invoice = (o: {
    id: string; businessId: string; customerId: string; fairId?: string; date: string; rupees: number; gst?: boolean;
  }): void => {
    repository.saveDraft({
      id: o.id, number: o.id, businessId: o.businessId, customerId: o.customerId, invoiceDate: o.date,
      status: "DRAFT", paymentAccount: "RECEIVABLES",
      taxType: o.gst === true ? "CGST_SGST" : "NONE", taxRateBasisPoints: o.gst === true ? 1800 : 0,
      ...(o.fairId === undefined ? {} : { fairId: o.fairId }),
      lines: [{ itemId, description: "Atlas", quantity: 1, unitPricePaise: PAISE(o.rupees) }],
    });
    repository.finalizeInvoice(o.id);
  };
  const note = (id: string, invoiceId: string, rupees: number, on: string): void => {
    vi.setSystemTime(new Date(`${on}T06:00:00.000Z`));
    repository.saveCreditNote({
      id, invoiceId, number: id, reason: "Return", status: "DRAFT",
      lines: [{ itemId, description: "Returned", quantity: 1, unitPricePaise: PAISE(rupees) }],
    });
    repository.finalizeCreditNote(id);
  };
  invoice({ id: "INV1", businessId: bizA, customerId: alpha, fairId: fair1, date: "2026-01-10", rupees: 1000 });
  invoice({ id: "INV4", businessId: bizA, customerId: alpha, fairId: fair1, date: "2026-01-20", rupees: 1000, gst: true });
  invoice({ id: "INV2", businessId: bizA, customerId: beta, fairId: fair2, date: "2026-02-10", rupees: 500 });
  invoice({ id: "INV3", businessId: bizB, customerId: alpha, date: "2026-03-10", rupees: 200 });
  note("CN1", "INV1", 300, "2026-02-15");
  note("CN2", "INV4", 200, "2026-02-20");
  return { repository, companyId, bizA, bizB, alpha, beta, fair1, fair2, itemId };
}

/** Wraps a database so every SELECT is recorded with its bound parameters and the rows SQLite handed back. */
function spy(db: Database.Database) {
  const log: Array<{ sql: string; params: unknown[]; rows: number }> = [];
  const bindIfFunction = (target: object, prop: string | symbol): unknown => {
    const value = Reflect.get(target, prop) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  };
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop !== "prepare") return bindIfFunction(target, prop);
      return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(st, p) {
            if (p === "all") {
              return (...params: unknown[]) => {
                const rows = st.all(...params);
                log.push({ sql, params, rows: rows.length });
                return rows;
              };
            }
            return bindIfFunction(st, p);
          },
        });
      };
    },
  });
  return { db: proxy as Database.Database, log };
}

const net = (rows: ReadonlyArray<{ netSalesPaise: number }>): number => rows.reduce((t, r) => t + r.netSalesPaise, 0);

describe("salesByCustomer", () => {
  it("nets credit notes off each customer's invoiced sales, with counts", () => {
    const w = world();
    const { rows, totals } = salesByCustomer(w.repository.db);
    expect(rows).toEqual([
      { customerId: w.alpha, customerName: "Alpha School", invoicedPaise: PAISE(2200), creditNotesPaise: PAISE(500), netSalesPaise: PAISE(1700), invoiceCount: 3, creditNoteCount: 2 },
      { customerId: w.beta, customerName: "Beta School", invoicedPaise: PAISE(500), creditNotesPaise: 0, netSalesPaise: PAISE(500), invoiceCount: 1, creditNoteCount: 0 },
    ]);
    expect(totals).toEqual({ invoicedPaise: PAISE(2700), creditNotesPaise: PAISE(500), netSalesPaise: PAISE(2200), invoiceCount: 4, creditNoteCount: 2 });
    // The report and the ledger can never disagree: it ties to accrual P&L income.
    expect(totals.netSalesPaise).toBe(w.repository.getProfitAndLoss({ basis: "ACCRUAL" }).totalIncomePaise);
  });

  it("each filter narrows the result; omitting every filter keeps untagged rows", () => {
    const w = world();
    const by = (f: Parameters<typeof salesByCustomer>[1]) => salesByCustomer(w.repository.db, f).rows.map((r) => [r.customerName, r.netSalesPaise]);
    expect(by({})).toEqual([["Alpha School", PAISE(1700)], ["Beta School", PAISE(500)]]);
    // Books A: INV1 + INV4 - both notes; Beta's INV2. INV3 (Books B) is gone.
    expect(by({ businessId: w.bizA })).toEqual([["Alpha School", PAISE(1500)], ["Beta School", PAISE(500)]]);
    expect(by({ businessId: w.bizB })).toEqual([["Alpha School", PAISE(200)]]);
    expect(by({ fairId: w.fair1 })).toEqual([["Alpha School", PAISE(1500)]]);
    expect(by({ fairId: w.fair2 })).toEqual([["Beta School", PAISE(500)]]);
    expect(by({ customerId: w.beta })).toEqual([["Beta School", PAISE(500)]]);
    // From 1 Feb: INV3 200 invoiced, both notes 500 credited -> Alpha is NEGATIVE 300; Beta 500.
    expect(by({ fromDate: "2026-02-01" })).toEqual([["Alpha School", -PAISE(300)], ["Beta School", PAISE(500)]]);
    // To 31 Jan: only INV1 and INV4, before any note.
    expect(by({ toDate: "2026-01-31" })).toEqual([["Alpha School", PAISE(2000)]]);
    // Bounds are inclusive.
    expect(by({ fromDate: "2026-02-15", toDate: "2026-02-15" })).toEqual([["Alpha School", -PAISE(300)]]);
  });

  it("refuses a reversed range and an impossible date, in the existing wording", () => {
    const w = world();
    expect(() => salesByCustomer(w.repository.db, { fromDate: "2026-03-01", toDate: "2026-02-01" })).toThrow("From date cannot be after the to date.");
    expect(() => salesByCustomer(w.repository.db, { fromDate: "2026-02-30" })).toThrow("From date must be a real date written as YYYY-MM-DD.");
  });

  it("applies the filter in SQL: excluded rows never leave SQLite", () => {
    const w = world();
    const unfiltered = net(salesByCustomer(w.repository.db).rows);
    const probe = spy(w.repository.db);
    const filtered = salesByCustomer(probe.db, { fairId: w.fair2 });
    expect(net(filtered.rows)).toBe(PAISE(500));
    expect(net(filtered.rows)).not.toBe(unfiltered);
    const query = probe.log.find((entry) => entry.sql.includes("journal_lines"));
    expect(query?.sql).toContain("je.fair_id = ?");
    expect(query?.params).toContain(w.fair2);
    // SQLite returned exactly the rows the report shows - nothing was fetched and then dropped.
    expect(query?.rows).toBe(filtered.rows.length);
  });

  it("refuses an item filter instead of silently ignoring it", () => {
    const w = world();
    expect(() => salesByCustomer(w.repository.db, { itemId: w.itemId } as never)).toThrow(/item/i);
  });

  it("picks up a USER-CREATED income account (the hardcoded-code-list trap)", () => {
    const w = world();
    w.repository.createAccount({ companyId: w.companyId, code: "BOOK_FAIR_INCOME", name: "Book Fair Income", type: "INCOME" });
    // No invoice path posts to a user income account today, so the entry goes through the posting
    // door: Rs 100 of Beta's Fair Two sale booked to the new account instead of SALES.
    postJournalEntry(w.repository.db, {
      id: "je-manual-1", sourceId: "INV2", description: "Reclass", isReversal: false,
      lines: [
        { account: "RECEIVABLES", debitPaise: PAISE(100), creditPaise: 0 },
        { account: "BOOK_FAIR_INCOME", debitPaise: 0, creditPaise: PAISE(100) },
      ],
    }, { businessId: w.bizA, entryDate: "2026-02-12", fairId: w.fair2 });
    const customers = salesByCustomer(w.repository.db).rows;
    expect(customers.find((r) => r.customerId === w.beta)).toMatchObject({ netSalesPaise: PAISE(600), invoiceCount: 1 });
    expect(salesByBusiness(w.repository.db).rows.find((r) => r.businessId === w.bizA)?.netSalesPaise).toBe(PAISE(2100));
    // A code list of ['SALES'] would have stopped at 2,200 here.
    const total = net(customers);
    expect(total).toBe(PAISE(2300));
    expect(total).toBe(w.repository.getProfitAndLoss({ basis: "ACCRUAL" }).totalIncomePaise);
  });

  it("shows income whose invoice cannot be found as its own row rather than dropping it", () => {
    const w = world();
    postJournalEntry(w.repository.db, {
      id: "je-orphan", sourceId: "NO-SUCH-INVOICE", description: "Orphan", isReversal: false,
      lines: [
        { account: "CASH", debitPaise: PAISE(50), creditPaise: 0 },
        { account: "SALES", debitPaise: 0, creditPaise: PAISE(50) },
      ],
    }, { businessId: w.bizA, entryDate: "2026-03-01" });
    const rows = salesByCustomer(w.repository.db).rows;
    expect(rows.find((r) => r.customerId === null)).toMatchObject({ customerName: "(Unknown customer)", netSalesPaise: PAISE(50), invoiceCount: 0 });
    expect(net(rows)).toBe(w.repository.getProfitAndLoss({ basis: "ACCRUAL" }).totalIncomePaise);
  });

  it("drops a cancelled invoice from the count and nets its sales to nothing", () => {
    const w = world();
    w.repository.cancelInvoice("INV2");
    const beta = salesByCustomer(w.repository.db).rows.find((r) => r.customerId === w.beta);
    expect(beta).toMatchObject({ netSalesPaise: 0, invoiceCount: 0 });
  });
});

describe("salesByBusiness", () => {
  it("nets per business", () => {
    const w = world();
    const { rows, totals } = salesByBusiness(w.repository.db);
    expect(rows).toEqual([
      { businessId: w.bizA, businessName: "Books A", invoicedPaise: PAISE(2500), creditNotesPaise: PAISE(500), netSalesPaise: PAISE(2000), invoiceCount: 3, creditNoteCount: 2 },
      { businessId: w.bizB, businessName: "Books B", invoicedPaise: PAISE(200), creditNotesPaise: 0, netSalesPaise: PAISE(200), invoiceCount: 1, creditNoteCount: 0 },
    ]);
    expect(totals.netSalesPaise).toBe(PAISE(2200));
  });

  it("each filter narrows it; no filter keeps untagged-fair sales", () => {
    const w = world();
    const by = (f: Parameters<typeof salesByBusiness>[1]) => salesByBusiness(w.repository.db, f).rows.map((r) => [r.businessName, r.netSalesPaise]);
    expect(by({})).toEqual([["Books A", PAISE(2000)], ["Books B", PAISE(200)]]);
    expect(by({ fairId: w.fair1 })).toEqual([["Books A", PAISE(1500)]]);
    expect(by({ customerId: w.beta })).toEqual([["Books A", PAISE(500)]]);
    expect(by({ businessId: w.bizB })).toEqual([["Books B", PAISE(200)]]);
    expect(by({ fromDate: "2026-03-01" })).toEqual([["Books B", PAISE(200)]]);
    expect(by({ toDate: "2026-01-31" })).toEqual([["Books A", PAISE(2000)]]);
  });

  it("applies the filter in SQL", () => {
    const w = world();
    const probe = spy(w.repository.db);
    const filtered = salesByBusiness(probe.db, { businessId: w.bizB, fromDate: "2026-03-01" });
    expect(net(filtered.rows)).toBe(PAISE(200));
    const query = probe.log.find((entry) => entry.sql.includes("journal_lines"));
    expect(query?.sql).toContain("je.business_id = ?");
    expect(query?.sql).toContain("je.entry_date >= ?");
    expect(query?.rows).toBe(filtered.rows.length);
  });
});

describe("salesByFair", () => {
  it("shows untagged sales as their own row", () => {
    const w = world();
    const { rows, totals } = salesByFair(w.repository.db);
    expect(rows).toEqual([
      { fairId: w.fair1, fairName: "Fair One", invoicedPaise: PAISE(2000), creditNotesPaise: PAISE(500), netSalesPaise: PAISE(1500), invoiceCount: 2, creditNoteCount: 2 },
      { fairId: w.fair2, fairName: "Fair Two", invoicedPaise: PAISE(500), creditNotesPaise: 0, netSalesPaise: PAISE(500), invoiceCount: 1, creditNoteCount: 0 },
      { fairId: null, fairName: "(No fair)", invoicedPaise: PAISE(200), creditNotesPaise: 0, netSalesPaise: PAISE(200), invoiceCount: 1, creditNoteCount: 0 },
    ]);
    expect(totals.netSalesPaise).toBe(PAISE(2200));
  });

  it("each filter narrows it; omitting fairId returns the untagged row", () => {
    const w = world();
    const by = (f: Parameters<typeof salesByFair>[1]) => salesByFair(w.repository.db, f).rows.map((r) => [r.fairName, r.netSalesPaise]);
    expect(by({ fairId: w.fair1 })).toEqual([["Fair One", PAISE(1500)]]);
    expect(by({ businessId: w.bizB })).toEqual([["(No fair)", PAISE(200)]]);
    expect(by({ customerId: w.beta })).toEqual([["Fair Two", PAISE(500)]]);
    expect(by({ fromDate: "2026-02-01", toDate: "2026-02-28" })).toEqual([["Fair One", -PAISE(500)], ["Fair Two", PAISE(500)]]);
    expect(by({})).toHaveLength(3);
  });

  it("applies the filter in SQL", () => {
    const w = world();
    const probe = spy(w.repository.db);
    const filtered = salesByFair(probe.db, { customerId: w.beta });
    expect(net(filtered.rows)).toBe(PAISE(500));
    const query = probe.log.find((entry) => entry.sql.includes("journal_lines"));
    expect(query?.sql).toContain("customer_id = ?");
    expect(query?.params).toContain(w.beta);
    expect(query?.rows).toBe(filtered.rows.length);
  });
});

describe("salesByTax", () => {
  it("groups taxable value and GST by tax treatment, netting credit notes, so it ties to a GST return", () => {
    const w = world();
    const { rows, totals } = salesByTax(w.repository.db);
    expect(rows).toEqual([
      { taxType: "CGST_SGST", taxRateBasisPoints: 1800, invoicedPaise: PAISE(1000), creditNotesPaise: PAISE(200), netSalesPaise: PAISE(800), invoiceCount: 1, creditNoteCount: 1, taxInvoicedPaise: PAISE(180), taxCreditNotesPaise: PAISE(36), taxPaise: PAISE(144) },
      { taxType: "NONE", taxRateBasisPoints: 0, invoicedPaise: PAISE(1700), creditNotesPaise: PAISE(300), netSalesPaise: PAISE(1400), invoiceCount: 3, creditNoteCount: 1, taxInvoicedPaise: 0, taxCreditNotesPaise: 0, taxPaise: 0 },
    ]);
    expect(totals.netSalesPaise).toBe(PAISE(2200));
    const pnl = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
    expect(totals.netSalesPaise).toBe(pnl.totalIncomePaise);
    expect(rows.reduce((t, r) => t + r.taxPaise, 0)).toBe(pnl.gstOnSalesPaise);
  });

  it("each filter narrows it; omitting every filter returns everything", () => {
    const w = world();
    const by = (f: Parameters<typeof salesByTax>[1]) => salesByTax(w.repository.db, f).rows.map((r) => [r.taxType, r.netSalesPaise, r.taxPaise]);
    expect(by({ businessId: w.bizB })).toEqual([["NONE", PAISE(200), 0]]);
    expect(by({ fairId: w.fair1 })).toEqual([["CGST_SGST", PAISE(800), PAISE(144)], ["NONE", PAISE(700), 0]]);
    expect(by({ customerId: w.beta })).toEqual([["NONE", PAISE(500), 0]]);
    expect(by({ fromDate: "2026-02-01", toDate: "2026-02-28" })).toEqual([["CGST_SGST", -PAISE(200), -PAISE(36)], ["NONE", PAISE(200), 0]]);
    expect(by({})).toHaveLength(2);
  });

  it("applies the filter in SQL", () => {
    const w = world();
    const probe = spy(w.repository.db);
    const filtered = salesByTax(probe.db, { toDate: "2026-01-31" });
    expect(net(filtered.rows)).toBe(PAISE(2000));
    const query = probe.log.find((entry) => entry.sql.includes("journal_lines"));
    expect(query?.sql).toContain("je.entry_date <= ?");
    expect(query?.rows).toBe(filtered.rows.length);
  });
});

/**
 * THE CREDIT-NOTE WORLD (Rs). Invoice X (Books A, Alpha, Fair One, Atlas 4 x 250 = 1,000) is paid 700 on 15 Jan.
 *   CN-1 (10 Feb) returns 2 Atlas = 500: only 300 was still owed, so 300 offsets the bill and 200 is refundable.
 *        Refunded 100 (12 Feb), applied 50 to invoice Y (12 Feb) -> still outstanding 50.
 *   Invoice Y (Books A, Alpha, Fair One, Banyan 4 x 100 = 400).  CN-2 (5 Mar) returns 1 Banyan = 100: all offset.
 *   Invoice Z (Books B, Beta, no fair, Atlas 4 x 100 = 400).  CN-3 (10 Mar) returns 2 Atlas = 200, all offset.
 *        CN-4 (11 Mar) returns 1 Atlas = 100 and is cancelled on 12 Mar.
 */
function noteWorld() {
  vi.setSystemTime(new Date("2026-01-05T06:00:00.000Z"));
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const bizA = repository.createBusiness({ companyId, name: "Books A" });
  const bizB = repository.createBusiness({ companyId, name: "Books B" });
  const alpha = repository.createCustomer({ companyId, name: "Alpha School" });
  const beta = repository.createCustomer({ companyId, name: "Beta School" });
  const atlas = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: false });
  const banyan = repository.createItem({ companyId, name: "Banyan", unit: "each", trackStock: false });
  const fair1 = repository.createFair({ companyId, hostCustomerId: alpha, name: "Fair One" });
  const invoice = (id: string, businessId: string, customerId: string, itemId: string, unit: number, date: string, fairId?: string): void => {
    repository.saveDraft({
      id, number: id, businessId, customerId, invoiceDate: date, status: "DRAFT", paymentAccount: "RECEIVABLES",
      taxType: "NONE", taxRateBasisPoints: 0, ...(fairId === undefined ? {} : { fairId }),
      lines: [{ itemId, description: "Goods", quantity: 4, unitPricePaise: PAISE(unit) }],
    });
    repository.finalizeInvoice(id);
  };
  const note = (id: string, invoiceId: string, itemId: string, quantity: number, unit: number, on: string): void => {
    vi.setSystemTime(new Date(`${on}T06:00:00.000Z`));
    repository.saveCreditNote({
      id, invoiceId, number: id, reason: "Return", status: "DRAFT",
      lines: [{ itemId, description: "Returned", quantity, unitPricePaise: PAISE(unit) }],
    });
    repository.finalizeCreditNote(id);
  };
  invoice("X", bizA, alpha, atlas, 250, "2026-01-10", fair1);
  repository.recordPayment("X", PAISE(700), "2026-01-15");
  invoice("Y", bizA, alpha, banyan, 100, "2026-02-11", fair1);
  invoice("Z", bizB, beta, atlas, 100, "2026-02-12");
  note("CN-1", "X", atlas, 2, 250, "2026-02-10");
  repository.recordCreditNoteRefund({ id: "R1", creditNoteId: "CN-1", amountPaise: PAISE(100), refundedOn: "2026-02-12", paymentAccount: "CASH" });
  repository.applyCreditNote({ id: "A1", creditNoteId: "CN-1", invoiceId: "Y", amountPaise: PAISE(50), appliedOn: "2026-02-12" });
  note("CN-2", "Y", banyan, 1, 100, "2026-03-05");
  note("CN-3", "Z", atlas, 2, 100, "2026-03-10");
  note("CN-4", "Z", atlas, 1, 100, "2026-03-11");
  vi.setSystemTime(new Date("2026-03-12T06:00:00.000Z"));
  repository.cancelCreditNote("CN-4");
  return { repository, bizA, bizB, alpha, beta, atlas, banyan, fair1 };
}

describe("creditNoteReport", () => {
  it("reports each note's value and how it was discharged, from the stored split", () => {
    const w = noteWorld();
    const { rows, totals } = creditNoteReport(w.repository.db);
    const pick = (r: (typeof rows)[number]) => [r.number, r.status, r.date, r.invoiceNumber, r.customerName, r.valuePaise, r.offsetPaise, r.refundedPaise, r.appliedPaise, r.outstandingPaise];
    expect(rows.map(pick)).toEqual([
      ["CN-1", "FINALIZED", "2026-02-10", "X", "Alpha School", PAISE(500), PAISE(300), PAISE(100), PAISE(50), PAISE(50)],
      ["CN-2", "FINALIZED", "2026-03-05", "Y", "Alpha School", PAISE(100), PAISE(100), 0, 0, 0],
      ["CN-3", "FINALIZED", "2026-03-10", "Z", "Beta School", PAISE(200), PAISE(200), 0, 0, 0],
      ["CN-4", "CANCELLED", "2026-03-11", "Z", "Beta School", PAISE(100), PAISE(100), 0, 0, 0],
    ]);
    expect(rows[0]).toMatchObject({ refundablePaise: PAISE(200), taxablePaise: PAISE(500), taxPaise: 0, businessId: w.bizA, fairId: w.fair1 });
    // The outstanding figure agrees with the repository's own sub-ledger for every note.
    for (const row of rows) {
      expect(row.outstandingPaise).toBe(w.repository.getCreditNoteBalance(row.creditNoteId).outstandingPaise);
    }
    // The totals leave the cancelled CN-4 out: its entries were reversed, so it is no longer a credit.
    expect(totals).toEqual({ valuePaise: PAISE(800), offsetPaise: PAISE(600), refundedPaise: PAISE(100), appliedPaise: PAISE(50), outstandingPaise: PAISE(50) });
  });

  it("each filter narrows it; omitting every filter returns the untagged note too", () => {
    const w = noteWorld();
    const by = (f: Parameters<typeof creditNoteReport>[1]) => creditNoteReport(w.repository.db, f).rows.map((r) => r.number);
    expect(by({})).toEqual(["CN-1", "CN-2", "CN-3", "CN-4"]);
    expect(by({ businessId: w.bizB })).toEqual(["CN-3", "CN-4"]);
    expect(by({ fairId: w.fair1 })).toEqual(["CN-1", "CN-2"]);
    expect(by({ customerId: w.beta })).toEqual(["CN-3", "CN-4"]);
    expect(by({ itemId: w.banyan })).toEqual(["CN-2"]);
    expect(by({ fromDate: "2026-03-01" })).toEqual(["CN-2", "CN-3", "CN-4"]);
    expect(by({ toDate: "2026-02-28" })).toEqual(["CN-1"]);
  });

  it("applies the filter in SQL", () => {
    const w = noteWorld();
    const probe = spy(w.repository.db);
    const filtered = creditNoteReport(probe.db, { itemId: w.banyan });
    expect(filtered.totals.valuePaise).toBe(PAISE(100));
    const query = probe.log.find((entry) => entry.sql.includes("credit_notes"));
    expect(query?.sql).toContain("credit_note_lines");
    expect(query?.params).toContain(w.banyan);
    expect(query?.rows).toBe(filtered.rows.length);
  });
});

describe("salesReturnReport", () => {
  it("lists the returns per item, leaving out a cancelled note", () => {
    const w = noteWorld();
    const report = salesReturnReport(w.repository.db);
    expect(report.rows.map((r) => [r.creditNoteNumber, r.date, r.invoiceNumber, r.itemName, r.quantity, r.unitPricePaise, r.valuePaise])).toEqual([
      ["CN-1", "2026-02-10", "X", "Atlas", 2, PAISE(250), PAISE(500)],
      ["CN-2", "2026-03-05", "Y", "Banyan", 1, PAISE(100), PAISE(100)],
      ["CN-3", "2026-03-10", "Z", "Atlas", 2, PAISE(100), PAISE(200)],
    ]);
    expect(report.byItem).toEqual([
      { itemId: w.atlas, itemName: "Atlas", quantity: 4, valuePaise: PAISE(700), creditNoteCount: 2 },
      { itemId: w.banyan, itemName: "Banyan", quantity: 1, valuePaise: PAISE(100), creditNoteCount: 1 },
    ]);
    expect(report.totalValuePaise).toBe(PAISE(800));
  });

  it("each filter narrows it; omitting every filter returns everything", () => {
    const w = noteWorld();
    const by = (f: Parameters<typeof salesReturnReport>[1]) => salesReturnReport(w.repository.db, f).rows.map((r) => r.creditNoteNumber);
    expect(by({})).toEqual(["CN-1", "CN-2", "CN-3"]);
    expect(by({ itemId: w.atlas })).toEqual(["CN-1", "CN-3"]);
    expect(by({ customerId: w.beta })).toEqual(["CN-3"]);
    expect(by({ businessId: w.bizA })).toEqual(["CN-1", "CN-2"]);
    expect(by({ fairId: w.fair1 })).toEqual(["CN-1", "CN-2"]);
    expect(by({ fromDate: "2026-03-01", toDate: "2026-03-07" })).toEqual(["CN-2"]);
  });

  it("applies the filter in SQL: the byItem totals move with the filter", () => {
    const w = noteWorld();
    const probe = spy(w.repository.db);
    const filtered = salesReturnReport(probe.db, { customerId: w.beta });
    expect(filtered.totalValuePaise).toBe(PAISE(200));
    expect(filtered.byItem).toEqual([{ itemId: w.atlas, itemName: "Atlas", quantity: 2, valuePaise: PAISE(200), creditNoteCount: 1 }]);
    const queries = probe.log.filter((entry) => entry.sql.includes("credit_note_lines"));
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(query.params).toContain(w.beta);
  });
});
