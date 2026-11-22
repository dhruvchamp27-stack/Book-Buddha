import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { migrations, runMigrations } from "./migrations.js";
import { applyPaymentCancellationSchema } from "./payment-cancellation-schema.js";
import { AccountingRepository } from "./repository.js";
import type { Invoice } from "../accounting/types.js";
import { moveToday, todayAt } from "./test-clock.js";

/**
 * R8 — cancelling a payment, by reversal.
 *
 * Until v17 a recorded payment could not be undone at all: the only ways out were to delete the
 * row, destroying the record, or to leave a wrong receipt standing for good. Both sit badly
 * against cancel-with-reversal, a fixed rule of this project.
 *
 * Nothing is deleted. The row is marked cancelled, the ORIGINAL entry is left exactly as it was
 * posted, and a reversing entry is posted beside it dated today.
 */

const at = (version: number) => migrations.filter((m) => m.version <= version);

describe("migration v17 adds the cancellation columns without touching anything else", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });
  afterEach(() => db.close());

  it("applies to a v16 database that already holds payments, and leaves them live", () => {
    // Build to v16 ONLY, so v17's own body is what runs below. Running the whole chain on an
    // empty database would test nothing: the columns would be there before the rows were.
    runMigrations(db, at(16));
    expect((db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as { version: number }).version).toBe(16);

    const columns = (table: string): string[] =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns("payments")).not.toContain("cancelled_at");
    expect(columns("supplier_payments")).not.toContain("cancelled_at");

    // Survivors, inserted by raw SQL exactly as a real v16 database would hold them.
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('co', 'Co', '2026-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu', 'co', 'Cust', '2026-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO businesses (id, company_id, name, created_at) VALUES ('bu', 'co', 'Biz', '2026-01-01T00:00:00.000Z')").run();
    db.prepare(
      "INSERT INTO invoices (id, number, business_id, customer_id, invoice_date, status, payment_account, created_at)"
      + " VALUES ('inv', 'INV-1', 'bu', 'cu', '2026-01-05', 'FINALIZED', 'RECEIVABLES', '2026-01-05T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at)"
      + " VALUES ('pay1', 'inv', 12345, 'CASH', '2026-01-06T12:00:00.000Z')",
    ).run();
    const before = db.prepare("SELECT id, invoice_id, amount_paise, paid_at FROM payments").all();

    // Apply v17's body DIRECTLY. A second runMigrations would be a no-op on an up-to-date db.
    applyPaymentCancellationSchema(db);

    for (const table of ["payments", "supplier_payments"]) {
      expect(columns(table), table).toContain("cancelled_at");
      expect(columns(table), table).toContain("cancellation_reason");
    }
    // The payment that was already there is untouched, and is LIVE: NULL is what live means.
    expect(db.prepare("SELECT id, invoice_id, amount_paise, paid_at FROM payments").all()).toEqual(before);
    expect((db.prepare("SELECT cancelled_at, cancellation_reason FROM payments WHERE id = 'pay1'").get() as {
      cancelled_at: string | null; cancellation_reason: string | null;
    })).toEqual({ cancelled_at: null, cancellation_reason: null });

    // Re-running is a no-op rather than an error, and adds no second copy of either column.
    expect(() => applyPaymentCancellationSchema(db)).not.toThrow();
    expect(columns("payments").filter((c) => c === "cancelled_at")).toHaveLength(1);
  });

  it("is registered as v17 and rebuilds no table, so no trigger needs replaying", () => {
    const v17 = migrations.find((m) => m.version === 17);
    expect(v17?.name).toBe("payment_cancellation");
    expect(migrations.filter((m) => m.version === 17)).toHaveLength(1);

    runMigrations(db, at(16));
    const triggersBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    applyPaymentCancellationSchema(db);
    expect(db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()).toEqual(triggersBefore);
  });
});

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  customerId: string;
  supplierId: string;
  itemId: string;
}

function setup(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2026-01-01"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Asha" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: false });
  return { repository, companyId, businessId, customerId, supplierId, itemId };
}

function invoice(w: World, id: string, date: string, paise: number): Invoice {
  return {
    id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate: date,
    status: "DRAFT", paymentAccount: "RECEIVABLES", taxType: "NONE", taxRateBasisPoints: 0,
    lines: [{ itemId: w.itemId, description: "Novel", quantity: 1, unitPricePaise: paise }],
  };
}

/** An account's balance straight off the journal: debits less credits. */
function balancePaise(repository: AccountingRepository, account: string): number {
  const row = repository.db
    .prepare("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) AS balance FROM journal_lines WHERE account = ?")
    .get(account) as { balance: number };
  return row.balance;
}

