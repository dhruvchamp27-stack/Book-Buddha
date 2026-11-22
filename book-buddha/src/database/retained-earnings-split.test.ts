import { describe, expect, it } from "vitest";
import { AccountingRepository } from "./repository.js";
import type { Invoice } from "../accounting/types.js";
import { todayAt } from "./test-clock.js";

/**
 * R5-rem — splitting the DERIVED retained earnings into brought forward and profit for the year.
 *
 * Presentation only: no closing entry is ever posted (S5-4), the RETAINED_EARNINGS row in
 * `equity` is untouched, and this is a second reading of that same number. The figures below are
 * hand-worked, and the boundary is deliberately straddled - one invoice and one expense on the
 * LAST day of the old year, one of each on the FIRST day of the new - so a one-day error in the
 * cut moves money across the line and both figures change.
 */

const FY25 = { startsOn: "2025-04-01", endsOn: "2026-03-31" } as const;
const FY26 = { startsOn: "2026-04-01", endsOn: "2027-03-31" } as const;

function world() {
  const repository = new AccountingRepository(":memory:", todayAt("2025-03-31"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Business" });
  const customerId = repository.createCustomer({ companyId, name: "Customer" });
  const supplierId = repository.createSupplier({ companyId, name: "Supplier" });
  const itemId = repository.createItem({ companyId, name: "Item", unit: "each", trackStock: false });
  return { repository, companyId, businessId, customerId, supplierId, itemId };
}

function invoice(w: ReturnType<typeof world>, id: string, invoiceDate: string, pricePaise: number): Invoice {
  return {
    id,
    number: id,
    businessId: w.businessId,
    customerId: w.customerId,
    invoiceDate,
    status: "DRAFT",
    paymentAccount: "RECEIVABLES",
    taxType: "NONE",
    taxRateBasisPoints: 0,
    lines: [{ itemId: w.itemId, description: "Line", quantity: 1, unitPricePaise: pricePaise }],
  };
}

/**
 * Income and expense either side of 1 April 2026, in paise:
 *
 *   2025-03-31  INV-A  +100000   before every financial year
 *   2026-03-31  INV-B  +200000   LAST day of FY 2025-26
 *   2026-03-31  EX-1    -50000   LAST day of FY 2025-26
 *   2026-04-01  INV-C  +400000   FIRST day of FY 2026-27
 *   2026-04-01  EX-2    -30000   FIRST day of FY 2026-27
 *   2026-06-15  INV-D  +800000   inside FY 2026-27
 */
function books(): ReturnType<typeof world> {
  const w = world();
  w.repository.createFinancialYear({ businessId: w.businessId, ...FY25 });
  w.repository.createFinancialYear({ businessId: w.businessId, ...FY26 });

  for (const [id, date, paise] of [
    ["INV-A", "2025-03-31", 100000],
    ["INV-B", "2026-03-31", 200000],
    ["INV-C", "2026-04-01", 400000],
    ["INV-D", "2026-06-15", 800000],
  ] as const) {
    w.repository.saveDraft(invoice(w, id, date, paise));
    w.repository.finalizeInvoice(id);
  }
  for (const [id, date, paise] of [
    ["EX-1", "2026-03-31", 50000],
    ["EX-2", "2026-04-01", 30000],
  ] as const) {
    w.repository.createExpense({
      id, businessId: w.businessId, supplierId: w.supplierId, number: id,
      expenseDate: date, description: "Cost", amountPaise: paise, paymentAccount: "PAYABLES",
    });
    w.repository.finalizeExpense(id);
  }
  return w;
}

describe("retained earnings split at the financial-year boundary", () => {
  it("reads brought forward and profit for the year as hand-worked, straddling 1 April 2026", () => {
    const w = books();
    try {
      const sheet = w.repository.getBalanceSheet({ businessId: w.businessId, asAtDate: "2026-12-31" });
      const split = sheet.retainedEarnings.split;
      expect(sheet.retainedEarnings.unsplitReason).toBeNull();
      expect(split).not.toBeNull();

      // Brought forward: INV-A 100000 + INV-B 200000 - EX-1 50000.
      expect(split?.broughtForwardPaise).toBe(250000);
      // Profit for the year: INV-C 400000 + INV-D 800000 - EX-2 30000.
      expect(split?.profitForYearPaise).toBe(1170000);
      expect(sheet.retainedEarnings.totalPaise).toBe(1420000);
      // The year picked is the one containing the as-at date, and its bounds are published.
      expect(split?.startsOn).toBe(FY26.startsOn);
      expect(split?.endsOn).toBe(FY26.endsOn);
      expect(split?.periodFrom).toBe(FY26.startsOn);
      expect(split?.periodTo).toBe("2026-12-31");
    } finally {
      w.repository.close();
    }
  });

  it("carries last year's closing figure forward as this year's brought forward", () => {
    const w = books();
    try {
      // Read on the last day of FY 2025-26, the whole of retained earnings is 250000...
      const lastYear = w.repository.getBalanceSheet({ businessId: w.businessId, asAtDate: FY25.endsOn });
      expect(lastYear.retainedEarnings.totalPaise).toBe(250000);
      expect(lastYear.retainedEarnings.split?.startsOn).toBe(FY25.startsOn);
      expect(lastYear.retainedEarnings.split?.broughtForwardPaise).toBe(100000); // INV-A alone
      expect(lastYear.retainedEarnings.split?.profitForYearPaise).toBe(150000); // INV-B less EX-1

      // ...and that same 250000 is what the next year opens with. This is the accounting tie the
      // split exists to show, and it is NOT how either figure is computed.
      const thisYear = w.repository.getBalanceSheet({ businessId: w.businessId, asAtDate: FY26.startsOn });
      expect(thisYear.retainedEarnings.split?.broughtForwardPaise).toBe(250000);
    } finally {
      w.repository.close();
    }
  });

  it("agrees with the Profit and Loss run over the very same dates", () => {
    const w = books();
    try {
      const sheet = w.repository.getBalanceSheet({ businessId: w.businessId, asAtDate: "2026-12-31" });
      const split = sheet.retainedEarnings.split;
      if (split === null) throw new Error("expected a split: the as-at date is inside FY 2026-27");

      // Profit for the year is the P&L for that period, measured independently of this code path.
      const pl = w.repository.getProfitAndLoss({
        businessId: w.businessId, basis: "ACCRUAL",
        fromDate: split.periodFrom,
        ...(split.periodTo === null ? {} : { toDate: split.periodTo }),
      });
      expect(split.profitForYearPaise).toBe(pl.netProfitPaise);

      // And brought forward is the P&L for everything up to the day before the year began.
      const earlier = w.repository.getProfitAndLoss({
        businessId: w.businessId, basis: "ACCRUAL", toDate: "2026-03-31",
      });
      expect(split.broughtForwardPaise).toBe(earlier.netProfitPaise);
    } finally {
      w.repository.close();
    }
  });

  it("leaves the sheet itself exactly as it was: same row, same totals, still balanced", () => {
    const w = books();
    try {
      const sheet = w.repository.getBalanceSheet({ businessId: w.businessId, asAtDate: "2026-12-31" });
      // The single derived row is still there and still carries the whole figure - the split is
      // an extra reading of it, never a replacement, so nothing can double-count equity.
      const derived = sheet.equity.filter((row) => row.account === "RETAINED_EARNINGS");
      expect(derived).toHaveLength(1);
      expect(derived[0]?.balancePaise).toBe(sheet.retainedEarnings.totalPaise);
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);

      // The two parts add back to the whole, and to the row in the sheet.
      const split = sheet.retainedEarnings.split;
      expect((split?.broughtForwardPaise ?? 0) + (split?.profitForYearPaise ?? 0))
        .toBe(sheet.retainedEarnings.totalPaise);
    } finally {
      w.repository.close();
    }
  });

  it("says plainly why it cannot split, rather than guessing a year", () => {
    const w = books();
    try {
      // Consolidated: financial years belong to a business, so there is no single year to cut at.
      const consolidated = w.repository.getBalanceSheet({ asAtDate: "2026-12-31" });
      expect(consolidated.retainedEarnings.split).toBeNull();
      expect(consolidated.retainedEarnings.unsplitReason).toMatch(/every business at once/);
      // The figure itself is still reported, and still matches the row.
      const row = consolidated.equity.find((r) => r.account === "RETAINED_EARNINGS");
      expect(consolidated.retainedEarnings.totalPaise).toBe(row?.balancePaise);

      // A date no financial year covers.
      const uncovered = w.repository.getBalanceSheet({ businessId: w.businessId, asAtDate: "2030-01-01" });
      expect(uncovered.retainedEarnings.split).toBeNull();
      expect(uncovered.retainedEarnings.unsplitReason).toMatch(/No financial year covers 2030-01-01/);

      // A business with no financial years at all.
      const other = w.repository.createBusiness({ companyId: w.companyId, name: "Other" });
      const none = w.repository.getBalanceSheet({ businessId: other, asAtDate: "2026-12-31" });
      expect(none.retainedEarnings.split).toBeNull();
      expect(none.retainedEarnings.unsplitReason).toMatch(/no financial year set up yet/);
    } finally {
      w.repository.close();
    }
  });

  it("with no as-at date, still partitions every entry there is - including a future-dated one", () => {
    const w = books();
    try {
      // An entry dated beyond the year containing today. An unbounded sheet includes it, so the
      // split must too, or the two parts would no longer add back to the whole.
      w.repository.saveDraft(invoice(w, "INV-FUTURE", FY26.endsOn, 70000));
      w.repository.finalizeInvoice("INV-FUTURE");

      const sheet = w.repository.getBalanceSheet({ businessId: w.businessId });
      const split = sheet.retainedEarnings.split;
      if (split !== null) {
        expect(split.periodTo).toBeNull();
        expect(split.broughtForwardPaise + split.profitForYearPaise).toBe(sheet.retainedEarnings.totalPaise);
      } else {
        // Today falls outside every financial year defined here; it must then say so, not guess.
        expect(sheet.retainedEarnings.unsplitReason).toMatch(/No financial year covers/);
      }
      // Either way the whole figure is reported and the sheet balances.
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    } finally {
      w.repository.close();
    }
  });
});
