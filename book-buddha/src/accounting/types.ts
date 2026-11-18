/** The one runtime list of valid account codes. The AccountCode type is derived from it. */
export const ACCOUNT_CODES = [
  "CASH", "RECEIVABLES", "SALES", "INVENTORY", "COGS",
  "OUTPUT_CGST", "OUTPUT_SGST", "OUTPUT_IGST",
  "PAYABLES", "INPUT_CGST", "INPUT_SGST", "INPUT_IGST", "EXPENSE",
] as const;
export type AccountCode = (typeof ACCOUNT_CODES)[number];
export type InvoiceTaxType = "NONE" | "CGST_SGST" | "IGST";
/**
 * A company's stored reporting preference ONLY. Posting is ALWAYS accrual regardless of this
 * value; it is the default for the (sub-slice 7d) report-level Cash/Accrual toggle. Do not remove.
 */
export type AccountingBasis = "CASH" | "ACCRUAL";

export type InvoiceStatus = "DRAFT" | "QUOTATION" | "FINALIZED" | "CANCELLED";

export interface InvoiceLine {
  readonly itemId?: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPricePaise: number;
}

export interface Invoice {
  readonly id: string;
  readonly number: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly invoiceDate?: string;
  readonly dueDate?: string;
  readonly discountPaise?: number;
  readonly extraChargePaise?: number;
  readonly notes?: string;
  readonly paymentTerms?: string;
  readonly taxType?: InvoiceTaxType;
  readonly taxRateBasisPoints?: number;
  readonly fairId?: string;
  readonly buyerName?: string;
  readonly buyerContact?: string;
  readonly lines: readonly InvoiceLine[];
  readonly paymentAccount: AccountCode;
  readonly status: InvoiceStatus;
  readonly convertedInvoiceId?: string;
}

export type CreditNoteStatus = "DRAFT" | "FINALIZED" | "CANCELLED";

export interface CreditNoteLine {
  readonly itemId?: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPricePaise: number;
}

export interface CreditNote {
  readonly id: string;
  readonly invoiceId: string;
  readonly number: string;
  readonly reason: string;
  /**
   * The day the goods came back and the note takes effect (S11-4). Absent means no date was
   * given (S11-20): the note then posts on the day it is finalized.
   */
  readonly noteDate?: string;
  readonly status: CreditNoteStatus;
  readonly lines: readonly CreditNoteLine[];
}

export interface JournalLine {
  /**
   * Any code in `chart_accounts`, which the user can extend at runtime (decision S2-1) - so this
   * CANNOT be the fixed `AccountCode` union: the union would make the accounts the user just
   * created unpostable at compile time, which is the whole point of the table. Validity is
   * enforced where it can be: the posting door (ledger.ts) looks the code up in the chart, and
   * a BEFORE INSERT trigger backs it up inside the database on every connection.
   * `AccountCode` stays as the typed set of codes the posting ENGINE itself emits.
   */
  readonly account: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
}

/**
 * OPENING_BALANCE is deliberately its own source type rather than defaulting to INVOICE: the cash
 * view walks documents by source type, and an opening set is not an invoice. It is also why the
 * cash view does not see opening income today - see the pinned test in opening-balances.test.ts.
 */
export type JournalSourceType =
  | "INVOICE"
  | "PURCHASE_BILL"
  | "EXPENSE"
  | "SUPPLIER_PAYMENT"
  | "OPENING_BALANCE"
  /**
   * Hand-entered opening stock and stock adjustments (R4c). `source_id` is the stock movement's
   * own id, which is also what makes the backfill idempotent: a movement has been posted exactly
   * when a STOCK_MOVEMENT entry carries its id, so no link table and no new migration is needed.
   * `source_type` has no CHECK constraint in SQLite, so this is a TypeScript widening only.
   */
  | "STOCK_MOVEMENT";

export interface JournalEntry {
  readonly id: string;
  readonly sourceId: string;
  /** Defaults to "INVOICE" (sales side) when omitted. */
  readonly sourceType?: JournalSourceType;
  readonly description: string;
  readonly lines: readonly JournalLine[];
  readonly isReversal: boolean;
}

export interface Payment {
  readonly id: string;
  readonly invoiceId: string;
  readonly amountPaise: number;
  readonly paymentAccount: "CASH";
  readonly paidAt: string;
  /**
   * R8. When this payment was cancelled, or null while it stands. A cancelled payment is NEVER
   * deleted: the row stays, its original journal entry stays exactly as posted, and a reversing
   * entry is posted beside it. Every sum of what has been paid excludes a cancelled row.
   */
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
}

export interface AuditEvent {
  readonly action: string;
  readonly entityId: string;
  readonly occurredAt: string;
}

export interface FinalizedInvoice {
  readonly invoice: Invoice;
  readonly journalEntry: JournalEntry;
  readonly auditEvent: AuditEvent;
}

export interface CancelledInvoice {
  readonly invoice: Invoice;
  readonly reversalEntry: JournalEntry;
  readonly auditEvent: AuditEvent;
}

export type PurchaseDocumentStatus = "DRAFT" | "FINALIZED" | "CANCELLED";
export type PurchasePaymentAccount = "CASH" | "PAYABLES";

export interface PurchaseBillLine {
  readonly itemId?: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPricePaise: number;
}

export interface SupplierPayment {
  readonly id: string;
  readonly supplierId: string;
  readonly billId: string | null;
  readonly expenseId: string | null;
  readonly amountPaise: number;
  readonly paymentAccount: "CASH";
  readonly paidAt: string;
  /** R8. The supplier mirror of Payment.cancelledAt. */
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
}
