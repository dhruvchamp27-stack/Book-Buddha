import { describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";
import {
  creditNoteReport, salesByBusiness, salesByCustomer, salesByFair, salesByItem, salesByTax, salesReturnReport,
} from "./reports-sales.js";
import { stockMovementReport, transactionDetailByAccount, transactionListByDate } from "./reports-transactions.js";

// S11-9: a report for a fair that does not exist must say so, not return zero rows (which reads as
// "no sales at that fair"). A real fair with no activity still legitimately yields an empty report.

interface World { repository: AccountingRepository; fairA: string; fairB: string }

function setup(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co" });
  const businessId = repository.createBusiness({ companyId, name: "Books A" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  const itemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const fairA = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair A" });
  const fairB = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair B" });
  const bill = repository.createPurchaseBill({
    id: "B0", businessId, supplierId, number: "B0", billDate: "2026-10-01", paymentAccount: "CASH",
    lines: [{ itemId, description: "Atlas", quantity: 20, unitPricePaise: 4000 }],
  });
  repository.finalizePurchaseBill(bill.id);
  const sell = (id: string, quantity: number, fairId: string, date: string): void => {
    repository.saveDraft({
      id, number: id, businessId, customerId, paymentAccount: "CASH", status: "DRAFT", fairId, invoiceDate: date,
      lines: [{ itemId, description: "Atlas", quantity, unitPricePaise: 10000 }],
    });
    repository.finalizeInvoice(id);
  };
  sell("IA", 4, fairA, "2026-11-05"); // Fair A: 40,000
  sell("IB", 2, fairB, "2026-11-08"); // Fair B: 20,000
  // Fair A returns 1 Atlas at 10,000: Fair A nets to 30,000 of sales with a 10,000 credit note.
  repository.saveCreditNote({
    id: "CNA", invoiceId: "IA", number: "CN-A", reason: "Return", status: "DRAFT",
    lines: [{ itemId, description: "Atlas", quantity: 1, unitPricePaise: 10000 }],
  });
  repository.finalizeCreditNote("CNA");
  return { repository, fairA, fairB };
}

type Run = (w: World, fairId?: string) => unknown;
const f = (fairId: string | undefined): { fairId?: string } => (fairId === undefined ? {} : { fairId });
/** The one customer in this world (the fair host, who is also the buyer). */
/**
 * setup() sells for CASH, so nothing is owed. The open-items reports need an unpaid invoice in Fair A
 * to have data to return; it is added only by the entries that need it, so every other entry keeps
 * the exact figures above. Idempotent per world.
 */
function withUnpaidInvoice(w: World): World {
  const one = (sql: string): string => (w.repository.db.prepare(sql).get() as { id: string }).id;
  if (w.repository.db.prepare("SELECT 1 FROM invoices WHERE id = 'IR'").get() !== undefined) return w;
  w.repository.saveDraft({
    id: "IR", number: "IR", businessId: one("SELECT id FROM businesses LIMIT 1"), customerId: one("SELECT id FROM customers LIMIT 1"),
    paymentAccount: "RECEIVABLES", status: "DRAFT", fairId: w.fairA, invoiceDate: "2026-11-06",
    lines: [{ itemId: one("SELECT id FROM items LIMIT 1"), description: "Atlas", quantity: 1, unitPricePaise: 10000 }],
  });
  w.repository.finalizeInvoice("IR");
  return w;
}
const hostCustomer = (w: World): string => (w.repository.db.prepare("SELECT id FROM customers LIMIT 1").get() as { id: string }).id;

/** All ten public entry points (the trial balance, P&L and balance-sheet rows share one of them). */
const ENTRY_POINTS: ReadonlyArray<{ name: string; run: Run; real: (result: any) => void }> = [
  { name: "reportConditions wrapper (getProfitAndLoss)", run: (w, id) => w.repository.getProfitAndLoss(f(id)), real: (r) => expect(r.totalIncomePaise).toBe(30000) },
  { name: "reportConditions wrapper (getTrialBalance)", run: (w, id) => w.repository.getTrialBalance(f(id)), real: (r) => expect(r.find((x: { account: string }) => x.account === "SALES").creditPaise).toBe(30000) },
  { name: "reportConditions wrapper (getGeneralLedger)", run: (w, id) => w.repository.getGeneralLedger(f(id)), real: (r) => expect(r.length).toBeGreaterThan(0) },
  { name: "reportConditions wrapper (deriveCashView)", run: (w, id) => w.repository.deriveCashView(f(id)), real: (r) => expect(r.recognitions.every((x: { documentId: string }) => x.documentId === "IA")).toBe(true) },
  { name: "salesByCustomer", run: (w, id) => salesByCustomer(w.repository.db, f(id)), real: (r) => expect(r.totals).toMatchObject({ invoicedPaise: 40000, creditNotesPaise: 10000, netSalesPaise: 30000 }) },
  { name: "salesByBusiness", run: (w, id) => salesByBusiness(w.repository.db, f(id)), real: (r) => expect(r.totals).toMatchObject({ invoicedPaise: 40000, creditNotesPaise: 10000, netSalesPaise: 30000 }) },
  { name: "salesByFair", run: (w, id) => salesByFair(w.repository.db, f(id)), real: (r) => expect(r.totals).toMatchObject({ invoicedPaise: 40000, creditNotesPaise: 10000, netSalesPaise: 30000 }) },
  { name: "salesByTax", run: (w, id) => salesByTax(w.repository.db, f(id)), real: (r) => expect(r.totals).toMatchObject({ invoicedPaise: 40000, creditNotesPaise: 10000, netSalesPaise: 30000 }) },
  { name: "creditNoteReport", run: (w, id) => creditNoteReport(w.repository.db, f(id)), real: (r) => { expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ creditNoteId: "CNA", invoiceId: "IA", taxablePaise: 10000, valuePaise: 10000 }); expect(r.totals.valuePaise).toBe(10000); } },
  { name: "salesReturnReport", run: (w, id) => salesReturnReport(w.repository.db, f(id)), real: (r) => { expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ creditNoteId: "CNA", itemName: "Atlas", quantity: 1, valuePaise: 10000 }); expect(r.byItem).toHaveLength(1); expect(r.totalValuePaise).toBe(10000); } },
  { name: "salesByItem", run: (w, id) => salesByItem(w.repository.db, f(id)), real: (r) => expect(r.length).toBeGreaterThan(0) },
  { name: "transactionListByDate", run: (w, id) => transactionListByDate(w.repository.db, f(id)), real: (r) => expect(r.length).toBeGreaterThan(0) },
  { name: "transactionDetailByAccount", run: (w, id) => transactionDetailByAccount(w.repository.db, f(id)), real: (r) => expect(r.length).toBeGreaterThan(0) },
  { name: "stockMovementReport", run: (w, id) => stockMovementReport(w.repository.db, f(id)), real: (r) => expect(r.length).toBeGreaterThan(0) },
  // Session 12: the four customer / profitability reports, and getReceivables now that it takes a fair.
  { name: "getReceivables (fairId)", run: (w, id) => withUnpaidInvoice(w).repository.getReceivables(f(id)), real: (r) => { expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ invoiceId: "IR", outstandingPaise: 10000 }); } },
  { name: "getCustomerStatement", run: (w, id) => withUnpaidInvoice(w).repository.getCustomerStatement({ customerId: hostCustomer(w), ...f(id) }), real: (r) => expect(r.rows.length).toBeGreaterThan(0) },
  { name: "getCustomerBalanceDetail", run: (w, id) => withUnpaidInvoice(w).repository.getCustomerBalanceDetail(f(id)), real: (r) => expect(r.totalPaise).toBeGreaterThan(0) },
  { name: "getCollections", run: (w, id) => withUnpaidInvoice(w).repository.getCollections(f(id)), real: (r) => expect(r.rows.length).toBeGreaterThan(0) },
  { name: "getItemProfitability", run: (w, id) => w.repository.getItemProfitability(f(id)), real: (r) => expect(r.rows.length).toBeGreaterThan(0) },
];

