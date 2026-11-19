import { describe, expect, it } from "vitest";
import { AccountingRepository } from "./repository.js";
import { excludedOpeningBalances, openCustomerItemRows } from "./open-items.js";

/**
 * Session 12, section 0a: the shared open-items query — the ONE definition of what a customer
 * still owes — gained a fair filter and `includeSettled`, and had its date fallback corrected.
 *
 * The regression guard for the move itself is the 609 tests that already existed and were not
 * edited. These test only what is new, and the tie-out that matters: a fair-wise A/R total plus
 * the untagged invoices plus the opening balances must equal the consolidated total, so no
 * receivable can hide between the two views.
 */

const AS_AT = "2026-04-01";

function world() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const kochi = repository.createFair({ companyId, hostCustomerId: customerId, name: "Kochi Fair" });
  const delhi = repository.createFair({ companyId, hostCustomerId: customerId, name: "Delhi Fair" });
  const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: false });
  const bill = (
    id: string,
    paise: number,
    opts: { fairId?: string; invoiceDate?: string; dueDate?: string } = {},
  ): void => {
    repository.saveDraft({
      id, number: id, businessId, customerId, paymentAccount: "RECEIVABLES", status: "DRAFT",
      taxType: "NONE", taxRateBasisPoints: 0,
      ...(opts.invoiceDate === undefined ? {} : { invoiceDate: opts.invoiceDate }),
      ...(opts.dueDate === undefined ? {} : { dueDate: opts.dueDate }),
      ...(opts.fairId === undefined ? {} : { fairId: opts.fairId }),
      lines: [{ itemId, description: "Novel", quantity: 1, unitPricePaise: paise }],
    });
    repository.finalizeInvoice(id);
  };
  return { repository, companyId, businessId, customerId, kochi, delhi, itemId, bill };
}
type World = ReturnType<typeof world>;

/** Rs 1,000 at Kochi, Rs 600 at Delhi, Rs 400 untagged, Rs 250 opening. Nothing paid yet. */
function books(w: World): void {
  w.bill("INV-K", 100_000, { fairId: w.kochi, invoiceDate: AS_AT, dueDate: "2026-04-15" });
  w.bill("INV-D", 60_000, { fairId: w.delhi, invoiceDate: AS_AT });
  w.bill("INV-N", 40_000, { invoiceDate: AS_AT });
  w.repository.saveOpeningCustomerBalance({
    id: "OCB-1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT,
    amountPaise: 25_000, incomePaise: 0,
  });
}

const totalOf = (rows: ReadonlyArray<{ outstandingPaise: number }>): number =>
  rows.reduce((sum, row) => sum + row.outstandingPaise, 0);

describe("the shared open-items query: includeSettled", () => {
  it("drops a fully settled invoice by default and keeps it when asked, at nil outstanding", () => {
    const w = world();
    try {
      w.bill("INV-PAID", 50_000, { invoiceDate: AS_AT });
      w.bill("INV-OPEN", 30_000, { invoiceDate: AS_AT });
      w.repository.recordPayment("INV-PAID", 50_000, AS_AT);

      // The open-item list: the paid invoice is gone, which is right for receivables and ageing.
      const open = openCustomerItemRows(w.repository.db, {});
      expect(open.map((row) => row.documentId)).toEqual(["INV-OPEN"]);

      // A statement must show it, with the payment against it, or it would not add up.
      const all = openCustomerItemRows(w.repository.db, { includeSettled: true });
      expect(all.map((row) => row.documentId)).toEqual(["INV-PAID", "INV-OPEN"]);
      const paid = all.find((row) => row.documentId === "INV-PAID");
      expect(paid).toMatchObject({ totalPaise: 50_000, paidPaise: 50_000, outstandingPaise: 0 });

      // And the public reshape is untouched: it still means "open items".
      expect(w.repository.getOpenCustomerItems().map((row) => row.documentId)).toEqual(["INV-OPEN"]);
    } finally {
      w.repository.close();
    }
  });
});

