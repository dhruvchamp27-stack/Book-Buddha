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
  readonly subtotalPaise: number;
  readonly taxPaise: number;
  readonly totalPaise: number;
  readonly paidPaise: number;
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
  readonly paidPaise: number;
}

export interface SupplierPaymentInput {
  readonly billId?: string;
  readonly expenseId?: string;
  readonly amountPaise: number;
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
  readonly type: "BILL" | "EXPENSE" | "PAYMENT";
  readonly documentId: string;
  readonly reference: string;
  /** Positive = we owe more (bill/expense); negative = payment made. */
  readonly amountPaise: number;
  readonly balancePaise: number;
}

export interface SupplierStatement {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly rows: readonly SupplierStatementRow[];
  readonly closingBalancePaise: number;
}
