import type {
  AccountCode,
  AuditEvent,
  CancelledInvoice,
  FinalizedInvoice,
  Invoice,
  InvoiceTaxType,
  JournalEntry,
  JournalLine,
  JournalSourceType,
  PurchasePaymentAccount,
} from "./types.js";

export class AccountingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}

function totalInvoicePaise(invoice: Invoice): number {
  if (invoice.lines.length === 0) {
    throw new AccountingError("An invoice must contain at least one line.");
  }

  const subtotal = invoice.lines.reduce((total, line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new AccountingError("Invoice quantities must be positive whole numbers.");
    }
    if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
      throw new AccountingError("Unit prices must be non-negative whole paise.");
    }
    return total + line.quantity * line.unitPricePaise;
  }, 0);
  const discountPaise = invoice.discountPaise ?? 0;
  const extraChargePaise = invoice.extraChargePaise ?? 0;
  const taxRateBasisPoints = invoice.taxRateBasisPoints ?? 0;
  const taxType = invoice.taxType ?? "NONE";
  if (!Number.isInteger(discountPaise) || discountPaise < 0) {
    throw new AccountingError("Discount must be a non-negative whole number of paise.");
  }
  if (!Number.isInteger(extraChargePaise) || extraChargePaise < 0) {
    throw new AccountingError("Extra charges must be a non-negative whole number of paise.");
  }
  if (discountPaise > subtotal) {
    throw new AccountingError("Discount cannot exceed the invoice subtotal.");
  }
  if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
    throw new AccountingError("Tax rate must be a whole number between 0% and 100%.");
  }
  if (taxType === "NONE" && taxRateBasisPoints !== 0) {
    throw new AccountingError("A tax rate requires a tax type.");
  }
  if (taxType !== "NONE" && taxRateBasisPoints === 0) {
    throw new AccountingError("A taxable invoice requires a positive tax rate.");
  }
  const taxablePaise = subtotal - discountPaise + extraChargePaise;
  return taxablePaise + Math.round(taxablePaise * taxRateBasisPoints / 10000);
}

function taxLines(invoice: Invoice, taxablePaise: number): readonly JournalLine[] {
  const taxType = invoice.taxType ?? "NONE";
  const rate = invoice.taxRateBasisPoints ?? 0;
  if (taxType === "NONE" || rate === 0) return [];
  const taxPaise = Math.round(taxablePaise * rate / 10000);
  if (taxType === "IGST") {
    return [{ account: "OUTPUT_IGST", debitPaise: 0, creditPaise: taxPaise }];
  }
  const cgst = Math.floor(taxPaise / 2);
  return [
    // A zero line is rejected by the ledger (tiny sales: 1 paisa of tax leaves CGST at 0).
    ...(cgst > 0 ? [{ account: "OUTPUT_CGST" as const, debitPaise: 0, creditPaise: cgst }] : []),
    { account: "OUTPUT_SGST", debitPaise: 0, creditPaise: taxPaise - cgst },
  ];
}

function balancedLines(lines: readonly JournalLine[]): readonly JournalLine[] {
  const debits = lines.reduce((total, line) => total + line.debitPaise, 0);
  const credits = lines.reduce((total, line) => total + line.creditPaise, 0);
  if (debits !== credits) {
    throw new AccountingError("Journal entry is not balanced.");
  }
  return lines;
}

function audit(action: string, entityId: string): AuditEvent {
  return {
    action,
    entityId,
    occurredAt: new Date().toISOString(),
  };
}

export function finalizeInvoice(invoice: Invoice): FinalizedInvoice {
  if (invoice.status !== "DRAFT") {
    throw new AccountingError("Only draft invoices can be finalized.");
  }

  const amountPaise = totalInvoicePaise(invoice);
  const subtotal = invoice.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0);
  const taxablePaise = subtotal - (invoice.discountPaise ?? 0) + (invoice.extraChargePaise ?? 0);
  const lines: readonly JournalLine[] = [
    {
      account: invoice.paymentAccount,
      debitPaise: amountPaise,
      creditPaise: 0,
    },
    {
      account: "SALES",
      debitPaise: 0,
      creditPaise: taxablePaise,
    },
    ...taxLines(invoice, taxablePaise),
  ];

  const journalEntry: JournalEntry = {
    id: `je-${invoice.id}`,
    sourceId: invoice.id,
    description: `Invoice ${invoice.number}`,
    lines: balancedLines(lines),
    isReversal: false,
  };

  return {
    invoice: { ...invoice, status: "FINALIZED" },
    journalEntry,
    auditEvent: audit("invoice.finalized", invoice.id),
  };
}

