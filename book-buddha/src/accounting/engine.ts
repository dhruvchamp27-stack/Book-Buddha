import type {
  AccountCode,
  AuditEvent,
  CancelledInvoice,
  FinalizedInvoice,
  Invoice,
  JournalEntry,
  JournalLine,
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
