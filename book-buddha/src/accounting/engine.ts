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
    { account: "OUTPUT_CGST", debitPaise: 0, creditPaise: cgst },
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
  /** Total cost of stock-tracked lines (debits INVENTORY). */
  readonly inventoryPaise: number;
  /** Total of non-stock lines / expense amount (debits EXPENSE). */
  readonly expensePaise: number;
  readonly taxType: InvoiceTaxType;
  readonly taxRateBasisPoints: number;
  readonly paymentAccount: PurchasePaymentAccount;
}

export interface PurchaseEntryResult {
  readonly entry: JournalEntry;
  readonly subtotalPaise: number;
  readonly taxPaise: number;
  readonly totalPaise: number;
}

/**
 * Accrual posting for a finalized purchase bill or expense:
 * Dr INVENTORY / Dr EXPENSE / Dr INPUT tax; Cr CASH or PAYABLES for the full total.
 */
export function purchaseEntry(input: PurchaseEntryInput): PurchaseEntryResult {
  if (!Number.isInteger(input.inventoryPaise) || input.inventoryPaise < 0
    || !Number.isInteger(input.expensePaise) || input.expensePaise < 0) {
    throw new AccountingError("Purchase amounts must be non-negative whole paise.");
  }
  const subtotalPaise = input.inventoryPaise + input.expensePaise;
  if (subtotalPaise <= 0) {
    throw new AccountingError("A purchase must have a total above zero.");
  }
  const taxPaise = inputTaxPaise(input.taxType, input.taxRateBasisPoints, subtotalPaise);
  const totalPaise = subtotalPaise + taxPaise;
  const lines: readonly JournalLine[] = [
    ...(input.inventoryPaise > 0 ? [{ account: "INVENTORY" as const, debitPaise: input.inventoryPaise, creditPaise: 0 }] : []),
    ...(input.expensePaise > 0 ? [{ account: "EXPENSE" as const, debitPaise: input.expensePaise, creditPaise: 0 }] : []),
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
    taxPaise,
    totalPaise,
  };
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

/** Paying down a supplier balance: Dr PAYABLES, Cr CASH. */
export function supplierPaymentEntry(input: {
  readonly entryId: string;
  readonly sourceId: string;
  readonly description: string;
  readonly amountPaise: number;
}): JournalEntry {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AccountingError("Payment amount must be a positive whole number of paise.");
  }
  return {
    id: input.entryId,
    sourceId: input.sourceId,
    sourceType: "SUPPLIER_PAYMENT",
    description: input.description,
    lines: balancedLines([
      { account: "PAYABLES", debitPaise: input.amountPaise, creditPaise: 0 },
      { account: "CASH", debitPaise: 0, creditPaise: input.amountPaise },
    ]),
    isReversal: false,
  };
}

// ---------------------------------------------------------------- cash-basis credit purchases

export interface CashBasisPurchaseFinalizeInput {
  readonly entryId: string;
  readonly sourceId: string;
  readonly sourceType: Extract<JournalSourceType, "PURCHASE_BILL" | "EXPENSE">;
  readonly description: string;
  /** Total cost of stock-tracked lines. Only this part is posted before payment. */
  readonly inventoryPaise: number;
}

/**
 * Finalize posting for a cash-basis credit (PAYABLES) purchase: only the stock received is
 * recorded (Dr INVENTORY / Cr PAYABLES). Expense and input tax wait for payments.
 * Returns `{ entry: null }` when there is nothing to post (never an empty entry).
 */
export function cashBasisPurchaseFinalizeEntry(
  input: CashBasisPurchaseFinalizeInput,
): { readonly entry: JournalEntry } | { readonly entry: null } {
  if (!Number.isInteger(input.inventoryPaise) || input.inventoryPaise < 0) {
    throw new AccountingError("Purchase amounts must be non-negative whole paise.");
  }
  if (input.inventoryPaise === 0) return { entry: null };
  return {
    entry: {
      id: input.entryId,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      description: input.description,
      lines: balancedLines([
        { account: "INVENTORY", debitPaise: input.inventoryPaise, creditPaise: 0 },
        { account: "PAYABLES", debitPaise: 0, creditPaise: input.inventoryPaise },
      ]),
      isReversal: false,
    },
  };
}

