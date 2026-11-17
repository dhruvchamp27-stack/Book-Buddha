import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository } from "./repository.js";

/**
 * S5-11 (owner ruling): applying a credit note across fairs is posted through INTER_FAIR_CLEARING.
 *
 * This file began as R3 check (c), a PINNED measurement of the old behaviour that said in its own
 * header it was an open question. The owner has now ruled: fix it with clearing entries, not a
 * schema change. The assertions below describe the CONFIRMED behaviour.
 *
 * IN PLAIN ENGLISH
 * A customer buys Rs 1,000 at Fair A and pays in full. Rs 400 comes back as a credit note, so
 * the shop owes the customer Rs 400 (the "customer credits" liability, tagged Fair A). Later the
 * same customer buys Rs 1,000 at Fair B and the Rs 400 is set against that invoice.
 * Journal dimensions are per ENTRY, so one entry cannot carry both fairs. When the two fairs
 * differ the application is therefore TWO balanced entries that meet in a clearing account:
 *   1. tagged the NOTE's fair:     Dr CUSTOMER_CREDITS / Cr INTER_FAIR_CLEARING
 *   2. tagged the INVOICE's fair:  Dr INTER_FAIR_CLEARING / Cr RECEIVABLES
 * The liability now closes inside the fair that created it, the receivable closes inside the fair
 * whose invoice it settles, and the movement between the two is visible in a named account.
 *
 * FIGURES AFTER THE APPLICATION (paise; Rs = paise / 100). Before the change, in brackets.
 *   CUSTOMER_CREDITS net:   Fair A 0 (was -40,000)   Fair B 0 (was +40,000)   company 0
 *   RECEIVABLES net debit:  Fair A 0                 Fair B 60,000             company 60,000
 *   INTER_FAIR_CLEARING:    Fair A -40,000 (credit)  Fair B +40,000 (debit)    company 0
 *   Profit, ACCRUAL: unchanged. Fair A 60,000, Fair B 100,000.
 *   Profit, CASH:    unchanged by the change. Fair A 60,000, Fair B 40,000 (the cash view reads
 *       applications from the credit_note_applications TABLE, not from journal-entry ids).
 *
 * WHEN IT SPLITS: only when the note's fair and the invoice's fair differ, and untagged counts as
 * different from tagged. Same fair, or both untagged, stays ONE entry with no clearing account.
 */