export function cancelInvoice(invoice: Invoice, originalEntry: JournalEntry): CancelledInvoice {
  if (invoice.status !== "FINALIZED") {
    throw new AccountingError("Only finalized invoices can be cancelled.");
  }
  if (originalEntry.sourceId !== invoice.id || originalEntry.isReversal) {
    throw new AccountingError("The journal entry does not belong to this invoice.");
  }

  const reversalLines: readonly JournalLine[] = originalEntry.lines.map((line) => ({
    account: line.account as AccountCode,
    debitPaise: line.creditPaise,
    creditPaise: line.debitPaise,
  }));
  const reversalEntry: JournalEntry = {
    id: `je-${invoice.id}-reversal`,
    sourceId: invoice.id,
    description: `Cancellation of invoice ${invoice.number}`,
    lines: balancedLines(reversalLines),
    isReversal: true,
  };

  return {
    invoice: { ...invoice, status: "CANCELLED" },
    reversalEntry,
    auditEvent: audit("invoice.cancelled", invoice.id),
  };
}

// ---------------------------------------------------------------- purchasing / expenses

/** Same tax-type/rate rules as sales invoices. */
export function validatePurchaseTax(taxType: InvoiceTaxType, taxRateBasisPoints: number): void {
  if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
    throw new AccountingError("Tax rate must be a whole number between 0% and 100%.");
  }
  if (taxType === "NONE" && taxRateBasisPoints !== 0) {
    throw new AccountingError("A tax rate requires a tax type.");
  }
  if (taxType !== "NONE" && taxRateBasisPoints === 0) {
    throw new AccountingError("A taxable purchase requires a positive tax rate.");
  }
}

/** Input tax (ITC) in whole paise on a taxable amount. Integer paise only. */
export function inputTaxPaise(taxType: InvoiceTaxType, taxRateBasisPoints: number, taxablePaise: number): number {
  validatePurchaseTax(taxType, taxRateBasisPoints);
  if (taxType === "NONE") return 0;
  return Math.round(taxablePaise * taxRateBasisPoints / 10000);
}

/** Debit lines for recoverable input tax. CGST gets floor(tax/2); SGST takes the remainder. */
export function inputTaxLines(taxType: InvoiceTaxType, taxPaise: number): readonly JournalLine[] {
  if (taxType === "NONE" || taxPaise === 0) return [];
  if (taxType === "IGST") {
    return [{ account: "INPUT_IGST", debitPaise: taxPaise, creditPaise: 0 }];
  }
  const cgst = Math.floor(taxPaise / 2);
  return [
    ...(cgst > 0 ? [{ account: "INPUT_CGST" as const, debitPaise: cgst, creditPaise: 0 }] : []),
    { account: "INPUT_SGST", debitPaise: taxPaise - cgst, creditPaise: 0 },
  ];
}

export interface PurchaseEntryInput {
  readonly entryId: string;
  readonly sourceId: string;
  readonly sourceType: Extract<JournalSourceType, "PURCHASE_BILL" | "EXPENSE">;
  readonly description: string;
  /**
   * Cost of stock-tracked lines (debits INVENTORY), NET of any part of the header discount that
   * was spread into it (see `spreadDiscountPaise`).
   */
  readonly inventoryPaise: number;
  /** Total of non-stock lines / expense amount (debits EXPENSE). */
  readonly expensePaise: number;
  /**
   * R8. Header-level discount the supplier gave on the bill as a whole. Reduces the GST-taxable
   * value, as on a sale. Owner ruling S17-7: the discount is assumed to be on STOCK items only, so
   * the repository spreads it into the stock lots (`spreadDiscountPaise`); only the part that
   * could not be spread (a bill with no stock lines) CREDITS PURCHASE_DISCOUNT.
   */
  readonly discountPaise?: number;
  /**
   * The part of `discountPaise` already netted into `inventoryPaise` (spread across the stock
   * lines). Not credited to PURCHASE_DISCOUNT. Defaults to 0 (the whole discount is credited).
   */
  readonly spreadDiscountPaise?: number;
  /** R8. Freight, packing and the like added by the supplier. DEBITS PURCHASE_EXTRA_CHARGES. */
  readonly extraChargePaise?: number;
  readonly taxType: InvoiceTaxType;
  readonly taxRateBasisPoints: number;
  readonly paymentAccount: PurchasePaymentAccount;
}

