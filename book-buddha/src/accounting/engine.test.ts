import { describe, expect, it } from "vitest";
import { AccountingError, cancelInvoice, finalizeInvoice } from "./engine.js";
import type { Invoice } from "./types.js";

const draftInvoice: Invoice = {
  id: "inv-1",
  number: "INV-001/26-27",
  businessId: "business-1",
  customerId: "customer-1",
  paymentAccount: "CASH",
  status: "DRAFT",
  lines: [{ description: "Book", quantity: 2, unitPricePaise: 12500 }],
};

function total(entry: { lines: readonly { debitPaise: number; creditPaise: number }[] }) {
  return entry.lines.reduce(
    (result, line) => ({
      debit: result.debit + line.debitPaise,
      credit: result.credit + line.creditPaise,
    }),
    { debit: 0, credit: 0 },
  );
}

describe("invoice accounting", () => {
  it("finalizes an invoice into a balanced journal entry", () => {
    const result = finalizeInvoice(draftInvoice);

    expect(result.invoice.status).toBe("FINALIZED");
    expect(total(result.journalEntry)).toEqual({ debit: 25000, credit: 25000 });
    expect(result.journalEntry.lines).toEqual([
      { account: "CASH", debitPaise: 25000, creditPaise: 0 },
      { account: "SALES", debitPaise: 0, creditPaise: 25000 },
    ]);
  });

  it("cancels by creating an equal and opposite reversal", () => {
    const finalized = finalizeInvoice(draftInvoice);
    const cancelled = cancelInvoice(finalized.invoice, finalized.journalEntry);

    expect(cancelled.invoice.status).toBe("CANCELLED");
    expect(cancelled.reversalEntry.isReversal).toBe(true);
    expect(total(cancelled.reversalEntry)).toEqual({ debit: 25000, credit: 25000 });
    expect(cancelled.reversalEntry.lines).toEqual([
      { account: "CASH", debitPaise: 0, creditPaise: 25000 },
      { account: "SALES", debitPaise: 25000, creditPaise: 0 },
    ]);
  });

  it("rejects empty invoices", () => {
    expect(() => finalizeInvoice({ ...draftInvoice, lines: [] })).toThrow(AccountingError);
  });

  it("rejects finalizing an invoice twice", () => {
    const finalized = finalizeInvoice(draftInvoice);
    expect(() => finalizeInvoice(finalized.invoice)).toThrow(AccountingError);
  });
});