describe("a report for an unknown fair is an error, not an empty report (S11-9)", () => {
  for (const entry of ENTRY_POINTS) {
    it(`${entry.name}: an unknown fair throws and names it`, () => {
      const w = setup();
      try {
        expect(() => entry.run(w, "no-such-fair")).toThrow(RepositoryValidationError);
        expect(() => entry.run(w, "no-such-fair")).toThrow(/Fair no-such-fair was not found/);
      } finally {
        w.repository.close();
      }
    });

    it(`${entry.name}: a real fair still returns its data`, () => {
      const w = setup();
      try {
        entry.real(entry.run(w, w.fairA));
      } finally {
        w.repository.close();
      }
    });

    it(`${entry.name}: omitting fairId is still consolidated, and an empty fairId is refused`, () => {
      const w = setup();
      try {
        expect(() => entry.run(w)).not.toThrow();
        expect(() => entry.run(w, "")).toThrow(/A project \(fair\) id cannot be empty/);
        expect(() => entry.run(w, "   ")).toThrow(RepositoryValidationError);
      } finally {
        w.repository.close();
      }
    });
  }

  it("a real fair with no activity is a legitimately empty report", () => {
    const w = setup();
    try {
      const idle = w.repository.createFair({
        companyId: (w.repository.db.prepare("SELECT company_id AS c FROM fairs WHERE id = ?").get(w.fairA) as { c: string }).c,
        hostCustomerId: (w.repository.db.prepare("SELECT host_customer_id AS c FROM fairs WHERE id = ?").get(w.fairA) as { c: string }).c,
        name: "Idle Fair",
      });
      expect(salesByCustomer(w.repository.db, { fairId: idle }).rows).toEqual([]);
      expect(w.repository.getProfitAndLoss({ fairId: idle }).totalIncomePaise).toBe(0);
      expect(transactionListByDate(w.repository.db, { fairId: idle })).toEqual([]);
    } finally {
      w.repository.close();
    }
  });
});