export interface PurchaseEntryResult {
  readonly entry: JournalEntry;
  /** Goods and services on the lines, before the header discount and extra charge. */
  readonly subtotalPaise: number;
  /** subtotal - discount + extra charge. This is what input GST is charged on. */
  readonly taxablePaise: number;
  readonly taxPaise: number;
  readonly totalPaise: number;
}

/**
 * Accrual posting for a finalized purchase bill or expense:
 * Dr INVENTORY / Dr EXPENSE / Dr PURCHASE_EXTRA_CHARGES / Dr INPUT tax;
 * Cr PURCHASE_DISCOUNT; Cr CASH or PAYABLES for what is actually owed.
 *
 * S17-7: INVENTORY is debited the NET stock cost (the header discount spread into the stock lots
 * by `spreadBillDiscount`), so the INVENTORY ledger equals the stock-layer value to the paise. A
 * discount with no stock lines to carry it still credits PURCHASE_DISCOUNT.
 */
export function purchaseEntry(input: PurchaseEntryInput): PurchaseEntryResult {
  if (!Number.isInteger(input.inventoryPaise) || input.inventoryPaise < 0
    || !Number.isInteger(input.expensePaise) || input.expensePaise < 0) {
    throw new AccountingError("Purchase amounts must be non-negative whole paise.");
  }
  const discountPaise = input.discountPaise ?? 0;
  const extraChargePaise = input.extraChargePaise ?? 0;
  if (!Number.isInteger(discountPaise) || discountPaise < 0) {
    throw new AccountingError("A bill discount must be a non-negative whole number of paise.");
  }
  if (!Number.isInteger(extraChargePaise) || extraChargePaise < 0) {
    throw new AccountingError("Bill extra charges must be a non-negative whole number of paise.");
  }
  const spreadDiscountPaise = input.spreadDiscountPaise ?? 0;
  if (!Number.isInteger(spreadDiscountPaise) || spreadDiscountPaise < 0 || spreadDiscountPaise > discountPaise) {
    throw new AccountingError("The spread part of a bill discount must be whole paise within the discount.");
  }
  // Gross value of the lines: the stock cost is net of the spread discount, so add it back.
  const subtotalPaise = input.inventoryPaise + spreadDiscountPaise + input.expensePaise;
  if (subtotalPaise <= 0) {
    throw new AccountingError("A purchase must have a total above zero.");
  }
  // Same rule as the sales side: a discount cannot exceed what is being discounted. Without it a
  // bill could end owing the supplier a negative amount, which is a refund, not a purchase.
  if (discountPaise > subtotalPaise) {
    throw new AccountingError("A bill discount cannot exceed the bill subtotal.");
  }
  const taxablePaise = subtotalPaise - discountPaise + extraChargePaise;
  const taxPaise = inputTaxPaise(input.taxType, input.taxRateBasisPoints, taxablePaise);
  const totalPaise = taxablePaise + taxPaise;
  const lines: readonly JournalLine[] = [
    ...(input.inventoryPaise > 0 ? [{ account: "INVENTORY" as const, debitPaise: input.inventoryPaise, creditPaise: 0 }] : []),
    ...(input.expensePaise > 0 ? [{ account: "EXPENSE" as const, debitPaise: input.expensePaise, creditPaise: 0 }] : []),
    ...(extraChargePaise > 0 ? [{ account: "PURCHASE_EXTRA_CHARGES" as const, debitPaise: extraChargePaise, creditPaise: 0 }] : []),
    ...(discountPaise - spreadDiscountPaise > 0 ? [{ account: "PURCHASE_DISCOUNT" as const, debitPaise: 0, creditPaise: discountPaise - spreadDiscountPaise }] : []),
    ...inputTaxLines(input.taxType, taxPaise),
    { account: input.paymentAccount, debitPaise: 0, creditPaise: totalPaise },
  ];
  return {
    entry: {
      id: input.entryId,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      description: input.description,
      lines: balancedLines(lines),
      isReversal: false,
    },
    subtotalPaise,
    taxablePaise,
    taxPaise,
    totalPaise,
  };
}

