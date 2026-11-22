import { describe, expect, it } from "vitest";
import { AccountingRepository } from "./repository.js";
import type { CreditNote, Invoice } from "../accounting/types.js";
import { todayAt } from "./test-clock.js";

/**
 * R3 — the two CONFIRMED money defects. Both were silent: no error, no test, wrong figures.
 * Each test here fails on the pre-fix code, which is the only thing that makes it a regression
 * test rather than a restatement of the new behaviour.
 *
 *  1. recordPayment capped against the ORIGINAL invoice total and counted only the `payments`
 *     table, so a credit note did not reduce what could still be paid. On a credited invoice the
 *     customer could overpay and drive RECEIVABLES NEGATIVE, with no refund path to undo it.
 *  2. validateCreditNoteLines compared a TAXABLE credit sum against the TAX-INCLUSIVE invoice
 *     total, so an 18% invoice could be over-credited by a further 18% - and the note's own GST
 *     was then added on top of that.
 */
type World = { repository: AccountingRepository; businessId: string; customerId: string; itemId: string };

function world(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2026-01-01"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Business" });
  const customerId = repository.createCustomer({ companyId, name: "Customer" });
  const itemId = repository.createItem({ companyId, name: "Item", unit: "each", trackStock: false });
  return { repository, businessId, customerId, itemId };
}

function finalizedInvoice(
  w: World,
  options: { id?: string; unitPricePaise: number; quantity?: number; taxRateBasisPoints?: number; discountPaise?: number },
): Invoice {
  const rate = options.taxRateBasisPoints ?? 0;
  const invoice: Invoice = {
    id: options.id ?? "inv1",
    number: `INV-${options.id ?? "inv1"}`,
    businessId: w.businessId,
    customerId: w.customerId,
    invoiceDate: "2026-01-01",
    status: "DRAFT",
    paymentAccount: "RECEIVABLES",
    taxType: rate === 0 ? "NONE" : "CGST_SGST",
    taxRateBasisPoints: rate,
    ...(options.discountPaise === undefined ? {} : { discountPaise: options.discountPaise }),
    lines: [{ itemId: w.itemId, description: "Line", quantity: options.quantity ?? 1, unitPricePaise: options.unitPricePaise }],
  };
  w.repository.saveDraft(invoice);
  w.repository.finalizeInvoice(invoice.id);
  return invoice;
}

function creditNote(w: World, invoice: Invoice, id: string, taxablePaise: number): CreditNote {
  return {
    id,
    invoiceId: invoice.id,
    number: `CN-${id}`,
    reason: "Return",
    status: "DRAFT",
    lines: [{ itemId: w.itemId, description: "Returned", quantity: 1, unitPricePaise: taxablePaise }],
  };
}

/** The CUSTOMER_CREDITS balance for one invoice, as a POSITIVE amount owed back. */
function customerCreditsPaise(repository: AccountingRepository, invoiceId: string): number {
  const row = repository.db
    .prepare(
      `SELECT COALESCE(SUM(jl.credit_paise), 0) - COALESCE(SUM(jl.debit_paise), 0) AS balance
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.source_id = ? AND jl.account = 'CUSTOMER_CREDITS'`,
    )
    .get(invoiceId) as { balance: number };
  return row.balance;
}