describe("S5-11: applying a credit note across fairs posts through INTER_FAIR_CLEARING", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Tag = "A" | "B" | null;
  /** sourceTag = fair of the invoice the note is raised against; targetTag = fair of the invoice it is applied to. */
  function world(sourceTag: Tag = "A", targetTag: Tag = "B") {
    const repository = new AccountingRepository();
    const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
    const businessId = repository.createBusiness({ companyId, name: "Business" });
    const customerId = repository.createCustomer({ companyId, name: "Customer" });
    const itemId = repository.createItem({ companyId, name: "Item", unit: "each", trackStock: false });
    const fairA = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair A" });
    const fairB = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair B" });
    const fairFor = (tag: Tag): string | undefined => (tag === "A" ? fairA : tag === "B" ? fairB : undefined);
    const invoice = (id: string, totalPaise: number, invoiceDate: string, fairId: string | undefined): void => {
      repository.saveDraft({
        id, number: `INV-${id}`, businessId, customerId, invoiceDate, status: "DRAFT", paymentAccount: "RECEIVABLES",
        taxType: "NONE", taxRateBasisPoints: 0, ...(fairId === undefined ? {} : { fairId }),
        lines: [{ itemId, description: "Line", quantity: 1, unitPricePaise: totalPaise }],
      });
      repository.finalizeInvoice(id);
    };
    // Fair A: Rs 1,000 invoice, collected in full.
    invoice("A", 100000, "2026-01-10", fairFor(sourceTag));
    repository.recordPayment("A", 100000, "2026-01-20");
    // February: Rs 400 comes back as a credit note (tagged Fair A, the source invoice's fair).
    vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
    repository.saveCreditNote({
      id: "cn1", invoiceId: "A", number: "CN-1", reason: "Return", status: "DRAFT",
      lines: [{ itemId, description: "Returned", quantity: 1, unitPricePaise: 40000 }],
    });
    repository.finalizeCreditNote("cn1");
    // Fair B: Rs 1,000 invoice, same customer, same business, not yet paid.
    invoice("B", 100000, "2026-02-11", fairFor(targetTag));
    const apply = (): void => {
      repository.applyCreditNote({ id: "ap1", creditNoteId: "cn1", invoiceId: "B", amountPaise: 40000, appliedOn: "2026-02-12" });
    };
    return { repository, fairA, fairB, apply };
  }

  type W = ReturnType<typeof world>;
  const scope = (w: W, which: "ALL" | "A" | "B") => (which === "ALL" ? {} : { fairId: which === "A" ? w.fairA : w.fairB });
  /** Net debit (positive) or net credit (negative) of one account, read from the Trial Balance. */
  const net = (w: W, which: "ALL" | "A" | "B", account: string): number => {
    const row = w.repository.getTrialBalance(scope(w, which)).find((r) => r.account === account);
    return row === undefined ? 0 : row.debitPaise - row.creditPaise;
  };
  const profit = (w: W, which: "ALL" | "A" | "B", basis: "ACCRUAL" | "CASH"): number =>
    w.repository.getProfitAndLoss({ ...scope(w, which), basis }).netProfitPaise;

  /** Every entry the application posted, with its fair and lines. Matches the apply id scheme only. */
  const applyEntries = (w: W) => {
    const entries = w.repository.db
      .prepare("SELECT id, fair_id FROM journal_entries WHERE id LIKE 'je-credit-apply-%' ORDER BY id")
      .all() as Array<{ id: string; fair_id: string | null }>;
    return entries.map((e) => ({
      ...e,
      lines: w.repository.db
        .prepare("SELECT account, debit_paise AS debit, credit_paise AS credit FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
        .all(e.id) as Array<{ account: string; debit: number; credit: number }>,
    }));
  };
  const hasClearingLine = (w: W): boolean =>
    w.repository.db.prepare("SELECT 1 FROM journal_lines WHERE account = 'INTER_FAIR_CLEARING'").get() !== undefined;

  it("before applying, the Fair A credit sits wholly in Fair A", () => {
    const w = world();
    try {
      expect(net(w, "A", "CUSTOMER_CREDITS")).toBe(-40000);
      expect(net(w, "B", "CUSTOMER_CREDITS")).toBe(0);
      expect(net(w, "ALL", "CUSTOMER_CREDITS")).toBe(-40000);
      expect(net(w, "A", "RECEIVABLES")).toBe(0);
      expect(net(w, "B", "RECEIVABLES")).toBe(100000);
      expect(profit(w, "A", "ACCRUAL")).toBe(60000);
      expect(profit(w, "B", "ACCRUAL")).toBe(100000);
      expect(profit(w, "A", "CASH")).toBe(100000);
      expect(profit(w, "B", "CASH")).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("the application is not blocked, and posts two entries: one per fair, each balanced", () => {
    const w = world();
    try {
      w.apply();
      const entries = applyEntries(w);
      expect(entries.map((e) => e.id)).toEqual(["je-credit-apply-ap1-source", "je-credit-apply-ap1-target"]);
      const [source, target] = entries;
      // SOURCE entry: the NOTE's fair (A). Dr CUSTOMER_CREDITS / Cr INTER_FAIR_CLEARING.
      expect(source?.fair_id).toBe(w.fairA);
      expect(source?.lines).toEqual([
        { account: "CUSTOMER_CREDITS", debit: 40000, credit: 0 },
        { account: "INTER_FAIR_CLEARING", debit: 0, credit: 40000 },
      ]);
      // TARGET entry: the INVOICE's fair (B). Dr INTER_FAIR_CLEARING / Cr RECEIVABLES.
      expect(target?.fair_id).toBe(w.fairB);
      expect(target?.lines).toEqual([
        { account: "INTER_FAIR_CLEARING", debit: 40000, credit: 0 },
        { account: "RECEIVABLES", debit: 0, credit: 40000 },
      ]);
      for (const e of entries) {
        expect(e.lines.reduce((t, l) => t + l.debit, 0)).toBe(e.lines.reduce((t, l) => t + l.credit, 0));
        // Neither id may start with the note's own prefix: invoiceCreditedPaise sums that prefix.
        expect(e.id.startsWith("je-credit-note-")).toBe(false);
      }
      // The note's own entry is untouched and still Fair A.
      const fairOf = (id: string) =>
        (w.repository.db.prepare("SELECT fair_id FROM journal_entries WHERE id = ?").get(id) as { fair_id: string }).fair_id;
      expect(fairOf("je-credit-note-cn1")).toBe(w.fairA);
      // The application row and the audit event are as before.
      const row = w.repository.db.prepare("SELECT amount_paise, applied_on FROM credit_note_applications WHERE id = 'ap1'").get();
      expect(row).toEqual({ amount_paise: 40000, applied_on: "2026-02-12" });
      expect(w.repository.db.prepare("SELECT 1 FROM audit_events WHERE action = 'credit_note.applied'").get()).toBeDefined();
    } finally {
      w.repository.close();
    }
  });

  it("CUSTOMER_CREDITS nets to ZERO in Fair A, in Fair B and company-wide", () => {
    const w = world();
    try {
      w.apply();
      expect(net(w, "A", "CUSTOMER_CREDITS")).toBe(0);
      expect(net(w, "B", "CUSTOMER_CREDITS")).toBe(0);
      expect(net(w, "ALL", "CUSTOMER_CREDITS")).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("RECEIVABLES is 0 in Fair A and 60,000 in Fair B (the invoice is settled in its own fair)", () => {
    const w = world();
    try {
      w.apply();
      expect(net(w, "A", "RECEIVABLES")).toBe(0);
      expect(net(w, "B", "RECEIVABLES")).toBe(60000);
      expect(net(w, "ALL", "RECEIVABLES")).toBe(60000);
    } finally {
      w.repository.close();
    }
  });

  it("INTER_FAIR_CLEARING shows the movement: credit in Fair A, debit in Fair B, zero company-wide", () => {
    const w = world();
    try {
      w.apply();
      expect(net(w, "A", "INTER_FAIR_CLEARING")).toBe(-40000);
      expect(net(w, "B", "INTER_FAIR_CLEARING")).toBe(40000);
      expect(net(w, "ALL", "INTER_FAIR_CLEARING")).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("the Trial Balance still balances, overall and inside each fair", () => {
    const w = world();
    try {
      w.apply();
      for (const which of ["ALL", "A", "B"] as const) {
        const rows = w.repository.getTrialBalance(scope(w, which));
        expect(rows.reduce((t, r) => t + r.debitPaise, 0)).toBe(rows.reduce((t, r) => t + r.creditPaise, 0));
      }
    } finally {
      w.repository.close();
    }
  });

  it("accrual profit does not move, and CASH profit is unchanged by the clearing entries (A 60,000, B 40,000)", () => {
    const w = world();
    try {
      w.apply();
      expect(profit(w, "A", "ACCRUAL")).toBe(60000);
      expect(profit(w, "B", "ACCRUAL")).toBe(100000);
      expect(profit(w, "ALL", "ACCRUAL")).toBe(160000);
      // The cash view reads applications from the credit_note_applications TABLE, so splitting the
      // journal entry cannot move these. They are the figures the old single entry gave.
      expect(profit(w, "A", "CASH")).toBe(60000); // was 100,000 before applying: -40,000
      expect(profit(w, "B", "CASH")).toBe(40000); // was 0 before applying:        +40,000
      expect(profit(w, "ALL", "CASH")).toBe(100000);
    } finally {
      w.repository.close();
    }
  });

  it("receivables and the cancel rule are unaffected: B owes 60,000 and the applied note cannot be cancelled", () => {
    const w = world();
    try {
      w.apply();
      const row = w.repository.getReceivables().find((r) => r.invoiceId === "B");
      expect(row?.outstandingPaise).toBe(60000);
      expect(row?.paidPaise).toBe(40000); // the application, read from the credit_note_applications table
      expect(row?.creditedPaise).toBe(0); // the je-credit-note-% prefix sum does not see the new ids
      // S4-7 rule 2: an applied note is not cancellable, so these entries never need reversing.
      expect(() => w.repository.cancelCreditNote("cn1")).toThrow();
    } finally {
      w.repository.close();
    }
  });

  it("the whole-company Balance Sheet is clean; a per-fair one is still refused", () => {
    const w = world();
    try {
      w.apply();
      expect(() => w.repository.getBalanceSheet({ fairId: w.fairA })).toThrow(/no per-fair Balance Sheet/);
      const sheet = w.repository.getBalanceSheet();
      expect(sheet.liabilities.find((l) => l.account === "CUSTOMER_CREDITS")?.balancePaise).toBe(0);
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    } finally {
      w.repository.close();
    }
  });

  it("journal dimensions are per ENTRY, not per line (which is why the split is needed)", () => {
    const w = world();
    try {
      const columns = (table: string) =>
        (w.repository.db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
      expect(columns("journal_entries")).toContain("fair_id");
      expect(columns("journal_lines")).not.toContain("fair_id");
    } finally {
      w.repository.close();
    }
  });

  describe("all fair combinations (untagged counts as different from tagged)", () => {
    const cases: Array<{ name: string; source: Tag; target: Tag; splits: boolean }> = [
      { name: "A -> B splits", source: "A", target: "B", splits: true },
      { name: "B -> B does not split", source: "B", target: "B", splits: false },
      { name: "untagged -> B splits", source: null, target: "B", splits: true },
      { name: "B -> untagged splits", source: "B", target: null, splits: true },
      { name: "untagged -> untagged does not split", source: null, target: null, splits: false },
    ];
    for (const c of cases) {
      it(c.name, () => {
        const w = world(c.source, c.target);
        try {
          w.apply();
          const entries = applyEntries(w);
          const fair = (t: Tag) => (t === "A" ? w.fairA : t === "B" ? w.fairB : null);
          if (c.splits) {
            expect(entries.map((e) => e.id)).toEqual(["je-credit-apply-ap1-source", "je-credit-apply-ap1-target"]);
            expect(entries[0]?.fair_id).toBe(fair(c.source));
            expect(entries[1]?.fair_id).toBe(fair(c.target));
            expect(entries[0]?.lines.map((l) => l.account)).toEqual(["CUSTOMER_CREDITS", "INTER_FAIR_CLEARING"]);
            expect(entries[1]?.lines.map((l) => l.account)).toEqual(["INTER_FAIR_CLEARING", "RECEIVABLES"]);
            expect(net(w, "ALL", "INTER_FAIR_CLEARING")).toBe(0);
          } else {
            // Byte-for-byte what it was: ONE entry, the old id, tagged with the (shared) fair.
            expect(entries).toHaveLength(1);
            expect(entries[0]?.id).toBe("je-credit-apply-ap1");
            expect(entries[0]?.fair_id).toBe(fair(c.target));
            expect(entries[0]?.lines).toEqual([
              { account: "CUSTOMER_CREDITS", debit: 40000, credit: 0 },
              { account: "RECEIVABLES", debit: 0, credit: 40000 },
            ]);
            expect(hasClearingLine(w)).toBe(false);
          }
          // Whatever the shape, CUSTOMER_CREDITS closes inside the fair that created it...
          expect(net(w, "ALL", "CUSTOMER_CREDITS")).toBe(0);
          if (c.source !== null) expect(net(w, c.source, "CUSTOMER_CREDITS")).toBe(0);
          // ...and every entry balances, so the whole ledger does.
          for (const e of entries) expect(e.lines.reduce((t, l) => t + l.debit - l.credit, 0)).toBe(0);
          const rows = w.repository.getTrialBalance();
          expect(rows.reduce((t, r) => t + r.debitPaise, 0)).toBe(rows.reduce((t, r) => t + r.creditPaise, 0));
        } finally {
          w.repository.close();
        }
      });
    }

    it("untagged -> B: under a Fair B filter CUSTOMER_CREDITS shows no bare debit", () => {
      const w = world(null, "B");
      try {
        w.apply();
        expect(net(w, "B", "CUSTOMER_CREDITS")).toBe(0);
        expect(net(w, "B", "INTER_FAIR_CLEARING")).toBe(40000);
        expect(net(w, "B", "RECEIVABLES")).toBe(60000);
      } finally {
        w.repository.close();
      }
    });
  });
});
