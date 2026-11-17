import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository } from "./repository.js";

/**
 * R3 check (c): what happens when a credit raised at Fair A is applied to an invoice at Fair B.
 *
 * PINNED (open ruling). This file records what the code does TODAY. It is an OPEN QUESTION for
 * the owner, NOT a confirmed defect and NOT accepted behaviour. Nothing here was fixed.
 *
 * IN PLAIN ENGLISH
 * A customer buys Rs 1,000 at Fair A and pays in full. Rs 400 comes back as a credit note, so
 * the shop now owes the customer Rs 400 (the "customer credits" liability, tagged Fair A).
 * Later the same customer buys Rs 1,000 at Fair B, and the Rs 400 is set against that invoice.
 * That settling entry is tagged with Fair B (the invoice's fair), not Fair A (the note's fair).
 * So the Rs 400 liability was CREATED in Fair A but CLEARED in Fair B. Fair by fair, neither
 * fair's customer-credits balance returns to zero; only the two together (the whole company) do.
 *
 * FIGURES AFTER THE APPLICATION (paise; Rs = paise / 100)
 *   Customer credits (liability), net:
 *       Fair A  Rs 400 owed (credit 40,000)    Fair B  Rs 400 debit (a "negative liability", 40,000)
 *       Whole company  Rs 0
 *   Receivables, net debit:
 *       Fair A  Rs 0        Fair B  Rs 600 (the Rs 1,000 invoice less the Rs 400 credit)
 *       Whole company  Rs 600. Receivables nets correctly per fair: B's invoice is settled in B.
 *   Trial Balance: balances overall AND inside each fair (every entry is itself balanced).
 *   Profit, ACCRUAL: unchanged by the application. Fair A Rs 600, Fair B Rs 1,000.
 *   Profit, CASH:    Fair A Rs 1,000 -> Rs 600 (-400); Fair B Rs 0 -> Rs 400 (+400).
 *       So on the cash basis Rs 400 of profit MOVES from Fair A to Fair B when the credit is used.
 *       Whether that is right is the owner's call.
 *   Balance Sheet: cannot be filtered by fair (the spec exempts it), so the phantom liability in
 *       Fair A and the debit in Fair B are only visible on the fair-filtered Trial Balance.
 *       The unfiltered Balance Sheet shows customer credits Rs 0, which is right.
 *
 * Journal dimensions are PER ENTRY (journal_entries.fair_id); journal_lines has no fair column.
 */
describe("PINNED (open ruling): applying a Fair A credit note to a Fair B invoice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function world() {
    const repository = new AccountingRepository();
    const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
    const businessId = repository.createBusiness({ companyId, name: "Business" });
    const customerId = repository.createCustomer({ companyId, name: "Customer" });
    const itemId = repository.createItem({ companyId, name: "Item", unit: "each", trackStock: false });
    const fairA = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair A" });
    const fairB = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair B" });
    const invoice = (id: string, totalPaise: number, invoiceDate: string, fairId: string): void => {
      repository.saveDraft({
        id, number: `INV-${id}`, businessId, customerId, invoiceDate, status: "DRAFT", paymentAccount: "RECEIVABLES",
        taxType: "NONE", taxRateBasisPoints: 0, fairId,
        lines: [{ itemId, description: "Line", quantity: 1, unitPricePaise: totalPaise }],
      });
      repository.finalizeInvoice(id);
    };
    // Fair A: Rs 1,000 invoice, collected in full.
    invoice("A", 100000, "2026-01-10", fairA);
    repository.recordPayment("A", 100000, "2026-01-20");
    // February: Rs 400 comes back as a credit note (tagged Fair A, the source invoice's fair).
    vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
    repository.saveCreditNote({
      id: "cn1", invoiceId: "A", number: "CN-1", reason: "Return", status: "DRAFT",
      lines: [{ itemId, description: "Returned", quantity: 1, unitPricePaise: 40000 }],
    });
    repository.finalizeCreditNote("cn1");
    // Fair B: Rs 1,000 invoice, same customer, same business, not yet paid.
    invoice("B", 100000, "2026-02-11", fairB);
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

  it("PINNED (open ruling): before applying, the Fair A credit sits wholly in Fair A", () => {
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

  it("PINNED (open ruling): the application is not blocked, and is tagged with the TARGET invoice's fair", () => {
    const w = world();
    try {
      w.apply(); // no throw: cross-customer and cross-business are refused, cross-fair is not
      const fairOf = (id: string) =>
        (w.repository.db.prepare("SELECT fair_id FROM journal_entries WHERE id = ?").get(id) as { fair_id: string }).fair_id;
      expect(fairOf("je-credit-note-cn1")).toBe(w.fairA); // SOURCE
      expect(fairOf("je-credit-apply-ap1")).toBe(w.fairB); // TARGET
    } finally {
      w.repository.close();
    }
  });

  it("PINNED (open ruling): CUSTOMER_CREDITS does NOT net to zero inside either fair, only company-wide", () => {
    const w = world();
    try {
      w.apply();
      expect(net(w, "A", "CUSTOMER_CREDITS")).toBe(-40000); // Rs 400 still "owed" in Fair A
      expect(net(w, "B", "CUSTOMER_CREDITS")).toBe(40000); // Rs 400 debit in Fair B
      expect(net(w, "ALL", "CUSTOMER_CREDITS")).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("PINNED (open ruling): RECEIVABLES nets correctly per fair (the invoice is settled in its own fair)", () => {
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

  it("PINNED (open ruling): the Trial Balance still balances, overall and inside each fair", () => {
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

  it("PINNED (open ruling): accrual profit does not move; CASH profit moves Rs 400 from Fair A to Fair B", () => {
    const w = world();
    try {
      w.apply();
      expect(profit(w, "A", "ACCRUAL")).toBe(60000);
      expect(profit(w, "B", "ACCRUAL")).toBe(100000);
      expect(profit(w, "ALL", "ACCRUAL")).toBe(160000);
      expect(profit(w, "A", "CASH")).toBe(60000); // was 100,000: -40,000
      expect(profit(w, "B", "CASH")).toBe(40000); // was 0:       +40,000
      expect(profit(w, "ALL", "CASH")).toBe(100000); // unchanged company-wide
    } finally {
      w.repository.close();
    }
  });

  it("PINNED (open ruling): the Balance Sheet cannot show the per-fair phantom; the whole-company one is clean", () => {
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

  it("PINNED (open ruling): journal dimensions are per ENTRY, not per line", () => {
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
});
