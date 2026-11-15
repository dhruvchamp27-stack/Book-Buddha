export type AccountCode =
  | "CASH" | "RECEIVABLES" | "SALES" | "INVENTORY" | "COGS"
  | "OUTPUT_CGST" | "OUTPUT_SGST" | "OUTPUT_IGST"
  | "PAYABLES" | "INPUT_CGST" | "INPUT_SGST" | "INPUT_IGST" | "EXPENSE";
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
  readonly status: CreditNoteStatus;
  readonly lines: readonly CreditNoteLine[];
}

export interface JournalLine {
  readonly account: AccountCode;
  readonly debitPaise: number;
  readonly creditPaise: number;
}

export type JournalSourceType = "INVOICE" | "PURCHASE_BILL" | "EXPENSE" | "SUPPLIER_PAYMENT";

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
}