/** The RECEIVABLES control balance straight from the ledger: debits less credits. */
function receivablesPaise(repository: AccountingRepository, invoiceId: string): number {
  const row = repository.db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS balance
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.source_id = ? AND jl.account = 'RECEIVABLES'`,
    )
    .get(invoiceId) as { balance: number };
  return row.balance;
}

/** Net output GST still owed on this invoice: credit-normal, so credits less debits. */
function outputTaxPaise(repository: AccountingRepository, invoiceId: string): number {
  const row = repository.db
    .prepare(
      `SELECT COALESCE(SUM(jl.credit_paise), 0) - COALESCE(SUM(jl.debit_paise), 0) AS balance
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.source_id = ? AND jl.account LIKE 'OUTPUT_%'`,
    )
    .get(invoiceId) as { balance: number };
  return row.balance;
}

/** Net GST still owed on ONE output account for this invoice. */
function taxPaise(repository: AccountingRepository, invoiceId: string, account: string): number {
  const row = repository.db
    .prepare(
      `SELECT COALESCE(SUM(jl.credit_paise), 0) - COALESCE(SUM(jl.debit_paise), 0) AS balance
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.source_id = ? AND jl.account = ?`,
    )
    .get(invoiceId, account) as { balance: number };
  return row.balance;
}

describe("DEFECT 1: a credit note must reduce what the customer can still pay", () => {
  it("refuses a payment of the original total once a credit note is finalized", () => {
    const w = world();
    try {
      // 1000.00 invoice, no tax. Credit note for 400.00. Only 600.00 is still owed.
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000 });
      expect(receivablesPaise(w.repository, invoice.id)).toBe(100000);
      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 40000));
      w.repository.finalizeCreditNote("cn1");
      expect(receivablesPaise(w.repository, invoice.id)).toBe(60000);

      // THE DEFECT: this used to succeed, leaving RECEIVABLES at -40000.
      expect(() => w.repository.recordPayment(invoice.id, 100000)).toThrow(/outstanding balance of 60000 paise/);
      expect(() => w.repository.recordPayment(invoice.id, 60001)).toThrow(/outstanding balance/);

      // The real remainder settles exactly, and the control account lands on zero.
      w.repository.recordPayment(invoice.id, 60000);
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
      expect(() => w.repository.recordPayment(invoice.id, 1)).toThrow(/outstanding balance of 0 paise/);
    } finally {
      w.repository.close();
    }
  });

  it("nets a credit note against cash ALREADY received, in either order", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000 });
      w.repository.recordPayment(invoice.id, 70000); // paid first
      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 20000));
      w.repository.finalizeCreditNote("cn1"); // credited after
      // 100000 - 20000 credited - 70000 paid = 10000 left.
      expect(() => w.repository.recordPayment(invoice.id, 10001)).toThrow(/outstanding balance of 10000 paise/);
      w.repository.recordPayment(invoice.id, 10000);
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("takes a fully credited invoice off the receivables list and allows no further payment", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000 });
      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 100000));
      w.repository.finalizeCreditNote("cn1"); // fully credited: nothing is owed
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
      expect(() => w.repository.recordPayment(invoice.id, 1)).toThrow(/outstanding balance of 0 paise/);

      // SAME DEFECT in the receivables report: a fully credited invoice used to stay on the list
      // at its full value, because the outstanding figure ignored credit notes.
      expect(w.repository.getReceivables().find((r) => r.invoiceId === invoice.id)).toBeUndefined();
    } finally {
      w.repository.close();
    }
  });

  it("reports outstanding net of credits on a part-credited, part-paid invoice", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000 });
      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 25000));
      w.repository.finalizeCreditNote("cn1");
      w.repository.recordPayment(invoice.id, 30000);
      const row = w.repository.getReceivables().find((r) => r.invoiceId === invoice.id);
      expect(row).toMatchObject({ totalPaise: 100000, creditedPaise: 25000, paidPaise: 30000, outstandingPaise: 45000 });
      expect(row?.outstandingPaise).toBe(receivablesPaise(w.repository, invoice.id));
    } finally {
      w.repository.close();
    }
  });

  it("never hands back more GST than the invoice charged, whatever the per-note rounding", () => {
    const w = world();
    try {
      // 2 x 25 paise at 18%: the invoice charges 9 paise of GST (round(9.0)), but a note of 25
      // rounds to 5 (round(4.5) goes up). Two such notes would hand back 10 - one paisa more than
      // was ever charged - leaving RECEIVABLES at -1 and output SGST with a DEBIT balance, i.e. a
      // negative liability. The second note's tax is clamped to the 4 paise of headroom instead.
      const invoice = finalizedInvoice(w, { unitPricePaise: 25, quantity: 2, taxRateBasisPoints: 1800 });
      const total = 50 + 9;
      expect(receivablesPaise(w.repository, invoice.id)).toBe(total);

      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 25));
      w.repository.finalizeCreditNote("cn1");
      w.repository.saveCreditNote(creditNote(w, invoice, "cn2", 25));
      w.repository.finalizeCreditNote("cn2");

      // A full return clears the invoice EXACTLY - never past it.
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
      expect(outputTaxPaise(w.repository, invoice.id)).toBe(0);
      expect(() => w.repository.recordPayment(invoice.id, 1)).toThrow(/outstanding balance of 0 paise/);
    } finally {
      w.repository.close();
    }
  });

  it("credits an invoice the customer has ALREADY paid, as a liability rather than a negative asset", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000 });
      w.repository.recordPayment(invoice.id, 100000);
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);

      // THE ORIGINAL DEFECT: this was once accepted silently and left RECEIVABLES at -40000 -
      // the books saying money was due back, with no way to pay it - and getReceivables then hid
      // the row behind its "outstanding > 0" filter. S3-3 refused the note outright as a stopgap.
      // S4-1 (owner, 2026-11-17) builds the real path instead: the note is allowed, and what it
      // is worth beyond the open balance becomes CUSTOMER_CREDITS, a liability that can be
      // refunded or set against a later invoice.
      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 40000));
      w.repository.finalizeCreditNote("cn1");
      // The defect itself is still fixed: receivables stop at zero, they do not go negative.
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
      expect(customerCreditsPaise(w.repository, invoice.id)).toBe(40000);
      expect(w.repository.getCreditNoteBalance("cn1")).toMatchObject({ refundablePaise: 40000, outstandingPaise: 40000 });
      // Nothing is owed BY the customer, so no receivable row appears for them either.
      expect(w.repository.getReceivables().filter((r) => r.invoiceId === invoice.id)).toHaveLength(0);

      // Part-paid: the note SPLITS - 30,000 comes off what is still owed, 1 paisa is owed back.
      const other = finalizedInvoice(w, { id: "inv2", unitPricePaise: 100000 });
      w.repository.recordPayment(other.id, 70000);
      w.repository.saveCreditNote(creditNote(w, other, "cn2", 30001));
      w.repository.finalizeCreditNote("cn2");
      expect(receivablesPaise(w.repository, other.id)).toBe(0);
      expect(customerCreditsPaise(w.repository, other.id)).toBe(1);
      expect(w.repository.getCreditNoteBalance("cn2")).toMatchObject({ refundablePaise: 1 });

      // A note that fits entirely inside the open balance is NOT split, exactly as before.
      const third = finalizedInvoice(w, { id: "inv3", unitPricePaise: 100000 });
      w.repository.recordPayment(third.id, 70000);
      w.repository.saveCreditNote(creditNote(w, third, "cn3", 30000));
      w.repository.finalizeCreditNote("cn3");
      expect(receivablesPaise(w.repository, third.id)).toBe(0);
      expect(customerCreditsPaise(w.repository, third.id)).toBe(0);
      expect(w.repository.getCreditNoteBalance("cn3")).toMatchObject({ refundablePaise: 0 });
    } finally {
      w.repository.close();
    }
  });
});

describe("DEFECT 2: a credit note is capped by what the invoice charged BEFORE tax", () => {
  it("ACCEPTANCE 18% over-credit: refuses a taxable credit equal to the tax-inclusive total", () => {
    const w = world();
    try {
      // Taxable 100000, GST 18000, total 118000.
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000, taxRateBasisPoints: 1800 });
      expect(receivablesPaise(w.repository, invoice.id)).toBe(118000);

      // THE DEFECT: 118000 taxable used to pass, because it was compared against the 118000
      // tax-INCLUSIVE total. The note would then have credited 118000 + 21240 GST = 139240
      // against a 118000 invoice — over-credited by exactly the 18%, twice over.
      expect(() => w.repository.saveCreditNote(creditNote(w, invoice, "cn-over", 118000)))
        .toThrow(/cannot exceed what the invoice charged before tax \(100000 paise\)/);
      expect(() => w.repository.saveCreditNote(creditNote(w, invoice, "cn-over", 100001))).toThrow(/before tax/);

      // A full credit at the taxable base is right, and it clears the invoice exactly.
      w.repository.saveCreditNote(creditNote(w, invoice, "cn-full", 100000));
      w.repository.finalizeCreditNote("cn-full");
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("leaves SALES and output GST at nil after a full credit, instead of reversing too much", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000, taxRateBasisPoints: 1800 });
      w.repository.saveCreditNote(creditNote(w, invoice, "cn-full", 100000));
      w.repository.finalizeCreditNote("cn-full");
      const pl = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      expect(pl.totalIncomePaise).toBe(0);
      expect(pl.gstOnSalesPaise).toBe(0);
      const sheet = w.repository.getBalanceSheet();
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    } finally {
      w.repository.close();
    }
  });

  it("measures against the DISCOUNTED base, so a discount cannot be credited back", () => {
    const w = world();
    try {
      // Lines 100000, discount 10000 → the invoice charged 90000 before tax, 106200 with 18% GST.
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000, taxRateBasisPoints: 1800, discountPaise: 10000 });
      expect(receivablesPaise(w.repository, invoice.id)).toBe(106200);

      // THE DEFECT: the old cap was the tax-inclusive 106200, so a 100000 taxable credit — more
      // than the customer was ever charged before tax — passed, discount and all.
      expect(() => w.repository.saveCreditNote(creditNote(w, invoice, "cn-over", 100000))).toThrow(/\(90000 paise\)/);
      expect(() => w.repository.saveCreditNote(creditNote(w, invoice, "cn-over", 90001))).toThrow(/before tax/);
      w.repository.saveCreditNote(creditNote(w, invoice, "cn-ok", 90000));
      w.repository.finalizeCreditNote("cn-ok");
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("counts credit notes ALREADY finalized towards the cap", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000, quantity: 3, taxRateBasisPoints: 1800 });
      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 200000));
      w.repository.finalizeCreditNote("cn1");
      // 300000 taxable charged, 200000 already credited: only 100000 of head-room is left.
      expect(() => w.repository.saveCreditNote(creditNote(w, invoice, "cn2", 100001)))
        .toThrow(/would take the total credited to 300001 paise/);
      w.repository.saveCreditNote(creditNote(w, invoice, "cn2", 100000));
      w.repository.finalizeCreditNote("cn2");
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});

describe("DEFECT 3: cancelling an invoice that carries a credit note", () => {
  it("is refused, because the cancellation would reverse more than was ever owed", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000, quantity: 10 });
      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 400000));
      w.repository.finalizeCreditNote("cn1");
      expect(receivablesPaise(w.repository, invoice.id)).toBe(600000);

      // THE DEFECT: cancelInvoice guarded only on payments. It reverses the ORIGINAL entry in
      // full, so a 1,000,000 invoice carrying a 400,000 note reversed 1,000,000 of SALES that
      // stood at 600,000 - leaving SALES with a 400,000 DEBIT balance and RECEIVABLES at
      // -400,000, silently, by a route neither earlier cap covered.
      expect(() => w.repository.cancelInvoice(invoice.id)).toThrow(/400000 paise of credit notes against it/);

      // The ledger is untouched and the invoice is still live.
      expect(receivablesPaise(w.repository, invoice.id)).toBe(600000);
      expect(w.repository.getInvoice(invoice.id).status).toBe("FINALIZED");
      const sales = w.repository.db
        .prepare(
          `SELECT COALESCE(SUM(jl.credit_paise), 0) - COALESCE(SUM(jl.debit_paise), 0) AS balance
             FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
            WHERE je.source_id = ? AND jl.account = 'SALES'`,
        )
        .get(invoice.id) as { balance: number };
      expect(sales.balance).toBe(600000);
    } finally {
      w.repository.close();
    }
  });

  it("is allowed, as before, when the invoice has no credit notes", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 100000 });
      expect(() => w.repository.cancelInvoice(invoice.id)).not.toThrow();
      expect(w.repository.getInvoice(invoice.id).status).toBe("CANCELLED");
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});

describe("DEFECT 4: GST is balanced per account, not just in total", () => {
  it("clears CGST and SGST individually on a full return", () => {
    const w = world();
    try {
      // 2 x 17 paise at 18%: the invoice charges 6 paise of GST, split 3 CGST / 3 SGST. Each note
      // of 17 wants round(3.06) = 3, split floor/remainder as 1 and 2 - so two notes would hand
      // back 2 of CGST and 4 of SGST. Capping only the TOTAL left CGST at -1 and SGST at +1: one
      // a negative liability, the other overstated, with the total looking right.
      const invoice = finalizedInvoice(w, { unitPricePaise: 17, quantity: 2, taxRateBasisPoints: 1800 });
      expect(receivablesPaise(w.repository, invoice.id)).toBe(40);
      expect(taxPaise(w.repository, invoice.id, "OUTPUT_CGST")).toBe(3);
      expect(taxPaise(w.repository, invoice.id, "OUTPUT_SGST")).toBe(3);

      w.repository.saveCreditNote(creditNote(w, invoice, "cn1", 17));
      w.repository.finalizeCreditNote("cn1");
      w.repository.saveCreditNote(creditNote(w, invoice, "cn2", 17));
      w.repository.finalizeCreditNote("cn2");

      // A full return clears every account EXACTLY - no stranded paisa, nothing negative.
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
      expect(taxPaise(w.repository, invoice.id, "OUTPUT_CGST")).toBe(0);
      expect(taxPaise(w.repository, invoice.id, "OUTPUT_SGST")).toBe(0);
      expect(outputTaxPaise(w.repository, invoice.id)).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("never lets a GST account go negative part-way through a series of notes", () => {
    const w = world();
    try {
      const invoice = finalizedInvoice(w, { unitPricePaise: 17, quantity: 3, taxRateBasisPoints: 1800 });
      for (const id of ["cn1", "cn2", "cn3"]) {
        w.repository.saveCreditNote(creditNote(w, invoice, id, 17));
        w.repository.finalizeCreditNote(id);
        for (const account of ["OUTPUT_CGST", "OUTPUT_SGST"]) {
          expect(taxPaise(w.repository, invoice.id, account), `${account} after ${id}`).toBeGreaterThanOrEqual(0);
        }
        expect(receivablesPaise(w.repository, invoice.id)).toBeGreaterThanOrEqual(0);
      }
      expect(receivablesPaise(w.repository, invoice.id)).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});

/**
 * CHARACTERISATION, not a defect: a CASH invoice behaves differently, and the owner should know.
 * Its credit note refunds by crediting CASH directly, which is a real refund and leaves no
 * negative balance - so a cash sale CAN be credited after the money came in, while a receivable
 * sale cannot once it is paid (there is no payment-reversal path). Pinned so the asymmetry is
 * visible when the refund path is designed.
 */
describe("the cash-invoice asymmetry (owner to rule)", () => {
  it("allows a credit note on a paid-at-once CASH invoice and refunds through CASH", () => {
    const w = world();
    try {
      const invoice: Invoice = {
        id: "inv-cash", number: "INV-CASH", businessId: w.businessId, customerId: w.customerId,
        invoiceDate: "2026-01-01", status: "DRAFT", paymentAccount: "CASH", taxType: "NONE", taxRateBasisPoints: 0,
        lines: [{ itemId: w.itemId, description: "Line", quantity: 10, unitPricePaise: 100000 }],
      };
      w.repository.saveDraft(invoice);
      w.repository.finalizeInvoice(invoice.id);
      w.repository.saveCreditNote(creditNote(w, invoice, "cn-cash", 400000));
      w.repository.finalizeCreditNote("cn-cash");

      const cash = w.repository.db
        .prepare(
          `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS balance
             FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
            WHERE je.source_id = ? AND jl.account = 'CASH'`,
        )
        .get(invoice.id) as { balance: number };
      // Cash genuinely left the till: 1,000,000 in, 400,000 refunded out. Nothing is negative.
      expect(cash.balance).toBe(600000);
      expect(w.repository.getProfitAndLoss({ basis: "ACCRUAL" }).totalIncomePaise).toBe(600000);
    } finally {
      w.repository.close();
    }
  });
});
