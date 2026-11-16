import { describe, expect, it } from "vitest";
import { AccountingRepository } from "./repository.js";
import { buildApi } from "../api/server.js";
import { verifyAuditChain } from "./audit-log.js";
import type { Invoice } from "../accounting/types.js";

/**
 * R5 — the financial-year lock, enforced at the posting door (ledger.ts). The door is the only
 * writer of journal entries, so a locked year cannot be posted into by any route.
 */
function world(): { repository: AccountingRepository; companyId: string; businessId: string; customerId: string; itemId: string } {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Business" });
  const customerId = repository.createCustomer({ companyId, name: "Customer" });
  const itemId = repository.createItem({ companyId, name: "Item", unit: "each", trackStock: false });
  return { repository, companyId, businessId, customerId, itemId };
}

function draft(w: ReturnType<typeof world>, id: string, invoiceDate: string): Invoice {
  return {
    id,
    number: `INV-${id}`,
    businessId: w.businessId,
    customerId: w.customerId,
    invoiceDate,
    status: "DRAFT",
    paymentAccount: "RECEIVABLES",
    taxType: "NONE",
    taxRateBasisPoints: 0,
    lines: [{ itemId: w.itemId, description: "Line", quantity: 1, unitPricePaise: 100000 }],
  };
}

describe("financial years", () => {
  it("defines a year, rejects an overlap, and locks it", () => {
    const w = world();
    try {
      const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      expect(w.repository.listFinancialYears(w.businessId)).toEqual([
        { id, businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31", status: "OPEN", lockedAt: null },
      ]);

      // Overlaps would make "which year is this date in" ambiguous, and the lock with it.
      const overlapping = [
        ["2025-04-01", "2026-03-31"], // identical
        ["2026-03-31", "2027-03-30"], // starts on the last day
        ["2024-04-01", "2025-04-01"], // ends on the first day
        ["2025-06-01", "2025-07-01"], // wholly inside
        ["2024-01-01", "2027-01-01"], // wholly containing
      ] as const;
      for (const [startsOn, endsOn] of overlapping) {
        expect(() => w.repository.createFinancialYear({ businessId: w.businessId, startsOn, endsOn }), `${startsOn}..${endsOn}`)
          .toThrow(/overlaps/);
      }
      // Abutting years are fine.
      expect(() => w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2026-04-01", endsOn: "2027-03-31" })).not.toThrow();
      expect(() => w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2027-03-31", endsOn: "2027-01-01" })).toThrow(/end before it starts/);
      expect(() => w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "not-a-date", endsOn: "2027-03-31" })).toThrow(/real date/);
      expect(() => w.repository.createFinancialYear({ businessId: "nope", startsOn: "2030-04-01", endsOn: "2031-03-31" })).toThrow(/not found/);

      w.repository.setFinancialYearLocked(id, true);
      const locked = w.repository.listFinancialYears(w.businessId).find((y) => y.id === id);
      expect(locked?.status).toBe("LOCKED");
      expect(locked?.lockedAt).not.toBeNull();
    } finally {
      w.repository.close();
    }
  });

  it("is per business: locking one business's year leaves the other free", () => {
    const w = world();
    try {
      const other = w.repository.createBusiness({ companyId: w.companyId, name: "Other" });
      const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      w.repository.setFinancialYearLocked(id, true);
      expect(w.repository.isPeriodOpen(w.businessId, "2025-06-01")).toBe(false);
      expect(w.repository.isPeriodOpen(other, "2025-06-01")).toBe(true);
      // The same business outside the locked range is open.
      expect(w.repository.isPeriodOpen(w.businessId, "2026-04-01")).toBe(true);
      // Boundaries are INCLUSIVE at both ends.
      expect(w.repository.isPeriodOpen(w.businessId, "2025-04-01")).toBe(false);
      expect(w.repository.isPeriodOpen(w.businessId, "2026-03-31")).toBe(false);
      expect(w.repository.isPeriodOpen(w.businessId, "2025-03-31")).toBe(true);
    } finally {
      w.repository.close();
    }
  });
});

describe("the lock stops postings at the door", () => {
  it("refuses to finalize an invoice dated inside a locked year, and allows one outside it", () => {
    const w = world();
    try {
      const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      const inside = draft(w, "inv-inside", "2025-06-15");
      const outside = draft(w, "inv-outside", "2026-06-15");
      w.repository.saveDraft(inside);
      w.repository.saveDraft(outside);

      // Open: both post happily.
      w.repository.finalizeInvoice(outside.id);
      w.repository.setFinancialYearLocked(id, true);

      expect(() => w.repository.finalizeInvoice(inside.id)).toThrow(/locked/);
      // Nothing was half-written: the invoice is still a draft and no journal exists for it.
      expect(w.repository.getInvoice(inside.id).status).toBe("DRAFT");
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE source_id = ?").get(inside.id)).toEqual({ n: 0 });
    } finally {
      w.repository.close();
    }
  });

  it("refuses a payment dated inside a locked year", () => {
    const w = world();
    try {
      const invoice = draft(w, "inv-pay", "2025-06-15");
      w.repository.saveDraft(invoice);
      w.repository.finalizeInvoice(invoice.id);
      const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      w.repository.setFinancialYearLocked(id, true);
      expect(() => w.repository.recordPayment(invoice.id, 1000, "2025-07-01")).toThrow(/locked/);
    } finally {
      w.repository.close();
    }
  });

  it("still allows a CANCELLATION of a document in a locked year, because the reversal is dated today", () => {
    const w = world();
    try {
      // A year covering the invoice date, locked after the invoice was finalized.
      const invoice = draft(w, "inv-cancel", "2025-06-15");
      w.repository.saveDraft(invoice);
      w.repository.finalizeInvoice(invoice.id);
      const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      w.repository.setFinancialYearLocked(id, true);

      // This is the property that makes the lock safe without a reversal exemption.
      expect(() => w.repository.cancelInvoice(invoice.id)).not.toThrow();
      expect(w.repository.getInvoice(invoice.id).status).toBe("CANCELLED");
      const reversal = w.repository.db
        .prepare("SELECT entry_date FROM journal_entries WHERE source_id = ? AND is_reversal = 1")
        .get(invoice.id) as { entry_date: string };
      expect(reversal.entry_date).not.toBe("2025-06-15");
      expect(w.repository.isPeriodOpen(w.businessId, reversal.entry_date)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("lets a reopened year be posted into again, and audits both the lock and the reopen", () => {
    const w = world();
    try {
      const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      const invoice = draft(w, "inv-reopen", "2025-06-15");
      w.repository.saveDraft(invoice);
      w.repository.setFinancialYearLocked(id, true);
      expect(() => w.repository.finalizeInvoice(invoice.id)).toThrow(/locked/);

      w.repository.setFinancialYearLocked(id, false, "Auditor found a missing invoice");
      expect(() => w.repository.finalizeInvoice(invoice.id)).not.toThrow();

      const events = w.repository.db
        .prepare("SELECT action, reason FROM audit_events WHERE entity_type = 'financial_year' ORDER BY id")
        .all() as Array<{ action: string; reason: string | null }>;
      expect(events.map((e) => e.action)).toEqual(["FINANCIAL_YEAR_CREATED", "FINANCIAL_YEAR_LOCKED", "FINANCIAL_YEAR_REOPENED"]);
      // A reopen is the one that matters for an auditor, so its reason is kept.
      expect(events[2]?.reason).toBe("Auditor found a missing invoice");
      expect(verifyAuditChain(w.repository.db).ok).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("setting the same lock state twice is a no-op and writes no audit event", () => {
    const w = world();
    try {
      const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      w.repository.setFinancialYearLocked(id, true);
      const before = w.repository.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get();
      w.repository.setFinancialYearLocked(id, true);
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get()).toEqual(before);
      expect(() => w.repository.setFinancialYearLocked("nope", true)).toThrow(/not found/);
    } finally {
      w.repository.close();
    }
  });
});

describe("financial years over HTTP", () => {
  it("creates, lists and locks a year, and the lock then blocks a finalize", async () => {
    const w = world();
    const app = buildApi(w.repository);
    try {
      const created = await app.inject({
        method: "POST", url: "/financial-years",
        payload: { businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<{ id: string }>().id;

      expect((await app.inject({ method: "GET", url: `/financial-years?businessId=${w.businessId}` })).json<unknown[]>()).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/financial-years" })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/financial-years", payload: { businessId: w.businessId, startsOn: "01-04-2025", endsOn: "2026-03-31" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/financial-years", payload: { businessId: w.businessId, startsOn: "2025-09-01", endsOn: "2025-10-01" } })).statusCode).toBe(400);

      expect((await app.inject({ method: "POST", url: `/financial-years/${id}/lock`, payload: { locked: true } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/financial-years?businessId=${w.businessId}` })).json<Array<{ status: string }>>()[0]?.status).toBe("LOCKED");

      const invoice = draft(w, "inv-http", "2025-06-15");
      w.repository.saveDraft(invoice);
      const finalized = await app.inject({ method: "POST", url: `/invoices/${invoice.id}/finalize` });
      expect(finalized.statusCode).toBe(400);
      expect(finalized.json<{ error: string }>().error).toMatch(/locked/);

      expect((await app.inject({ method: "POST", url: "/financial-years/nope/lock", payload: { locked: true } })).statusCode).toBe(400);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});
