import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository } from "./repository.js";
import { existingOn, openCustomerItemRows } from "./open-items.js";
import {
  buildCollectionsReport, buildCustomerBalanceDetail, buildCustomerStatement,
  type CustomerStatement,
} from "./reports-customers.js";

/**
 * Session 12, reports 1, 2 and 3: customer statement, Customer Balance Detail and Collections.
 * Money is paise (Rs 1 = 100). Only `Date` is faked, never timers. Every database is a throwaway
 * in-memory one.
 *
 * THE HAND EXAMPLE (definitions section 1), as built here:
 *
 *   date    event                              effect     running balance
 *   31 Mar  INV-0 (the credit's source)        +5,000      5,000   } the two extra rows a
 *   31 Mar  receipt for INV-0                  -5,000          0   } real credit forces
 *    1 Apr  opening balance                   +10,000     10,000
 *    5 Apr  invoice INV-1                     +25,000     35,000
 *    7 Apr  credit note CN-1                   -5,000     30,000
 *    9 Apr  receipt                           -12,000     18,000
 *   11 Apr  receipt, later CANCELLED               0      18,000   (no row: see below)
 *   13 Apr  credit CN-0 (3,000) applied        -3,000     15,000
 *   15 Apr  credit note CN-2, later CANCELLED: note -2,000 -> 13,000, reversal +2,000 -> 15,000
 *
 * WHAT DIFFERS FROM THE TABLE, AND WHY. (1) The table's credit applied to INV-1 needs a customer
 * credit to exist, and `applyCreditNote` refuses the note's own invoice, so the credit comes from a
 * second, fully paid invoice INV-0. INV-0 and its receipt are two extra rows, dated the same day
 * so they net to nil and every tabulated balance survives. INV-0's note (CN-0) posts nothing to
 * receivables (all of it is refundable), so it has no row. (2) The table says the cancelled
 * receipt shows "both rows"; the definition's own row-type table and the brief say a cancelled
 * payment is EXCLUDED, so it has no row at all and the balance holds at 18,000 either way.
 * (3) The cancelled note's two rows net to nil as the table says, but a note and its reversal are
 * two rows, so the balance passes through 13,000 between them.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-01T06:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (isoDate: string): void => { vi.setSystemTime(new Date(`${isoDate}T06:00:00.000Z`)); };

function world() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School", email: "school@example.test", phone: "111" });
  const otherCustomerId = repository.createCustomer({ companyId, name: "Another School" });
  const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: false });
  const invoice = (
    id: string, paise: number, invoiceDate: string,
    opts: { customerId?: string; dueDate?: string; fairId?: string } = {},
  ): void => {
    repository.saveDraft({
      id, number: id.toUpperCase(), businessId, customerId: opts.customerId ?? customerId,
      paymentAccount: "RECEIVABLES", status: "DRAFT", taxType: "NONE", taxRateBasisPoints: 0, invoiceDate,
      ...(opts.dueDate === undefined ? {} : { dueDate: opts.dueDate }),
      ...(opts.fairId === undefined ? {} : { fairId: opts.fairId }),
      // 100 units, so several credit notes can each return one without exceeding the quantity sold.
      lines: [{ itemId, description: "Novel", quantity: 100, unitPricePaise: paise / 100 }],
    });
    repository.finalizeInvoice(id);
  };
  const note = (id: string, invoiceId: string, paise: number, noteDate: string): void => {
    repository.saveCreditNote({
      id, invoiceId, number: id.toUpperCase(), reason: "Return", status: "DRAFT", noteDate,
      lines: [{ itemId, description: "Returned", quantity: 1, unitPricePaise: paise }],
    });
    repository.finalizeCreditNote(id);
  };
  return { repository, companyId, businessId, customerId, otherCustomerId, itemId, invoice, note };
}
type World = ReturnType<typeof world>;

/** Runs the hand example in table order, stepping the clock with each event. */
function handExample(w: World): { cancelledPaymentId: string } {
  const r = w.repository;
  at("2026-04-01");
  w.invoice("inv0", 500000, "2026-03-31");
  r.recordPayment("inv0", 500000, "2026-03-31");
  r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: "2026-04-01", amountPaise: 1000000, incomePaise: 0 });
  at("2026-04-05");
  w.invoice("inv1", 2500000, "2026-04-05");
  at("2026-04-06");
  w.note("cn0", "inv0", 500000, "2026-04-06"); // all refundable: INV-0 owes nothing
  at("2026-04-07");
  w.note("cn1", "inv1", 500000, "2026-04-07");
  at("2026-04-09");
  r.recordPayment("inv1", 1200000, "2026-04-09");
  at("2026-04-11");
  const cancelled = r.recordPayment("inv1", 400000, "2026-04-11");
  r.cancelPayment(cancelled.id, "Cheque bounced");
  at("2026-04-13");
  r.applyCreditNote({ id: "ap1", creditNoteId: "cn0", invoiceId: "inv1", amountPaise: 300000, appliedOn: "2026-04-13" });
  at("2026-04-14");
  r.recordCreditNoteRefund({ id: "rf1", creditNoteId: "cn0", amountPaise: 100000, refundedOn: "2026-04-14", paymentAccount: "CASH" });
  at("2026-04-15");
  w.note("cn2", "inv1", 200000, "2026-04-15");
  r.cancelCreditNote("cn2");
  return { cancelledPaymentId: cancelled.id };
}