describe("R8: cancelling a customer payment", () => {
  it("puts the money back to owed, without deleting or touching the original entry", () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      const payment = w.repository.recordPayment("INV-1", 100000, "2026-05-20");

      expect(balancePaise(w.repository, "RECEIVABLES")).toBe(0);
      expect(balancePaise(w.repository, "CASH")).toBe(100000);
      expect(w.repository.getReceivables()).toHaveLength(0);

      const originalBefore = w.repository.db
        .prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
        .all(`je-payment-${payment.id}`);

      const reversal = w.repository.cancelPayment(payment.id, "Cheque bounced");

      // The ledger is back where it was before the receipt.
      expect(balancePaise(w.repository, "RECEIVABLES")).toBe(100000);
      expect(balancePaise(w.repository, "CASH")).toBe(0);
      // ...and the invoice is outstanding again, from the same open-items query the ageing uses.
      const open = w.repository.getReceivables();
      expect(open).toHaveLength(1);
      expect(open[0]?.outstandingPaise).toBe(100000);
      expect(open[0]?.paidPaise).toBe(0);
      expect(w.repository.getReceivablesAgeing().totalOutstandingPaise).toBe(100000);

      // NOTHING WAS DELETED: the row is still there, now marked.
      const rows = w.repository.listPayments("INV-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountPaise).toBe(100000);
      expect(rows[0]?.cancelledAt).not.toBeNull();
      expect(rows[0]?.cancellationReason).toBe("Cheque bounced");

      // The ORIGINAL entry is byte-for-byte as it was posted; the reversal sits beside it.
      expect(w.repository.db
        .prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
        .all(`je-payment-${payment.id}`)).toEqual(originalBefore);
      expect(reversal.id).toBe(`je-payment-${payment.id}-reversal`);
      expect(reversal.isReversal).toBe(true);
      // The reversal is this entry's own lines flipped, never rebuilt from the document.
      expect(reversal.lines.map((line) => ({ account: line.account, debitPaise: line.debitPaise, creditPaise: line.creditPaise })))
        .toEqual(originalBefore.map((line) => {
          const row = line as { account: string; debit_paise: number; credit_paise: number };
          return { account: row.account, debitPaise: row.credit_paise, creditPaise: row.debit_paise };
        }));
    } finally {
      w.repository.close();
    }
  });

  it("refuses a second cancellation, and an unknown payment", () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      const payment = w.repository.recordPayment("INV-1", 40000, "2026-05-20");
      w.repository.cancelPayment(payment.id);
      expect(() => w.repository.cancelPayment(payment.id)).toThrow(/already been cancelled/);
      expect(() => w.repository.cancelPayment("nope")).toThrow(/not found/);
      // One reversal only: a second would double the money back.
      expect(balancePaise(w.repository, "RECEIVABLES")).toBe(100000);
    } finally {
      w.repository.close();
    }
  });

  it("frees the invoice to be cancelled, which the payment used to block for good", () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      const payment = w.repository.recordPayment("INV-1", 100000, "2026-05-20");
      // This is the dead end R8 closes: a paid invoice could not be cancelled and the payment
      // could not be undone, so a mistake on either was permanent.
      expect(() => w.repository.cancelInvoice("INV-1")).toThrow(/recorded payments/);

      w.repository.cancelPayment(payment.id);
      expect(() => w.repository.cancelInvoice("INV-1")).not.toThrow();

      // Everything nets to zero: no account is left carrying a trace of either document.
      for (const account of ["RECEIVABLES", "CASH", "SALES"]) {
        expect(balancePaise(w.repository, account), account).toBe(0);
      }
      expect(w.repository.getReceivables()).toHaveLength(0);
    } finally {
      w.repository.close();
    }
  });

  it("keeps open items and the receivables control account agreeing when a credit note is involved", () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      const payment = w.repository.recordPayment("INV-1", 60000, "2026-05-20");
      w.repository.saveCreditNote({
        id: "cn1", invoiceId: "INV-1", number: "CN-1", reason: "Returned", status: "DRAFT",
        lines: [{ itemId: w.itemId, description: "Returned", quantity: 1, unitPricePaise: 40000 }],
      });
      w.repository.finalizeCreditNote("cn1");

      const openTotal = (): number => w.repository.getReceivables().reduce((sum, row) => sum + row.outstandingPaise, 0);
      // Paid 60,000 and credited 40,000 against a 100,000 invoice: nothing left owing.
      expect(openTotal()).toBe(0);
      expect(openTotal()).toBe(balancePaise(w.repository, "RECEIVABLES"));

      // Now undo the receipt. The credit note still stands, so 60,000 goes back to owed and the
      // two definitions of "owed" must STILL agree -- this is the ordering that would expose a
      // cancelled payment being counted in one place and not the other.
      w.repository.cancelPayment(payment.id);
      expect(openTotal()).toBe(60000);
      expect(openTotal()).toBe(balancePaise(w.repository, "RECEIVABLES"));
      expect(w.repository.getReceivablesAgeing().totalOutstandingPaise).toBe(60000);
    } finally {
      w.repository.close();
    }
  });

  it("holds up when the invoice was paid IN FULL first and the note became customer credit", () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      // Paid in full FIRST, so the later note cannot reduce an outstanding balance -- it has to
      // go to customer credit instead. This is the ordering that would expose a cancelled
      // payment being counted in one place and not another.
      const payment = w.repository.recordPayment("INV-1", 100000, "2026-05-20");
      w.repository.saveCreditNote({
        id: "cn1", invoiceId: "INV-1", number: "CN-1", reason: "Returned", status: "DRAFT",
        lines: [{ itemId: w.itemId, description: "Returned", quantity: 1, unitPricePaise: 40000 }],
      });
      w.repository.finalizeCreditNote("cn1");

      const openTotal = (): number => w.repository.getReceivables().reduce((sum, row) => sum + row.outstandingPaise, 0);
      expect(openTotal()).toBe(balancePaise(w.repository, "RECEIVABLES"));

      w.repository.cancelPayment(payment.id);

      // The two definitions of "owed" still agree after the receipt is undone.
      expect(openTotal()).toBe(balancePaise(w.repository, "RECEIVABLES"));
      expect(w.repository.getReceivablesAgeing().totalOutstandingPaise).toBe(openTotal());

      // And the guard that matters: cancelling the INVOICE now would reverse the whole 100,000
      // of SALES while a 40,000 note stands against it, leaving SALES in DEBIT -- the exact
      // defect cancelInvoice's own comment describes. It must refuse.
      expect(() => w.repository.cancelInvoice("INV-1")).toThrow();
      expect(balancePaise(w.repository, "SALES")).toBeLessThanOrEqual(0); // credit-normal: never debit
    } finally {
      w.repository.close();
    }
  });

  it("refuses to cancel into a locked year, because the reversal is dated today", () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      const payment = w.repository.recordPayment("INV-1", 100000, "2026-05-20");

      // A year covering TODAY, locked. The payment's own period is irrelevant: the correction
      // lands today, so today is the period that has to be open.
      const today = w.repository.today(); // the pinned clock (ruling G)
      const year = w.repository.createFinancialYear({
        businessId: w.businessId, startsOn: `${today.slice(0, 4)}-01-01`, endsOn: `${today.slice(0, 4)}-12-31`,
      });
      w.repository.setFinancialYearLocked(year, true);
      expect(() => w.repository.cancelPayment(payment.id)).toThrow(/locked/);

      // Nothing was half-done: the row is still live and the ledger has not moved.
      expect(w.repository.listPayments("INV-1")[0]?.cancelledAt).toBeNull();
      expect(balancePaise(w.repository, "RECEIVABLES")).toBe(0);

      w.repository.setFinancialYearLocked(year, false);
      expect(() => w.repository.cancelPayment(payment.id)).not.toThrow();
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: what a cancellation does to the two bases is NOT symmetric", () => {
  it("S16-7(3), replacing S8-1: both bases keep May as reported; the cash correction lands in the cancellation's own month", () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      const payment = w.repository.recordPayment("INV-1", 100000, "2026-05-20");

      const may = { businessId: w.businessId, basis: "CASH", fromDate: "2026-05-01", toDate: "2026-05-31" } as const;
      expect(w.repository.getProfitAndLoss(may).netProfitPaise).toBe(100000);

      // Ruling G: "today" is the repository's clock. Move it to June so the cancellation lands in a
      // LATER month than May, which is what this test is about (the suite used to rely on the wall clock).
      moveToday(w.repository, "2026-06-15");
      w.repository.cancelPayment(payment.id);

      // CASH (owner ruling S16-7(3), which REPLACES the old S8-1 rule that took the collection
      // back out of May): May stays at 100,000, a closed month never changes. The take-back is
      // dated by the reversal journal entry (today), so it shows there as minus 100,000.
      expect(w.repository.getProfitAndLoss(may).netProfitPaise).toBe(100000);
      const today = w.repository.today();
      expect(w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "CASH", fromDate: today, toDate: today }).netProfitPaise).toBe(-100000);
      expect(w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "CASH" }).netProfitPaise).toBe(0);

      // ACCRUAL: May is untouched; the reversal is dated today, so the correction lands today.
      const mayAccrual = { businessId: w.businessId, basis: "ACCRUAL", fromDate: "2026-05-01", toDate: "2026-05-31" } as const;
      expect(w.repository.getProfitAndLoss(mayAccrual).netProfitPaise).toBe(100000);
      expect(w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "ACCRUAL" }).netProfitPaise).toBe(100000);

      // The two bases now agree on the principle: a reported month is never rewritten.
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: cancelling a supplier payment", () => {
  it("mirrors the customer side and puts the bill back to owed", () => {
    const w = setup();
    try {
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "PB-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: 70000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);
      const payment = w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 70000, paidOn: "2026-05-20" });

      expect(w.repository.getPurchaseBill(bill.id).paidPaise).toBe(70000);
      expect(w.repository.getPayables()).toHaveLength(0);
      expect(balancePaise(w.repository, "CASH")).toBe(-70000);

      const reversal = w.repository.cancelSupplierPayment(payment.id, "Paid twice by mistake");
      expect(reversal.id).toBe(`je-supplier-payment-${payment.id}-reversal`);
      expect(reversal.isReversal).toBe(true);

      expect(w.repository.getPurchaseBill(bill.id).paidPaise).toBe(0);
      expect(balancePaise(w.repository, "CASH")).toBe(0);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-70000); // credit balance: owed again
      const payables = w.repository.getPayables();
      expect(payables).toHaveLength(1);
      expect(payables[0]?.outstandingPaise).toBe(70000);
      expect(w.repository.getPayablesAgeing().totalOutstandingPaise).toBe(70000);

      // The row stays, marked; and the bill can now be cancelled, which the payment blocked.
      const rows = w.repository.listSupplierPayments({ billId: bill.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.cancelledAt).not.toBeNull();
      expect(rows[0]?.cancellationReason).toBe("Paid twice by mistake");

      // The supplier STATEMENT must agree with getPayables. listSupplierPayments keeps the
      // cancelled row (nothing is deleted), so a statement that counted it would go on
      // reducing the closing balance and quietly disagree with what is owed.
      const statement = w.repository.getSupplierStatement(w.supplierId);
      expect(statement.closingBalancePaise).toBe(70000);
      expect(statement.rows.filter((row) => row.type === "PAYMENT")).toEqual([]);
      expect(statement.closingBalancePaise)
        .toBe(w.repository.getPayables().reduce((sum, row) => sum + row.outstandingPaise, 0));

      expect(() => w.repository.cancelPurchaseBill(bill.id)).not.toThrow();

      expect(() => w.repository.cancelSupplierPayment(payment.id)).toThrow(/already been cancelled/);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: cancelling a payment over HTTP", () => {
  it("cancels on both routes and refuses a double cancel with a 400", async () => {
    const w = setup();
    try {
      w.repository.saveDraft(invoice(w, "INV-1", "2026-05-10", 100000));
      w.repository.finalizeInvoice("INV-1");
      const payment = w.repository.recordPayment("INV-1", 100000, "2026-05-20");

      const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
      const cancel = async (url: string, body: unknown) =>
        app.inject({ method: "POST", url, payload: body as never });

      const first = await cancel(`/payments/${payment.id}/cancel`, { reason: "Cheque bounced" });
      expect(first.statusCode).toBe(200);
      expect(first.json<{ reversalEntry: { isReversal: boolean } }>().reversalEntry.isReversal).toBe(true);
      expect(w.repository.getReceivables()[0]?.outstandingPaise).toBe(100000);

      expect((await cancel(`/payments/${payment.id}/cancel`, {})).statusCode).toBe(400);
      expect((await cancel("/payments/nope/cancel", {})).statusCode).toBe(400);

      // The supplier route, and an unknown field refused rather than ignored.
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "PB-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: 70000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);
      const supplierPayment = w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 70000 });
      expect((await cancel(`/supplier-payments/${supplierPayment.id}/cancel`, { nonsense: 1 })).statusCode).toBe(400);
      expect((await cancel(`/supplier-payments/${supplierPayment.id}/cancel`, {})).statusCode).toBe(200);
      expect(w.repository.getPurchaseBill(bill.id).paidPaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});