export interface DiscountSpreadLine {
  readonly quantity: number;
  readonly unitPricePaise: number;
  /** True when the line is a tracked stock item (creates stock movements). */
  readonly stock: boolean;
}

/** A run of identical units of one stock line: `quantity` units at `unitCostPaise` each. */
export interface DiscountedLot {
  readonly quantity: number;
  readonly unitCostPaise: number;
}

export interface DiscountSpread {
  /** One entry per input line: its lots (non-stock lines get no lots). Quantities sum to the line quantity. */
  readonly lots: ReadonlyArray<readonly DiscountedLot[]>;
  /** The part of the discount that was spread into the stock lots. */
  readonly spreadPaise: number;
  /** Net cost of all the stock lines (sum of lots). */
  readonly stockCostPaise: number;
}

/**
 * S17-7 (owner ruling Q1): the bill discount is assumed to be on STOCK items only. It is spread
 * over the stock lines pro-rata to their value in whole paise (largest remainder, ties to the
 * earlier line, so the shares sum exactly), then within a line per unit in whole paise with the
 * remainder on the line's LAST unit: (qty-1) units at floor cost and one at floor + remainder.
 * If the discount exceeds the stock value, only the stock value is spread; the rest stays
 * unspread (spreadPaise < discountPaise) for the caller to credit to PURCHASE_DISCOUNT.
 */
export function spreadBillDiscount(lines: readonly DiscountSpreadLine[], discountPaise: number): DiscountSpread {
  if (!Number.isInteger(discountPaise) || discountPaise < 0) {
    throw new AccountingError("A bill discount must be a non-negative whole number of paise.");
  }
  const values = lines.map((line) => (line.stock ? line.quantity * line.unitPricePaise : 0));
  const stockValue = values.reduce((total, value) => total + value, 0);
  const spreadPaise = Math.min(discountPaise, stockValue);
  const shares = values.map(() => 0);
  if (spreadPaise > 0) {
    const remainders: Array<{ index: number; remainder: bigint }> = [];
    let assigned = 0;
    values.forEach((value, index) => {
      if (value === 0) return;
      const product = BigInt(spreadPaise) * BigInt(value);
      const share = Number(product / BigInt(stockValue));
      shares[index] = share;
      assigned += share;
      remainders.push({ index, remainder: product % BigInt(stockValue) });
    });
    remainders.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
    for (let i = 0; i < spreadPaise - assigned; i += 1) {
      const target = remainders[i] as { index: number };
      shares[target.index] = (shares[target.index] as number) + 1;
    }
  }
  let stockCostPaise = 0;
  const lots = lines.map((line, index): DiscountedLot[] => {
    if (!line.stock) return [];
    const net = (values[index] as number) - (shares[index] as number);
    stockCostPaise += net;
    const base = Math.floor(net / line.quantity);
    const remainder = net - base * line.quantity;
    if (remainder === 0) return [{ quantity: line.quantity, unitCostPaise: base }];
    return [
      ...(line.quantity > 1 ? [{ quantity: line.quantity - 1, unitCostPaise: base }] : []),
      { quantity: 1, unitCostPaise: base + remainder },
    ];
  });
  return { lots, spreadPaise, stockCostPaise };
}

/** Exact reversal of an entry: every debit becomes a credit and vice versa. */
export function reverseEntry(original: JournalEntry, entryId: string, description: string): JournalEntry {
  if (original.isReversal) {
    throw new AccountingError("A reversal entry cannot be reversed.");
  }
  const lines: readonly JournalLine[] = original.lines.map((line) => ({
    account: line.account,
    debitPaise: line.creditPaise,
    creditPaise: line.debitPaise,
  }));
  return {
    id: entryId,
    sourceId: original.sourceId,
    ...(original.sourceType === undefined ? {} : { sourceType: original.sourceType }),
    description,
    lines: balancedLines(lines),
    isReversal: true,
  };
}