describe("the shared open-items query: the fair filter", () => {
  it("returns one fair's invoices only, and no opening balances at all", () => {
    const w = world();
    try {
      books(w);
      const kochi = openCustomerItemRows(w.repository.db, { fairId: w.kochi });
      expect(kochi.map((row) => row.documentId)).toEqual(["INV-K"]);
      expect(kochi[0]?.fairId).toBe(w.kochi);
      expect(kochi[0]?.dueDate).toBe("2026-04-15");
      // An opening balance predates every fair, so it belongs to none. See OpenItemFilter.fairId.
      expect(kochi.some((row) => row.kind === "OPENING")).toBe(false);
    } finally {
      w.repository.close();
    }
  });

  it("TIE-OUT: the fairs, the untagged invoices and the openings add back to the whole", () => {
    const w = world();
    try {
      books(w);
      const db = w.repository.db;
      const consolidated = totalOf(openCustomerItemRows(db, {}));
      expect(consolidated).toBe(100_000 + 60_000 + 40_000 + 25_000); // Rs 2,250

      const kochi = totalOf(openCustomerItemRows(db, { fairId: w.kochi }));
      const delhi = totalOf(openCustomerItemRows(db, { fairId: w.delhi }));
      const untagged = totalOf(
        openCustomerItemRows(db, {}).filter((row) => row.kind === "INVOICE" && row.fairId === null),
      );
      const openings = totalOf(openCustomerItemRows(db, {}).filter((row) => row.kind === "OPENING"));

      // The only decomposition that holds: a per-fair figure plus the untagged work plus the
      // openings. "One fair plus its excluded openings" does NOT equal the whole and never did.
      expect(kochi + delhi + untagged + openings).toBe(consolidated);
      expect(kochi).toBe(100_000);
      expect(delhi).toBe(60_000);
      expect(untagged).toBe(40_000);
      expect(openings).toBe(25_000);
    } finally {
      w.repository.close();
    }
  });

  it("says what a fair filter left out, and nothing when no fair was asked for", () => {
    const w = world();
    try {
      books(w);
      expect(excludedOpeningBalances(w.repository.db, { fairId: w.kochi })).toBe(25_000);
      // Nothing was excluded when nothing was filtered, so there is nothing to disclose.
      expect(excludedOpeningBalances(w.repository.db, {})).toBe(0);
      // A receipt against the opening balance reduces what is being left out.
      w.repository.recordOpeningBalanceReceipt({
        id: "RC-1", openingCustomerBalanceId: "OCB-1", amountPaise: 10_000,
        receivedOn: AS_AT, paymentAccount: "CASH",
      });
      expect(excludedOpeningBalances(w.repository.db, { fairId: w.kochi })).toBe(15_000);
    } finally {
      w.repository.close();
    }
  });

  it("combines with the business and customer filters rather than replacing them", () => {
    const w = world();
    try {
      books(w);
      const other = w.repository.createBusiness({ companyId: w.companyId, name: "Stationery" });
      expect(openCustomerItemRows(w.repository.db, { fairId: w.kochi, businessId: other })).toEqual([]);
      expect(openCustomerItemRows(w.repository.db, { fairId: w.kochi, businessId: w.businessId }))
        .toHaveLength(1);
      const stranger = w.repository.createCustomer({ companyId: w.companyId, name: "Nobody" });
      expect(openCustomerItemRows(w.repository.db, { fairId: w.kochi, customerId: stranger })).toEqual([]);
    } finally {
      w.repository.close();
    }
  });
});

describe("the shared open-items query: the date a document bears", () => {
  /**
   * Every invoice written through `saveDraft` now stores a date (in IST — see
   * `invoice-date-ist.test.ts`), so this fallback is for rows where `invoice_date` IS NULL: the
   * column is nullable and a database that predates that rule can hold them. What matters is
   * WHICH fallback. The old one was `i.created_at`, a UTC timestamp, so such a row was dated by
   * the UTC calendar and, being a timestamp, was not even a date. It is now the POSTED entry's
   * own date, so the document and the ledger agree.
   */
  const nullTheDate = (repository: AccountingRepository, invoiceId: string): void => {
    repository.db.prepare("UPDATE invoices SET invoice_date = NULL WHERE id = ?").run(invoiceId);
  };

  it("dates a legacy row with no invoice date by its POSTED entry, not by the UTC clock", () => {
    const w = world();
    try {
      w.bill("INV-LEGACY", 70_000, { invoiceDate: "2026-04-02" });
      // The posted entry keeps 2 April; only the invoice's own column is emptied, exactly as a
      // row written before invoice_date was always populated would look.
      nullTheDate(w.repository, "INV-LEGACY");
      const stored = w.repository.db
        .prepare("SELECT created_at FROM invoices WHERE id = ?")
        .get("INV-LEGACY") as { created_at: string };

      const row = openCustomerItemRows(w.repository.db, {})[0];
      expect(row?.documentId).toBe("INV-LEGACY");
      expect(row?.date).toBe("2026-04-02");
      // Not the timestamp it used to fall back to, and a DATE, so nothing downstream must slice it.
      expect(row?.date).not.toBe(stored.created_at);
      expect(row?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The ageing report reads the same rows, so it agrees.
      expect(w.repository.getReceivables()[0]?.invoiceDate).toBe("2026-04-02");
    } finally {
      w.repository.close();
    }
  });

  it("leaves an invoice that has its own date exactly as it was", () => {
    const w = world();
    try {
      w.bill("INV-DATED", 70_000, { invoiceDate: "2026-03-20" });
      expect(openCustomerItemRows(w.repository.db, {})[0]?.date).toBe("2026-03-20");
    } finally {
      w.repository.close();
    }
  });
});
