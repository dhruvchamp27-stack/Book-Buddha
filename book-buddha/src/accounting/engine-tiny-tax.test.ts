import { describe, expect, it } from "vitest";
import { finalizeInvoice } from "./engine.js";
import type { Invoice } from "./types.js";

const base: Invoice = {
  id: "inv-tiny",
  number: "INV-TINY",
  businessId: "business-1",
  customerId: "customer-1",
  paymentAccount: "CASH",
  status: "DRAFT",
  taxType: "CGST_SGST",
  taxRateBasisPoints: 1800,
  lines: [{ description: "Pencil", quantity: 1, unitPricePaise: 3 }],
};

describe("D15: tiny sale GST split", () => {
  it("3 paise at 18% CGST_SGST: no zero CGST line, SGST keeps the paisa, entry balanced", () => {
    const lines = finalizeInvoice(base).journalEntry.lines;
    expect(lines.every((l) => l.debitPaise > 0 || l.creditPaise > 0)).toBe(true);
    expect(lines.some((l) => l.account === "OUTPUT_CGST")).toBe(false);
    expect(lines.find((l) => l.account === "OUTPUT_SGST")?.creditPaise).toBe(1);
    const debit = lines.reduce((t, l) => t + l.debitPaise, 0);
    const credit = lines.reduce((t, l) => t + l.creditPaise, 0);
    expect(debit).toBe(4);
    expect(credit).toBe(4);
  });

  it("an ordinary sale still posts both CGST and SGST", () => {
    const lines = finalizeInvoice({ ...base, lines: [{ description: "Book", quantity: 1, unitPricePaise: 10000 }] }).journalEntry.lines;
    expect(lines.find((l) => l.account === "OUTPUT_CGST")?.creditPaise).toBe(900);
    expect(lines.find((l) => l.account === "OUTPUT_SGST")?.creditPaise).toBe(900);
  });
});
