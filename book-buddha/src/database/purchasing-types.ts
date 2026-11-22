import type {
  InvoiceTaxType,
  PurchaseBillLine,
  PurchaseDocumentStatus,
  PurchasePaymentAccount,
} from "../accounting/types.js";

export interface SupplierInput {
  readonly id?: string;
  readonly companyId: string;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly phone2?: string;
  readonly classification?: string;
  readonly gstin?: string;
  readonly website?: string;
  readonly billingAddress?: string;
  readonly shippingAddress?: string;
  readonly internalNotes?: string;
}

/** Editable supplier fields. `null` clears a value. */
export interface SupplierPatch {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly phone2?: string | null;
  readonly classification?: string | null;
  readonly gstin?: string | null;
  readonly website?: string | null;
  readonly billingAddress?: string | null;
  readonly shippingAddress?: string | null;
  readonly internalNotes?: string | null;
}

export interface SupplierRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly phone2: string | null;
  readonly classification: string | null;
  readonly gstin: string | null;
  readonly website: string | null;
  readonly billingAddress: string | null;
  readonly shippingAddress: string | null;
  readonly internalNotes: string | null;
  readonly active: boolean;
}

export interface ExpenseCategoryRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly active: boolean;
}

export interface PurchaseBillInput {
  readonly id?: string;
  readonly businessId: string;
  readonly supplierId: string;
  /** Optional project (fair); must belong to the business's company. Fixed once finalized. */
  readonly fairId?: string;
  readonly number: string;
  readonly supplierInvoiceNumber?: string;
  /** YYYY-MM-DD */
  readonly billDate: string;
  readonly dueDate?: string;
  readonly notes?: string;
  readonly taxType?: InvoiceTaxType;
  readonly taxRateBasisPoints?: number;
  /**
   * R8 (migration v18). Header-level discount the supplier gave on the bill as a whole, mirroring
   * the invoice. Cannot exceed the line subtotal. Credits PURCHASE_DISCOUNT ("Discount Received")
   * rather than reducing the goods cost - see V18_ADDED_ACCOUNTS for why, and for the trade-off
   * that accepts.
   */
  readonly discountPaise?: number;
  /** R8. Freight, packing and the like added by the supplier. Debits PURCHASE_EXTRA_CHARGES. */
  readonly extraChargePaise?: number;
  /** I-Q6. Typed by the owner to match the supplier's printed total. Signed whole paise, under Rs 1. Default 0. */
  readonly roundOffPaise?: number;
  readonly paymentAccount: PurchasePaymentAccount;
  readonly lines: readonly PurchaseBillLine[];
}

export interface PurchaseBillRecord {
  readonly id: string;
  readonly businessId: string;
  readonly supplierId: string;
  readonly number: string;
  readonly supplierInvoiceNumber: string | null;
  readonly billDate: string;
  readonly dueDate: string | null;
  readonly notes: string | null;
  readonly taxType: InvoiceTaxType;
  readonly taxRateBasisPoints: number;
  readonly paymentAccount: PurchasePaymentAccount;
  readonly status: PurchaseDocumentStatus;
  /** Present only when the bill is tagged to a project (fair). */
  readonly fairId?: string;
  readonly lines: readonly PurchaseBillLine[];
  /** The lines, before the header discount and extra charge. */
  readonly subtotalPaise: number;
  readonly discountPaise: number;
  readonly extraChargePaise: number;
  /** subtotal - discount + extra charge. What input GST is charged on. */
  readonly taxablePaise: number;
  readonly taxPaise: number;
  /** taxable + tax: the COMPUTED total. The typed round-off (I-Q6) is its own figure below, never folded in. */
  readonly totalPaise: number;
  /** I-Q6. The round-off the owner typed, signed whole paise. 0 when none. */
  readonly roundOffPaise: number;
  readonly paidPaise: number;
  /** F: kept as history (dated on or before the opening date); never journalled. */
  readonly beforeOpening: boolean;
}

export interface ExpenseInput {
  readonly id?: string;
  readonly businessId: string;
  readonly supplierId?: string;
  readonly categoryId?: string;
  /** Optional project (fair); must belong to the business's company. Fixed once finalized. */
  readonly fairId?: string;
  readonly number: string;
  /** YYYY-MM-DD */
  readonly expenseDate: string;
  readonly description: string;
  readonly amountPaise: number;
  readonly taxType?: InvoiceTaxType;
  readonly taxRateBasisPoints?: number;
  /** I-Q6. Typed by the owner to match the supplier's printed total. Signed whole paise, under Rs 1. Default 0. */
  readonly roundOffPaise?: number;
  readonly paymentAccount: PurchasePaymentAccount;
}