function shape(s: CustomerStatement) {
  return s.rows.map((row) => [row.date, row.type, row.reference, row.amountPaise, row.balancePaise] as const);
}

describe("customer statement", () => {
  it("HAND EXAMPLE: every running balance, and the closing Rs 15,000 that getReceivables agrees with", () => {
    const w = world();
    try {
      handExample(w);
      const s = buildCustomerStatement(w.repository.db, { customerId: w.customerId });
      expect(shape(s)).toEqual([
        ["2026-03-31", "INVOICE", "INV0", 500000, 500000],
        ["2026-03-31", "PAYMENT", "INV0", -500000, 0],
        ["2026-04-01", "OPENING", "Opening balance", 1000000, 1000000],
        ["2026-04-05", "INVOICE", "INV1", 2500000, 3500000],
        ["2026-04-07", "CREDIT_NOTE", "CN1", -500000, 3000000],
        ["2026-04-09", "PAYMENT", "INV1", -1200000, 1800000],
        ["2026-04-13", "CREDIT_APPLIED", "CN0", -300000, 1500000],
        ["2026-04-15", "CREDIT_NOTE", "CN2", -200000, 1300000],
        ["2026-04-15", "CREDIT_NOTE", "CN2", 200000, 1500000],
      ]);
      expect(s.closingBalancePaise).toBe(1500000);
      const receivables = w.repository.getReceivables({ customerId: w.customerId });
      expect(receivables.reduce((sum, row) => sum + row.outstandingPaise, 0)).toBe(1500000);
      // The tie-out the definitions name: the shared open-items query says the same.
      expect(openCustomerItemRows(w.repository.db, { customerId: w.customerId }).reduce((sum, i) => sum + i.outstandingPaise, 0)).toBe(1500000);
    } finally {
      w.repository.close();
    }
  });

  it("a cancelled receipt has no row, and INV-0's credit note (all refundable) has none either", () => {
    const w = world();
    try {
      const { cancelledPaymentId } = handExample(w);
      const s = buildCustomerStatement(w.repository.db, { customerId: w.customerId });
      expect(s.rows.some((row) => row.date === "2026-04-11")).toBe(false);
      expect(s.rows.filter((row) => row.type === "PAYMENT" && row.documentId === "inv1")).toHaveLength(1);
      expect(s.rows.some((row) => row.reference === "CN0" && row.type === "CREDIT_NOTE")).toBe(false);
      // The payment really is cancelled in the books, so the absence is the rule, not luck.
      const row = w.repository.db.prepare("SELECT cancelled_at FROM payments WHERE id = ?").get(cancelledPaymentId) as { cancelled_at: string | null };
      expect(row.cancelled_at).not.toBeNull();
    } finally {
      w.repository.close();
    }
  });

  it("TIE-OUT per document: the settlement rows under each document sum to its settledPaise", () => {
    const w = world();
    try {
      handExample(w);
      const s = buildCustomerStatement(w.repository.db, { customerId: w.customerId });
      expect(s.documents.map((d) => d.documentId).sort()).toEqual(["inv0", "inv1", "ocb1"]);
      for (const doc of s.documents) {
        const settlements = s.rows.filter((row) => row.documentId === doc.documentId && row.type !== "INVOICE" && row.type !== "OPENING");
        expect(settlements.reduce((sum, row) => sum - row.amountPaise, 0)).toBe(doc.settledPaise);
        const own = s.rows.filter((row) => row.documentId === doc.documentId && (row.type === "INVOICE" || row.type === "OPENING"));
        expect(own.map((row) => row.amountPaise)).toEqual([doc.totalPaise]);
      }
      const inv1 = s.documents.find((d) => d.documentId === "inv1");
      expect(inv1?.settledPaise).toBe(2000000); // 12,000 receipt + 3,000 credit + 5,000 note
      expect(inv1?.outstandingPaise).toBe(500000);
    } finally {
      w.repository.close();
    }
  });

  it("a cancelled credit note shows as TWO rows netting to nil, the reversal flagged", () => {
    const w = world();
    try {
      handExample(w);
      const s = buildCustomerStatement(w.repository.db, { customerId: w.customerId });
      const rows = s.rows.filter((row) => row.reference === "CN2");
      expect(rows.map((row) => row.isReversal)).toEqual([false, true]);
      expect(rows.reduce((sum, row) => sum + row.amountPaise, 0)).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("a refund is not a statement row and does not move the closing balance", () => {
    const w = world();
    try {
      handExample(w); // includes a 1,000 refund of CN-0 on 14 Apr
      const refundEntry = w.repository.db.prepare("SELECT 1 FROM journal_entries WHERE id = 'je-refund-rf1'").get();
      expect(refundEntry).toBeDefined();
      const s = buildCustomerStatement(w.repository.db, { customerId: w.customerId });
      expect(s.rows.some((row) => row.date === "2026-04-14")).toBe(false);
      expect(s.closingBalancePaise).toBe(1500000);
    } finally {
      w.repository.close();
    }
  });

  it("unappliedCreditPaise sits beside the closing balance and is never netted into it", () => {
    const w = world();
    try {
      handExample(w);
      const s = buildCustomerStatement(w.repository.db, { customerId: w.customerId });
      // CN-0: 5,000 refundable - 3,000 applied - 1,000 refunded = 1,000 still owed back to them.
      expect(s.unappliedCreditPaise).toBe(100000);
      const balances = w.repository.listCreditNotes().map((n) => w.repository.getCreditNoteBalance(n.id).outstandingPaise);
      expect(balances.reduce((sum, n) => sum + n, 0)).toBe(s.unappliedCreditPaise);
      expect(s.closingBalancePaise).toBe(1500000); // not 1,400,000
    } finally {
      w.repository.close();
    }
  });

  it("refuses an unknown customer", () => {
    const w = world();
    try {
      expect(() => buildCustomerStatement(w.repository.db, { customerId: "nobody" })).toThrow(/not found/);
    } finally {
      w.repository.close();
    }
  });
});

describe("customer balance detail", () => {
  it("TIE-OUT: the report total equals getReceivables for the same filter, with and without an as-at", () => {
    const w = world();
    try {
      handExample(w);
      w.invoice("invz", 700000, "2026-04-10", { customerId: w.otherCustomerId });
      const db = w.repository.db;
      const sum = (rows: ReadonlyArray<{ outstandingPaise: number }>): number => rows.reduce((t, r) => t + r.outstandingPaise, 0);

      const all = buildCustomerBalanceDetail(db, {});
      expect(all.totalPaise).toBe(sum(w.repository.getReceivables()));
      expect(all.totalPaise).toBe(1500000 + 700000);
      expect(all.groups.map((g) => [g.customerName, g.subtotalPaise])).toEqual([["Another School", 700000], ["Host School", 1500000]]);

      const one = buildCustomerBalanceDetail(db, { customerId: w.customerId });
      expect(one.totalPaise).toBe(sum(w.repository.getReceivables({ customerId: w.customerId })));

      const asAt = buildCustomerBalanceDetail(db, { asAtDate: "2026-04-08" });
      expect(asAt.totalPaise).toBe(sum(w.repository.getReceivables({ asAtDate: "2026-04-08" })));
      expect(asAt.groups.flatMap((g) => g.items).some((i) => i.documentId === "invz")).toBe(false);

      const business = buildCustomerBalanceDetail(db, { businessId: w.businessId });
      expect(business.totalPaise).toBe(sum(w.repository.getReceivables({ businessId: w.businessId })));
      // Each group's subtotal is the sum of its own items, and unapplied credit is not netted in.
      for (const group of all.groups) expect(group.subtotalPaise).toBe(sum(group.items));
    } finally {
      w.repository.close();
    }
  });

  it("AS-AT: a document dated after the as-at is excluded; a settlement after it is NOT rolled back", () => {
    const w = world();
    try {
      at("2026-01-10");
      w.invoice("a", 300000, "2026-01-10");
      w.invoice("b", 900000, "2026-05-01");
      at("2026-03-01");
      w.repository.recordPayment("a", 100000, "2026-03-01"); // AFTER the as-at below
      at("2026-06-01");
      const detail = buildCustomerBalanceDetail(w.repository.db, { asAtDate: "2026-02-01" });
      const items = detail.groups.flatMap((g) => g.items);
      expect(items.map((i) => i.documentId)).toEqual(["a"]); // b did not yet exist
      // Established meaning: the March payment still counts, so A shows Rs 2,000, not Rs 3,000.
      expect(items[0]?.outstandingPaise).toBe(200000);
      expect(detail.totalPaise).toBe(200000);
      const collections = buildCollectionsReport(w.repository.db, { asAtDate: "2026-02-01" });
      expect(collections.rows.map((row) => row.documentId)).toEqual(["a"]);
      expect(collections.rows[0]?.outstandingPaise).toBe(200000);
    } finally {
      w.repository.close();
    }
  });

  it("existingOn: no date keeps everything; a date drops later documents and keeps the day itself", () => {
    const rows = [{ date: "2026-01-01" }, { date: "2026-02-01T10:00:00Z" }, { date: "2026-02-02" }];
    expect(existingOn(rows)).toBe(rows);
    expect(existingOn(rows, "2026-02-01").map((r) => r.date)).toEqual(["2026-01-01", "2026-02-01T10:00:00Z"]);
  });
});

describe("collections", () => {
  function collectionsWorld(): World {
    const w = world();
    handExample(w);
    at("2026-04-10");
    w.invoice("invz", 700000, "2026-04-10", { customerId: w.otherCustomerId, dueDate: "2026-05-30" }); // not yet due
    w.invoice("invy", 400000, "2026-04-02", { customerId: w.otherCustomerId, dueDate: "2026-04-20" }); // overdue, has a due date
    return w;
  }

  it("lists only overdue documents, oldest first, saying which date it used, with contact details", () => {
    const w = collectionsWorld();
    try {
      const report = buildCollectionsReport(w.repository.db, { asAtDate: "2026-04-30" });
      expect(report.asAtDate).toBe("2026-04-30");
      expect(report.rows.map((r) => [r.documentId, r.dueOn, r.dueDateBasis, r.daysOverdue])).toEqual([
        ["ocb1", "2026-04-01", "INVOICE_DATE", 29], // opening balance: its own as-at
        ["inv1", "2026-04-05", "INVOICE_DATE", 25], // no due date set
        ["invy", "2026-04-20", "DUE_DATE", 10],
      ]);
      expect(report.rows.find((r) => r.documentId === "invz")).toBeUndefined(); // due 30 May
      expect(report.totalOverduePaise).toBe(1000000 + 500000 + 400000);
      const school = report.rows.find((r) => r.documentId === "inv1");
      expect(school).toMatchObject({ customerName: "Host School", email: "school@example.test", phone: "111", phone2: null });
    } finally {
      w.repository.close();
    }
  });

  it("is a strict subset of Balance Detail for the same as-at, with identical outstanding per row", () => {
    const w = collectionsWorld();
    try {
      const asAtDate = "2026-04-30";
      const detail = buildCustomerBalanceDetail(w.repository.db, { asAtDate });
      const detailItems = new Map(detail.groups.flatMap((g) => g.items).map((i) => [i.documentId, i.outstandingPaise]));
      const collections = buildCollectionsReport(w.repository.db, { asAtDate });
      expect(collections.rows.length).toBeGreaterThan(0);
      expect(collections.rows.length).toBeLessThan(detailItems.size);
      for (const row of collections.rows) expect(detailItems.get(row.documentId)).toBe(row.outstandingPaise);
    } finally {
      w.repository.close();
    }
  });

  it("defaults the as-at to today in IST, not the UTC date", () => {
    const w = world();
    try {
      at("2026-04-01");
      w.invoice("late", 100000, "2026-04-01", { dueDate: "2026-04-10" });
      // 20:00 UTC on 10 Apr is 01:30 IST on 11 Apr: the invoice (due 10 Apr) is overdue by one day.
      vi.setSystemTime(new Date("2026-04-10T20:00:00.000Z"));
      const report = buildCollectionsReport(w.repository.db, {});
      expect(report.asAtDate).toBe("2026-04-11");
      expect(report.rows.map((r) => r.daysOverdue)).toEqual([1]);
    } finally {
      w.repository.close();
    }
  });
});

describe("fair filter", () => {
  function fairWorld() {
    const w = world();
    const fairId = w.repository.createFair({ companyId: w.companyId, hostCustomerId: w.customerId, name: "Kochi Fair" });
    at("2026-04-01");
    w.repository.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: "2026-04-01", amountPaise: 1000000, incomePaise: 0 });
    w.invoice("fairinv", 500000, "2026-04-05", { fairId });
    w.invoice("plain", 300000, "2026-04-06");
    return { w, fairId };
  }

  it("an unknown fair THROWS from all three, never an empty report", () => {
    const w = world();
    try {
      const db = w.repository.db;
      expect(() => buildCustomerStatement(db, { customerId: w.customerId, fairId: "no-such-fair" })).toThrow(/not found/);
      expect(() => buildCustomerBalanceDetail(db, { fairId: "no-such-fair" })).toThrow(/not found/);
      expect(() => buildCollectionsReport(db, { fairId: "no-such-fair" })).toThrow(/not found/);
    } finally {
      w.repository.close();
    }
  });

  it("reports excludedOpeningBalancesPaise under a fair, and only that fair's documents", () => {
    const { w, fairId } = fairWorld();
    try {
      const db = w.repository.db;
      const statement = buildCustomerStatement(db, { customerId: w.customerId, fairId });
      expect(statement.rows.map((r) => r.documentId)).toEqual(["fairinv"]);
      expect(statement.closingBalancePaise).toBe(500000);
      expect(statement.excludedOpeningBalancesPaise).toBe(1000000);

      const detail = buildCustomerBalanceDetail(db, { fairId });
      expect(detail.totalPaise).toBe(500000);
      expect(detail.excludedOpeningBalancesPaise).toBe(1000000);
      expect(detail.totalPaise).toBe(openCustomerItemRows(db, { fairId }).reduce((t, i) => t + i.outstandingPaise, 0));

      at("2026-05-01");
      const collections = buildCollectionsReport(db, { fairId });
      expect(collections.rows.map((r) => r.documentId)).toEqual(["fairinv"]);
      expect(collections.excludedOpeningBalancesPaise).toBe(1000000);

      // Consolidated: nothing is excluded, so the disclosure is 0 and the whole account shows.
      const whole = buildCustomerStatement(db, { customerId: w.customerId });
      expect(whole.excludedOpeningBalancesPaise).toBe(0);
      expect(whole.closingBalancePaise).toBe(1000000 + 500000 + 300000);
    } finally {
      w.repository.close();
    }
  });
});