/**
 * Paying down a supplier balance: Dr PAYABLES (amount + discount) / Cr CASH (amount).
 * Q2 / S17-7: a settlement discount taken AT PAYMENT is "Discount received" income:
 * Cr PURCHASE_DISCOUNT (discount). Without one this is the plain Dr PAYABLES, Cr CASH.
 */
export function supplierPaymentEntry(input: {
  readonly entryId: string;
  readonly sourceId: string;
  readonly description: string;
  readonly amountPaise: number;
  readonly settlementDiscountPaise?: number;
}): JournalEntry {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AccountingError("Payment amount must be a positive whole number of paise.");
  }
  const discountPaise = input.settlementDiscountPaise ?? 0;
  if (!Number.isInteger(discountPaise) || discountPaise < 0) {
    throw new AccountingError("A settlement discount must be a non-negative whole number of paise.");
  }
  return {
    id: input.entryId,
    sourceId: input.sourceId,
    sourceType: "SUPPLIER_PAYMENT",
    description: input.description,
    lines: balancedLines([
      { account: "PAYABLES", debitPaise: input.amountPaise + discountPaise, creditPaise: 0 },
      { account: "CASH", debitPaise: 0, creditPaise: input.amountPaise },
      ...(discountPaise > 0 ? [{ account: "PURCHASE_DISCOUNT" as const, debitPaise: 0, creditPaise: discountPaise }] : []),
    ]),
    isReversal: false,
  };
}

export interface ProportionalAllocationInput {
  /** Whole-paise amounts of the lines to recognise. May be negative (a net credit-side balance); zero is fine. */
  readonly lineAmountsPaise: readonly number[];
  /** T: the document total the payments are measured against. Must be above zero. */
  readonly totalPaise: number;
  /** Cumulative cash allocated to the document BEFORE this payment. */
  readonly paidBeforePaise: number;
  /** Cumulative cash allocated to the document AFTER this payment (never above the total). */
  readonly paidAfterPaise: number;
}

/**
 * Cash-basis recognition of one payment against one document, using a CUMULATIVE TARGET.
 *
 * A line of amount L is recognised to date as round(L x paid / T) (half rounds away from zero,
 * and at full payment exactly L). This payment's share of the line is
 * target(paidAfter) - target(paidBefore), clamped to [0, L - target(paidBefore)] in magnitude,
 * and carries the line's sign. Because every payment is the difference of two points on one
 * monotonic curve, the shares of any sequence of payments telescope: when the document is fully
 * paid each line has recognised EXACTLY its full amount, however many odd-sized payments came
 * first. Rounding each payment separately would drift; this cannot.
 *
 * Pure and read-only. Uses BigInt for the product so large amounts cannot lose paise.
 */
export function allocateProportionally(input: ProportionalAllocationInput): readonly number[] {
  const { lineAmountsPaise, totalPaise, paidBeforePaise, paidAfterPaise } = input;
  const whole = [totalPaise, paidBeforePaise, paidAfterPaise, ...lineAmountsPaise];
  if (whole.some((value) => !Number.isSafeInteger(value))) {
    throw new AccountingError("Cash-basis amounts must be whole paise.");
  }
  if (totalPaise <= 0) {
    throw new AccountingError("The document total must be above zero.");
  }
  if (paidBeforePaise < 0 || paidAfterPaise < paidBeforePaise || paidAfterPaise > totalPaise) {
    throw new AccountingError("Payments must be in order and cannot exceed the document total.");
  }
  const total = BigInt(totalPaise);
  const target = (magnitude: number, paid: number): number =>
    paid >= totalPaise ? magnitude : Number((2n * BigInt(magnitude) * BigInt(paid) + total) / (2n * total));
  return lineAmountsPaise.map((amount) => {
    const magnitude = Math.abs(amount);
    const before = target(magnitude, paidBeforePaise);
    const after = target(magnitude, paidAfterPaise);
    const share = Math.min(Math.max(after - before, 0), magnitude - before);
    return amount < 0 ? -share : share;
  });
}