export interface CashBasisSupplierPaymentInput {
  /** V: inventory part already booked to PAYABLES at finalize. */
  readonly payablesBasePaise: number;
  /** E: expense subtotal (non-stock lines). */
  readonly expenseBasePaise: number;
  readonly taxType: InvoiceTaxType;
  readonly taxRateBasisPoints: number;
  /** T: document total (V + E + input tax). */
  readonly totalPaise: number;
  readonly recognizedPayablesPaise: number;
  readonly recognizedExpensePaise: number;
  readonly recognizedCgstPaise: number;
  readonly recognizedSgstPaise: number;
  readonly recognizedIgstPaise: number;
  /** A: this payment. */
  readonly amountPaise: number;
}

/**
 * Lines for one supplier payment on a cash-basis credit purchase. The payment is split
 * across PAYABLES (stock already booked), EXPENSE and input tax in proportion to the document,
 * driven by what is already recognized so no line is ever negative and totals land exactly.
 */
export function cashBasisSupplierPaymentLines(input: CashBasisSupplierPaymentInput): readonly JournalLine[] {
  const amounts = [
    input.payablesBasePaise, input.expenseBasePaise, input.totalPaise, input.recognizedPayablesPaise,
    input.recognizedExpensePaise, input.recognizedCgstPaise, input.recognizedSgstPaise, input.recognizedIgstPaise,
  ];
  if (amounts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new AccountingError("Purchase amounts must be non-negative whole paise.");
  }
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AccountingError("Payment amount must be a positive whole number of paise.");
  }
  const { payablesBasePaise: v, expenseBasePaise: e, totalPaise: t, amountPaise: a } = input;
  const taxPaise = t - v - e;
  if (taxPaise !== inputTaxPaise(input.taxType, input.taxRateBasisPoints, v + e)) {
    throw new AccountingError("Purchase total does not match its amounts and tax.");
  }
  const keys = ["payables", "expense", "input"] as const;
  type Bucket = typeof keys[number];
  const base: Record<Bucket, number> = { payables: v, expense: e, input: taxPaise };
  const recognized: Record<Bucket, number> = {
    payables: input.recognizedPayablesPaise,
    expense: input.recognizedExpensePaise,
    input: input.recognizedCgstPaise + input.recognizedSgstPaise + input.recognizedIgstPaise,
  };
  const priorPaid = recognized.payables + recognized.expense + recognized.input;
  const paidAfter = priorPaid + a;
  if (paidAfter > t) {
    throw new AccountingError("Payment cannot exceed the outstanding balance.");
  }
  const delta: Record<Bucket, number> = { payables: 0, expense: 0, input: 0 };
  for (const key of keys) {
    const target = paidAfter === t ? base[key] : Math.round(paidAfter * base[key] / t);
    delta[key] = Math.min(Math.max(target - recognized[key], 0), base[key] - recognized[key]);
  }
  let diff = a - (delta.payables + delta.expense + delta.input);
  if (diff > 0) {
    for (const key of keys) {
      const add = Math.min(diff, base[key] - recognized[key] - delta[key]);
      delta[key] += add;
      diff -= add;
    }
  } else if (diff < 0) {
    for (const key of keys) {
      const take = Math.min(-diff, delta[key]);
      delta[key] -= take;
      diff += take;
    }
  }
  if (diff !== 0) throw new AccountingError("Payment could not be allocated.");

  const inputThis = delta.input;
  let inputLines: readonly JournalLine[] = [];
  if (input.taxType === "IGST") {
    inputLines = inputThis > 0 ? [{ account: "INPUT_IGST", debitPaise: inputThis, creditPaise: 0 }] : [];
  } else if (input.taxType === "CGST_SGST") {
    const cgstThis = Math.floor((input.recognizedCgstPaise + input.recognizedSgstPaise + inputThis) / 2)
      - input.recognizedCgstPaise;
    const sgstThis = inputThis - cgstThis;
    inputLines = [
      ...(cgstThis > 0 ? [{ account: "INPUT_CGST" as const, debitPaise: cgstThis, creditPaise: 0 }] : []),
      ...(sgstThis > 0 ? [{ account: "INPUT_SGST" as const, debitPaise: sgstThis, creditPaise: 0 }] : []),
    ];
  }
  return balancedLines([
    ...(delta.payables > 0 ? [{ account: "PAYABLES" as const, debitPaise: delta.payables, creditPaise: 0 }] : []),
    ...(delta.expense > 0 ? [{ account: "EXPENSE" as const, debitPaise: delta.expense, creditPaise: 0 }] : []),
    ...inputLines,
    { account: "CASH", debitPaise: 0, creditPaise: a },
  ]);
}