export interface ExpenseRecord {
  readonly id: string;
  readonly businessId: string;
  readonly supplierId: string | null;
  readonly categoryId: string | null;
  readonly number: string;
  readonly expenseDate: string;
  readonly description: string;
  readonly amountPaise: number;
  readonly taxType: InvoiceTaxType;
  readonly taxRateBasisPoints: number;
  readonly paymentAccount: PurchasePaymentAccount;
  readonly status: PurchaseDocumentStatus;
  /** Present only when the expense is tagged to a project (fair). */
  readonly fairId?: string;
  readonly taxPaise: number;
  readonly totalPaise: number;
  /** I-Q6. The round-off the owner typed, signed whole paise. 0 when none; not folded into `totalPaise`. */
  readonly roundOffPaise: number;
  readonly paidPaise: number;
  /** F: kept as history (dated on or before the opening date); never journalled. */
  readonly beforeOpening: boolean;
}

export interface SupplierPaymentInput {
  /** F: confirm that a payment dated on or before the opening date is kept as history (not posted). */
  readonly confirmBeforeOpening?: boolean;
  /** Q12: confirm that a payment dated in an earlier month than today changes figures already reported. */
  readonly confirmBackdatedMonth?: boolean | undefined;
  readonly billId?: string;
  readonly expenseId?: string;
  /** The money that actually leaves the money account. */
  readonly amountPaise: number;
  /**
   * Q2 / S17-7. A discount the supplier allows AT PAYMENT (whole paise, >= 0): "Discount received"
   * income. The document is settled by amount + discount; only `amountPaise` leaves the account.
   */
  readonly settlementDiscountPaise?: number;
  /** Business date the money moved (YYYY-MM-DD, IST). Defaults to today. */
  readonly paidOn?: string;
}

export interface PayableRow {
  readonly documentType: "BILL" | "EXPENSE" | "OPENING";
  readonly documentId: string;
  readonly documentNumber: string;
  readonly supplierId: string;
  readonly documentDate: string;
  readonly totalPaise: number;
  readonly paidPaise: number;
  readonly outstandingPaise: number;
  readonly ageDays: number;
}

export interface SupplierStatementRow {
  readonly date: string;
  readonly type: "BILL" | "EXPENSE" | "PAYMENT" | "RETURN" | "OPENING" | "SETTLEMENT";
  readonly documentId: string;
  readonly reference: string;
  /** Positive = we owe more (bill/expense/opening balance); negative = payment, return or opening settlement. */
  readonly amountPaise: number;
  readonly balancePaise: number;
}

export interface SupplierStatement {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly rows: readonly SupplierStatementRow[];
  readonly closingBalancePaise: number;
}

/**
 * R8 purchase returns (migration v19) - the supplier mirror of a credit note.
 *
 * Deliberately shaped like CreditNoteLine / CreditNote, because that is exactly what this is on
 * the other side of the books, and the next person should not have to learn two vocabularies.
 */
export interface PurchaseReturnLine {
  /** Absent for a line that was never a stock item (a service, freight, a one-off). */
  readonly itemId?: string;
  readonly description: string;
  readonly quantity: number;
  /** Must be the price the BILL charged for this item: that is what the stock layer holds. */
  readonly unitPricePaise: number;
  /**
   * I-Q14: the bill line (`purchase_bill_lines.id`) this return line sends back. The return line
   * takes THAT line's rate. Absent on input, the repository links it by item and price.
   */
  readonly reversesBillLineId?: number;
  /** Always present on what the repository reads back: the rate the line reverses. */
  readonly taxRateBasisPoints?: number;
}

export interface PurchaseReturnInput {
  readonly id?: string;
  readonly billId: string;
  /** S17-4: the app numbers a purchase return (PR-001/25-26); given only by the import path. */
  readonly number?: string;
  readonly reason: string;
  /**
   * YYYY-MM-DD, the day the goods actually went back. Defaults to today (IST).
   *
   * A credit note has no date of its own and is dated at finalize instead (S4-8), which the owner
   * has an open complaint about (S8-4: a return cannot be back-dated). A purchase return is new,
   * so it carries its own document date from the start rather than inheriting that problem.
   */
  readonly returnDate?: string;
  readonly lines: readonly PurchaseReturnLine[];
}

export interface PurchaseReturnRecord {
  readonly id: string;
  readonly billId: string;
  readonly number: string;
  readonly reason: string;
  readonly returnDate: string;
  readonly status: PurchaseDocumentStatus;
  readonly lines: readonly PurchaseReturnLine[];
  /** The lines: what the goods were billed at. */
  readonly valuePaise: number;
  /** F: kept as history (dated on or before the opening date); never journalled. */
  readonly beforeOpening: boolean;
}

/** What a finalized return is worth back from the supplier, and how much is still undischarged. */
export interface PurchaseReturnBalance {
  /** Posted to SUPPLIER_CREDITS: the part that exceeded what was still owed on the bill. */
  readonly creditPaise: number;
  readonly refundedPaise: number;
  readonly outstandingPaise: number;
}
