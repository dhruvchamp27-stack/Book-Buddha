import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository } from "./repository.js";

/**
 * Session 12. An invoice saved WITHOUT an explicit date took its date from
 * `new Date().toISOString().slice(0, 10)` — the UTC calendar — while the rest of the app has
 * always used India Standard Time for a business date (the rule is spelled out in
 * `journal-dimensions-schema.ts`: "this app assumes India Standard Time (UTC+5:30) for every
 * business date"). Between 00:00 and 05:29 IST those two calendars disagree, so such an invoice
 * was dated the PREVIOUS day.
 *
 * It did not stop at the invoice. `invoiceEntryDate` reads `invoice_date` back and that is the
 * date `finalizeInvoice` posts, so the journal entry, the P&L period, the General Ledger and the
 * ageing reports all carried the wrong day — and across a month-end or a year-end the transaction
 * landed in the wrong period entirely.
 *
 * Found while building the session 12 customer reports, by probing what the shared open-items
 * query actually reads.
 */
describe("an invoice with no date of its own is dated in IST, not UTC", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 19:00 UTC on 1 April is 00:30 IST on 2 April: the half-hour-past-midnight case.
    vi.setSystemTime(new Date("2026-04-01T19:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function world() {
    const repository = new AccountingRepository();
    const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
    const businessId = repository.createBusiness({ companyId, name: "Books" });
    const customerId = repository.createCustomer({ companyId, name: "Asha" });
    const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: false });
    return { repository, companyId, businessId, customerId, itemId };
  }

  it("stores 2 April for an invoice entered at 00:30 IST, and posts it to 2 April", () => {
    const w = world();
    try {
      w.repository.saveDraft({
        id: "INV-1", number: "INV-1", businessId: w.businessId, customerId: w.customerId,
        paymentAccount: "RECEIVABLES", status: "DRAFT", taxType: "NONE", taxRateBasisPoints: 0,
        lines: [{ itemId: w.itemId, description: "Novel", quantity: 1, unitPricePaise: 50_000 }],
      });
      const stored = w.repository.db
        .prepare("SELECT invoice_date, created_at FROM invoices WHERE id = ?")
        .get("INV-1") as { invoice_date: string; created_at: string };
      // The UTC date inside created_at is the day before. That is what this used to store.
      expect(stored.created_at.slice(0, 10)).toBe("2026-04-01");
      expect(stored.invoice_date).toBe("2026-04-02");

      w.repository.finalizeInvoice("INV-1");
      const posted = w.repository.db
        .prepare("SELECT entry_date FROM journal_entries WHERE id = ?")
        .get("je-INV-1") as { entry_date: string };
      expect(posted.entry_date).toBe("2026-04-02");

      // And the reports that date documents agree with the ledger.
      expect(w.repository.getReceivables()[0]?.invoiceDate).toBe("2026-04-02");
      expect(w.repository.getGeneralLedger().every((row) => row.entryDate === "2026-04-02")).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("across a month end it keeps the transaction in the right month", () => {
    const w = world();
    try {
      // 31 March 19:00 UTC = 1 April 00:30 IST: a year end in Indian books, not just a month end.
      vi.setSystemTime(new Date("2026-03-31T19:00:00.000Z"));
      w.repository.saveDraft({
        id: "INV-2", number: "INV-2", businessId: w.businessId, customerId: w.customerId,
        paymentAccount: "RECEIVABLES", status: "DRAFT", taxType: "NONE", taxRateBasisPoints: 0,
        lines: [{ itemId: w.itemId, description: "Novel", quantity: 1, unitPricePaise: 50_000 }],
      });
      w.repository.finalizeInvoice("INV-2");
      const posted = w.repository.db
        .prepare("SELECT entry_date FROM journal_entries WHERE id = ?")
        .get("je-INV-2") as { entry_date: string };
      // 2026-27, not 2025-26. Dated by the UTC calendar this sale fell in the closing year.
      expect(posted.entry_date).toBe("2026-04-01");
    } finally {
      w.repository.close();
    }
  });

  it("never overrides a date the user did give", () => {
    const w = world();
    try {
      w.repository.saveDraft({
        id: "INV-3", number: "INV-3", businessId: w.businessId, customerId: w.customerId,
        invoiceDate: "2026-01-15",
        paymentAccount: "RECEIVABLES", status: "DRAFT", taxType: "NONE", taxRateBasisPoints: 0,
        lines: [{ itemId: w.itemId, description: "Novel", quantity: 1, unitPricePaise: 50_000 }],
      });
      expect(
        (w.repository.db.prepare("SELECT invoice_date FROM invoices WHERE id = ?")
          .get("INV-3") as { invoice_date: string }).invoice_date,
      ).toBe("2026-01-15");
    } finally {
      w.repository.close();
    }
  });
});
