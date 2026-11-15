import { describe, expect, it } from "vitest";
import { AccountingError, allocateProportionally, cancelInvoice, finalizeInvoice } from "./engine.js";
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

describe("allocateProportionally (cash-basis cumulative target)", () => {
  it("splits a line in proportion to the payment (owner figures: half paid recognises half)", () => {
    // Invoice SALES 1,000,000 / CGST 90,000 / SGST 90,000 / COGS 600,000 against a 1,180,000 total, 590,000 paid.
    expect(allocateProportionally({
      lineAmountsPaise: [1000000, 90000, 90000, 600000], totalPaise: 1180000, paidBeforePaise: 0, paidAfterPaise: 590000,
    })).toEqual([500000, 45000, 45000, 300000]);
  });

  it("lands exactly on every line with many odd payments (no paise lost)", () => {
    const lines = [1000000, 90000, 90000, 600000, 1, 7];
    const total = 1180000;
    const payments = [1, 999, 2500, total - 1 - 999 - 2500];
    const recognised = lines.map(() => 0);
    let paid = 0;
    for (const payment of payments) {
      const share = allocateProportionally({ lineAmountsPaise: lines, totalPaise: total, paidBeforePaise: paid, paidAfterPaise: paid + payment });
      share.forEach((value, index) => { recognised[index] = (recognised[index] ?? 0) + value; });
      paid += payment;
    }
    expect(recognised).toEqual(lines);
  });

  it("carries the sign of a negative line and handles zero lines", () => {
    expect(allocateProportionally({ lineAmountsPaise: [-100, 0], totalPaise: 10, paidBeforePaise: 0, paidAfterPaise: 5 })).toEqual([-50, 0]);
    expect(allocateProportionally({ lineAmountsPaise: [-101], totalPaise: 10, paidBeforePaise: 5, paidAfterPaise: 10 })[0]).toBe(-101 + 51);
  });

  it("does not lose precision on very large amounts", () => {
    const big = 900_000_000_000_000; // 9 trillion rupees in paise: the product exceeds 2^53
    const first = allocateProportionally({ lineAmountsPaise: [big], totalPaise: big, paidBeforePaise: 0, paidAfterPaise: big / 3 })[0] as number;
    const rest = allocateProportionally({ lineAmountsPaise: [big], totalPaise: big, paidBeforePaise: big / 3, paidAfterPaise: big })[0] as number;
    expect(first).toBe(big / 3);
    expect(first + rest).toBe(big);
  });

  it("rejects fractions, a non-positive total, out-of-order or over-total payments", () => {
    const ok = { lineAmountsPaise: [100], totalPaise: 100, paidBeforePaise: 0, paidAfterPaise: 50 };
    expect(() => allocateProportionally({ ...ok, lineAmountsPaise: [10.5] })).toThrow(AccountingError);
    expect(() => allocateProportionally({ ...ok, totalPaise: 0 })).toThrow(AccountingError);
    expect(() => allocateProportionally({ ...ok, paidBeforePaise: 60 })).toThrow(AccountingError);
    expect(() => allocateProportionally({ ...ok, paidAfterPaise: 101 })).toThrow(AccountingError);
    expect(() => allocateProportionally({ ...ok, paidBeforePaise: -1 })).toThrow(AccountingError);
  });

  it("fuzz: never negative, never over the line, lands exactly at full payment", () => {
    // Deterministic PRNG so a failure is reproducible.
    let seed = 20261115;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

    for (let round = 0; round < 3000; round += 1) {
      const total = int(1, round % 3 === 0 ? 5_000_000_000 : 20_000);
      const lines = Array.from({ length: int(1, 6) }, () => int(0, round % 5 === 0 ? total * 2 : total));
      // Random split of the total into 1..12 payments (some tiny, some huge).
      const cuts = Array.from({ length: int(0, 11) }, () => int(0, total)).sort((a, b) => a - b);
      const points = [0, ...cuts, total];
      const recognised = lines.map(() => 0);
      for (let step = 1; step < points.length; step += 1) {
        const before = points[step - 1] as number;
        const after = points[step] as number;
        if (after === before) continue;
        const share = allocateProportionally({ lineAmountsPaise: lines, totalPaise: total, paidBeforePaise: before, paidAfterPaise: after });
        share.forEach((value, index) => {
          expect(value).toBeGreaterThanOrEqual(0);
          recognised[index] = (recognised[index] ?? 0) + value;
          expect(recognised[index]).toBeLessThanOrEqual(lines[index] as number);
          // Cumulative target: exactly round(line x paid / total), computed independently in BigInt.
          const exact = (2n * BigInt(lines[index] as number) * BigInt(after) + BigInt(total)) / (2n * BigInt(total));
          expect(BigInt(recognised[index] as number)).toBe(exact);
        });
      }
      expect(recognised).toEqual(lines);
    }
  });
});
