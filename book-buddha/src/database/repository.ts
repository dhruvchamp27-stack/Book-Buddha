import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  AccountingError,
  allocateProportionally,
  cancelInvoice,
  finalizeInvoice,
  inputTaxPaise,
  purchaseEntry,
  reverseEntry,
  supplierPaymentEntry,
  validatePurchaseTax,
} from "../accounting/engine.js";
import type {
  AccountCode,
  AuditEvent,
  CreditNote,
  CreditNoteLine,
  Invoice,
  InvoiceLine,
  InvoiceTaxType,
  JournalEntry,
  JournalSourceType,
  Payment,
  PurchaseBillLine,
  PurchaseDocumentStatus,
  PurchasePaymentAccount,
  SupplierPayment,
} from "../accounting/types.js";
import { ACCOUNT_CODES, type AccountingBasis } from "../accounting/types.js";
import { advanceRunDate, isValidIsoDate, type RecurrenceFrequency } from "../accounting/recurrence.js";
import { runMigrations } from "./migrations.js";
import { RepositoryValidationError } from "./errors.js";
import { assertPeriodOpen, postJournalEntry } from "./ledger.js";
import { appendAuditEvent } from "./audit-log.js";
import { reportConditions } from "./report-filters-sql.js";
import {
  salesByBusiness, salesByCustomer, salesByFair, salesByTax, creditNoteReport, salesReturnReport,
  type SalesReportFilter, type CreditNoteReportFilter, type SalesReport, type CreditNoteReport,
  type SalesByBusinessRow, type SalesByCustomerRow, type SalesByFairRow, type SalesByTaxRow,
  type SalesReturnReport,
} from "./reports-sales.js";
import {
  transactionListByDate, transactionDetailByAccount, stockMovementReport,
  type TransactionReportFilter, type TransactionListRow, type TransactionDetailAccount,
  type StockMovementFilter, type StockMovementRow,
} from "./reports-transactions.js";
export type * from "./reports-sales.js";
export type * from "./reports-transactions.js";
import { ACCOUNT_TYPES, SETTLEMENT_ROLES, type AccountRole, type AccountType } from "./chart-accounts-schema.js";
import { OPENING_BALANCE_EQUITY_CODE, OPENING_CONTROL_ROLES } from "./opening-balances-schema.js";
import type {
  ExpenseCategoryRecord,
  ExpenseInput,
  ExpenseRecord,
  PayableRow,
  PurchaseBillInput,
  PurchaseBillRecord,
  SupplierInput,
  SupplierPatch,
  SupplierPaymentInput,
  SupplierRecord,
  SupplierStatement,
  SupplierStatementRow,
} from "./purchasing-types.js";
export type * from "./purchasing-types.js";
import { hashPassword, passwordPolicyProblem, verifyPassword } from "../auth/password.js";
import { generateRecoveryCode, normaliseRecoveryCode } from "../auth/recovery-code.js";
import {
  generateSessionToken,
  hashToken,
  isLocked,
  isSessionExpired,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  sessionExpiryIso,
} from "../auth/session.js";

/** Spread helper: `{}` when there is no fair, so a missing project is simply absent (stored NULL). */
function fairDim(fairId: string | undefined): { fairId?: string } {
  return fairId === undefined ? {} : { fairId };
}

/** Safety cap on catch-up drafts created for one template in a single generate call. */
const MAX_DRAFTS_PER_TEMPLATE_PER_RUN = 366;

export interface RecurringInvoiceTemplateInput {
  readonly id?: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly fairId?: string;
  readonly buyerName?: string;
  readonly buyerContact?: string;
  readonly paymentAccount: "CASH" | "RECEIVABLES";
  readonly taxType?: Invoice["taxType"];
  readonly taxRateBasisPoints?: number;
  readonly discountPaise?: number;
  readonly extraChargePaise?: number;
  readonly notes?: string;
  readonly paymentTerms?: string;
  readonly frequency: RecurrenceFrequency;
  readonly intervalCount?: number;
  readonly startDate: string;
  /** Defaults to startDate. */
  readonly nextRunDate?: string;
  readonly endDate?: string;
  readonly lines: readonly InvoiceLine[];
}

export interface RecurringInvoiceTemplate {
  readonly id: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly fairId?: string;
  readonly buyerName?: string;
  readonly buyerContact?: string;
  readonly paymentAccount: "CASH" | "RECEIVABLES";
  readonly taxType: NonNullable<Invoice["taxType"]>;
  readonly taxRateBasisPoints: number;
  readonly discountPaise: number;
  readonly extraChargePaise: number;
  readonly notes?: string;
  readonly paymentTerms?: string;
  readonly frequency: RecurrenceFrequency;
  readonly intervalCount: number;
  readonly startDate: string;
  readonly nextRunDate: string;
  readonly endDate?: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lines: readonly InvoiceLine[];
}

export interface RecurringInvoiceTemplateUpdate {
  readonly active?: boolean;
  readonly nextRunDate?: string;
}

export interface UpcomingRecurringInvoiceRow {
  readonly templateId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly frequency: RecurrenceFrequency;
  readonly intervalCount: number;
  readonly nextRunDate: string;
  readonly endDate: string | null;
  /** Expected invoice total (incl. tax) for the next run, in paise. */
  readonly totalPaise: number;
}

export interface GenerationFailure {
  readonly templateId: string;
  readonly error: string;
}

export interface GenerateDueInvoicesResult {
  readonly asOfDate: string;
  readonly invoices: readonly Invoice[];
  /** Templates that could not generate; they are left untouched and can be retried. */
  readonly failures: readonly GenerationFailure[];
}

interface RecurringTemplateRow {
  id: string;
  business_id: string;
  customer_id: string;
  fair_id: string | null;
  buyer_name: string | null;
  buyer_contact: string | null;
  payment_account: "CASH" | "RECEIVABLES";
  tax_type: NonNullable<Invoice["taxType"]>;
  tax_rate_basis_points: number;
  discount_paise: number;
  extra_charge_paise: number;
  notes: string | null;
  payment_terms: string | null;
  frequency: RecurrenceFrequency;
  interval_count: number;
  start_date: string;
  next_run_date: string;
  end_date: string | null;
  active: number;
  created_at: string;
}

function templateTotalPaise(template: RecurringInvoiceTemplate): number {
  const subtotal = template.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0);
  const taxable = subtotal - template.discountPaise + template.extraChargePaise;
  return taxable + Math.round(taxable * template.taxRateBasisPoints / 10000);
}

interface InvoiceRow {
  id: string;
  number: string;
  business_id: string;
  customer_id: string;
  payment_account: AccountCode;
  status: Invoice["status"];
  fair_id: string | null;
  buyer_name: string | null;
  buyer_contact: string | null;
  invoice_date: string | null;
  due_date: string | null;
  discount_paise: number;
  extra_charge_paise: number;
  notes: string | null;
  payment_terms: string | null;
  converted_invoice_id: string | null;
  tax_type: Invoice["taxType"] | null;
  tax_rate_basis_points: number;
  created_at?: string;
}

interface InvoiceLineRow {
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price_paise: number;
}

interface JournalEntryRow {
  id: string;
  source_id: string;
  description: string;
  is_reversal: number;
  created_at?: string;
}

interface JournalLineRow {
  account: AccountCode;
  debit_paise: number;
  credit_paise: number;
}

export interface CompanyInput {
  readonly id?: string;
  readonly name: string;
  readonly accountingBasis?: AccountingBasis;
}

export interface BusinessInput {
  readonly id?: string;
  readonly companyId: string;
  readonly name: string;
}

export interface CustomerInput {
  readonly id?: string;
  readonly companyId: string;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly classification?: string;
  readonly gstin?: string;
  readonly website?: string;
  readonly phone2?: string;
  readonly billingAddress?: string;
  readonly shippingAddress?: string;
  readonly internalNotes?: string;
  /** When set, a customer_number (e.g. SCH0001) is auto-allocated. Callers can never set the number directly. */
  readonly numberingCategory?: string;
}

/** Editable customer profile fields. `null` clears a value. customer_number is never editable. */
export interface CustomerPatch {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly classification?: string | null;
  readonly gstin?: string | null;
  readonly website?: string | null;
  readonly phone2?: string | null;
  readonly billingAddress?: string | null;
  readonly shippingAddress?: string | null;
  readonly internalNotes?: string | null;
}

export const CUSTOMER_CLASSIFICATIONS = [
  "Individual", "Business", "Company", "Partnership", "Trust", "Charity", "Government", "Other",
] as const;
export const CUSTOMER_NUMBERING_CATEGORIES = ["SCH", "LIB", "CLG", "RET", "GEN"] as const;

export interface DuplicateCustomerQuery {
  readonly companyId: string;
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly gstin?: string;
}

export interface ItemInput {
  readonly id?: string;
  readonly companyId: string;
  readonly name: string;
  readonly unit: string;
  readonly trackStock?: boolean;
  readonly description?: string;
  readonly sellingPricePaise?: number;
  readonly costPricePaise?: number;
  readonly mrpPaise?: number;
  readonly reorderThreshold?: number;
}

/** Editable item fields. `null` clears an optional value. track_stock is not editable. */
export interface ItemPatch {
  readonly name?: string;
  readonly unit?: string;
  readonly description?: string | null;
  readonly sellingPricePaise?: number | null;
  readonly costPricePaise?: number | null;
  readonly mrpPaise?: number | null;
  readonly reorderThreshold?: number | null;
}

export interface InventoryValuationRow {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly valuePaise: number;
}

export interface LowStockRow {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly reorderThreshold: number;
}

export interface SalesByItemRow {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly salesPaise: number;
}

export interface FairInput {
  readonly id?: string;
  readonly companyId: string;
  readonly hostCustomerId: string;
  readonly name: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export interface FairRecord {
  readonly id: string;
  readonly companyId: string;
  readonly hostCustomerId: string;
  readonly name: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
}

export interface CreditNoteSummary {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly number: string;
  readonly reason: string;
  readonly status: CreditNote["status"];
  readonly createdAt: string;
  /** Taxable value of the returned lines, in paise. */
  readonly subtotalPaise: number;
  /** Tax reversed on the returned lines (invoice tax rate), in paise. */
  readonly taxPaise: number;
  /** subtotalPaise + taxPaise: the amount credited back on finalize. */
  readonly totalPaise: number;
}

export interface TrialBalanceRow {
  /** A code from chart_accounts, which the user can extend at runtime - NOT a fixed union. */
  readonly account: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
}

export interface ReportAccountRow {
  readonly account: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
  readonly balancePaise: number;
}

/** A financial year for one business, and whether it is closed to new postings. */
export interface FinancialYear {
  readonly id: string;
  readonly businessId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: "OPEN" | "LOCKED";
  readonly lockedAt: string | null;
}

/** An account in the chart. `system` accounts are the engine's own, shared by every company. */
export interface ChartAccount {
  readonly code: string;
  readonly companyId: string | null;
  readonly name: string;
  readonly type: AccountType;
  /** The job this account does in the engine; only system accounts have one. */
  readonly role: AccountRole | null;
  readonly parentCode: string | null;
  readonly active: boolean;
  readonly system: boolean;
}

/**
 * A report row carrying its classification, JOINed from chart_accounts (decision S2-1).
 * Every report section is selected by `type` or `role`, never by a hardcoded list of codes, so
 * an account the user adds cannot be silently dropped from a report - which, for a
 * balance-sheet account, used to unbalance the sheet with no error at all.
 */
export interface ClassifiedReportAccountRow extends ReportAccountRow {
  readonly type: AccountType;
  readonly role: AccountRole | null;
}

export interface ProfitAndLossReport {
  readonly income: readonly ReportAccountRow[];
  readonly expenses: readonly ReportAccountRow[];
  readonly totalIncomePaise: number;
  readonly totalExpensesPaise: number;
  readonly netProfitPaise: number;
  /** Which view this report is: the books as posted (ACCRUAL) or the derived cash view (CASH). */
  readonly basis: AccountingBasis;
  /**
   * Gross sales including GST. Accrual: net sales + GST straight from the ledger.
   * Cash: the cash actually collected on invoices in the period (it can differ from
   * net + GST by a paise or two part-way through an invoice; exact once fully collected).
   */
  readonly grossSalesPaise: number;
  /** Output GST (CGST + SGST + IGST) on those sales, net of any credit-note reversal. */
  readonly gstOnSalesPaise: number;
}

/**
 * One slice of the derived cash view: a document's accrual line, recognised on the date the
 * cash moved. amountPaise is in the account's natural direction (credit - debit for SALES and
 * OUTPUT_* GST; debit - credit for COGS, EXPENSE, INVENTORY and INPUT_* GST).
 */
export interface CashRecognitionRow {
  readonly date: string;
  /** A chart_accounts code, extensible at runtime - NOT a fixed union. */
  readonly account: string;
  readonly amountPaise: number;
  readonly documentType: "INVOICE" | "PURCHASE_BILL" | "EXPENSE" | "OPENING_BALANCE";
  readonly documentId: string;
}

export interface CashViewDerivation {
  readonly recognitions: readonly CashRecognitionRow[];
  /** Cash received on invoices, by date: the "gross sales" of the cash view. */
  readonly invoiceCollections: ReadonlyArray<{ readonly date: string; readonly amountPaise: number }>;
}

/**
 * The derived retained-earnings figure cut at the financial-year boundary (R5).
 *
 * PRESENTATION ONLY. No closing entry is ever posted (S5-4) and `BalanceSheetReport.equity`
 * is untouched: it still carries the single derived RETAINED_EARNINGS row, and this split is
 * an extra reading of that same number. The cut is ONE date - the financial year's start - and
 * the upper bound is whatever bound the sheet itself used, so the two parts partition the
 * figure exactly and cannot quietly lose an entry between them.
 */
export interface RetainedEarningsSplit {
  readonly financialYearId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  /** Profit for the year is measured from here: the financial year's first day. */
  readonly periodFrom: string;
  /**
   * ...to here: the sheet's own as-at date. `null` means the sheet had no as-at bound, so the
   * figure runs to the latest entry there is - which, if anything is dated after `endsOn`,
   * is MORE than the financial year. The dates are published so that is visible, not implied.
   */
  readonly periodTo: string | null;
  /** Everything earned before `periodFrom`: retained earnings brought forward. */
  readonly broughtForwardPaise: number;
  /** Everything earned from `periodFrom` to `periodTo`: profit for the year. */
  readonly profitForYearPaise: number;
}

/** The derived retained-earnings figure, and the year-boundary split of it when one is possible. */
export interface RetainedEarningsBreakdown {
  /** The single derived figure - identical to the RETAINED_EARNINGS row in `equity`. */
  readonly totalPaise: number;
  /** `null` when no financial year can be picked; `broughtForwardPaise + profitForYearPaise === totalPaise`. */
  readonly split: RetainedEarningsSplit | null;
  /** Plain English for the owner, non-null exactly when `split` is null. */
  readonly unsplitReason: string | null;
}

export interface BalanceSheetReport {
  readonly assets: readonly ReportAccountRow[];
  readonly liabilities: readonly ReportAccountRow[];
  readonly equity: readonly ReportAccountRow[];
  readonly totalAssetsPaise: number;
  readonly totalLiabilitiesPaise: number;
  readonly totalEquityPaise: number;
  /** R5: the derived retained earnings, split into brought forward and profit for the year. */
  readonly retainedEarnings: RetainedEarningsBreakdown;
}

export interface GeneralLedgerRow {
  readonly journalEntryId: string;
  readonly sourceId: string;
  readonly sourceType: JournalSourceType;
  /**
   * When the row was WRITTEN - a full timestamp, not a business date. It was called `date`
   * until R7b, which read as the transaction date and was rendered as one, so a back-dated
   * opening entry appeared under today. Nothing in a ledger column should be called "date"
   * unless it is `entryDate`.
   */
  readonly postedAt: string;
  /** Transaction date (YYYY-MM-DD, IST) — what the report is read, ordered and filtered by. */
  readonly entryDate: string;
  readonly description: string;
  readonly isReversal: boolean;
  readonly account: AccountCode;
  readonly debitPaise: number;
  readonly creditPaise: number;
}

/** One open item of a customer: an invoice or an opening balance. See getOpenCustomerItems. */
export interface OpenCustomerItem {
  readonly documentId: string;
  readonly kind: "INVOICE" | "OPENING";
  readonly date: string;
  readonly totalPaise: number;
  /** Payments, applied credit and credit notes (invoice), or receipts (opening balance). */
  readonly settledPaise: number;
  readonly outstandingPaise: number;
  readonly customerId: string;
  readonly businessId: string;
}

/** The supplier mirror of OpenCustomerItem. See getOpenSupplierItems. */
export interface OpenSupplierItem {
  readonly documentId: string;
  readonly kind: "BILL" | "EXPENSE" | "OPENING";
  readonly date: string;
  readonly totalPaise: number;
  readonly settledPaise: number;
  readonly outstandingPaise: number;
  readonly supplierId: string;
  readonly businessId: string;
}

export interface OpeningCustomerBalanceRecord {
  readonly id: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly asAt: string;
  readonly amountPaise: number;
  /** The part of the balance that is income earned before the books began (S5-2). 0 = balance sheet only. */
  readonly incomePaise: number;
  readonly incomeAccount: string | null;
  readonly journalEntryId: string;
  readonly reversedAt: string | null;
  readonly createdAt: string;
  readonly receivedPaise: number;
}

export interface OpeningSupplierBalanceRecord {
  readonly id: string;
  readonly businessId: string;
  readonly supplierId: string;
  readonly asAt: string;
  readonly amountPaise: number;
  readonly journalEntryId: string;
  readonly reversedAt: string | null;
  readonly createdAt: string;
  readonly paidPaise: number;
}

/**
 * R7b. One age band of what is owed. `toDays` null means "and older".
 * Ages are measured from the document's own date to the report's as-at date, INCLUSIVE of
 * neither end being guessed: the as-at date is passed in, never read from the clock, so the
 * same books asked the same question twice give the same answer.
 */
export interface AgeingBucket {
  readonly label: string;
  readonly fromDays: number;
  readonly toDays: number | null;
  readonly outstandingPaise: number;
  readonly documentCount: number;
}

/** What one customer or supplier owes, split into age bands. */
export interface AgeingPartyRow {
  readonly partyId: string;
  readonly partyName: string;
  readonly outstandingPaise: number;
  readonly buckets: readonly AgeingBucket[];
}

/**
 * R7b. Ageing of what is owed, read from the SAME open-items query as `getReceivables` and
 * `getOpenCustomerItems` (and their supplier mirrors), so there is one definition of what is
 * outstanding and these cannot drift apart from the Balance Sheet control account.
 */
export interface AgeingReport {
  /**
   * The date everything was aged against. Always present, even when the caller gave none.
   *
   * KNOWN LIMIT, say it plainly rather than imply otherwise: documents dated after this date
   * are excluded, but SETTLEMENT is counted as it stands today. So this answers "how old is
   * what is still owed, counted from this date", not "what was owed on this date". An invoice
   * raised in March and paid last week shows as settled even when asked as at April. Making it
   * a true as-at position needs the open-items query to date settlements too, which is a
   * change to that query and not to this report.
   */
  readonly asAtDate: string;
  readonly rows: readonly AgeingPartyRow[];
  /** The same bands, totalled across every party. */
  readonly buckets: readonly AgeingBucket[];
  readonly totalOutstandingPaise: number;
}

export interface ReceivableRow {
  /** INVOICE, or OPENING for an opening customer balance (then invoiceId is the opening balance's id). */
  readonly kind: "INVOICE" | "OPENING";
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly customerId: string;
  readonly invoiceDate: string;
  readonly totalPaise: number;
  readonly paidPaise: number;
  /** Tax-inclusive value of finalized credit notes on this invoice; reduces what is owed. */
  readonly creditedPaise: number;
  readonly outstandingPaise: number;
  readonly ageDays: number;
}

export interface FairSalesRow {
  readonly fairId: string;
  readonly fairName: string;
  readonly invoiceCount: number;
  readonly totalPaise: number;
}

export type StockMovementType = "OPENING" | "PURCHASE" | "ADJUSTMENT";

/**
 * What a hand-entered stock movement credits, per the owner's ruling S5-3. INVENTORY is always the
 * debit. `PURCHASE` is `undefined` on purpose — NOT an oversight: a real purchase posts its GL on
 * the bill, so posting here too would double-count the stock (R4c).
 */
const STOCK_MOVEMENT_OFFSET_ACCOUNT: Readonly<Record<StockMovementType, string | undefined>> = {
  OPENING: OPENING_BALANCE_EQUITY_CODE,
  ADJUSTMENT: "STOCK_ADJUSTMENT",
  PURCHASE: undefined,
};

export interface StockMovement {
  readonly id: string;
  readonly itemId: string;
  readonly sourceId: string | null;
  /** Reporting tag only (one shared stock pool): the project this movement belongs to, if any. */
  readonly fairId?: string;
  /** The journal entry this movement posted, when it posted one (OPENING and ADJUSTMENT, R4c). */
  readonly journalEntryId?: string;
  readonly movementType: StockMovementType | "SALE" | "SALE_REVERSAL" | "PURCHASE_REVERSAL";
  readonly quantityDelta: number;
  readonly unitCostPaise: number;
  readonly occurredAt: string;
}

/** One hand-entered stock movement the R4c backfill would post, or has nothing to post for. */
export interface StockJournalBackfillRow {
  readonly movementId: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly movementType: StockMovementType;
  readonly quantity: number;
  readonly unitCostPaise: number;
  /** quantity x unit cost: the ORIGINAL value of the layer, never what is left of it. */
  readonly valuePaise: number;
  /** The IST date of the movement, which is the date its journal entry carries. */
  readonly entryDate: string;
  readonly offsetAccount: string;
  readonly fairId?: string;
}

export interface StockJournalBackfillRefusal extends StockJournalBackfillRow {
  readonly reason: string;
}

export interface StockJournalBackfillPlan {
  readonly businessId: string;
  readonly toPost: readonly StockJournalBackfillRow[];
  readonly refused: readonly StockJournalBackfillRefusal[];
  /** Zero-value movements: nothing to post, not a refusal. */
  readonly nothingToPost: readonly StockJournalBackfillRow[];
  /** Source-less PURCHASE movements: inventory that moved with no journal entry and never will. */
  readonly uncoveredPurchaseMovements: number;
  readonly totalPaise: number;
}

export interface StockJournalBackfillResult extends StockJournalBackfillPlan {
  readonly dryRun: boolean;
  readonly postedCount: number;
  readonly postedPaise: number;
}

export interface StockBalance {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly valuePaise: number;
}

export interface CompanyRecord {
  readonly id: string;
  readonly name: string;
  readonly accountingBasis: AccountingBasis;
}

export interface BusinessRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
}

export interface CustomerRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly customerNumber: string | null;
  readonly classification: string | null;
  readonly gstin: string | null;
  readonly website: string | null;
  readonly phone2: string | null;
  readonly billingAddress: string | null;
  readonly shippingAddress: string | null;
  readonly internalNotes: string | null;
  readonly numberingCategory: string | null;
  readonly active: boolean;
}

export interface ItemRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly unit: string;
  readonly trackStock: boolean;
  readonly description: string | null;
  readonly sellingPricePaise: number | null;
  readonly costPricePaise: number | null;
  readonly mrpPaise: number | null;
  readonly reorderThreshold: number | null;
  readonly active: boolean;
}

export interface InvoiceSummary {
  readonly id: string;
  readonly number: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly paymentAccount: AccountCode;
  readonly status: Invoice["status"];
  readonly fairId?: string;
  readonly taxType: Invoice["taxType"];
  readonly taxRateBasisPoints: number;
}

const CUSTOMER_SELECT =
  "SELECT id, company_id, name, email, phone, customer_number, classification, gstin, website, phone2, billing_address, shipping_address, internal_notes, numbering_category, active FROM customers";

interface CustomerRow {
  id: string; company_id: string; name: string; email: string | null; phone: string | null;
  customer_number: string | null; classification: string | null; gstin: string | null; website: string | null;
  phone2: string | null; billing_address: string | null; shipping_address: string | null;
  internal_notes: string | null; numbering_category: string | null; active: number;
}

function mapCustomerRow(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    customerNumber: row.customer_number,
    classification: row.classification,
    gstin: row.gstin,
    website: row.website,
    phone2: row.phone2,
    billingAddress: row.billing_address,
    shippingAddress: row.shipping_address,
    internalNotes: row.internal_notes,
    numberingCategory: row.numbering_category,
    active: row.active === 1,
  };
}

interface StockLayer {
  quantity: number;
  unitCostPaise: number;
  sourceId: string | null;
}

/** Optional filter for period reports (P&L, General Ledger). Omit everything for consolidated, all dates. */
export interface PeriodReportFilter {
  readonly businessId?: string;
  /** Only entries tagged with this project (fair). Omitted = consolidated: every fair AND untagged entries. */
  readonly fairId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  /**
   * Profit and Loss only: the view to show. Omitted means the stored accounting_basis of the
   * given business's company, or ACCRUAL when there is no businessId (a consolidated report has
   * no single company preference). Posting is always accrual; CASH is derived, never posted.
   */
  readonly basis?: AccountingBasis;
}

/** Optional filter for as-at reports (Trial Balance, Balance Sheet): everything with entry_date <= asAtDate. */
export interface AsAtReportFilter {
  readonly businessId?: string;
  /** Trial Balance only. The Balance Sheet refuses it: there is no per-fair balance sheet (Design Doc 12.1). */
  readonly fairId?: string;
  readonly asAtDate?: string;
}

/** The app assumes India Standard Time (UTC+5:30) for every business date. */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) in IST of an ISO instant; defaults to now. The single "today" source. */
export function istDateOf(instant: string | Date = new Date()): string {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export { RepositoryValidationError };

interface AuthUserRow {
  readonly id: string;
  readonly email: string | null;
  readonly google_sub: string | null;
  readonly password_hash: string;
  readonly failed_attempts: number;
  readonly locked_until: string | null;
  /** Null on an admin created before migration v16; see recoverPassword (S6-3). */
  readonly recovery_code_hash: string | null;
}

/** Auth failures that need a specific HTTP status (401 bad credentials/session, 409 not set up, 423 locked). */
export class AuthenticationError extends RepositoryValidationError {
  public readonly statusCode: 401 | 409 | 423;

  public constructor(message: string, statusCode: 401 | 409 | 423) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AuthenticationError";
  }
}

/** One typed opening line: the owner supplies exactly one of the two sides. */
export interface OpeningBalanceLineInput {
  readonly account: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
}

export interface OpeningBalanceSet {
  readonly id: string;
  readonly businessId: string;
  readonly asAt: string;
  readonly journalEntryId: string;
  /** The date the set was reversed, or null while it is live. */
  readonly reversedAt: string | null;
  readonly createdAt: string;
  /** What the owner typed. */
  readonly lines: readonly OpeningBalanceLineInput[];
  /** The OPENING_BALANCE_EQUITY line the system added to balance, or null when none was needed. */
  readonly balancingLine: OpeningBalanceLineInput | null;
}

export class AccountingRepository {
  public readonly db: Database.Database;

  public constructor(databasePath = ":memory:") {
    this.db = new Database(databasePath);
    runMigrations(this.db);
  }

  public close(): void {
    this.db.close();
  }

  public createCompany(input: CompanyInput): string {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        "INSERT INTO companies (id, name, accounting_basis, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, input.name, input.accountingBasis ?? "ACCRUAL", new Date().toISOString());
    return id;
  }

  public createBusiness(input: BusinessInput): string {
    this.requireCompany(input.companyId);
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        "INSERT INTO businesses (id, company_id, name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, input.companyId, input.name, new Date().toISOString());
    return id;
  }

  public createCustomer(input: CustomerInput): string {
    this.requireCompany(input.companyId);
    this.validateClassification(input.classification);
    this.validateNumberingCategory(input.numberingCategory);
    const id = input.id ?? randomUUID();
    this.db.transaction(() => {
      const customerNumber = input.numberingCategory === undefined
        ? null
        : this.allocateCustomerNumber(input.companyId, input.numberingCategory);
      this.db
        .prepare(
          `INSERT INTO customers (id, company_id, name, email, phone, created_at, customer_number, classification, gstin,
             website, phone2, billing_address, shipping_address, internal_notes, numbering_category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.companyId,
          input.name,
          input.email ?? null,
          input.phone ?? null,
          new Date().toISOString(),
          customerNumber,
          input.classification ?? null,
          input.gstin ?? null,
          input.website ?? null,
          input.phone2 ?? null,
          input.billingAddress ?? null,
          input.shippingAddress ?? null,
          input.internalNotes ?? null,
          input.numberingCategory ?? null,
        );
      this.insertAuditEvent({ action: "customer.created", entityId: id, occurredAt: new Date().toISOString() });
    })();
    return id;
  }

  /** Atomically takes the next sequence for (company, category). Must run inside a transaction. */
  private allocateCustomerNumber(companyId: string, category: string): string {
    this.db
      .prepare("INSERT INTO customer_number_counters (company_id, category, next_seq) VALUES (?, ?, 1) ON CONFLICT(company_id, category) DO NOTHING")
      .run(companyId, category);
    const row = this.db
      .prepare("SELECT next_seq FROM customer_number_counters WHERE company_id = ? AND category = ?")
      .get(companyId, category) as { next_seq: number };
    this.db
      .prepare("UPDATE customer_number_counters SET next_seq = next_seq + 1 WHERE company_id = ? AND category = ?")
      .run(companyId, category);
    return `${category}${String(row.next_seq).padStart(4, "0")}`;
  }

  private validateClassification(value: string | null | undefined): void {
    if (value === undefined || value === null) return;
    if (!(CUSTOMER_CLASSIFICATIONS as readonly string[]).includes(value)) {
      throw new RepositoryValidationError(`Classification must be one of: ${CUSTOMER_CLASSIFICATIONS.join(", ")}.`);
    }
  }

  private validateNumberingCategory(value: string | undefined): void {
    if (value === undefined) return;
    if (!(CUSTOMER_NUMBERING_CATEGORIES as readonly string[]).includes(value)) {
      throw new RepositoryValidationError(`Numbering category must be one of: ${CUSTOMER_NUMBERING_CATEGORIES.join(", ")}.`);
    }
  }

  private validateOptionalPaise(label: string, value: number | null | undefined): void {
    if (value === undefined || value === null) return;
    if (!Number.isInteger(value) || value < 0) {
      throw new RepositoryValidationError(`${label} must be a non-negative whole number of paise.`);
    }
  }

  private validateReorderThreshold(value: number | null | undefined): void {
    if (value === undefined || value === null) return;
    if (!Number.isInteger(value) || value < 0) {
      throw new RepositoryValidationError("Reorder threshold must be a non-negative whole number.");
    }
  }

  public updateCustomer(customerId: string, patch: CustomerPatch): void {
    this.requireCustomer(customerId);
    this.validateClassification(patch.classification);
    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new RepositoryValidationError("Customer name cannot be empty.");
    }
    const columns: Array<[string, string | null | undefined]> = [
      ["name", patch.name], ["email", patch.email], ["phone", patch.phone],
      ["classification", patch.classification], ["gstin", patch.gstin], ["website", patch.website],
      ["phone2", patch.phone2], ["billing_address", patch.billingAddress],
      ["shipping_address", patch.shippingAddress], ["internal_notes", patch.internalNotes],
    ];
    const changed = columns.filter(([, value]) => value !== undefined);
    if (changed.length === 0) return;
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE customers SET ${changed.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .run(...changed.map(([, value]) => value as string | null), customerId);
      this.insertAuditEvent({ action: "customer.updated", entityId: customerId, occurredAt: new Date().toISOString() });
    })();
  }

  /** Non-blocking duplicate signal (warn-and-allow): createCustomer never refuses on a match. */
  public findDuplicateCustomers(query: DuplicateCustomerQuery): readonly CustomerRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (query.name !== undefined && query.name.trim() !== "") {
      conditions.push("LOWER(TRIM(name)) = ?");
      params.push(query.name.trim().toLowerCase());
    }
    if (query.phone !== undefined && query.phone.trim() !== "") {
      conditions.push("(TRIM(phone) = ? OR TRIM(phone2) = ?)");
      params.push(query.phone.trim(), query.phone.trim());
    }
    if (query.email !== undefined && query.email.trim() !== "") {
      conditions.push("LOWER(TRIM(email)) = ?");
      params.push(query.email.trim().toLowerCase());
    }
    if (query.gstin !== undefined && query.gstin.trim() !== "") {
      conditions.push("UPPER(TRIM(gstin)) = ?");
      params.push(query.gstin.trim().toUpperCase());
    }
    if (conditions.length === 0) return [];
    const rows = this.db
      .prepare(`${CUSTOMER_SELECT} WHERE company_id = ? AND (${conditions.join(" OR ")}) ORDER BY name, rowid`)
      .all(query.companyId, ...params) as CustomerRow[];
    return rows.map(mapCustomerRow);
  }

  public setCustomerActive(customerId: string, active: boolean): void {
    this.requireCustomer(customerId);
    this.db.transaction(() => {
      this.db.prepare("UPDATE customers SET active = ? WHERE id = ?").run(active ? 1 : 0, customerId);
      this.insertAuditEvent({
        action: active ? "customer.activated" : "customer.deactivated",
        entityId: customerId,
        occurredAt: new Date().toISOString(),
      });
    })();
  }

  public deleteCustomer(customerId: string): void {
    this.requireCustomer(customerId);
    const linked = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM invoices WHERE customer_id = @id)
         + (SELECT COUNT(*) FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id WHERE i.customer_id = @id)
         + (SELECT COUNT(*) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.customer_id = @id)
         + (SELECT COUNT(*) FROM recurring_invoice_templates WHERE customer_id = @id)
         + (SELECT COUNT(*) FROM fairs WHERE host_customer_id = @id) AS total`,
      )
      .get({ id: customerId }) as { total: number };
    if (linked.total > 0) {
      throw new RepositoryValidationError(
        "This customer has linked invoices, credit notes, payments, recurring templates or fairs and cannot be deleted. Mark the customer inactive instead.",
      );
    }
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
      this.insertAuditEvent({ action: "customer.deleted", entityId: customerId, occurredAt: new Date().toISOString() });
    })();
  }

  private requireCustomer(customerId: string): void {
    if (this.db.prepare("SELECT 1 FROM customers WHERE id = ?").get(customerId) === undefined) {
      throw new RepositoryValidationError(`Customer ${customerId} was not found.`);
    }
  }

  private requireItem(itemId: string): void {
    if (this.db.prepare("SELECT 1 FROM items WHERE id = ?").get(itemId) === undefined) {
      throw new RepositoryValidationError(`Item ${itemId} was not found.`);
    }
  }

  public createItem(input: ItemInput): string {
    this.requireCompany(input.companyId);
    this.validateOptionalPaise("Selling price", input.sellingPricePaise);
    this.validateOptionalPaise("Cost price", input.costPricePaise);
    this.validateOptionalPaise("MRP", input.mrpPaise);
    this.validateReorderThreshold(input.reorderThreshold);
    const id = input.id ?? randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO items (id, company_id, name, unit, track_stock, created_at, description, selling_price_paise,
             cost_price_paise, mrp_paise, reorder_threshold)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.companyId,
          input.name,
          input.unit,
          input.trackStock === true ? 1 : 0,
          new Date().toISOString(),
          input.description ?? null,
          input.sellingPricePaise ?? null,
          input.costPricePaise ?? null,
          input.mrpPaise ?? null,
          input.reorderThreshold ?? null,
        );
      this.insertAuditEvent({ action: "item.created", entityId: id, occurredAt: new Date().toISOString() });
    })();
    return id;
  }

  public updateItem(itemId: string, patch: ItemPatch): void {
    this.requireItem(itemId);
    this.validateOptionalPaise("Selling price", patch.sellingPricePaise);
    this.validateOptionalPaise("Cost price", patch.costPricePaise);
    this.validateOptionalPaise("MRP", patch.mrpPaise);
    this.validateReorderThreshold(patch.reorderThreshold);
    if (patch.name !== undefined && patch.name.trim() === "") throw new RepositoryValidationError("Item name cannot be empty.");
    if (patch.unit !== undefined && patch.unit.trim() === "") throw new RepositoryValidationError("Item unit cannot be empty.");
    const columns: Array<[string, string | number | null | undefined]> = [
      ["name", patch.name], ["unit", patch.unit], ["description", patch.description],
      ["selling_price_paise", patch.sellingPricePaise], ["cost_price_paise", patch.costPricePaise],
      ["mrp_paise", patch.mrpPaise], ["reorder_threshold", patch.reorderThreshold],
    ];
    const changed = columns.filter(([, value]) => value !== undefined);
    if (changed.length === 0) return;
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE items SET ${changed.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .run(...changed.map(([, value]) => value as string | number | null), itemId);
      this.insertAuditEvent({ action: "item.updated", entityId: itemId, occurredAt: new Date().toISOString() });
    })();
  }

  public setItemActive(itemId: string, active: boolean): void {
    this.requireItem(itemId);
    this.db.transaction(() => {
      this.db.prepare("UPDATE items SET active = ? WHERE id = ?").run(active ? 1 : 0, itemId);
      this.insertAuditEvent({
        action: active ? "item.activated" : "item.deactivated",
        entityId: itemId,
        occurredAt: new Date().toISOString(),
      });
    })();
  }

  /**
   * Quantity on hand and FIFO stock value per stock-tracked item, from the FIFO stock sub-ledger
   * (remaining lot qty x lot unit cost). Read-only: posts no journal. This may differ from the GL
   * INVENTORY balance until purchasing/opening-balance GL posting is designed (out of scope here).
   */
  public getInventoryValuation(): readonly InventoryValuationRow[] {
    const items = this.db
      .prepare("SELECT id, name, unit FROM items WHERE track_stock = 1 ORDER BY name, rowid")
      .all() as Array<{ id: string; name: string; unit: string }>;
    return items.map((item) => {
      const layers = this.getStockLayers(item.id);
      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity: layers.reduce((total, layer) => total + layer.quantity, 0),
        valuePaise: layers.reduce((total, layer) => total + layer.quantity * layer.unitCostPaise, 0),
      };
    });
  }

  /** Stock-tracked items at or below their reorder threshold. Items with no threshold are skipped. */
  public getLowStockItems(): readonly LowStockRow[] {
    const items = this.db
      .prepare(
        `SELECT i.id, i.name, i.unit, i.reorder_threshold,
                COALESCE((SELECT SUM(quantity_delta) FROM stock_movements WHERE item_id = i.id), 0) AS quantity
         FROM items i
         WHERE i.track_stock = 1 AND i.reorder_threshold IS NOT NULL
         ORDER BY i.name, i.rowid`,
      )
      .all() as Array<{ id: string; name: string; unit: string; reorder_threshold: number; quantity: number }>;
    return items
      .filter((item) => item.quantity <= item.reorder_threshold)
      .map((item) => ({
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity: item.quantity,
        reorderThreshold: item.reorder_threshold,
      }));
  }

  /** Quantity and line amount (quantity x unit price, before invoice-level discount/tax) per item on finalized invoices. */
  public getSalesByItem(): readonly SalesByItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.name, i.unit, SUM(il.quantity) AS quantity, SUM(il.quantity * il.unit_price_paise) AS sales_paise
         FROM invoice_lines il
         JOIN invoices inv ON inv.id = il.invoice_id
         JOIN items i ON i.id = il.item_id
         WHERE inv.status = 'FINALIZED'
         GROUP BY i.id, i.name, i.unit
         ORDER BY i.name, MIN(i.rowid)`,
      )
      .all() as Array<{ id: string; name: string; unit: string; quantity: number; sales_paise: number }>;
    return rows.map((row) => ({
      itemId: row.id, itemName: row.name, unit: row.unit, quantity: row.quantity, salesPaise: row.sales_paise,
    }));
  }

  public createFair(input: FairInput): string {
    this.requireCompany(input.companyId);
    const customer = this.db
      .prepare("SELECT company_id FROM customers WHERE id = ?")
      .get(input.hostCustomerId) as { company_id: string } | undefined;
    if (customer === undefined) {
      throw new RepositoryValidationError(`Customer ${input.hostCustomerId} was not found.`);
    }

    if (customer.company_id !== input.companyId) {
      throw new RepositoryValidationError("Fair host customer must belong to the fair company.");
    }
    const id = input.id ?? randomUUID();
    this.db.prepare(
      "INSERT INTO fairs (id, company_id, host_customer_id, name, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, input.companyId, input.hostCustomerId, input.name, input.startsAt ?? null, input.endsAt ?? null, new Date().toISOString());
    return id;
  }

  public listFairs(companyId?: string): readonly FairRecord[] {
    const statement = companyId === undefined
      ? this.db.prepare("SELECT id, company_id, host_customer_id, name, starts_at, ends_at FROM fairs ORDER BY name, id")
      : this.db.prepare("SELECT id, company_id, host_customer_id, name, starts_at, ends_at FROM fairs WHERE company_id = ? ORDER BY name, id");
    const rows = (companyId === undefined ? statement.all() : statement.all(companyId)) as Array<{
      id: string; company_id: string; host_customer_id: string; name: string; starts_at: string | null; ends_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id, companyId: row.company_id, hostCustomerId: row.host_customer_id,
      name: row.name, startsAt: row.starts_at, endsAt: row.ends_at,
    }));
  }

  /**
   * Stock entered by hand (R4c). OPENING and ADJUSTMENT movements now post a journal entry, which
   * retires the standing carry-over that hand-entered stock changed inventory with NO GL effect.
   *
   * S5-3 (owner ruling): opening stock is EQUITY (`Dr INVENTORY / Cr OPENING_BALANCE_EQUITY`),
   * because it was bought before the books began; a mid-year ADJUSTMENT is a CURRENT-YEAR event
   * (`Dr INVENTORY / Cr STOCK_ADJUSTMENT`, the expense account seeded at v13), so a recount
   * reaches this year's P&L instead of sitting in equity for ever.
   *
   * A bare `PURCHASE` through this door still posts NOTHING, deliberately and unchanged: real
   * purchases carry their GL on the BILL (`finalizePurchaseBill`), so posting here as well would
   * double-count the inventory. A source-less PURCHASE movement is therefore the one remaining
   * way inventory can move without a journal entry; `planStockJournalBackfill` counts those rows
   * separately so nobody is told the ledger ties when it does not.
   *
   * DATE. `occurredOn` dates the JOURNAL ENTRY only. `stock_movements.occurred_at` stays the real
   * insertion instant, because FIFO consumes layers `ORDER BY occurred_at` (`getStockLayers`): a
   * back-dated layer would jump ahead of layers already consumed and silently re-measure COGS
   * that is already posted. So the ledger can be dated truthfully while the stock layers stay
   * strictly append-only. The financial-year lock applies through the door, on `occurredOn`.
   */
  public addStockMovement(input: {
    itemId: string;
    movementType: StockMovementType;
    quantity: number;
    unitCostPaise: number;
    /** Reporting tag only; OPENING and ADJUSTMENT movements only. Never affects FIFO or quantity. */
    fairId?: string;
    /**
     * Which business's ledger this posts to. Items belong to a COMPANY, not a business, so this
     * cannot be derived from the item alone. Omitted, it is resolved by
     * `resolveStockMovementBusiness` — which only succeeds when the company has exactly one.
     */
    businessId?: string;
    /** The date the journal entry carries (YYYY-MM-DD, IST). Defaults to today. */
    occurredOn?: string;
  }): StockMovement {
    if (input.fairId !== undefined && input.movementType === "PURCHASE") {
      throw new RepositoryValidationError("A project can be tagged on an opening or adjustment movement; purchases take the fair of their bill.");
    }
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new RepositoryValidationError("Stock quantity must be a positive whole number.");
    }
    if (!Number.isInteger(input.unitCostPaise) || input.unitCostPaise < 0) {
      throw new RepositoryValidationError("Stock cost must be a non-negative whole number of paise.");
    }
    const item = this.db.prepare("SELECT track_stock, company_id FROM items WHERE id = ?").get(input.itemId) as
      | { track_stock: number; company_id: string }
      | undefined;
    if (item === undefined) {
      throw new RepositoryValidationError(`Item ${input.itemId} was not found.`);
    }
    if (item.track_stock !== 1) {
      throw new RepositoryValidationError("Stock movements require an item with stock tracking enabled.");
    }
    if (input.occurredOn !== undefined) this.assertIsoDate("The stock movement date", input.occurredOn);
    if (input.fairId !== undefined) this.assertFairExists(input.fairId);

    const valuePaise = input.quantity * input.unitCostPaise;
    const offsetAccount = STOCK_MOVEMENT_OFFSET_ACCOUNT[input.movementType];
    // Nothing to post for a bare PURCHASE (the bill posts it) or for a zero-value movement: the
    // door rightly refuses a line with neither a debit nor a credit above zero.
    const posts = offsetAccount !== undefined && valuePaise > 0;
    const businessId = posts
      ? this.resolveStockMovementBusiness(item.company_id, input.businessId, input.movementType)
      : undefined;
    const entryDate = input.occurredOn ?? istDateOf();
    const movementId = randomUUID();
    const journalEntryId = `je-stock-movement-${movementId}`;
    const movement: StockMovement = {
      id: movementId,
      itemId: input.itemId,
      sourceId: null,
      movementType: input.movementType,
      quantityDelta: input.quantity,
      unitCostPaise: input.unitCostPaise,
      occurredAt: new Date().toISOString(),
      ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
      ...(posts ? { journalEntryId } : {}),
    };
    // One transaction: either the movement AND its journal entry land, or neither does. A door
    // refusal (a locked year, a deactivated account) must leave no stock row behind.
    return this.db.transaction(() => {
      this.db.prepare(
        "INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(movement.id, movement.itemId, null, movement.movementType, movement.quantityDelta, movement.unitCostPaise, movement.occurredAt, input.fairId ?? null);
      if (posts && offsetAccount !== undefined && businessId !== undefined) {
        this.insertJournalEntry(
          {
            id: journalEntryId,
            sourceId: movement.id,
            sourceType: "STOCK_MOVEMENT",
            description: `${input.movementType === "OPENING" ? "Opening stock" : "Stock adjustment"} as at ${entryDate}`,
            isReversal: false,
            lines: [
              { account: "INVENTORY", debitPaise: valuePaise, creditPaise: 0 },
              { account: offsetAccount, debitPaise: 0, creditPaise: valuePaise },
            ],
          },
          { businessId, entryDate, ...fairDim(input.fairId) },
        );
      }
      this.insertAuditEvent({ action: "stock.movement_added", entityId: movement.itemId, occurredAt: movement.occurredAt });
      return movement;
    })();
  }

  /**
   * The ONE place a hand-entered stock movement's business is decided, live and in the backfill,
   * so reversing this rule is a one-line change. Items belong to a company; journal entries need
   * a business. Named explicitly, the business must exist and belong to the item's own company.
   * Omitted, it is derived ONLY when the company has exactly one business — with two or more there
   * is no honest guess to make, so it refuses and names them.
   */
  private resolveStockMovementBusiness(companyId: string, businessId: string | undefined, movementType: string): string {
    if (businessId !== undefined) {
      const { companyId: ownerCompanyId } = this.requireBusinessCompany(businessId);
      if (ownerCompanyId !== companyId) {
        throw new RepositoryValidationError("That business belongs to another company than the item.");
      }
      return businessId;
    }
    const businesses = this.db
      .prepare("SELECT id, name FROM businesses WHERE company_id = ? ORDER BY name, id")
      .all(companyId) as Array<{ id: string; name: string }>;
    const only = businesses[0];
    if (businesses.length === 1 && only !== undefined) return only.id;
    if (businesses.length === 0) {
      throw new RepositoryValidationError(
        `A ${movementType === "OPENING" ? "opening stock" : "stock adjustment"} movement posts to the ledger, so this company needs a business first.`,
      );
    }
    throw new RepositoryValidationError(
      `This company has ${businesses.length} businesses (${businesses.map((b) => b.name).join(", ")}), so say which one this stock belongs to.`,
    );
  }

  // ---------------------------------------------------------------------------
  // The R4c backfill: give the OPENING and ADJUSTMENT movements already in a live database the
  // journal entry they were never given. It goes through the ONE door like everything else, is
  // IDEMPOTENT (a movement is "done" exactly when a STOCK_MOVEMENT entry carries its id, so a
  // second run posts nothing), and REFUSES rather than forces a movement whose date falls in a
  // locked financial year — listing each refusal instead of stopping at the first.
  //
  // Old movements have nothing to attribute them to: `stock_movements` has no business column and
  // items belong to a company. So the caller NAMES the business, and only movements whose item
  // belongs to that business's company are touched.
  // ---------------------------------------------------------------------------

  public planStockJournalBackfill(input: { businessId: string }): StockJournalBackfillPlan {
    const { companyId } = this.requireBusinessCompany(input.businessId);
    const rows = this.db
      .prepare(
        `SELECT m.id, m.item_id, m.movement_type, m.quantity_delta, m.unit_cost_paise, m.occurred_at, m.fair_id,
                i.name AS item_name, i.company_id
           FROM stock_movements m JOIN items i ON i.id = m.item_id
          WHERE m.movement_type IN ('OPENING', 'ADJUSTMENT')
            AND NOT EXISTS (
                  SELECT 1 FROM journal_entries je
                   WHERE je.source_type = 'STOCK_MOVEMENT' AND je.source_id = m.id)
          ORDER BY m.occurred_at, m.rowid`,
      )
      .all() as Array<{
        id: string; item_id: string; movement_type: string; quantity_delta: number; unit_cost_paise: number;
        occurred_at: string; fair_id: string | null; item_name: string; company_id: string;
      }>;
    const toPost: StockJournalBackfillRow[] = [];
    const refused: StockJournalBackfillRefusal[] = [];
    const nothingToPost: StockJournalBackfillRow[] = [];
    for (const row of rows) {
      const valuePaise = row.quantity_delta * row.unit_cost_paise;
      const entryDate = istDateOf(row.occurred_at);
      const offsetAccount = STOCK_MOVEMENT_OFFSET_ACCOUNT[row.movement_type as StockMovementType];
      const planned: StockJournalBackfillRow = {
        movementId: row.id,
        itemId: row.item_id,
        itemName: row.item_name,
        movementType: row.movement_type as StockMovementType,
        quantity: row.quantity_delta,
        unitCostPaise: row.unit_cost_paise,
        valuePaise,
        entryDate,
        offsetAccount: offsetAccount ?? "",
        ...(row.fair_id === null ? {} : { fairId: row.fair_id }),
      };
      if (row.company_id !== companyId) {
        // Another company's stock: not this business's to post, and silently posting it would put
        // one company's inventory into another's ledger.
        refused.push({ ...planned, reason: "The item belongs to another company than this business." });
        continue;
      }
      if (offsetAccount === undefined) {
        refused.push({ ...planned, reason: `A ${row.movement_type} movement has no offset account.` });
        continue;
      }
      // A zero-value movement is not a refusal: there is simply no entry to post, now or ever.
      if (valuePaise === 0) {
        nothingToPost.push(planned);
        continue;
      }
      if (!this.isPeriodOpen(input.businessId, entryDate)) {
        refused.push({ ...planned, reason: `The financial year covering ${entryDate} is locked.` });
        continue;
      }
      toPost.push(planned);
    }
    // Source-less PURCHASE movements are the one way inventory still moves with no journal entry
    // (they are not bill-sourced, so nothing posted them). Counted, never posted, so a tie-out
    // report can never claim the ledger agrees with the stock when it does not.
    const uncovered = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM stock_movements m JOIN items i ON i.id = m.item_id
          WHERE m.movement_type = 'PURCHASE' AND m.source_id IS NULL AND i.company_id = ?`,
      )
      .get(companyId) as { count: number };
    return {
      businessId: input.businessId,
      toPost,
      refused,
      nothingToPost,
      uncoveredPurchaseMovements: uncovered.count,
      totalPaise: toPost.reduce((sum, row) => sum + row.valuePaise, 0),
    };
  }

  /**
   * Posts the plan above. `dryRun` defaults to TRUE: calling this without saying otherwise changes
   * nothing and only reports what WOULD be posted.
   */
  public backfillStockJournals(input: { businessId: string; dryRun?: boolean }): StockJournalBackfillResult {
    const plan = this.planStockJournalBackfill({ businessId: input.businessId });
    const dryRun = input.dryRun !== false;
    if (dryRun || plan.toPost.length === 0) return { ...plan, dryRun, postedCount: 0, postedPaise: 0 };
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const row of plan.toPost) {
        this.insertJournalEntry(
          {
            id: `je-stock-movement-${row.movementId}`,
            sourceId: row.movementId,
            sourceType: "STOCK_MOVEMENT",
            description: `${row.movementType === "OPENING" ? "Opening stock" : "Stock adjustment"} as at ${row.entryDate} (backfilled)`,
            isReversal: false,
            lines: [
              { account: "INVENTORY", debitPaise: row.valuePaise, creditPaise: 0 },
              { account: row.offsetAccount, debitPaise: 0, creditPaise: row.valuePaise },
            ],
          },
          { businessId: input.businessId, entryDate: row.entryDate, ...fairDim(row.fairId) },
        );
        this.insertAuditEvent({ action: "stock.journal_backfilled", entityId: row.movementId, occurredAt: now });
      }
    })();
    return { ...plan, dryRun: false, postedCount: plan.toPost.length, postedPaise: plan.totalPaise };
  }

  public listStockMovements(itemId?: string): readonly StockMovement[] {
    const statement = itemId === undefined
      ? this.db.prepare("SELECT id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id FROM stock_movements ORDER BY occurred_at, rowid")
      : this.db.prepare("SELECT id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id FROM stock_movements WHERE item_id = ? ORDER BY occurred_at, rowid");
    const rows = (itemId === undefined ? statement.all() : statement.all(itemId)) as Array<{
      id: string; item_id: string; source_id: string | null; movement_type: StockMovement["movementType"];
      quantity_delta: number; unit_cost_paise: number; occurred_at: string; fair_id: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id, itemId: row.item_id, sourceId: row.source_id, movementType: row.movement_type,
      quantityDelta: row.quantity_delta, unitCostPaise: row.unit_cost_paise, occurredAt: row.occurred_at,
      ...(row.fair_id === null ? {} : { fairId: row.fair_id }),
    }));
  }

  public getStockBalances(): readonly StockBalance[] {
    const items = this.db.prepare(
      "SELECT id, name, unit FROM items WHERE track_stock = 1 ORDER BY name, id",
    ).all() as Array<{ id: string; name: string; unit: string }>;
    return items.map((item) => {
      const movements = this.listStockMovements(item.id);
      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity: movements.reduce((total, movement) => total + movement.quantityDelta, 0),
        valuePaise: movements.reduce((total, movement) => total + movement.quantityDelta * movement.unitCostPaise, 0),
      };
    });
  }

  public listCompanies(): readonly CompanyRecord[] {
    const rows = this.db
      .prepare("SELECT id, name, accounting_basis FROM companies ORDER BY name, id")
      .all() as Array<{ id: string; name: string; accounting_basis: AccountingBasis }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      accountingBasis: row.accounting_basis,
    }));
  }

  public listBusinesses(companyId?: string): readonly BusinessRecord[] {
    const statement = companyId === undefined
      ? this.db.prepare("SELECT id, company_id, name FROM businesses ORDER BY name, id")
      : this.db.prepare("SELECT id, company_id, name FROM businesses WHERE company_id = ? ORDER BY name, id");
    const rows = (companyId === undefined ? statement.all() : statement.all(companyId)) as Array<{
      id: string;
      company_id: string;
      name: string;
    }>;
    return rows.map((row) => ({ id: row.id, companyId: row.company_id, name: row.name }));
  }

  public listCustomers(companyId?: string, options: { activeOnly?: boolean } = {}): readonly CustomerRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (companyId !== undefined) {
      conditions.push("company_id = ?");
      params.push(companyId);
    }
    if (options.activeOnly === true) conditions.push("active = 1");
    const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
    const rows = this.db.prepare(`${CUSTOMER_SELECT}${where} ORDER BY name, id`).all(...params) as CustomerRow[];
    return rows.map(mapCustomerRow);
  }

  public listItems(companyId?: string, options: { activeOnly?: boolean } = {}): readonly ItemRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (companyId !== undefined) {
      conditions.push("company_id = ?");
      params.push(companyId);
    }
    if (options.activeOnly === true) conditions.push("active = 1");
    const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
    const rows = this.db.prepare(
      `SELECT id, company_id, name, unit, track_stock, description, selling_price_paise, cost_price_paise,
              mrp_paise, reorder_threshold, active FROM items${where} ORDER BY name, id`,
    ).all(...params) as Array<{
      id: string; company_id: string; name: string; unit: string; track_stock: number; description: string | null;
      selling_price_paise: number | null; cost_price_paise: number | null; mrp_paise: number | null;
      reorder_threshold: number | null; active: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      unit: row.unit,
      trackStock: row.track_stock === 1,
      description: row.description,
      sellingPricePaise: row.selling_price_paise,
      costPricePaise: row.cost_price_paise,
      mrpPaise: row.mrp_paise,
      reorderThreshold: row.reorder_threshold,
      active: row.active === 1,
    }));
  }

  public listInvoices(businessId?: string): readonly InvoiceSummary[] {
    const statement = businessId === undefined
      ? this.db.prepare(
          "SELECT * FROM invoices ORDER BY created_at DESC, id DESC",
        )
      : this.db.prepare(
          "SELECT * FROM invoices WHERE business_id = ? ORDER BY created_at DESC, id DESC",
        );
    const rows = (businessId === undefined
      ? statement.all()
      : statement.all(businessId)) as InvoiceRow[];
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      businessId: row.business_id,
      customerId: row.customer_id,
      invoiceDate: row.invoice_date ?? row.created_at ?? new Date().toISOString(),
      ...(row.due_date === null ? {} : { dueDate: row.due_date }),
      discountPaise: row.discount_paise,
      extraChargePaise: row.extra_charge_paise,
      ...(row.notes === null ? {} : { notes: row.notes }),
      ...(row.payment_terms === null ? {} : { paymentTerms: row.payment_terms }),
      taxType: row.tax_type ?? "NONE",
      taxRateBasisPoints: row.tax_rate_basis_points,
      ...(row.converted_invoice_id === null ? {} : { convertedInvoiceId: row.converted_invoice_id }),
      paymentAccount: row.payment_account,
      status: row.status,
      ...(row.fair_id === null ? {} : { fairId: row.fair_id }),
    }));
  }

  public saveDraft(invoice: Invoice): void {
    const transaction = this.db.transaction(() => {
      this.validateInvoiceReferences(invoice);
      this.db
        .prepare(
          "INSERT INTO invoices (id, business_id, customer_id, fair_id, buyer_name, buyer_contact, number, invoice_date, due_date, discount_paise, extra_charge_paise, notes, payment_terms, tax_type, tax_rate_basis_points, payment_account, status, converted_invoice_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          invoice.id,
          invoice.businessId,
          invoice.customerId,
          invoice.fairId ?? null,
          invoice.buyerName ?? null,
          invoice.buyerContact ?? null,
          invoice.number,
          invoice.invoiceDate ?? new Date().toISOString().slice(0, 10),
          invoice.dueDate ?? null,
          invoice.discountPaise ?? 0,
          invoice.extraChargePaise ?? 0,
          invoice.notes ?? null,
          invoice.paymentTerms ?? null,
          invoice.taxType ?? "NONE",
          invoice.taxRateBasisPoints ?? 0,
          invoice.paymentAccount,
          invoice.status,
          invoice.convertedInvoiceId ?? null,
          new Date().toISOString(),
        );
      const lineStatement = this.db.prepare(
        "INSERT INTO invoice_lines (invoice_id, item_id, description, quantity, unit_price_paise) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of invoice.lines) {
        lineStatement.run(
          invoice.id,
          line.itemId ?? null,
          line.description,
          line.quantity,
          line.unitPricePaise,
        );
      }
    });
    transaction();
  }

  public updateDraft(invoice: Invoice): void {
    if (invoice.status !== "DRAFT" && invoice.status !== "QUOTATION") {
      throw new Error("Only draft invoices and quotations can be edited.");
    }
    const transaction = this.db.transaction(() => {
      const current = this.getInvoice(invoice.id);
      if (current.status !== "DRAFT" && current.status !== "QUOTATION") {
        throw new Error("Only draft invoices and quotations can be edited.");
      }
      this.validateInvoiceReferences(invoice);
      this.db
        .prepare(
          "UPDATE invoices SET business_id = ?, customer_id = ?, fair_id = ?, buyer_name = ?, buyer_contact = ?, number = ?, invoice_date = ?, due_date = ?, discount_paise = ?, extra_charge_paise = ?, notes = ?, payment_terms = ?, tax_type = ?, tax_rate_basis_points = ?, payment_account = ?, status = ? WHERE id = ?",
        )
        .run(
          invoice.businessId,
          invoice.customerId,
          invoice.fairId ?? null,
          invoice.buyerName ?? null,
          invoice.buyerContact ?? null,
          invoice.number,
          invoice.invoiceDate ?? new Date().toISOString().slice(0, 10),
          invoice.dueDate ?? null,
          invoice.discountPaise ?? 0,
          invoice.extraChargePaise ?? 0,
          invoice.notes ?? null,
          invoice.paymentTerms ?? null,
          invoice.taxType ?? "NONE",
          invoice.taxRateBasisPoints ?? 0,
          invoice.paymentAccount,
          invoice.status,
          invoice.id,
        );
      this.db
        .prepare("DELETE FROM invoice_lines WHERE invoice_id = ?")
        .run(invoice.id);
      const lineStatement = this.db.prepare(
        "INSERT INTO invoice_lines (invoice_id, item_id, description, quantity, unit_price_paise) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of invoice.lines) {
        lineStatement.run(
          invoice.id,
          line.itemId ?? null,
          line.description,
          line.quantity,
          line.unitPricePaise,
        );
      }
      this.insertAuditEvent({
        action: "invoice.draft_updated",
        entityId: invoice.id,
        occurredAt: new Date().toISOString(),
      });
    });
    transaction();
  }

  public convertQuotation(quotationId: string): Invoice {
    const quotation = this.getInvoice(quotationId);
    if (quotation.status !== "QUOTATION") {
      throw new RepositoryValidationError("Only quotations can be converted into invoices.");
    }

    if (quotation.convertedInvoiceId !== undefined) {
      throw new RepositoryValidationError("This quotation has already been converted.");
    }
    const invoice: Invoice = {
      ...quotation,
      id: randomUUID(),
      number: `INV-${quotation.number}`,
      status: "DRAFT",
    };
    this.saveDraft(invoice);
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE invoices SET converted_invoice_id = ? WHERE id = ?")
        .run(invoice.id, quotationId);
      this.insertAuditEvent({
        action: "quotation.converted",
        entityId: quotationId,
        occurredAt: new Date().toISOString(),
      });
    })();
    return this.getInvoice(invoice.id);
  }

  public saveCreditNote(note: CreditNote): void {
    const invoice = this.getInvoice(note.invoiceId);
    if (invoice.status !== "FINALIZED") throw new RepositoryValidationError("Credit notes require a finalized invoice.");
    if (note.status !== "DRAFT" || note.lines.length === 0) throw new RepositoryValidationError("Credit notes must start as non-empty drafts.");
    this.validateCreditNoteLines(invoice, note.lines);
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO credit_notes (id, invoice_id, number, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(note.id, note.invoiceId, note.number, note.reason, note.status, new Date().toISOString());
      const statement = this.db.prepare("INSERT INTO credit_note_lines (credit_note_id, item_id, description, quantity, unit_price_paise) VALUES (?, ?, ?, ?, ?)");
      for (const line of note.lines) statement.run(note.id, line.itemId ?? null, line.description, line.quantity, line.unitPricePaise);
      this.insertAuditEvent({ action: "credit_note.created", entityId: note.id, occurredAt: new Date().toISOString() });
    });
    transaction();
  }

  public finalizeCreditNote(creditNoteId: string): JournalEntry {
    return this.db.transaction(() => {
      const note = this.getCreditNote(creditNoteId);
      if (note.status !== "DRAFT") throw new RepositoryValidationError("Only draft credit notes can be finalized.");
      const invoice = this.getInvoice(note.invoiceId);
      this.validateCreditNoteLines(invoice, note.lines);
      const taxablePaise = note.lines.reduce((sum, line) => sum + line.quantity * line.unitPricePaise, 0);
      // One place decides the GST lines, capped per account and absorbing the remainder on a
      // full return (see creditNoteTaxLines).
      const taxLines: JournalEntry["lines"] = this.creditNoteTaxLines(invoice, taxablePaise);
      // The settlement credit follows the tax ACTUALLY posted, or the caps would unbalance the
      // entry and the door would reject it.
      const postedTaxPaise = taxLines.reduce((sum, line) => sum + line.debitPaise, 0);
      const noteInclusivePaise = taxablePaise + postedTaxPaise;
      // S4-1: the settlement credit SPLITS. Up to what the invoice still owes, the note reduces
      // the customer's bill. Anything beyond that is money owed BACK to them, which is a
      // LIABILITY, not a negative asset - so receivables land on zero instead of going negative
      // and hiding behind getReceivables' "outstanding > 0" filter.
      //
      // A CASH invoice is never split. There is no open balance to offset and the money goes
      // back across the counter at once, so the note IS the refund; the walk already recognises
      // a paid-at-once document's entries on their own dates, which is what S1-6 asks for.
      const outstandingPaise =
        invoice.paymentAccount === "CASH"
          ? noteInclusivePaise
          : Math.max(0, this.invoiceTotal(invoice) - this.invoiceCreditedPaise(invoice) - this.invoiceSettledPaise(invoice.id));
      const offsetPaise = Math.min(noteInclusivePaise, outstandingPaise);
      const refundablePaise = noteInclusivePaise - offsetPaise;
      const settlementLines: Array<JournalEntry["lines"][number]> = [];
      if (offsetPaise > 0) settlementLines.push({ account: invoice.paymentAccount, debitPaise: 0, creditPaise: offsetPaise });
      if (refundablePaise > 0) settlementLines.push({ account: "CUSTOMER_CREDITS", debitPaise: 0, creditPaise: refundablePaise });
      const entry: JournalEntry = {
        id: `je-credit-note-${note.id}`,
        sourceId: invoice.id,
        description: `Credit note ${note.number} for invoice ${invoice.number}`,
        isReversal: false,
        lines: [
          { account: "SALES", debitPaise: taxablePaise, creditPaise: 0 },
          ...taxLines,
          ...settlementLines,
        ],
      };
      const inventoryCost = this.restoreCreditNoteStock(note, invoice.fairId);
      // S4-8 (owner, 2026-11-17): a credit note is dated at FINALIZE, never at the draft.
      //
      // This used to read created_at, which is stamped when the DRAFT is saved. A note drafted in
      // January and finalized in February was therefore back-dated into January, where it
      // re-measured any payment falling between the two dates - a month already reported, moved
      // by a February action. Reproduced before it was changed: two payments of 3,000 on 20 and
      // 30 January and a freight note drafted 25 January, finalized 10 February, pushed January's
      // cash expenses from 2,400 to 3,257.14. That is S1-6 broken by an entirely ordinary
      // workflow - raise the paperwork, finalize it later.
      //
      // The owner chose this over giving a note its own document date: the trade-off he accepted
      // is that a note finalized late lands in the month it was FINALIZED rather than the month
      // the goods came back. The cash-view walk reads these entry dates, so it follows for free.
      const dims = { businessId: invoice.businessId, entryDate: istDateOf(), ...fairDim(invoice.fairId) };
      this.insertJournalEntry(entry, dims);
      if (inventoryCost > 0) {
        this.insertJournalEntry({
          id: `je-credit-note-inventory-${note.id}`,
          sourceId: invoice.id,
          description: `Inventory returned for credit note ${note.number}`,
          lines: [{ account: "INVENTORY", debitPaise: inventoryCost, creditPaise: 0 }, { account: "COGS", debitPaise: 0, creditPaise: inventoryCost }],
          isReversal: false,
        }, dims);
      }
      // Persisted, never recomputed later: the walk sorts notes BEFORE payments on the same day,
      // so a walk that re-derived the split would disagree with the ledger whenever a payment and
      // a note share a date (pay 14,000 in the morning, credit 5,000 that afternoon - the books
      // say 1,000 offset, a recomputing walk would say 5,000).
      this.db.prepare("UPDATE credit_notes SET status = 'FINALIZED', refundable_paise = ? WHERE id = ?").run(refundablePaise, note.id);
      this.insertAuditEvent({ action: "credit_note.finalized", entityId: note.id, occurredAt: new Date().toISOString() });
      return entry;
    })();
  }

  /**
   * The date a credit note actually took effect: the date on its posted journal entry, set when
   * it was FINALIZED (S4-8). Never created_at, which is when the draft was saved - the gap
   * between the two is exactly what let a February note rewrite January.
   */
  private creditNoteEntryDate(creditNoteId: string): string {
    const row = this.db
      .prepare("SELECT entry_date FROM journal_entries WHERE id = ?")
      .get(`je-credit-note-${creditNoteId}`) as { entry_date: string } | undefined;
    if (row === undefined) {
      throw new RepositoryValidationError(`Credit note ${creditNoteId} has no posted entry to date from.`);
    }
    return row.entry_date;
  }

  /**
   * How much of a credit note has already been discharged - refunded in cash, or set against a
   * later invoice (S4-5). One figure for both routes, because they draw on the same pot.
   */
  private creditNoteDischargedPaise(creditNoteId: string): number {
    const refunded = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM credit_note_refunds WHERE credit_note_id = ?")
      .get(creditNoteId) as { total: number };
    const applied = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM credit_note_applications WHERE credit_note_id = ?")
      .get(creditNoteId) as { total: number };
    return refunded.total + applied.total;
  }

  /** What a credit note is worth back to the customer, and how much of it is still undischarged. */
  public getCreditNoteBalance(creditNoteId: string): {
    refundablePaise: number;
    dischargedPaise: number;
    outstandingPaise: number;
  } {
    const row = this.db.prepare("SELECT refundable_paise, status FROM credit_notes WHERE id = ?").get(creditNoteId) as
      | { refundable_paise: number; status: CreditNote["status"] }
      | undefined;
    if (row === undefined) throw new RepositoryValidationError(`No credit note ${creditNoteId}.`);
    const dischargedPaise = this.creditNoteDischargedPaise(creditNoteId);
    // refundable_paise stays as the historical record of what the note was worth, but a CANCELLED
    // note owes nothing: its entries have been reversed, so the ledger carries none of it either.
    // Reporting the old figure would make this sub-ledger disagree with the books.
    const outstandingPaise = row.status === "CANCELLED" ? 0 : row.refundable_paise - dischargedPaise;
    return { refundablePaise: row.refundable_paise, dischargedPaise, outstandingPaise };
  }

  /**
   * Pay a credit note back to the customer in cash or from the bank (S4-1).
   *
   * Dr CUSTOMER_CREDITS / Cr CASH|BANK on the refund's OWN date, which is what makes S1-6 work:
   * the cash P&L falls in the month the money actually left, never in the month the goods came
   * back. Its own table, so the `CHECK IN ('CASH')` still on payments.payment_account - which
   * would otherwise make BANK unusable - is not in the way.
   */
  public recordCreditNoteRefund(input: {
    id: string;
    creditNoteId: string;
    amountPaise: number;
    refundedOn: string;
    paymentAccount: "CASH" | "BANK";
  }): JournalEntry {
    return this.db.transaction(() => {
      const note = this.getCreditNote(input.creditNoteId);
      if (note.status !== "FINALIZED") {
        throw new RepositoryValidationError("Only a finalized credit note can be refunded.");
      }
      if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
        throw new RepositoryValidationError("A refund must be a whole number of paise above zero.");
      }
      const invoice = this.getInvoice(note.invoiceId);
      // Validated as a real date, not merely string-compared: "garbage" sorts after every ISO
      // date, so it would clear the check below and land straight in entryDate.
      this.assertIsoDate("Refund date", input.refundedOn);
      const noteDate = this.creditNoteEntryDate(note.id);
      if (input.refundedOn < noteDate) {
        throw new RepositoryValidationError(`A refund cannot predate its credit note (${noteDate}).`);
      }
      const balance = this.getCreditNoteBalance(note.id);
      if (input.amountPaise > balance.outstandingPaise) {
        throw new RepositoryValidationError(
          `Credit note ${note.number} has ${balance.outstandingPaise} paise left to give back; a refund of ${input.amountPaise} paise exceeds it.`,
        );
      }
      const entry: JournalEntry = {
        // Deliberately NOT a `je-credit-note-` id: that prefix belongs to the note's own two
        // entries, which the cash-view walk matches by exact id.
        id: `je-refund-${input.id}`,
        sourceId: invoice.id,
        description: `Refund of credit note ${note.number}`,
        isReversal: false,
        lines: [
          { account: "CUSTOMER_CREDITS", debitPaise: input.amountPaise, creditPaise: 0 },
          { account: input.paymentAccount, debitPaise: 0, creditPaise: input.amountPaise },
        ],
      };
      this.insertJournalEntry(entry, {
        businessId: invoice.businessId,
        entryDate: input.refundedOn,
        ...fairDim(invoice.fairId),
      });
      this.db
        .prepare(
          "INSERT INTO credit_note_refunds (id, credit_note_id, amount_paise, refunded_on, payment_account, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(input.id, note.id, input.amountPaise, input.refundedOn, input.paymentAccount, new Date().toISOString());
      this.insertAuditEvent({ action: "credit_note.refunded", entityId: input.id, occurredAt: new Date().toISOString() });
      return entry;
    })();
  }

  /**
   * Set a credit note against a LATER invoice instead of refunding it (S4-5).
   *
   * Dr CUSTOMER_CREDITS / Cr RECEIVABLES on the application's own date. For the target invoice
   * this is a settlement exactly like cash, which is why invoiceSettledPaise counts it: it caps
   * further payments, it keeps the invoice off the receivables list, and it blocks cancellation.
   * Per S1-6 the reduction is recognised when the credit is USED, not when the note was raised.
   */
  public applyCreditNote(input: {
    id: string;
    creditNoteId: string;
    invoiceId: string;
    amountPaise: number;
    appliedOn: string;
  }): JournalEntry {
    return this.db.transaction(() => {
      const note = this.getCreditNote(input.creditNoteId);
      if (note.status !== "FINALIZED") {
        throw new RepositoryValidationError("Only a finalized credit note can be applied.");
      }
      if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
        throw new RepositoryValidationError("An applied credit must be a whole number of paise above zero.");
      }
      if (input.invoiceId === note.invoiceId) {
        throw new RepositoryValidationError(
          "A credit note cannot be applied to its own invoice: whatever it could take off that bill it already has.",
        );
      }
      const source = this.getInvoice(note.invoiceId);
      const target = this.getInvoice(input.invoiceId);
      if (target.status !== "FINALIZED") {
        throw new RepositoryValidationError("A credit can only be applied to a finalized invoice.");
      }
      if (target.paymentAccount !== "RECEIVABLES") {
        throw new RepositoryValidationError("A credit can only be applied to a receivable invoice.");
      }
      // The credit belongs to one customer; applying it to another would move money between two
      // people's accounts with nothing to show for it.
      if (target.customerId !== source.customerId) {
        throw new RepositoryValidationError("A credit can only be applied to an invoice for the same customer.");
      }
      // Entry dimensions are per entry, so a cross-business application would credit one
      // business's receivables against another's liability and misstate both in a filtered report.
      if (target.businessId !== source.businessId) {
        throw new RepositoryValidationError("A credit can only be applied to an invoice in the same business.");
      }
      this.assertIsoDate("Application date", input.appliedOn);
      const noteDate = this.creditNoteEntryDate(note.id);
      if (input.appliedOn < noteDate) {
        throw new RepositoryValidationError(`A credit cannot be applied before its credit note (${noteDate}).`);
      }
      const targetDate = target.invoiceDate ?? noteDate;
      if (input.appliedOn < targetDate) {
        throw new RepositoryValidationError(`A credit cannot be applied before the invoice it settles (${targetDate}).`);
      }
      const balance = this.getCreditNoteBalance(note.id);
      if (input.amountPaise > balance.outstandingPaise) {
        throw new RepositoryValidationError(
          `Credit note ${note.number} has ${balance.outstandingPaise} paise left to give back; applying ${input.amountPaise} paise exceeds it.`,
        );
      }
      const targetOutstandingPaise = this.invoiceOutstandingPaise(target);
      if (input.amountPaise > targetOutstandingPaise) {
        throw new RepositoryValidationError(
          `Invoice ${target.number} only owes ${targetOutstandingPaise} paise; applying ${input.amountPaise} paise would take it past settled.`,
        );
      }
      // S5-11: journal dimensions are per ENTRY, so one entry cannot carry two fairs. When the
      // note's fair and the invoice's fair differ, post TWO single-fair entries that meet in
      // INTER_FAIR_CLEARING, so CUSTOMER_CREDITS nets to zero inside the fair that created it and
      // RECEIVABLES nets inside the fair whose invoice was settled. Untagged counts as different
      // from tagged (null vs non-null splits); null vs null, or the same fair, stays ONE entry.
      // `?? null` first: a missing fair may read back as undefined or null, and they are the same.
      const sourceFair = source.fairId ?? null;
      const targetFair = target.fairId ?? null;
      const description = `Credit note ${note.number} applied to invoice ${target.number}`;
      // None of these ids may begin `je-credit-note-`: that prefix belongs to a note's own two
      // entries, which the cash-view walk matches by exact id and which invoiceCreditedPaise sums
      // by prefix. They are sourced at the TARGET invoice, whose receivable they settle.
      let entry: JournalEntry;
      if (sourceFair === targetFair) {
        entry = {
          id: `je-credit-apply-${input.id}`,
          sourceId: target.id,
          description,
          isReversal: false,
          lines: [
            { account: "CUSTOMER_CREDITS", debitPaise: input.amountPaise, creditPaise: 0 },
            { account: "RECEIVABLES", debitPaise: 0, creditPaise: input.amountPaise },
          ],
        };
        this.insertJournalEntry(entry, {
          businessId: target.businessId,
          entryDate: input.appliedOn,
          ...fairDim(target.fairId),
        });
      } else {
        const sourceEntry: JournalEntry = {
          id: `je-credit-apply-${input.id}-source`,
          sourceId: target.id,
          description,
          isReversal: false,
          lines: [
            { account: "CUSTOMER_CREDITS", debitPaise: input.amountPaise, creditPaise: 0 },
            { account: "INTER_FAIR_CLEARING", debitPaise: 0, creditPaise: input.amountPaise },
          ],
        };
        entry = {
          id: `je-credit-apply-${input.id}-target`,
          sourceId: target.id,
          description,
          isReversal: false,
          lines: [
            { account: "INTER_FAIR_CLEARING", debitPaise: input.amountPaise, creditPaise: 0 },
            { account: "RECEIVABLES", debitPaise: 0, creditPaise: input.amountPaise },
          ],
        };
        this.insertJournalEntry(sourceEntry, {
          businessId: target.businessId,
          entryDate: input.appliedOn,
          ...fairDim(source.fairId),
        });
        this.insertJournalEntry(entry, {
          businessId: target.businessId,
          entryDate: input.appliedOn,
          ...fairDim(target.fairId),
        });
      }
      this.db
        .prepare(
          "INSERT INTO credit_note_applications (id, credit_note_id, invoice_id, amount_paise, applied_on, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(input.id, note.id, target.id, input.amountPaise, input.appliedOn, new Date().toISOString());
      this.insertAuditEvent({ action: "credit_note.applied", entityId: input.id, occurredAt: new Date().toISOString() });
      return entry;
    })();
  }

  /**
   * Undo a finalized credit note (S4-1). Until this existed, `CreditNoteStatus.CANCELLED` was a
   * value nothing ever set, so a note could never be undone - and because an invoice carrying a
   * note cannot be cancelled either, one mistaken note froze that invoice for good.
   *
   * Correction by REVERSAL, never deletion: both of the note entries are negated on today date
   * and the restored stock goes back out. Nothing earlier is rewritten, so a month already
   * reported stays exactly as it was (S1-6).
   */
  public cancelCreditNote(creditNoteId: string): JournalEntry {
    return this.db.transaction(() => {
      const note = this.getCreditNote(creditNoteId);
      if (note.status !== "FINALIZED") {
        throw new RepositoryValidationError("Only a finalized credit note can be cancelled.");
      }
      const invoice = this.getInvoice(note.invoiceId);
      const balance = this.getCreditNoteBalance(note.id);
      if (balance.dischargedPaise > 0) {
        throw new RepositoryValidationError(
          `Credit note ${note.number} has ${balance.dischargedPaise} paise already refunded or applied to another invoice. Cancelling it would leave that money unaccounted for, and there is no path to reverse a refund yet.`,
        );
      }
      // NEWEST FIRST, and newest means LAST FINALIZED - never last drafted. Each note split was
      // worked out against the balance outstanding AT THE MOMENT IT WAS FINALIZED, so that is the
      // order the splits depend on. created_at is set when the DRAFT is saved, and the two orders
      // come apart the moment anyone drafts two notes and finalizes them the other way round:
      // the guard then refuses the note finalized last and waves through the one whose split
      // everything else was measured against, leaving RECEIVABLES and CUSTOMER_CREDITS on one
      // invoice carrying figures the surviving notes no longer justify - exactly the state this
      // guard exists to prevent. journal_lines.id is INTEGER PRIMARY KEY AUTOINCREMENT, so the
      // first line of a note value entry is a strictly monotonic stamp of when it posted.
      const latest = this.db
        .prepare(
          `SELECT cn.id, cn.number,
                  (SELECT MIN(jl.id) FROM journal_lines jl
                    WHERE jl.journal_entry_id = 'je-credit-note-' || cn.id) AS posted_seq
             FROM credit_notes cn
            WHERE cn.invoice_id = ? AND cn.status = 'FINALIZED'
            ORDER BY posted_seq DESC
            LIMIT 1`,
        )
        .get(note.invoiceId) as { id: string; number: string } | undefined;
      if (latest !== undefined && latest.id !== note.id) {
        throw new RepositoryValidationError(
          `Credit note ${note.number} is not the latest on invoice ${invoice.number}: cancel ${latest.number} first. Each note was split against what was outstanding when it was finalized, so undoing an earlier one first would leave the later splits wrong.`,
        );
      }

      // The stock this note put back has to still be there to go out again. If it has since been
      // sold on, cancelling would drive the item negative.
      const restored = this.db
        .prepare(
          "SELECT item_id, quantity_delta, unit_cost_paise FROM stock_movements WHERE source_id = ? AND movement_type = 'SALE_REVERSAL' ORDER BY rowid",
        )
        .all(note.id) as Array<{ item_id: string; quantity_delta: number; unit_cost_paise: number }>;
      const neededByItem = new Map<string, number>();
      for (const row of restored) {
        neededByItem.set(row.item_id, (neededByItem.get(row.item_id) ?? 0) + row.quantity_delta);
      }
      for (const [itemId, quantity] of neededByItem) {
        const onHand = (
          this.db
            .prepare("SELECT COALESCE(SUM(quantity_delta), 0) AS quantity FROM stock_movements WHERE item_id = ?")
            .get(itemId) as { quantity: number }
        ).quantity;
        if (onHand < quantity) {
          throw new RepositoryValidationError(
            `Cancelling credit note ${note.number} needs ${quantity} of item ${itemId} back, but only ${onHand} are on hand: the returned goods have already gone out again.`,
          );
        }
      }
      for (const row of restored) {
        this.insertStockMovement({
          itemId: row.item_id,
          sourceId: note.id,
          movementType: "SALE",
          quantityDelta: -row.quantity_delta,
          unitCostPaise: row.unit_cost_paise,
          ...fairDim(invoice.fairId),
        });
      }

      const dims = { businessId: invoice.businessId, entryDate: istDateOf(), ...fairDim(invoice.fairId) };
      const reverse = (sourceEntryId: string, id: string, description: string): JournalEntry | undefined => {
        const lines = this.db
          .prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
          .all(sourceEntryId) as Array<{ account: string; debit_paise: number; credit_paise: number }>;
        if (lines.length === 0) return undefined;
        return {
          id,
          sourceId: invoice.id,
          description,
          isReversal: true,
          lines: lines.map((line) => ({
            account: line.account,
            debitPaise: line.credit_paise,
            creditPaise: line.debit_paise,
          })),
        };
      };
      // These ids keep the `je-credit-note-` prefix deliberately. invoiceCreditedPaise sums that
      // prefix against the settlement account, so the reversal nets this note credit back to zero
      // there with no special case - which is precisely what frees the invoice to be cancelled.
      const valueReversal = reverse(
        `je-credit-note-${note.id}`,
        `je-credit-note-cancel-${note.id}`,
        `Cancellation of credit note ${note.number}`,
      );
      if (valueReversal === undefined) {
        throw new Error(`Credit note ${note.id} is finalized but has no journal entry to reverse.`);
      }
      this.insertJournalEntry(valueReversal, dims);
      const stockReversal = reverse(
        `je-credit-note-inventory-${note.id}`,
        `je-credit-note-cancel-inventory-${note.id}`,
        `Stock sent out again for cancelled credit note ${note.number}`,
      );
      if (stockReversal !== undefined) this.insertJournalEntry(stockReversal, dims);

      this.db.prepare("UPDATE credit_notes SET status = 'CANCELLED' WHERE id = ?").run(note.id);
      this.insertAuditEvent({ action: "credit_note.cancelled", entityId: note.id, occurredAt: new Date().toISOString() });
      return valueReversal;
    })();
  }

  public listCreditNotes(filter: { invoiceId?: string; status?: CreditNote["status"] } = {}): readonly CreditNoteSummary[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.invoiceId !== undefined) { conditions.push("cn.invoice_id = ?"); params.push(filter.invoiceId); }
    if (filter.status !== undefined) { conditions.push("cn.status = ?"); params.push(filter.status); }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db.prepare(
      `SELECT cn.id, cn.invoice_id, i.number AS invoice_number, cn.number, cn.reason, cn.status, cn.created_at,
              i.tax_rate_basis_points,
              COALESCE((SELECT SUM(cnl.quantity * cnl.unit_price_paise) FROM credit_note_lines cnl WHERE cnl.credit_note_id = cn.id), 0) AS subtotal_paise
         FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id
         ${where}
         ORDER BY cn.created_at DESC, cn.id DESC`,
    ).all(...params) as Array<{
      id: string; invoice_id: string; invoice_number: string; number: string; reason: string;
      status: CreditNote["status"]; created_at: string; tax_rate_basis_points: number | null; subtotal_paise: number;
    }>;
    return rows.map((row) => {
      const taxPaise = Math.round(row.subtotal_paise * (row.tax_rate_basis_points ?? 0) / 10000);
      return {
        id: row.id,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        number: row.number,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
        subtotalPaise: row.subtotal_paise,
        taxPaise,
        totalPaise: row.subtotal_paise + taxPaise,
      };
    });
  }

  public getCreditNote(creditNoteId: string): CreditNote {
    const row = this.db.prepare("SELECT id, invoice_id, number, reason, status FROM credit_notes WHERE id = ?")
      .get(creditNoteId) as { id: string; invoice_id: string; number: string; reason: string; status: CreditNote["status"] } | undefined;
    if (row === undefined) throw new Error(`Credit note ${creditNoteId} was not found.`);
    const lines = this.db.prepare("SELECT item_id, description, quantity, unit_price_paise FROM credit_note_lines WHERE credit_note_id = ? ORDER BY id")
      .all(creditNoteId) as Array<{ item_id: string | null; description: string; quantity: number; unit_price_paise: number }>;
    return {
      id: row.id, invoiceId: row.invoice_id, number: row.number, reason: row.reason, status: row.status,
      lines: lines.map((line) => ({ ...(line.item_id === null ? {} : { itemId: line.item_id }), description: line.description, quantity: line.quantity, unitPricePaise: line.unit_price_paise })),
    };
  }

  public getInvoice(invoiceId: string): Invoice {
    const row = this.db
      .prepare("SELECT * FROM invoices WHERE id = ?")
      .get(invoiceId) as InvoiceRow | undefined;
    if (row === undefined) {
      throw new Error(`Invoice ${invoiceId} was not found.`);
    }

    const lines = this.db
      .prepare(
        "SELECT item_id, description, quantity, unit_price_paise FROM invoice_lines WHERE invoice_id = ? ORDER BY id",
      )
      .all(invoiceId) as InvoiceLineRow[];
    return {
      id: row.id,
      number: row.number,
      businessId: row.business_id,
      customerId: row.customer_id,
      invoiceDate: row.invoice_date ?? new Date().toISOString(),
      ...(row.due_date === null ? {} : { dueDate: row.due_date }),
      discountPaise: row.discount_paise,
      extraChargePaise: row.extra_charge_paise,
      ...(row.notes === null ? {} : { notes: row.notes }),
      ...(row.payment_terms === null ? {} : { paymentTerms: row.payment_terms }),
      taxType: row.tax_type ?? "NONE",
      taxRateBasisPoints: row.tax_rate_basis_points,
      ...(row.converted_invoice_id === null ? {} : { convertedInvoiceId: row.converted_invoice_id }),
      ...(row.fair_id === null ? {} : { fairId: row.fair_id }),
      ...(row.buyer_name === null ? {} : { buyerName: row.buyer_name }),
      ...(row.buyer_contact === null ? {} : { buyerContact: row.buyer_contact }),
      paymentAccount: row.payment_account,
      status: row.status,
      lines: lines.map((line): InvoiceLine => ({
        ...(line.item_id === null ? {} : { itemId: line.item_id }),
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unit_price_paise,
      })),
    };
  }

  public finalizeInvoice(invoiceId: string): JournalEntry {
    const finalized = this.db.transaction(() => {
      const invoice = this.getInvoice(invoiceId);
      const result = finalizeInvoice(invoice);
      const inventoryCostPaise = this.consumeInvoiceStock(invoice);
      this.db
        .prepare("UPDATE invoices SET status = ? WHERE id = ?")
        .run(result.invoice.status, invoiceId);
      const dims = { businessId: invoice.businessId, entryDate: this.invoiceEntryDate(invoiceId), ...fairDim(invoice.fairId) };
      this.insertJournalEntry(result.journalEntry, dims);
      if (inventoryCostPaise > 0) {
        this.insertJournalEntry(this.inventoryJournalEntry(invoice, inventoryCostPaise, false), dims);
      }
      this.insertAuditEvent(result.auditEvent);
      return result.journalEntry;
    })();
    return finalized;
  }

  public cancelInvoice(invoiceId: string): JournalEntry {
    const cancelled = this.db.transaction(() => {
      const invoice = this.getInvoice(invoiceId);
      // Symmetry with bills and expenses: a document with money against it cannot be
      // cancelled. Reversing the whole invoice while the receipt stands would drive
      // RECEIVABLES negative and leave the cash with nowhere to go (there is no refund
      // path yet). Refund or reverse the payment first.
      // Applied credits count here too (S4-5): an invoice settled by a credit note from another
      // invoice is just as settled as one paid in cash, and cancelling it would reverse the whole
      // invoice while the credit stood.
      if (this.invoiceSettledPaise(invoiceId) > 0) {
        throw new RepositoryValidationError("An invoice with recorded payments or applied credits cannot be cancelled.");
      }
      // A finalized credit note is money against the invoice for exactly the same reason, and the
      // guard above missed it. Cancellation reverses the ORIGINAL entry in full, so on a 1000
      // invoice carrying a 400 note it reversed 1000 of SALES that only stood at 600 — leaving
      // SALES with a 400 DEBIT balance and RECEIVABLES at -400, silently.
      //
      // THE DEAD END IS CLOSED. This used to be terminal: CreditNoteStatus had a CANCELLED value
      // that nothing ever set, so a note could not be undone and one mistaken note froze its
      // invoice for good. cancelCreditNote now exists, and because its reversal keeps the
      // `je-credit-note-` prefix, the sum below nets back to zero with no special case here.
      const creditedPaise = this.invoiceCreditedPaise(invoice);
      if (creditedPaise > 0) {
        throw new RepositoryValidationError(
          `This invoice has ${creditedPaise} paise of credit notes against it and cannot be cancelled: the cancellation would reverse more than the invoice still owes. Cancel its credit notes first, newest first.`,
        );
      }
      const originalEntry = this.getOriginalJournalEntry(invoiceId);
      const result = cancelInvoice(invoice, originalEntry);
      const inventoryCostPaise = this.restoreInvoiceStock(invoiceId, invoice.fairId);
      this.db
        .prepare("UPDATE invoices SET status = ? WHERE id = ?")
        .run(result.invoice.status, invoiceId);
      // A cancellation is its own event, dated the day it happens (never the invoice's date).
      const dims = { businessId: invoice.businessId, entryDate: istDateOf(), ...fairDim(invoice.fairId) };
      this.insertJournalEntry(result.reversalEntry, dims);
      if (inventoryCostPaise > 0) {
        this.insertJournalEntry(this.inventoryJournalEntry(invoice, inventoryCostPaise, true), dims);
      }
      this.insertAuditEvent(result.auditEvent);
      return result.reversalEntry;
    })();
    return cancelled;
  }

  /**
   * Stored `paid_at` for a payment. No date given: the instant of recording. A business date (YYYY-MM-DD):
   * noon IST on that day, still a full ISO instant so the column stays one format; noon keeps the date
   * stable under both IST conversion and a plain UTC slice.
   */
  private paymentInstant(paidOn: string | undefined): string {
    if (paidOn === undefined) return new Date().toISOString();
    this.assertIsoDate("Payment date", paidOn);
    return new Date(`${paidOn}T12:00:00+05:30`).toISOString();
  }

  public recordPayment(invoiceId: string, amountPaise: number, paidOn?: string): Payment {
    const payment = this.db.transaction(() => {
      const paidAt = this.paymentInstant(paidOn);
      const invoice = this.getInvoice(invoiceId);
      if (invoice.status !== "FINALIZED") {
        throw new RepositoryValidationError("Only finalized invoices can receive payments.");
      }
      if (invoice.paymentAccount !== "RECEIVABLES") {
        throw new RepositoryValidationError("Only receivable invoices can receive payments.");
      }
      if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
        throw new RepositoryValidationError("Payment amount must be a positive whole number of paise.");
      }
      // DEFECT FIXED: this capped against the ORIGINAL invoice total and counted only the
      // `payments` table, so a credit note did not reduce what the customer could still pay.
      // On a credited invoice they could overpay, driving RECEIVABLES NEGATIVE with no error
      // and no refund path to put it right.
      const outstandingPaise = this.invoiceOutstandingPaise(invoice);
      if (amountPaise > outstandingPaise) {
        throw new RepositoryValidationError(
          `Payment cannot exceed the invoice outstanding balance of ${outstandingPaise} paise.`,
        );
      }
      const result: Payment = {
        id: randomUUID(),
        invoiceId,
        amountPaise,
        paymentAccount: "CASH",
        paidAt,
      };
      this.db
        .prepare("INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at) VALUES (?, ?, ?, ?, ?)")
        .run(result.id, result.invoiceId, result.amountPaise, result.paymentAccount, result.paidAt);
      const paymentLines = [
        { account: "CASH" as const, debitPaise: amountPaise, creditPaise: 0 },
        { account: "RECEIVABLES" as const, debitPaise: 0, creditPaise: amountPaise },
      ];
      this.insertJournalEntry({
        id: `je-payment-${result.id}`,
        sourceId: invoiceId,
        description: `Payment for invoice ${invoice.number}`,
        isReversal: false,
        lines: paymentLines,
      }, { businessId: invoice.businessId, entryDate: istDateOf(result.paidAt), ...fairDim(invoice.fairId) });
      this.insertAuditEvent({
        action: "invoice.payment_received",
        entityId: invoiceId,
        occurredAt: new Date().toISOString(),
      });
      return result;
    })();
    return payment;
  }

  public listPayments(invoiceId: string): readonly Payment[] {
    const rows = this.db
      .prepare("SELECT id, invoice_id, amount_paise, payment_account, paid_at FROM payments WHERE invoice_id = ? ORDER BY paid_at, id")
      .all(invoiceId) as Array<{ id: string; invoice_id: string; amount_paise: number; payment_account: "CASH"; paid_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      amountPaise: row.amount_paise,
      paymentAccount: row.payment_account,
      paidAt: row.paid_at,
    }));
  }

  /**
   * R7b: this took NO filters and aged against the wall clock, so it could not answer "what was
   * owed at the year end" and gave a different answer each day it was run. It now takes the same
   * filters as the open-items query it reads, and ages against `asAtDate` (today when omitted),
   * which is passed in rather than read from the clock.
   */
  public getReceivables(filter: { businessId?: string; customerId?: string; asAtDate?: string } = {}): readonly ReceivableRow[] {
    // One definition of "what a customer still owes": the shared open-items query, which reads
    // invoices (less payments, applied credit and credit notes from the POSTED journal) and
    // opening balances alike. This method only reshapes its rows.
    const now = Date.parse(`${this.asAtOrToday(filter.asAtDate)}T00:00:00.000Z`);
    return this.openCustomerItemRows({
      ...(filter.businessId === undefined ? {} : { businessId: filter.businessId }),
      ...(filter.customerId === undefined ? {} : { customerId: filter.customerId }),
    }).map((item) => ({
      kind: item.kind,
      invoiceId: item.documentId,
      invoiceNumber: item.number,
      customerId: item.customerId,
      invoiceDate: item.date,
      totalPaise: item.totalPaise,
      paidPaise: item.paidPaise,
      creditedPaise: item.creditedPaise,
      outstandingPaise: item.outstandingPaise,
      ageDays: Math.max(0, Math.floor((now - Date.parse(`${item.date}T00:00:00.000Z`)) / 86400000)),
    }));
  }

  /** The as-at date a report should use: the caller's, validated, or today in IST. */
  private asAtOrToday(asAtDate?: string): string {
    if (asAtDate === undefined) return istDateOf();
    if (!isValidIsoDate(asAtDate)) {
      throw new RepositoryValidationError("As-at date must be a real date written as YYYY-MM-DD.");
    }
    return asAtDate;
  }

  /** The age bands every ageing report uses. One definition, so customer and supplier agree. */
  private static readonly AGEING_BANDS: ReadonlyArray<{ label: string; fromDays: number; toDays: number | null }> = [
    { label: "0-30 days", fromDays: 0, toDays: 30 },
    { label: "31-60 days", fromDays: 31, toDays: 60 },
    { label: "61-90 days", fromDays: 61, toDays: 90 },
    { label: "Over 90 days", fromDays: 91, toDays: null },
  ];

  /**
   * Age a set of open documents into bands and group them by party. Shared by the customer and
   * supplier reports so the two cannot drift apart.
   */
  private buildAgeingReport(
    asAtDate: string,
    documents: ReadonlyArray<{ partyId: string; date: string; outstandingPaise: number }>,
    names: ReadonlyMap<string, string>,
  ): AgeingReport {
    const asAtMs = Date.parse(`${asAtDate}T00:00:00.000Z`);
    const emptyBuckets = (): AgeingBucket[] =>
      AccountingRepository.AGEING_BANDS.map((band) => ({ ...band, outstandingPaise: 0, documentCount: 0 }));
    const byParty = new Map<string, AgeingBucket[]>();
    const totals = emptyBuckets();

    for (const document of documents) {
      if (document.outstandingPaise === 0) continue;
      // A document dated after the as-at date did not exist then, so it cannot be owed then.
      // Without this an ageing report run as at January listed June's invoices at nil days old.
      if (document.date > asAtDate) continue;
      const ageDays = Math.floor((asAtMs - Date.parse(`${document.date}T00:00:00.000Z`)) / 86400000);
      const index = AccountingRepository.AGEING_BANDS
        .findIndex((band) => ageDays >= band.fromDays && (band.toDays === null || ageDays <= band.toDays));
      // The bands run contiguously from 0 with an open top, so this cannot miss. Guarded anyway:
      // a document silently dropped from an ageing report is the worst thing it could do.
      if (index === -1) throw new AccountingError(`No ageing band covers ${ageDays} days.`);
      let buckets = byParty.get(document.partyId);
      if (buckets === undefined) { buckets = emptyBuckets(); byParty.set(document.partyId, buckets); }
      const bucket = buckets[index] as AgeingBucket;
      buckets[index] = { ...bucket, outstandingPaise: bucket.outstandingPaise + document.outstandingPaise, documentCount: bucket.documentCount + 1 };
      const total = totals[index] as AgeingBucket;
      totals[index] = { ...total, outstandingPaise: total.outstandingPaise + document.outstandingPaise, documentCount: total.documentCount + 1 };
    }

    const rows: AgeingPartyRow[] = [...byParty.entries()]
      .map(([partyId, buckets]) => ({
        partyId,
        partyName: names.get(partyId) ?? "(unknown)",
        outstandingPaise: buckets.reduce((sum, bucket) => sum + bucket.outstandingPaise, 0),
        buckets,
      }))
      .sort((left, right) => left.partyName.localeCompare(right.partyName) || left.partyId.localeCompare(right.partyId));

    return {
      asAtDate,
      rows,
      buckets: totals,
      totalOutstandingPaise: totals.reduce((sum, bucket) => sum + bucket.outstandingPaise, 0),
    };
  }

  /** R7b. What customers owe, aged. Reads the same open items as `getReceivables`. */
  public getReceivablesAgeing(filter: { businessId?: string; customerId?: string; asAtDate?: string } = {}): AgeingReport {
    const items = this.openCustomerItemRows({
      ...(filter.businessId === undefined ? {} : { businessId: filter.businessId }),
      ...(filter.customerId === undefined ? {} : { customerId: filter.customerId }),
    });
    const names = new Map(
      (this.db.prepare("SELECT id, name FROM customers").all() as Array<{ id: string; name: string }>)
        .map((row) => [row.id, row.name] as const),
    );
    return this.buildAgeingReport(
      this.asAtOrToday(filter.asAtDate),
      items.map((item) => ({ partyId: item.customerId, date: item.date, outstandingPaise: item.outstandingPaise })),
      names,
    );
  }

  /** R7b. The supplier mirror: what is owed to suppliers, aged, from the same open-items query. */
  public getPayablesAgeing(filter: { businessId?: string; supplierId?: string; asAtDate?: string } = {}): AgeingReport {
    const items = this.openSupplierItemRows({
      ...(filter.businessId === undefined ? {} : { businessId: filter.businessId }),
      ...(filter.supplierId === undefined ? {} : { supplierId: filter.supplierId }),
    });
    const names = new Map(
      (this.db.prepare("SELECT id, name FROM suppliers").all() as Array<{ id: string; name: string }>)
        .map((row) => [row.id, row.name] as const),
    );
    return this.buildAgeingReport(
      this.asAtOrToday(filter.asAtDate),
      items.map((item) => ({ partyId: item.supplierId, date: item.date, outstandingPaise: item.outstandingPaise })),
      names,
    );
  }

  public getFairSales(fairId?: string): readonly FairSalesRow[] {
    const statement = fairId === undefined
      ? this.db.prepare(
          `SELECT f.id, f.name, COUNT(s.id) AS invoice_count,
                  COALESCE(SUM(s.total_paise), 0) AS total_paise
           FROM fairs f
           LEFT JOIN (
             SELECT i.id, i.fair_id,
                    (SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise)
                      + ROUND((SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise) * i.tax_rate_basis_points / 10000.0) AS total_paise
             FROM invoices i JOIN invoice_lines il ON il.invoice_id = i.id
             WHERE i.status = 'FINALIZED'
             GROUP BY i.id
           ) s ON s.fair_id = f.id
           GROUP BY f.id ORDER BY f.name, f.id`,
        )
      : this.db.prepare(
          `SELECT f.id, f.name, COUNT(s.id) AS invoice_count,
                  COALESCE(SUM(s.total_paise), 0) AS total_paise
           FROM fairs f
           LEFT JOIN (
             SELECT i.id, i.fair_id,
                    (SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise)
                      + ROUND((SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise) * i.tax_rate_basis_points / 10000.0) AS total_paise
             FROM invoices i JOIN invoice_lines il ON il.invoice_id = i.id
             WHERE i.status = 'FINALIZED'
             GROUP BY i.id
           ) s ON s.fair_id = f.id
           WHERE f.id = ?
           GROUP BY f.id ORDER BY f.name, f.id`,
        );
    const rows = (fairId === undefined ? statement.all() : statement.all(fairId)) as Array<{
      id: string; name: string; invoice_count: number; total_paise: number;
    }>;
    return rows.map((row) => ({
      fairId: row.id,
      fairName: row.name,
      invoiceCount: row.invoice_count,
      totalPaise: row.total_paise,
    }));
  }

  public listAuditEvents(entityId?: string): readonly AuditEvent[] {
    const statement =
      entityId === undefined
        ? this.db.prepare(
            "SELECT action, entity_id, occurred_at FROM audit_events ORDER BY id",
          )
        : this.db.prepare(
            "SELECT action, entity_id, occurred_at FROM audit_events WHERE entity_id = ? ORDER BY id",
          );
    const rows = (entityId === undefined
      ? statement.all()
      : statement.all(entityId)) as Array<{
      action: string;
      entity_id: string;
      occurred_at: string;
    }>;
    return rows.map((row) => ({
      action: row.action,
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
    }));
  }

  public listJournalEntries(): readonly JournalEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, source_id, description, is_reversal FROM journal_entries ORDER BY created_at, id",
      )
      .all() as JournalEntryRow[];
    return rows.map((row) => this.getJournalEntry(row));
  }

  public getTrialBalance(filter: AsAtReportFilter = {}): readonly TrialBalanceRow[] {
    return this.getReportAccountRows(filter).map((row) => ({
      account: row.account as AccountCode,
      debitPaise: row.debitPaise,
      creditPaise: row.creditPaise,
    }));
  }

  public getProfitAndLoss(filter: PeriodReportFilter = {}): ProfitAndLossReport {
    const { basis: requestedBasis, ...rangeFilter } = filter;
    const basis = requestedBasis ?? this.defaultReportBasis(rangeFilter.businessId);
    if (basis !== "CASH" && basis !== "ACCRUAL") {
      throw new RepositoryValidationError("Basis must be CASH or ACCRUAL.");
    }
    // Derive the cash view ONCE: both the account rows and gross sales come out of it.
    const derivation = basis === "CASH" ? this.deriveCashView(rangeFilter) : undefined;
    const rows = derivation === undefined ? this.getReportAccountRows(rangeFilter) : this.cashViewAccountRows(derivation);
    // Grouped by CLASS, never by a list of codes: an income or expense account the user adds
    // appears here automatically.
    const income = rows.filter((row) => row.type === "INCOME");
    const expenses = rows.filter((row) => row.type === "EXPENSE");
    const totalIncomePaise = income.reduce((total, row) => total + row.creditPaise - row.debitPaise, 0);
    const totalExpensesPaise = expenses.reduce((total, row) => total + row.debitPaise - row.creditPaise, 0);
    // GST on sales is a ROLE, not a class: these are liabilities, and `type` cannot single them out.
    const gstOnSalesPaise = rows
      .filter((row) => row.role === "OUTPUT_GST")
      .reduce((total, row) => total + row.creditPaise - row.debitPaise, 0);
    const grossSalesPaise = derivation === undefined
      ? totalIncomePaise + gstOnSalesPaise
      : derivation.invoiceCollections.reduce((total, row) => total + row.amountPaise, 0);
    return {
      income,
      expenses,
      totalIncomePaise,
      totalExpensesPaise,
      netProfitPaise: totalIncomePaise - totalExpensesPaise,
      basis,
      grossSalesPaise,
      gstOnSalesPaise,
    };
  }

  /** Company preference for a business (its stored accounting_basis); ACCRUAL for consolidated or an unknown business. */
  private defaultReportBasis(businessId: string | undefined): AccountingBasis {
    if (businessId === undefined) return "ACCRUAL";
    const row = this.db
      .prepare("SELECT c.accounting_basis AS basis FROM businesses b JOIN companies c ON c.id = b.company_id WHERE b.id = ?")
      .get(businessId) as { basis: AccountingBasis } | undefined;
    return row?.basis ?? "ACCRUAL";
  }

  /**
   * An already-computed cash view, shaped like the ledger rows the accrual P&L uses
   * (net per account). Takes the derivation rather than a filter so a cash P&L derives once.
   */
  private cashViewAccountRows(derivation: CashViewDerivation): readonly ClassifiedReportAccountRow[] {
    const classes = this.accountClasses();
    const totals = new Map<string, number>();
    for (const row of derivation.recognitions) {
      totals.set(row.account, (totals.get(row.account) ?? 0) + row.amountPaise);
    }
    const rows: ClassifiedReportAccountRow[] = [];
    for (const [account, natural] of [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (natural === 0) continue;
      const classification = classes.get(account);
      if (classification === undefined) {
        throw new AccountingError(`Account "${account}" is recognised in the cash view but has no row in chart_accounts.`);
      }
      const creditNormal = AccountingRepository.creditNormal(classification.type);
      const debitPaise = creditNormal ? (natural < 0 ? -natural : 0) : (natural > 0 ? natural : 0);
      const creditPaise = creditNormal ? (natural > 0 ? natural : 0) : (natural < 0 ? -natural : 0);
      rows.push({
        account,
        type: classification.type,
        role: classification.role,
        debitPaise,
        creditPaise,
        balancePaise: debitPaise - creditPaise,
      });
    }
    return rows;
  }

  /**
   * The cash view of the books, DERIVED and READ-ONLY: it inserts, updates and deletes nothing
   * (no journal entry or line is ever written for it). Public so the figures behind the cash
   * Profit and Loss (inventory, input GST/ITC) can be inspected.
   *
   * One uniform rule for every document (invoice, purchase bill, expense). With T the document
   * total and sum-p the cash allocated to it so far, each posted accrual line of the document is
   * recognised in proportion sum-p / T, each increment dated to the payment that caused it
   * (its IST date), using the cumulative-target allocator so a fully paid document lands on its
   * accrual amounts exactly.
   *
   * Which lines: every journal entry with the document's source_type + source_id, so the
   * invoice entry, its separate COGS/inventory entry, any reversal and any credit note are all
   * gathered together (payment entries share the invoice's source_id, but carry only CASH and
   * RECEIVABLES/PAYABLES lines, which are balance-sheet accounts and are ignored here). Lines of the
   * same account are netted. Only SALES, COGS, EXPENSE, INVENTORY and the GST accounts are kept.
   *
   * Documents paid at once (payment_account CASH) have no payment rows: the cash moved when
   * each entry was posted, so every entry is recognised in full (ratio 1) on its own entry_date.
   * That includes a reversal (it fully negates) and a credit note. Credit documents (RECEIVABLES /
   * PAYABLES) can only be cancelled while unpaid, so a reversal there carries ratio 0 and nets to
   * nothing; this falls out of the same rule rather than being special-cased.
   *
   * CREDIT NOTES on a credit invoice (outcome of the uniform rule, pinned by a test, NOT a design
   * choice): the note's lines are part of the invoice's lines, so they are recognised pro rata
   * with the collections, measured against the ORIGINAL invoice total, and dated to the PAYMENT
   * dates, not the note's own date. Consequences: (1) a note reduces cash-view sales/GST/COGS only
   * as collections arrive; (2) a note raised AFTER the invoice was fully collected restates the
   * earlier collection periods retroactively (the cash view then converges on the net-of-note
   * accrual figure but a closed period changes); (3) because the receivable falls by the note but
   * the payment cap and ratio still use the original total, cash-view gross (cash received) no
   * longer equals net + GST. No refund is modelled. Whether a refund should instead be recognised
   * on the refund date is an owner decision.
   *
   * Period: from/to filter on the recognition date (the payment's IST date, or the entry date
   * for paid-at-once documents), with the same inclusive semantics as the accrual reports.
   * The business filter is the document's business.
   */
  public deriveCashView(filter: { businessId?: string; fairId?: string; fromDate?: string; toDate?: string } = {}): CashViewDerivation {
    // Validates dates and ordering exactly as the accrual reports do.
    this.reportConditions(filter);
    const inPeriod = (date: string): boolean =>
      (filter.fromDate === undefined || date >= filter.fromDate) && (filter.toDate === undefined || date <= filter.toDate);

    type Natural = { account: string; amountPaise: number };
    const classes = this.accountClasses();
    // EXCLUSION, not an inclusion list. The old list named the ten accounts to include, so any
    // account added later was silently dropped from the cash P&L. What actually belongs out is
    // settlement - how a document was paid (cash, bank) and what was owed (receivables,
    // payables). Everything else a document posts is performance and is recognised as cash lands.
    const creditNormal = (account: string): boolean => {
      const classification = classes.get(account);
      if (classification === undefined) {
        throw new AccountingError(`Account "${account}" appears in the ledger but has no row in chart_accounts.`);
      }
      return AccountingRepository.creditNormal(classification.type);
    };

    // Posted lines of the P&L-side accounts, grouped by document and by entry.
    const lineRows = this.db
      .prepare(
        `SELECT je.id AS entry_id, je.source_type, je.source_id,
                COALESCE(je.entry_date, date(je.created_at, '+330 minutes')) AS entry_date,
                jl.account, jl.debit_paise, jl.credit_paise
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.journal_entry_id
           JOIN chart_accounts ca ON ca.code = jl.account
          WHERE ca.role IS NULL OR ca.role NOT IN (${SETTLEMENT_ROLES.map(() => "?").join(",")})
          ORDER BY je.rowid, jl.id`,
      )
      .all(...SETTLEMENT_ROLES) as Array<{
      entry_id: string; source_type: string; source_id: string; entry_date: string;
      account: string; debit_paise: number; credit_paise: number;
    }>;
    const byDocument = new Map<string, Array<(typeof lineRows)[number]>>();
    for (const row of lineRows) {
      const key = `${row.source_type}|${row.source_id}`;
      const list = byDocument.get(key);
      if (list === undefined) byDocument.set(key, [row]); else list.push(row);
    }
    const natural = (row: (typeof lineRows)[number]): number =>
      creditNormal(row.account) ? row.credit_paise - row.debit_paise : row.debit_paise - row.credit_paise;

    // Cash allocated to credit documents, in payment order.
    const paymentsOf = new Map<string, Array<{ amountPaise: number; paidAt: string }>>();
    const addPayment = (key: string, amountPaise: number, paidAt: string): void => {
      const list = paymentsOf.get(key);
      if (list === undefined) paymentsOf.set(key, [{ amountPaise, paidAt }]); else list.push({ amountPaise, paidAt });
    };
    for (const p of this.db.prepare("SELECT invoice_id, amount_paise, paid_at FROM payments ORDER BY paid_at, rowid").all() as Array<{ invoice_id: string; amount_paise: number; paid_at: string }>) {
      addPayment(`INVOICE|${p.invoice_id}`, p.amount_paise, p.paid_at);
    }
    for (const p of this.db.prepare("SELECT bill_id, expense_id, amount_paise, paid_at FROM supplier_payments ORDER BY paid_at, rowid").all() as Array<{ bill_id: string | null; expense_id: string | null; amount_paise: number; paid_at: string }>) {
      addPayment(p.bill_id !== null ? `PURCHASE_BILL|${p.bill_id}` : `EXPENSE|${p.expense_id}`, p.amount_paise, p.paid_at);
    }

    // Credit notes per invoice, read from the TABLE rather than inferred from entry-id prefixes.
    // One note is TWO journal entries - `je-credit-note-<id>` (its sales and GST) and
    // `je-credit-note-inventory-<id>` (the stock going back) - and they have to be ONE event. As
    // two, anything that acts on a note (the settlement true-up, a refund split) can catch one
    // entry and not the other, stranding COGS on a different date from the sales it belongs to.
    // CANCELLED notes are loaded as well as finalized ones. Their original entries are still in
    // the ledger, and if they were not claimed here they would fall into baseRows, become part of
    // the invoice from day one and re-measure months already reported - the S3-5 defect.
    const notesOf = new Map<string, Array<{ id: string; refundablePaise: number }>>();
    for (const n of this.db.prepare(
      "SELECT id, invoice_id, refundable_paise FROM credit_notes WHERE status IN ('FINALIZED', 'CANCELLED') ORDER BY created_at, rowid",
    ).all() as Array<{ id: string; invoice_id: string; refundable_paise: number }>) {
      const entry = { id: n.id, refundablePaise: n.refundable_paise };
      const list = notesOf.get(n.invoice_id);
      if (list === undefined) notesOf.set(n.invoice_id, [entry]); else list.push(entry);
    }

    // Refunds, by the note they discharge (S4-1). A refund is the CASH event for the part of a
    // note that was never set against an open balance: S1-6 puts the reduction in the month the
    // money left, not the month the goods came back.
    const dischargesOf = new Map<string, Array<{ amountPaise: number; date: string }>>();
    const addDischarge = (noteId: string, amountPaise: number, date: string): void => {
      const entry = { amountPaise, date };
      const list = dischargesOf.get(noteId);
      if (list === undefined) dischargesOf.set(noteId, [entry]); else list.push(entry);
    };
    for (const r of this.db.prepare(
      "SELECT credit_note_id, amount_paise, refunded_on FROM credit_note_refunds ORDER BY refunded_on, rowid",
    ).all() as Array<{ credit_note_id: string; amount_paise: number; refunded_on: string }>) {
      addDischarge(r.credit_note_id, r.amount_paise, r.refunded_on);
    }
    // An application discharges the SOURCE note exactly as a refund does - S1-6 recognises it
    // when the credit is USED - and at the same moment settles the TARGET invoice, where it
    // behaves as a payment. One row, two documents.
    for (const a of this.db.prepare(
      "SELECT credit_note_id, invoice_id, amount_paise, applied_on FROM credit_note_applications ORDER BY applied_on, rowid",
    ).all() as Array<{ credit_note_id: string; invoice_id: string; amount_paise: number; applied_on: string }>) {
      addDischarge(a.credit_note_id, a.amount_paise, a.applied_on);
      addPayment(`INVOICE|${a.invoice_id}`, a.amount_paise, a.applied_on);
    }

    // The document's own business and fair (documents carry fair_id, as the entries do).
    const businessClause = (filter.businessId === undefined ? "" : " AND business_id = ?") + (filter.fairId === undefined ? "" : " AND fair_id = ?");
    const businessParams = [...(filter.businessId === undefined ? [] : [filter.businessId]), ...(filter.fairId === undefined ? [] : [filter.fairId])];
    const documents: Array<{ type: "INVOICE" | "PURCHASE_BILL" | "EXPENSE"; id: string; paidAtOnce: boolean; totalPaise: () => number }> = [];
    for (const row of this.db.prepare(`SELECT id, payment_account FROM invoices WHERE status IN ('FINALIZED', 'CANCELLED')${businessClause} ORDER BY created_at, rowid`).all(...businessParams) as Array<{ id: string; payment_account: string }>) {
      documents.push({ type: "INVOICE", id: row.id, paidAtOnce: row.payment_account === "CASH", totalPaise: () => this.invoiceTotal(this.getInvoice(row.id)) });
    }
    for (const row of this.db.prepare(`SELECT id, payment_account FROM purchase_bills WHERE status IN ('FINALIZED', 'CANCELLED')${businessClause} ORDER BY created_at, rowid`).all(...businessParams) as Array<{ id: string; payment_account: string }>) {
      documents.push({ type: "PURCHASE_BILL", id: row.id, paidAtOnce: row.payment_account === "CASH", totalPaise: () => this.getPurchaseBill(row.id).totalPaise });
    }
    for (const row of this.db.prepare(`SELECT id, payment_account FROM expenses WHERE status IN ('FINALIZED', 'CANCELLED')${businessClause} ORDER BY created_at, rowid`).all(...businessParams) as Array<{ id: string; payment_account: string }>) {
      documents.push({ type: "EXPENSE", id: row.id, paidAtOnce: row.payment_account === "CASH", totalPaise: () => this.getExpense(row.id).totalPaise });
    }

    const recognitions: CashRecognitionRow[] = [];
    const invoiceCollections: Array<{ date: string; amountPaise: number }> = [];
    const sumByAccount = (rows: ReadonlyArray<(typeof lineRows)[number]>): Natural[] => {
      const sums = new Map<string, number>();
      for (const row of rows) sums.set(row.account, (sums.get(row.account) ?? 0) + natural(row));
      return [...sums.entries()].map(([account, amountPaise]) => ({ account, amountPaise }));
    };

    for (const doc of documents) {
      const key = `${doc.type}|${doc.id}`;
      const docLines = byDocument.get(key) ?? [];
      if (docLines.length === 0) continue;

      if (doc.paidAtOnce) {
        // Cash moved when each entry was posted: ratio 1 at that entry's own date.
        const entries = new Map<string, Array<(typeof lineRows)[number]>>();
        for (const row of docLines) {
          const list = entries.get(row.entry_id);
          if (list === undefined) entries.set(row.entry_id, [row]); else list.push(row);
        }
        for (const entryLines of entries.values()) {
          const date = (entryLines[0] as (typeof lineRows)[number]).entry_date;
          if (!inPeriod(date)) continue;
          for (const line of sumByAccount(entryLines)) {
            if (line.amountPaise !== 0) recognitions.push({ date, account: line.account, amountPaise: line.amountPaise, documentType: doc.type, documentId: doc.id });
          }
          if (doc.type === "INVOICE") {
            const gross = entryLines
              .filter((row) => row.account === "SALES" || row.account.startsWith("OUTPUT_"))
              .reduce((total, row) => total + natural(row), 0);
            if (gross !== 0) invoiceCollections.push({ date, amountPaise: gross });
          }
        }
        continue;
      }

      // Credit document: an EVENT-ORDERED walk of its credit notes and payments (decision S2-2).
      //
      // At a credit note the remainder is RE-BASED: from then on, what is still to be recognised
      // is (the lines as they now stand, less what is already recognised) measured over (what is
      // still owed). Recognitions already emitted are never revisited, so a month that has been
      // reported cannot move - which is what S1-6 requires.
      //
      // Simply dividing by the net total instead looks equivalent and is not: it re-measures
      // EVERY earlier payment against the new lines, so returning a line that carried no COGS
      // silently raised the COGS of an earlier, closed month. The walk keeps the note's effect
      // entirely in the future, and still converges - once everything owed has been paid, the
      // remaining balance is nil and every remaining line has been recognised.
      const totalPaise = doc.totalPaise();
      if (totalPaise <= 0) continue;

      type Event =
        | { kind: "NOTE"; date: string; noteId: string; lines: readonly Natural[]; inclusivePaise: number; offsetPaise: number }
        | { kind: "PAYMENT"; date: string; amountPaise: number }
        | { kind: "DISCHARGE"; date: string; noteId: string; amountPaise: number }
        | { kind: "CANCEL"; date: string; noteId: string };

      // Partition the document's lines by EXACT entry id against the notes the table reports,
      // never by an id prefix: a prefix test silently swallows any future entry that happens to
      // start the same way, and a reversal landing in baseRows would become part of the invoice
      // from day one and re-measure months already reported (the S3-5 defect).
      const notes = doc.type === "INVOICE" ? notesOf.get(doc.id) ?? [] : [];
      // Entry id -> which note, and which PART of it. Exact ids throughout: a startsWith test
      // would put `je-credit-note-cancel-inventory-x` in the wrong bucket, and would silently
      // swallow any future entry that happened to share the prefix.
      const entryRole = new Map<string, string>();
      for (const note of notes) {
        entryRole.set(`je-credit-note-${note.id}`, `${note.id}|VALUE`);
        entryRole.set(`je-credit-note-inventory-${note.id}`, `${note.id}|STOCK`);
        entryRole.set(`je-credit-note-cancel-${note.id}`, `${note.id}|CANCEL`);
        entryRole.set(`je-credit-note-cancel-inventory-${note.id}`, `${note.id}|CANCEL`);
      }
      const rowsOf = new Map<string, Array<(typeof lineRows)[number]>>();
      const baseRows: Array<(typeof lineRows)[number]> = [];
      for (const row of docLines) {
        const key = entryRole.get(row.entry_id);
        if (key === undefined) { baseRows.push(row); continue; }
        const list = rowsOf.get(key);
        if (list === undefined) rowsOf.set(key, [row]); else list.push(row);
      }
      const events: Event[] = [];
      for (const note of notes) {
        const valueRows = rowsOf.get(`${note.id}|VALUE`) ?? [];
        const stockRows = rowsOf.get(`${note.id}|STOCK`) ?? [];
        const cancelRows = rowsOf.get(`${note.id}|CANCEL`) ?? [];
        if (valueRows.length === 0 && stockRows.length === 0) continue;
        const dateRow = (valueRows[0] ?? stockRows[0]) as (typeof lineRows)[number];
        // The note's tax-inclusive value: the negated sum of its SALES and GST lines. The stock
        // entry moves cost between accounts and takes nothing off the bill, so it is excluded
        // here but included in the lines. CUSTOMER_CREDITS is a settlement role and so never
        // reaches these rows at all - which is why it had to be one.
        const inclusivePaise = -sumByAccount(valueRows).reduce((total, line) => total + line.amountPaise, 0);
        events.push({
          kind: "NOTE",
          date: dateRow.entry_date,
          noteId: note.id,
          lines: sumByAccount([...valueRows, ...stockRows]),
          inclusivePaise,
          // Only the part set against an OPEN BALANCE takes anything off the bill. The rest is
          // money owed back, and nothing is recognised for it until it is actually discharged.
          offsetPaise: Math.max(0, inclusivePaise - note.refundablePaise),
        });
        for (const discharge of dischargesOf.get(note.id) ?? []) {
          events.push({ kind: "DISCHARGE", date: discharge.date, noteId: note.id, amountPaise: discharge.amountPaise });
        }
        // A cancelled note is NOT erased from the walk. It stands at its own date, and a second
        // event undoes it on the CANCEL date, so a month that has been reported never moves.
        if (cancelRows.length > 0) {
          events.push({ kind: "CANCEL", date: (cancelRows[0] as (typeof lineRows)[number]).entry_date, noteId: note.id });
        }
      }
      for (const payment of paymentsOf.get(key) ?? []) {
        events.push({ kind: "PAYMENT", date: istDateOf(payment.paidAt), amountPaise: payment.amountPaise });
      }
      // Notes before payments before refunds on the same day: the note reduces the bill, cash is
      // applied to whatever is left of it, and only then can anything be given back. Documented
      // because the orders give different figures.
      const rank = (event: Event): number =>
        event.kind === "NOTE" ? 0 : event.kind === "PAYMENT" ? 1 : event.kind === "DISCHARGE" ? 2 : 3;
      events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a) - rank(b)));

      const current = new Map<string, number>();
      for (const line of sumByAccount(baseRows)) current.set(line.account, line.amountPaise);
      const recognised = new Map<string, number>();
      let balancePaise = totalPaise;
      let cashPaise = 0;

      // A SEGMENT is the stretch between two credit notes. Inside it the cumulative allocator
      // runs exactly as it always did - paidBefore/paidAfter against the segment's own lines and
      // balance - so a document with NO credit notes behaves identically to before, by
      // construction. (Restarting the allocator at every payment instead would silently change
      // the intermediate shares of every multi-payment bill, expense and uncredited invoice:
      // with one line of 10 against a total of 30 and payments of 1, 1 and 28, the second
      // payment recognises 1 cumulatively but 0 if each payment is allocated on its own.)
      // Only a note opens a new segment, re-based on what is left.
      let segmentLines = [...current.keys()].sort();
      let segmentAmounts = segmentLines.map((account) => current.get(account) ?? 0);
      let segmentBalance = balancePaise;
      let segmentPaid = 0;

      const openSegment = (): void => {
        segmentLines = [...current.keys()].sort();
        segmentAmounts = segmentLines.map((account) => (current.get(account) ?? 0) - (recognised.get(account) ?? 0));
        segmentBalance = balancePaise - cashPaise;
        segmentPaid = 0;
      };

      // Each note runs ONE cumulative allocator over its own tax-inclusive value. The offset
      // share is consumed first, then every discharge in turn, so the shares telescope exactly as
      // a document's payments do: once a note is fully discharged it has recognised precisely its
      // own lines, however many odd-sized refunds came first.
      const noteLedger = new Map<
        string,
        {
          lines: readonly Natural[];
          inclusivePaise: number;
          dischargedPaise: number;
          offsetPaise: number;
          /** Exactly what this note folded into the document, so a cancellation can take back that and no more. */
          folded: Array<{ account: string; amountPaise: number }>;
        }
      >();
      const dischargeShares = (noteId: string, amountPaise: number): Array<{ account: string; amountPaise: number }> => {
        const state = noteLedger.get(noteId);
        if (state === undefined || state.inclusivePaise <= 0 || amountPaise <= 0) return [];
        const before = state.dischargedPaise;
        const after = Math.min(before + amountPaise, state.inclusivePaise);
        if (after <= before) return [];
        const shares = allocateProportionally({
          lineAmountsPaise: state.lines.map((line) => line.amountPaise),
          totalPaise: state.inclusivePaise,
          paidBeforePaise: before,
          paidAfterPaise: after,
        });
        state.dischargedPaise = after;
        return state.lines
          .map((line, index) => ({ account: line.account, amountPaise: shares[index] as number }))
          .filter((line) => line.amountPaise !== 0);
      };

      for (const event of events) {
        if (event.kind === "DISCHARGE") {
          // The note is being given back - as cash, or as credit set against a later invoice. The note's held lines are recognised NOW, in the
          // refund's own month - the owner's S4-6 figures. current and recognised move together,
          // so the running segment is untouched and must NOT be reopened: resetting it here would
          // restart the cumulative allocator mid-segment and silently change the shares of every
          // later payment.
          for (const line of dischargeShares(event.noteId, event.amountPaise)) {
            current.set(line.account, (current.get(line.account) ?? 0) + line.amountPaise);
            recognised.set(line.account, (recognised.get(line.account) ?? 0) + line.amountPaise);
            if (inPeriod(event.date)) {
              recognitions.push({ date: event.date, account: line.account, amountPaise: line.amountPaise, documentType: doc.type, documentId: doc.id });
            }
          }
          // Gross collections fall by what went back out, or gross would stop equalling
          // income + GST once the invoice had converged.
          if (doc.type === "INVOICE" && inPeriod(event.date)) {
            invoiceCollections.push({ date: event.date, amountPaise: -event.amountPaise });
          }
          continue;
        }
        if (event.kind === "CANCEL") {
          const state = noteLedger.get(event.noteId);
          if (state === undefined) continue;
          // Take back EXACTLY what the note folded in, and nothing else. Recognitions already
          // emitted stand: S1-6 forbids rewriting a month that has been reported, and this event
          // is dated at the cancellation, never back at the note.
          for (const line of state.folded) {
            current.set(line.account, (current.get(line.account) ?? 0) - line.amountPaise);
          }
          balancePaise += state.offsetPaise;
          state.folded = [];
          // Belt and braces: a cancelled note can carry no discharges (cancelCreditNote refuses
          // once any part has been refunded or applied), but this makes it impossible anyway.
          state.dischargedPaise = state.inclusivePaise;
          openSegment();
          continue;
        }
        if (event.kind === "NOTE") {
          const state = {
            lines: event.lines,
            inclusivePaise: event.inclusivePaise,
            dischargedPaise: 0,
            offsetPaise: event.offsetPaise,
            folded: [] as Array<{ account: string; amountPaise: number }>,
          };
          noteLedger.set(event.noteId, state);
          // Only the OFFSET share folds into the document now. A note worth more than the invoice
          // still owes has the remainder held back entirely until it is refunded or applied: S1-6
          // puts that reduction in the month it actually happens.
          const folded =
            event.inclusivePaise <= 0
              ? event.lines.map((line) => ({ account: line.account, amountPaise: line.amountPaise }))
              : dischargeShares(event.noteId, event.offsetPaise);
          for (const line of folded) current.set(line.account, (current.get(line.account) ?? 0) + line.amountPaise);
          state.folded = folded;
          balancePaise -= event.offsetPaise;
          // S4-3 (owner, 2026-11-17; AMENDS S2-2): a note that CLEARS what is owed is itself a
          // settlement event. S2-2 still governs the note's own lines - the returned goods never
          // hit the cash P&L on the note date - but once nothing is owed, the lines the customer
          // KEPT are fully settled and no later cash can ever recognise them. Without this the
          // cash view simply never reached accrual: a 10,000 of goods costing 6,000 plus 5,000 of
          // freight, paid 10,000 and then waived, left 200,000 paise of COGS stranded for good.
          //
          // The true-up is (lines as they now stand, less what is already recognised) PER
          // ACCOUNT, which is what makes it safe: an account the earlier payments over-recognised
          // - the share attributed to a line this note has just waived - comes out negative and
          // corrects itself, so no account is left overstated. S1-6 holds, because the entry is
          // dated at the NOTE, never back in the month already reported.
          if (balancePaise - cashPaise === 0) {
            for (const account of [...current.keys()].sort()) {
              const trueUp = (current.get(account) ?? 0) - (recognised.get(account) ?? 0);
              if (trueUp === 0) continue;
              recognised.set(account, current.get(account) ?? 0);
              if (inPeriod(event.date)) {
                recognitions.push({ date: event.date, account, amountPaise: trueUp, documentType: doc.type, documentId: doc.id });
              }
            }
          }
          openSegment();
          continue;
        }
        if (segmentBalance > 0) {
          const segmentPaidAfter = Math.min(segmentPaid + event.amountPaise, segmentBalance);
          if (segmentPaidAfter > segmentPaid) {
            const shares = allocateProportionally({
              lineAmountsPaise: segmentAmounts,
              totalPaise: segmentBalance,
              paidBeforePaise: segmentPaid,
              paidAfterPaise: segmentPaidAfter,
            });
            segmentLines.forEach((account, index) => {
              const share = shares[index] as number;
              if (share === 0) return;
              // Accumulated whether or not it falls in the reported period: the filter decides
              // what is SHOWN, never what has been recognised, or a date range would double count.
              recognised.set(account, (recognised.get(account) ?? 0) + share);
              if (inPeriod(event.date)) {
                recognitions.push({ date: event.date, account, amountPaise: share, documentType: doc.type, documentId: doc.id });
              }
            });
          }
          segmentPaid = segmentPaidAfter;
        }
        if (doc.type === "INVOICE" && inPeriod(event.date)) {
          invoiceCollections.push({ date: event.date, amountPaise: event.amountPaise });
        }
        cashPaise += event.amountPaise;
      }
    }

    // Opening CUSTOMER balances (S5-2, R4b). An opening balance of Y carrying income X (0 <= X <= Y)
    // recognises X x collected / Y on the CASH basis, on each RECEIPT'S date (S1-6). X = 0 recognises
    // nothing: the sale predates the books and the collection is a balance-sheet movement only.
    //
    // It uses allocateProportionally, the SAME cumulative allocator every invoice uses, so the shares
    // telescope and the last receipt trues up to X exactly - there is deliberately no second formula
    // here (a parallel one is how S3-4 and S3-5 happened).
    //
    // The opening entry's own income line is NOT passed through on its own date: this block is the
    // only thing that visits it. It is matched by the EXACT journal-entry id the balance row
    // carries, never by prefix or by source id alone (a general opening set can share a source id
    // with a sub-ledger balance), so nothing else under OPENING_BALANCE can leak in.
    // Opening balances belong to no fair, so a per-fair view has none to show.
    if (filter.fairId === undefined) {
      const receiptsOf = new Map<string, Array<{ amountPaise: number; date: string }>>();
      for (const r of this.db.prepare(
        "SELECT opening_customer_balance_id AS id, amount_paise, received_on FROM opening_balance_receipts ORDER BY received_on, rowid",
      ).all() as Array<{ id: string; amount_paise: number; received_on: string }>) {
        const list = receiptsOf.get(r.id);
        const entry = { amountPaise: r.amount_paise, date: r.received_on };
        if (list === undefined) receiptsOf.set(r.id, [entry]); else list.push(entry);
      }
      for (const b of this.db.prepare(
        `SELECT id, amount_paise, journal_entry_id FROM opening_customer_balances
          WHERE reversed_at IS NULL AND income_paise > 0${filter.businessId === undefined ? "" : " AND business_id = ?"}
          ORDER BY created_at, rowid`,
      ).all(...(filter.businessId === undefined ? [] : [filter.businessId])) as Array<{ id: string; amount_paise: number; journal_entry_id: string }>) {
        // Performance lines only, found by CLASS (the equity plug is not income), of the one entry.
        const performance = sumByAccount(
          (byDocument.get(`OPENING_BALANCE|${b.id}`) ?? []).filter((row) => {
            const type = classes.get(row.account)?.type;
            return row.entry_id === b.journal_entry_id && (type === "INCOME" || type === "EXPENSE");
          }),
        ).filter((line) => line.amountPaise !== 0);
        if (performance.length === 0) continue;
        let collectedPaise = 0;
        for (const receipt of receiptsOf.get(b.id) ?? []) {
          const afterPaise = Math.min(collectedPaise + receipt.amountPaise, b.amount_paise);
          if (afterPaise <= collectedPaise) continue;
          const shares = allocateProportionally({
            lineAmountsPaise: performance.map((line) => line.amountPaise),
            totalPaise: b.amount_paise,
            paidBeforePaise: collectedPaise,
            paidAfterPaise: afterPaise,
          });
          collectedPaise = afterPaise;
          if (!inPeriod(receipt.date)) continue;
          performance.forEach((line, index) => {
            const share = shares[index] as number;
            if (share === 0) return;
            recognitions.push({ date: receipt.date, account: line.account, amountPaise: share, documentType: "OPENING_BALANCE", documentId: b.id });
            if (classes.get(line.account)?.type === "INCOME") invoiceCollections.push({ date: receipt.date, amountPaise: share });
          });
        }
      }
    }
    return { recognitions, invoiceCollections };
  }

  public getBalanceSheet(filter: AsAtReportFilter = {}): BalanceSheetReport {
    if (filter.fairId !== undefined) {
      throw new RepositoryValidationError(
        "The Balance Sheet cannot be filtered by project (fair): there is no per-fair Balance Sheet. Use the Profit and Loss, Trial Balance or General Ledger for a fair.",
      );
    }
    const rows = this.getReportAccountRows(filter);
    // Every section is a CLASS. Because the three classes below partition the balance-sheet rows
    // exactly, and income less expenses becomes retained earnings, the sheet cannot be
    // unbalanced by an account nobody remembered to add to a list.
    const assets = rows.filter((row) => row.type === "ASSET");
    // Liabilities and equity are credit-normal: present them as credit - debit so owed and
    // contributed amounts read positive.
    const creditSide = (row: ClassifiedReportAccountRow) => ({ ...row, balancePaise: row.creditPaise - row.debitPaise });
    const liabilities = rows.filter((row) => row.type === "LIABILITY").map(creditSide);
    const postedEquity = rows.filter((row) => row.type === "EQUITY").map(creditSide);
    // Retained earnings = all income less all expenses, so the sheet balances. It is DERIVED and
    // deliberately has no row in chart_accounts: nothing may ever post to it directly.
    const netProfitPaise = AccountingRepository.netProfitOf(rows);
    const retainedEarnings: ClassifiedReportAccountRow = {
      account: "RETAINED_EARNINGS",
      type: "EQUITY",
      role: null,
      debitPaise: netProfitPaise < 0 ? Math.abs(netProfitPaise) : 0,
      creditPaise: netProfitPaise > 0 ? netProfitPaise : 0,
      balancePaise: netProfitPaise,
    };
    const equity: readonly ClassifiedReportAccountRow[] = [...postedEquity, retainedEarnings];
    return {
      assets,
      liabilities,
      equity,
      totalAssetsPaise: assets.reduce((total, row) => total + row.balancePaise, 0),
      totalLiabilitiesPaise: liabilities.reduce((total, row) => total + row.balancePaise, 0),
      totalEquityPaise: equity.reduce((total, row) => total + row.balancePaise, 0),
      retainedEarnings: this.splitRetainedEarnings(filter, netProfitPaise),
    };
  }

  /** Income less expenses over a set of report rows. The one definition of net profit. */
  private static netProfitOf(rows: readonly ClassifiedReportAccountRow[]): number {
    return rows
      .filter((row) => row.type === "INCOME")
      .reduce((total, row) => total + row.creditPaise - row.debitPaise, 0)
      - rows
        .filter((row) => row.type === "EXPENSE")
        .reduce((total, row) => total + row.debitPaise - row.creditPaise, 0);
  }

  /** The day before an ISO date, used to close the brought-forward period at the year boundary. */
  private static dayBefore(date: string): string {
    const previous = new Date(`${date}T00:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
  }

  /**
   * R5, presentation only: cut the derived retained-earnings figure at the financial-year start.
   *
   * The cut is a SINGLE date, and the upper bound is the sheet's own, so brought forward and
   * profit for the year partition `totalPaise` exactly - there is no third bucket an entry can
   * fall into. A split needs a business, because financial years belong to one (`financial_years
   * .business_id`); the consolidated sheet therefore cannot be split and says so rather than
   * guessing a year.
   */
  private splitRetainedEarnings(filter: AsAtReportFilter, totalPaise: number): RetainedEarningsBreakdown {
    const unsplit = (unsplitReason: string): RetainedEarningsBreakdown => ({ totalPaise, split: null, unsplitReason });
    const { businessId } = filter;
    if (businessId === undefined) {
      return unsplit(
        "This Balance Sheet covers every business at once, and each business keeps its own financial years, "
          + "so there is no single year to split at. Choose a business to see brought forward and profit for the year.",
      );
    }
    const years = this.listFinancialYears(businessId);
    if (years.length === 0) {
      return unsplit("This business has no financial year set up yet, so there is no year boundary to split at.");
    }
    // The year to report is the one containing the sheet's own date - its as-at date, or today
    // when it has none, which is the date an unbounded sheet is in fact read on.
    const onDate = filter.asAtDate ?? istDateOf();
    const year = years.find((candidate) => candidate.startsOn <= onDate && onDate <= candidate.endsOn);
    if (year === undefined) {
      return unsplit(`No financial year covers ${onDate}, so there is no year boundary to split at.`);
    }
    // Both parts are measured the same way the total was, with the SAME upper bound, so what the
    // sheet includes is exactly what the two parts add up to.
    const periodTo = filter.asAtDate ?? null;
    const broughtForwardPaise = AccountingRepository.netProfitOf(
      this.getReportAccountRows({ businessId, toDate: AccountingRepository.dayBefore(year.startsOn) }),
    );
    const profitForYearPaise = AccountingRepository.netProfitOf(
      this.getReportAccountRows({
        businessId,
        fromDate: year.startsOn,
        ...(periodTo === null ? {} : { toDate: periodTo }),
      }),
    );
    return {
      totalPaise,
      split: {
        financialYearId: year.id,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        periodFrom: year.startsOn,
        periodTo,
        broughtForwardPaise,
        profitForYearPaise,
      },
      unsplitReason: null,
    };
  }

  public getGeneralLedger(filter: PeriodReportFilter = {}): readonly GeneralLedgerRow[] {
    const { where, params } = this.reportConditions(filter);
    const rows = this.db
      .prepare(
        `SELECT je.id AS journal_entry_id, je.source_id, je.source_type, je.created_at, je.entry_date,
                je.description, je.is_reversal, jl.account, jl.debit_paise, jl.credit_paise
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         ${where}
         ORDER BY je.entry_date, je.created_at, je.id, jl.id`,
      )
      .all(...params) as Array<{
      journal_entry_id: string;
      source_id: string;
      source_type: JournalSourceType;
      created_at: string;
      entry_date: string | null;
      description: string;
      is_reversal: number;
      account: AccountCode;
      debit_paise: number;
      credit_paise: number;
    }>;
    return rows.map((row) => ({
      journalEntryId: row.journal_entry_id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      postedAt: row.created_at,
      entryDate: row.entry_date ?? row.created_at.slice(0, 10),
      description: row.description,
      isReversal: row.is_reversal === 1,
      account: row.account,
      debitPaise: row.debit_paise,
      creditPaise: row.credit_paise,
    }));
  }

  // ---------------------------------------------------------------------------
  // R7b. `reports-sales.ts` and `reports-transactions.ts` were written, tested and then never
  // wired up: nothing outside their own tests imported them, so not one of these reports could
  // be reached from the running app. These methods are the door. They hold no logic of their
  // own on purpose - the measurement stays in one place, and this file does not become a
  // second definition of what a sale is.
  // ---------------------------------------------------------------------------

  /** Sales by customer, net of credit notes, keyed on entry_date. */
  public getSalesByCustomer(filter: SalesReportFilter = {}): SalesReport<SalesByCustomerRow> {
    return salesByCustomer(this.db, filter);
  }

  /** Sales by business, net of credit notes. */
  public getSalesByBusiness(filter: SalesReportFilter = {}): SalesReport<SalesByBusinessRow> {
    return salesByBusiness(this.db, filter);
  }

  /** Sales by project (fair), net of credit notes - the journal-anchored answer. */
  public getSalesByFairReport(filter: SalesReportFilter = {}): SalesReport<SalesByFairRow> {
    return salesByFair(this.db, filter);
  }

  /** Sales by GST treatment and rate, net of credit notes. */
  public getSalesByTax(filter: SalesReportFilter = {}): SalesReport<SalesByTaxRow> {
    return salesByTax(this.db, filter);
  }

  /** Credit notes with what each one still owes the customer. */
  public getCreditNoteReport(filter: CreditNoteReportFilter = {}): CreditNoteReport {
    return creditNoteReport(this.db, filter);
  }

  /** Sales returns, line by line and summarised by item. */
  public getSalesReturnReport(filter: CreditNoteReportFilter = {}): SalesReturnReport {
    return salesReturnReport(this.db, filter);
  }

  /** Every posted transaction in date order - the day book. */
  public getTransactionList(filter: TransactionReportFilter = {}): readonly TransactionListRow[] {
    return transactionListByDate(this.db, filter);
  }

  /** The same transactions grouped under the accounts they touched. */
  public getTransactionDetailByAccount(filter: TransactionReportFilter = {}): readonly TransactionDetailAccount[] {
    return transactionDetailByAccount(this.db, filter);
  }

  /** Stock movements with their source document. */
  public getStockMovementReport(filter: StockMovementFilter = {}): readonly StockMovementRow[] {
    return stockMovementReport(this.db, filter);
  }

  private insertJournalEntry(entry: JournalEntry, dimensions: { businessId: string; entryDate: string; fairId?: string }): void {
    postJournalEntry(this.db, entry, dimensions);
  }

  /**
   * What the invoice actually CHARGED before tax: lines, less the discount, plus any extra charge.
   * This - not the tax-inclusive total - is what a credit note's lines can be measured against,
   * because a note's lines are taxable amounts and its own GST is added on top of them.
   */
  private invoiceTaxableBase(invoice: Invoice): number {
    return invoice.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0)
      - (invoice.discountPaise ?? 0)
      + (invoice.extraChargePaise ?? 0);
  }

  private invoiceTotal(invoice: Invoice): number {
    const taxablePaise = this.invoiceTaxableBase(invoice);
    return taxablePaise + Math.round(taxablePaise * (invoice.taxRateBasisPoints ?? 0) / 10000);
  }

  /**
   * Output GST still OWED on this invoice - credits less debits, so the invoice's own charge less
   * whatever its credit notes have already given back. Optionally for one account.
   *
   * Journal-derived, so it is self-correcting: whatever was actually posted is what limits the
   * next note, with no second recomputation to drift out of step.
   */
  private outputTaxHeadroomPaise(invoiceId: string, account?: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.credit_paise), 0) - COALESCE(SUM(jl.debit_paise), 0) AS headroom
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE je.source_id = ? AND jl.account LIKE 'OUTPUT_%'
                ${account === undefined ? "" : "AND jl.account = ?"}`,
      )
      .get(...(account === undefined ? [invoiceId] : [invoiceId, account])) as { headroom: number };
    return row.headroom;
  }

  /**
   * The tax-inclusive value of every FINALIZED credit note on this invoice - what has been taken
   * back off the customer's bill, and so off what they still owe.
   *
   * Read from the POSTED journal, not recomputed from the note lines. Recomputing would disagree
   * with the ledger the moment a note's tax is clamped (see creditNoteTaxPaise), and the figure
   * that decides what a customer may still pay has to be the one actually on the books.
   * The `je-credit-note-inventory-%` entries also match the id prefix but never touch the
   * settlement account, so filtering on that account excludes them.
   */
  private invoiceCreditedPaise(invoice: Invoice): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.credit_paise) - SUM(jl.debit_paise), 0) AS credited
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE je.source_id = ? AND je.id LIKE 'je-credit-note-%' AND jl.account = ?`,
      )
      .get(invoice.id, invoice.paymentAccount) as { credited: number };
    return row.credited;
  }

  /**
   * The GST a credit note of `taxablePaise` should carry, CLAMPED so this invoice's notes can
   * never give back more tax than it charged.
   *
   * Without the clamp, per-note rounding over-credits: a 2 x 25 paise invoice at 18% charges 9
   * paise of GST (round(9.0)), but two notes of 25 each round to 5 (round(4.5) goes up), handing
   * back 10. That one paisa drove RECEIVABLES to -1 and left output SGST with a debit balance -
   * a negative liability - with no error at all.
   */
  private creditNoteTaxPaise(invoice: Invoice, taxablePaise: number): number {
    return this.creditNoteTaxLines(invoice, taxablePaise).reduce((sum, line) => sum + line.debitPaise, 0);
  }

  /** Taxable value of this invoice's FINALIZED credit notes (the note being posted is still a draft). */
  private creditedTaxablePaise(invoiceId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cnl.quantity * cnl.unit_price_paise), 0) AS taxable
           FROM credit_note_lines cnl JOIN credit_notes cn ON cn.id = cnl.credit_note_id
          WHERE cn.invoice_id = ? AND cn.status = 'FINALIZED'`,
      )
      .get(invoiceId) as { taxable: number };
    return row.taxable;
  }

  /**
   * The output-GST lines a credit note of `taxablePaise` should carry - the single place this is
   * decided, so validation and posting can never disagree.
   *
   * Each account is capped by what it still OWES on this invoice, which stops the per-note
   * floor/remainder split leaving one GST account negative and the other overstated.
   *
   * A note that completes the taxable base takes ALL the remaining headroom, so a full return
   * clears the invoice EXACTLY. Without that, rounding each note's share separately strands a
   * paisa or two: a 2 x 17 invoice at 18% charges 6, but two notes of 17 round to 3 each and the
   * per-account caps then allow only 5 of it, leaving the invoice 1 paisa short of settled.
   */
  private creditNoteTaxLines(invoice: Invoice, taxablePaise: number): Array<{ account: string; debitPaise: number; creditPaise: number }> {
    const wanted = Math.round(taxablePaise * (invoice.taxRateBasisPoints ?? 0) / 10000);
    const completesBase = this.creditedTaxablePaise(invoice.id) + taxablePaise >= this.invoiceTaxableBase(invoice);
    const capped = (account: string, want: number): number => {
      const room = this.outputTaxHeadroomPaise(invoice.id, account);
      return Math.max(0, Math.min(completesBase ? room : want, room));
    };
    const lines = invoice.taxType === "IGST"
      ? [{ account: "OUTPUT_IGST", debitPaise: capped("OUTPUT_IGST", wanted), creditPaise: 0 }]
      : invoice.taxType === "CGST_SGST"
        ? [
          { account: "OUTPUT_CGST", debitPaise: capped("OUTPUT_CGST", Math.floor(wanted / 2)), creditPaise: 0 },
          { account: "OUTPUT_SGST", debitPaise: capped("OUTPUT_SGST", wanted - Math.floor(wanted / 2)), creditPaise: 0 },
        ]
        : [];
    return lines.filter((line) => line.debitPaise > 0); // the door rejects a zero-amount line
  }

  /** What the customer still owes: the bill, less credit notes, less cash already received. */
  private invoiceOutstandingPaise(invoice: Invoice): number {
    return this.invoiceTotal(invoice) - this.invoiceCreditedPaise(invoice) - this.invoiceSettledPaise(invoice.id);
  }

  private validateCreditNoteLines(invoice: Invoice, lines: readonly CreditNoteLine[]): void {
    const sold = new Map<string, number>();
    for (const line of invoice.lines) {
      if (line.itemId !== undefined) sold.set(line.itemId, (sold.get(line.itemId) ?? 0) + line.quantity);
    }
    const returned = this.db.prepare(
      "SELECT cnl.item_id, SUM(cnl.quantity) AS quantity FROM credit_note_lines cnl JOIN credit_notes cn ON cn.id = cnl.credit_note_id WHERE cn.invoice_id = ? AND cn.status = 'FINALIZED' GROUP BY cnl.item_id",
    ).all(invoice.id) as Array<{ item_id: string | null; quantity: number }>;
    const alreadyReturned = new Map(returned.filter((row) => row.item_id !== null).map((row) => [row.item_id as string, row.quantity]));
    for (const line of lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0 || !Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
        throw new RepositoryValidationError("Credit note quantities and prices must be valid whole paise values.");
      }
      if (line.itemId !== undefined) {
        const available = (sold.get(line.itemId) ?? 0) - (alreadyReturned.get(line.itemId) ?? 0);
        if (line.quantity > available) {
          throw new RepositoryValidationError(`Credit note quantity exceeds the sold quantity for item ${line.itemId}.`);
        }
      }
    }
    const creditTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPricePaise, 0);
    const alreadyCredited = this.db.prepare(
      "SELECT COALESCE(SUM(cnl.quantity * cnl.unit_price_paise), 0) AS total FROM credit_note_lines cnl JOIN credit_notes cn ON cn.id = cnl.credit_note_id WHERE cn.invoice_id = ? AND cn.status = 'FINALIZED'",
    ).get(invoice.id) as { total: number };
    // DEFECT FIXED: this compared a TAXABLE credit sum against the TAX-INCLUSIVE invoice total,
    // so an 18% invoice could be over-credited by a further 18% - and the note's own GST was then
    // added on top of that. It also ignored the invoice discount, letting a note credit more than
    // was ever charged. Both sides are now the net taxable base.
    const taxableBase = this.invoiceTaxableBase(invoice);
    if (creditTotal + alreadyCredited.total > taxableBase) {
      throw new RepositoryValidationError(
        `Credit notes cannot exceed what the invoice charged before tax (${taxableBase} paise); this note would take the total credited to ${creditTotal + alreadyCredited.total} paise.`,
      );
    }
    // The cap against what is still UNPAID is GONE (S4-1, owner ruling 2026-11-17). It existed
    // only because crediting an already-paid invoice drove RECEIVABLES negative with no refund
    // path to settle it. A genuine return after payment is an ordinary business event, and it is
    // now representable: finalizeCreditNote splits the settlement credit, so whatever exceeds the
    // open balance becomes CUSTOMER_CREDITS - a liability - and receivables stop at zero.
    //
    // The cap above still stands and still matters: a note can never credit more than the
    // invoice CHARGED before tax, whatever has been paid.
  }

  private restoreCreditNoteStock(note: CreditNote, fairId: string | undefined): number {
    let totalCost = 0;
    for (const line of note.lines) {
      if (line.itemId === undefined || !this.isTrackedItem(line.itemId)) continue;
      const soldRows = this.db.prepare(
        "SELECT quantity_delta, unit_cost_paise FROM stock_movements WHERE source_id = ? AND item_id = ? AND movement_type = 'SALE' ORDER BY occurred_at, rowid",
      ).all(note.invoiceId, line.itemId) as Array<{ quantity_delta: number; unit_cost_paise: number }>;
      let remaining = line.quantity;
      for (const row of soldRows) {
        if (remaining === 0) break;
        const quantity = Math.min(remaining, Math.abs(row.quantity_delta));
        this.insertStockMovement({
          itemId: line.itemId,
          sourceId: note.id,
          movementType: "SALE_REVERSAL",
          quantityDelta: quantity,
          unitCostPaise: row.unit_cost_paise,
          ...fairDim(fairId),
        });
        totalCost += quantity * row.unit_cost_paise;
        remaining -= quantity;
      }
      if (remaining > 0) throw new RepositoryValidationError(`Credit note exceeds sold stock for item ${line.itemId}.`);
    }
    return totalCost;
  }

  private consumeInvoiceStock(invoice: Invoice): number {
    let totalCostPaise = 0;
    for (const line of invoice.lines) {
      if (line.itemId === undefined || !this.isTrackedItem(line.itemId)) {
        continue;
      }
      let remaining = line.quantity;
      const layers = this.getStockLayers(line.itemId);
      for (const layer of layers) {
        if (remaining === 0) break;
        const quantity = Math.min(remaining, layer.quantity);
        this.insertStockMovement({
          itemId: line.itemId,
          sourceId: invoice.id,
          movementType: "SALE",
          quantityDelta: -quantity,
          unitCostPaise: layer.unitCostPaise,
          ...fairDim(invoice.fairId),
        });
        totalCostPaise += quantity * layer.unitCostPaise;
        remaining -= quantity;
      }
      if (remaining > 0) {
        throw new RepositoryValidationError(`Insufficient stock for item ${line.itemId}.`);
      }
      this.insertAuditEvent({
        action: "stock.sale_consumed",
        entityId: invoice.id,
        occurredAt: new Date().toISOString(),
      });
    }
    return totalCostPaise;
  }

  private restoreInvoiceStock(invoiceId: string, fairId: string | undefined): number {
    const rows = this.db.prepare(
      "SELECT item_id, quantity_delta, unit_cost_paise FROM stock_movements WHERE source_id = ? AND movement_type = 'SALE'",
    ).all(invoiceId) as Array<{ item_id: string; quantity_delta: number; unit_cost_paise: number }>;
    let totalCostPaise = 0;
    for (const row of rows) {
      this.insertStockMovement({
        itemId: row.item_id,
        sourceId: invoiceId,
        movementType: "SALE_REVERSAL",
        quantityDelta: Math.abs(row.quantity_delta),
        unitCostPaise: row.unit_cost_paise,
        ...fairDim(fairId),
      });
      totalCostPaise += Math.abs(row.quantity_delta) * row.unit_cost_paise;
    }
    if (rows.length > 0) {
      this.insertAuditEvent({
        action: "stock.sale_reversed",
        entityId: invoiceId,
        occurredAt: new Date().toISOString(),
      });
    }
    return totalCostPaise;
  }

  /** The invoice's own date (plain YYYY-MM-DD), or today in IST when the nullable column is empty. */
  private invoiceEntryDate(invoiceId: string): string {
    const row = this.db.prepare("SELECT invoice_date FROM invoices WHERE id = ?").get(invoiceId) as { invoice_date: string | null } | undefined;
    return row?.invoice_date ?? istDateOf();
  }

  private inventoryJournalEntry(invoice: Invoice, costPaise: number, reversal: boolean): JournalEntry {
    return {
      id: reversal ? `je-inventory-${invoice.id}-reversal` : `je-inventory-${invoice.id}`,
      sourceId: invoice.id,
      description: reversal
        ? `Reversal of inventory cost for invoice ${invoice.number}`
        : `Inventory cost for invoice ${invoice.number}`,
      isReversal: reversal,
      lines: reversal
        ? [
            { account: "INVENTORY", debitPaise: costPaise, creditPaise: 0 },
            { account: "COGS", debitPaise: 0, creditPaise: costPaise },
          ]
        : [
            { account: "COGS", debitPaise: costPaise, creditPaise: 0 },
            { account: "INVENTORY", debitPaise: 0, creditPaise: costPaise },
          ],
    };
  }

  private isTrackedItem(itemId: string): boolean {
    const row = this.db.prepare("SELECT track_stock FROM items WHERE id = ?").get(itemId) as { track_stock: number } | undefined;
    return row?.track_stock === 1;
  }

  private getStockLayers(itemId: string): StockLayer[] {
    const rows = this.db.prepare(
      "SELECT source_id, movement_type, quantity_delta, unit_cost_paise FROM stock_movements WHERE item_id = ? ORDER BY occurred_at, rowid",
    ).all(itemId) as Array<{ source_id: string | null; movement_type: string; quantity_delta: number; unit_cost_paise: number }>;
    const layers: StockLayer[] = [];
    for (const row of rows) {
      if (row.quantity_delta > 0) {
        layers.push({ quantity: row.quantity_delta, unitCostPaise: row.unit_cost_paise, sourceId: row.source_id });
        continue;
      }
      let remaining = Math.abs(row.quantity_delta);
      if (row.movement_type === "PURCHASE_REVERSAL") {
        // Removes this purchase's own lot (same source and cost), never the oldest lot.
        for (const layer of layers) {
          if (remaining === 0) break;
          if (layer.sourceId !== row.source_id || layer.unitCostPaise !== row.unit_cost_paise) continue;
          const removed = Math.min(remaining, layer.quantity);
          layer.quantity -= removed;
          remaining -= removed;
        }
        for (let index = layers.length - 1; index >= 0; index -= 1) {
          if (layers[index]?.quantity === 0) layers.splice(index, 1);
        }
        continue;
      }
      while (remaining > 0 && layers.length > 0) {
        const layer = layers[0];
        if (layer === undefined) break;
        const consumed = Math.min(remaining, layer.quantity);
        layer.quantity -= consumed;
        remaining -= consumed;
        if (layer.quantity === 0) layers.shift();
      }
    }
    return layers;
  }

  private insertStockMovement(input: {
    itemId: string;
    sourceId: string;
    movementType: "SALE" | "SALE_REVERSAL" | "PURCHASE" | "PURCHASE_REVERSAL";
    quantityDelta: number;
    unitCostPaise: number;
    /** Reporting tag ONLY. Never read by getStockLayers or any cost/quantity calculation. */
    fairId?: string;
  }): void {
    if (input.fairId !== undefined) this.assertFairExists(input.fairId);
    this.db.prepare(
      "INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), input.itemId, input.sourceId, input.movementType, input.quantityDelta, input.unitCostPaise, new Date().toISOString(), input.fairId ?? null);
  }

  /**
   * What has SETTLED this invoice: cash received, plus any credit note set against it (S4-5).
   *
   * Deliberately not named for payments any more. An applied credit discharges the customer's
   * debt exactly as cash does, and every caller - the payment cap, the cancellation guard and the
   * split in finalizeCreditNote - means "how much of this bill is already dealt with". Counting
   * only the payments table let an invoice settled entirely by credit still be cancelled, which
   * would have reversed the whole invoice while the credit stood.
   */
  private invoiceSettledPaise(invoiceId: string): number {
    const paid = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE invoice_id = ?")
      .get(invoiceId) as { total: number };
    const applied = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM credit_note_applications WHERE invoice_id = ?")
      .get(invoiceId) as { total: number };
    return paid.total + applied.total;
  }

  private reportConditions(filter: { businessId?: string; fairId?: string; fromDate?: string; toDate?: string; asAtDate?: string }): { where: string; params: string[] } {
    return reportConditions(filter);
  }

  private getReportAccountRows(filter: { businessId?: string; fairId?: string; fromDate?: string; toDate?: string; asAtDate?: string } = {}): readonly ClassifiedReportAccountRow[] {
    const { where, params } = this.reportConditions(filter);
    const rows = this.db
      .prepare(
        // LEFT JOIN, deliberately not an inner one: an inner join would silently DROP a line whose
        // account is missing from the chart, which is the exact failure this slice exists to kill.
        // The FK and the v9 trigger make it impossible, so if it ever happens we want to hear it.
        `SELECT jl.account AS account, ca.type AS type, ca.role AS role,
                SUM(jl.debit_paise) AS debit_paise, SUM(jl.credit_paise) AS credit_paise
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         LEFT JOIN chart_accounts ca ON ca.code = jl.account
         ${where}
         GROUP BY jl.account ORDER BY jl.account`,
      )
      .all(...params) as Array<{
      account: string;
      type: AccountType | null;
      role: AccountRole | null;
      debit_paise: number;
      credit_paise: number;
    }>;
    return rows.map((row) => {
      if (row.type === null) {
        throw new AccountingError(
          `Account "${row.account}" has journal lines but no row in chart_accounts, so no report can classify it.`,
        );
      }
      return {
        account: row.account,
        type: row.type,
        role: row.role,
        debitPaise: row.debit_paise,
        creditPaise: row.credit_paise,
        balancePaise: row.debit_paise - row.credit_paise,
      };
    });
  }

  /** The classification of every account, for the places that work from codes rather than rows. */
  private accountClasses(): ReadonlyMap<string, { type: AccountType; role: AccountRole | null }> {
    const rows = this.db.prepare("SELECT code, type, role FROM chart_accounts").all() as Array<{
      code: string; type: AccountType; role: AccountRole | null;
    }>;
    return new Map(rows.map((r) => [r.code, { type: r.type, role: r.role }]));
  }

  /**
   * Which side an account's balance naturally sits on, DERIVED from its class and never chosen
   * (S2-1). Income, liabilities and equity are credit-normal; assets and expenses debit-normal.
   */
  private static creditNormal(type: AccountType): boolean {
    return type === "INCOME" || type === "LIABILITY" || type === "EQUITY";
  }

  public createRecurringInvoiceTemplate(input: RecurringInvoiceTemplateInput): RecurringInvoiceTemplate {
    const id = input.id ?? randomUUID();
    const intervalCount = input.intervalCount ?? 1;
    const nextRunDate = input.nextRunDate ?? input.startDate;
    const taxType = input.taxType ?? "NONE";
    const taxRateBasisPoints = input.taxRateBasisPoints ?? 0;
    const discountPaise = input.discountPaise ?? 0;
    const extraChargePaise = input.extraChargePaise ?? 0;

    if (!["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].includes(input.frequency)) {
      throw new RepositoryValidationError("Frequency must be WEEKLY, MONTHLY, QUARTERLY or YEARLY.");
    }
    if (!Number.isInteger(intervalCount) || intervalCount < 1) {
      throw new RepositoryValidationError("Interval must be a positive whole number.");
    }
    for (const [label, value] of [["Start date", input.startDate], ["Next run date", nextRunDate], ["End date", input.endDate]] as const) {
      if (value !== undefined && !isValidIsoDate(value)) {
        throw new RepositoryValidationError(`${label} must be a valid YYYY-MM-DD date.`);
      }
    }
    if (nextRunDate < input.startDate) {
      throw new RepositoryValidationError("Next run date cannot be before the start date.");
    }
    if (input.endDate !== undefined && input.endDate < nextRunDate) {
      throw new RepositoryValidationError("End date cannot be before the first run date.");
    }
    if (input.lines.length === 0) {
      throw new RepositoryValidationError("A recurring template needs at least one line.");
    }
    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new RepositoryValidationError("Line quantities must be positive whole numbers.");
      }
      if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
        throw new RepositoryValidationError("Unit prices must be non-negative whole paise.");
      }
      if (line.description.trim().length === 0) {
        throw new RepositoryValidationError("Every line needs a description.");
      }
    }
    if (!Number.isInteger(discountPaise) || discountPaise < 0 || !Number.isInteger(extraChargePaise) || extraChargePaise < 0) {
      throw new RepositoryValidationError("Discount and extra charge must be non-negative whole paise.");
    }
    const subtotal = input.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0);
    if (discountPaise > subtotal) {
      throw new RepositoryValidationError("Discount cannot exceed the invoice subtotal.");
    }
    if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
      throw new RepositoryValidationError("Tax rate must be a whole number between 0% and 100%.");
    }
    if (taxType === "NONE" && taxRateBasisPoints !== 0) {
      throw new RepositoryValidationError("A tax rate requires a tax type.");
    }
    if (taxType !== "NONE" && taxRateBasisPoints === 0) {
      throw new RepositoryValidationError("Tax rate must be positive for a taxable invoice.");
    }

    const createdAt = new Date().toISOString();
    this.db.transaction(() => {
      // Reuse the invoice reference checks (business/customer/fair/items belong together).
      this.validateInvoiceReferences({
        id,
        number: "template-check",
        businessId: input.businessId,
        customerId: input.customerId,
        ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
        paymentAccount: input.paymentAccount,
        status: "DRAFT",
        lines: input.lines,
      });
      this.db.prepare(
        "INSERT INTO recurring_invoice_templates (id, business_id, customer_id, fair_id, buyer_name, buyer_contact, payment_account, tax_type, tax_rate_basis_points, discount_paise, extra_charge_paise, notes, payment_terms, frequency, interval_count, start_date, next_run_date, end_date, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
      ).run(
        id, input.businessId, input.customerId, input.fairId ?? null, input.buyerName ?? null,
        input.buyerContact ?? null, input.paymentAccount, taxType, taxRateBasisPoints,
        discountPaise, extraChargePaise, input.notes ?? null, input.paymentTerms ?? null,
        input.frequency, intervalCount, input.startDate, nextRunDate, input.endDate ?? null, createdAt,
      );
      const lineStatement = this.db.prepare(
        "INSERT INTO recurring_invoice_template_lines (template_id, item_id, description, quantity, unit_price_paise) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of input.lines) {
        lineStatement.run(id, line.itemId ?? null, line.description, line.quantity, line.unitPricePaise);
      }
      this.insertAuditEvent({ action: "recurring_template.created", entityId: id, occurredAt: createdAt });
    })();
    return this.getRecurringInvoiceTemplate(id);
  }

  public listRecurringInvoiceTemplates(filter: { businessId?: string; active?: boolean } = {}): readonly RecurringInvoiceTemplate[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filter.businessId !== undefined) {
      conditions.push("business_id = ?");
      params.push(filter.businessId);
    }
    if (filter.active !== undefined) {
      conditions.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db
      .prepare(`SELECT * FROM recurring_invoice_templates ${where} ORDER BY next_run_date, id`)
      .all(...params) as RecurringTemplateRow[];
    return rows.map((row) => this.mapRecurringTemplate(row));
  }

  public getRecurringInvoiceTemplate(templateId: string): RecurringInvoiceTemplate {
    const row = this.db
      .prepare("SELECT * FROM recurring_invoice_templates WHERE id = ?")
      .get(templateId) as RecurringTemplateRow | undefined;
    if (row === undefined) {
      throw new RepositoryValidationError(`Recurring template ${templateId} was not found.`);
    }
    return this.mapRecurringTemplate(row);
  }

  public updateRecurringInvoiceTemplate(templateId: string, update: RecurringInvoiceTemplateUpdate): RecurringInvoiceTemplate {
    const current = this.getRecurringInvoiceTemplate(templateId);
    const nextRunDate = update.nextRunDate ?? current.nextRunDate;
    const active = update.active ?? current.active;
    if (update.nextRunDate !== undefined) {
      if (!isValidIsoDate(update.nextRunDate)) {
        throw new RepositoryValidationError("Next run date must be a valid YYYY-MM-DD date.");
      }
      if (update.nextRunDate < current.startDate) {
        throw new RepositoryValidationError("Next run date cannot be before the start date.");
      }
    }
    if (active && current.endDate !== undefined && nextRunDate > current.endDate) {
      throw new RepositoryValidationError("The next run date is after the end date, so the template cannot be active.");
    }
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE recurring_invoice_templates SET next_run_date = ?, active = ? WHERE id = ?")
        .run(nextRunDate, active ? 1 : 0, templateId);
      this.insertAuditEvent({ action: "recurring_template.updated", entityId: templateId, occurredAt: new Date().toISOString() });
    })();
    return this.getRecurringInvoiceTemplate(templateId);
  }

  public deactivateRecurringInvoiceTemplate(templateId: string): RecurringInvoiceTemplate {
    this.getRecurringInvoiceTemplate(templateId);
    this.db.transaction(() => {
      this.db.prepare("UPDATE recurring_invoice_templates SET active = 0 WHERE id = ?").run(templateId);
      this.insertAuditEvent({ action: "recurring_template.deactivated", entityId: templateId, occurredAt: new Date().toISOString() });
    })();
    return this.getRecurringInvoiceTemplate(templateId);
  }

  public getUpcomingRecurringInvoices(): readonly UpcomingRecurringInvoiceRow[] {
    return this.listRecurringInvoiceTemplates({ active: true }).map((template) => {
      const customer = this.db
        .prepare("SELECT name FROM customers WHERE id = ?")
        .get(template.customerId) as { name: string } | undefined;
      return {
        templateId: template.id,
        businessId: template.businessId,
        customerId: template.customerId,
        customerName: customer?.name ?? "",
        frequency: template.frequency,
        intervalCount: template.intervalCount,
        nextRunDate: template.nextRunDate,
        endDate: template.endDate ?? null,
        totalPaise: templateTotalPaise(template),
      };
    });
  }

  /**
   * Creates a DRAFT invoice for every period that is due (nextRunDate <= asOfDate)
   * on each active template, and advances nextRunDate in the same transaction as
   * the draft insert so a period can never be generated twice. Drafts are never
   * finalized here; the user reviews and finalizes them through the normal flow.
   */
  public generateDueInvoices(asOfDate: string = new Date().toISOString().slice(0, 10)): GenerateDueInvoicesResult {
    if (!isValidIsoDate(asOfDate)) {
      throw new RepositoryValidationError("As-of date must be a valid YYYY-MM-DD date.");
    }
    const dueIds = (this.db
      .prepare("SELECT id FROM recurring_invoice_templates WHERE active = 1 AND next_run_date <= ? ORDER BY next_run_date, id")
      .all(asOfDate) as Array<{ id: string }>).map((row) => row.id);
    const invoices: Invoice[] = [];
    const failures: GenerationFailure[] = [];
    for (const templateId of dueIds) {
      try {
        invoices.push(...this.db.transaction(() => this.generateForTemplate(templateId, asOfDate))());
      } catch (error) {
        failures.push({ templateId, error: error instanceof Error ? error.message : "Generation failed." });
      }
    }
    return { asOfDate, invoices, failures };
  }

  private generateForTemplate(templateId: string, asOfDate: string): Invoice[] {
    const template = this.getRecurringInvoiceTemplate(templateId);
    const created: Invoice[] = [];
    let runDate = template.nextRunDate;
    let active = template.active;
    while (active && runDate <= asOfDate && created.length < MAX_DRAFTS_PER_TEMPLATE_PER_RUN) {
      const invoice: Invoice = {
        id: randomUUID(),
        number: `REC-${template.id.slice(0, 8)}-${runDate}`,
        businessId: template.businessId,
        customerId: template.customerId,
        invoiceDate: runDate,
        discountPaise: template.discountPaise,
        extraChargePaise: template.extraChargePaise,
        ...(template.notes === undefined ? {} : { notes: template.notes }),
        ...(template.paymentTerms === undefined ? {} : { paymentTerms: template.paymentTerms }),
        taxType: template.taxType,
        taxRateBasisPoints: template.taxRateBasisPoints,
        ...(template.fairId === undefined ? {} : { fairId: template.fairId }),
        ...(template.buyerName === undefined ? {} : { buyerName: template.buyerName }),
        ...(template.buyerContact === undefined ? {} : { buyerContact: template.buyerContact }),
        paymentAccount: template.paymentAccount,
        status: "DRAFT",
        lines: template.lines,
      };
      this.saveDraft(invoice);
      this.insertAuditEvent({ action: "invoice.generated_from_template", entityId: invoice.id, occurredAt: new Date().toISOString() });
      created.push(this.getInvoice(invoice.id));
      runDate = advanceRunDate(runDate, template.frequency, template.intervalCount, template.startDate);
      if (template.endDate !== undefined && runDate > template.endDate) {
        active = false;
      }
    }
    this.db
      .prepare("UPDATE recurring_invoice_templates SET next_run_date = ?, active = ? WHERE id = ?")
      .run(runDate, active ? 1 : 0, templateId);
    if (created.length > 0) {
      this.insertAuditEvent({ action: "recurring_template.generated", entityId: templateId, occurredAt: new Date().toISOString() });
    }
    return created;
  }

  private mapRecurringTemplate(row: RecurringTemplateRow): RecurringInvoiceTemplate {
    const lines = this.db
      .prepare("SELECT item_id, description, quantity, unit_price_paise FROM recurring_invoice_template_lines WHERE template_id = ? ORDER BY id")
      .all(row.id) as InvoiceLineRow[];
    return {
      id: row.id,
      businessId: row.business_id,
      customerId: row.customer_id,
      ...(row.fair_id === null ? {} : { fairId: row.fair_id }),
      ...(row.buyer_name === null ? {} : { buyerName: row.buyer_name }),
      ...(row.buyer_contact === null ? {} : { buyerContact: row.buyer_contact }),
      paymentAccount: row.payment_account,
      taxType: row.tax_type,
      taxRateBasisPoints: row.tax_rate_basis_points,
      discountPaise: row.discount_paise,
      extraChargePaise: row.extra_charge_paise,
      ...(row.notes === null ? {} : { notes: row.notes }),
      ...(row.payment_terms === null ? {} : { paymentTerms: row.payment_terms }),
      frequency: row.frequency,
      intervalCount: row.interval_count,
      startDate: row.start_date,
      nextRunDate: row.next_run_date,
      ...(row.end_date === null ? {} : { endDate: row.end_date }),
      active: row.active === 1,
      createdAt: row.created_at,
      lines: lines.map((line): InvoiceLine => ({
        ...(line.item_id === null ? {} : { itemId: line.item_id }),
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unit_price_paise,
      })),
    };
  }

  private requireCompany(companyId: string): void {
    const company = this.db
      .prepare("SELECT 1 FROM companies WHERE id = ?")
      .get(companyId);
    if (company === undefined) {
      throw new RepositoryValidationError(`Company ${companyId} was not found.`);
    }
  }

  private validateInvoiceReferences(invoice: Invoice): void {
    const business = this.db
      .prepare("SELECT company_id FROM businesses WHERE id = ?")
      .get(invoice.businessId) as { company_id: string } | undefined;
    if (business === undefined) {
      throw new RepositoryValidationError(`Business ${invoice.businessId} was not found.`);
    }

    const customer = this.db
      .prepare("SELECT company_id FROM customers WHERE id = ?")
      .get(invoice.customerId) as { company_id: string } | undefined;
    if (customer === undefined) {
      throw new RepositoryValidationError(`Customer ${invoice.customerId} was not found.`);
    }
    if (business.company_id !== customer.company_id) {
      throw new RepositoryValidationError(
        "Invoice business and customer must belong to the same company.",
      );
    }

    if (invoice.fairId !== undefined) {
      const fair = this.db
        .prepare("SELECT company_id, host_customer_id FROM fairs WHERE id = ?")
        .get(invoice.fairId) as { company_id: string; host_customer_id: string } | undefined;
      if (fair === undefined) {
        throw new RepositoryValidationError(`Fair ${invoice.fairId} was not found.`);
      }
      if (fair.company_id !== business.company_id) {
        throw new RepositoryValidationError("Invoice fair must belong to the same company as the business.");
      }
      if (fair.host_customer_id !== invoice.customerId) {
        throw new RepositoryValidationError("Invoice customer must be the fair host customer.");
      }
    }

    const itemStatement = this.db.prepare(
      "SELECT company_id FROM items WHERE id = ?",
    );
    for (const line of invoice.lines) {
      if (line.itemId === undefined) {
        continue;
      }
      const item = itemStatement.get(line.itemId) as { company_id: string } | undefined;
      if (item === undefined) {
        throw new RepositoryValidationError(`Item ${line.itemId} was not found.`);
      }
      if (item.company_id !== business.company_id) {
        throw new RepositoryValidationError(
          "Invoice items must belong to the same company as the business.",
        );
      }
    }
  }

  // ---------------------------------------------------------------- purchasing & expenses (Slice 6)
  //
  // Purchase bills and expenses are ALWAYS recognised on an ACCRUAL basis at finalize, whatever
  // the company's stored accounting_basis (that is a report-level default only).
  // Inventory ties to the GL for BILL-SOURCED stock only:
  // stock added through addStockMovement (OPENING/ADJUSTMENT) posts no GL.

  /** Runs pure accounting code and surfaces its errors as validation errors (HTTP 400). */
  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof AccountingError) throw new RepositoryValidationError(error.message);
      throw error;
    }
  }

  /** A fair, when named, must be a non-empty id of an existing fair. */
  private assertFairExists(fairId: string): void {
    if (typeof fairId !== "string" || fairId.trim() === "") {
      throw new RepositoryValidationError("A project (fair) id cannot be empty.");
    }
    if (this.db.prepare("SELECT 1 FROM fairs WHERE id = ?").get(fairId) === undefined) {
      throw new RepositoryValidationError(`Fair ${fairId} was not found.`);
    }
  }

  /** Purchase documents: the fair must belong to the same company as the document's business. */
  private assertDocumentFair(fairId: string | undefined, companyId: string, label: string): void {
    if (fairId === undefined) return;
    this.assertFairExists(fairId);
    const fair = this.db.prepare("SELECT company_id FROM fairs WHERE id = ?").get(fairId) as { company_id: string };
    if (fair.company_id !== companyId) {
      throw new RepositoryValidationError(`${label} fair must belong to the same company as the business.`);
    }
  }

  private requireBusinessCompany(businessId: string): { companyId: string } {
    const row = this.db
      .prepare("SELECT company_id FROM businesses WHERE id = ?")
      .get(businessId) as { company_id: string } | undefined;
    if (row === undefined) throw new RepositoryValidationError(`Business ${businessId} was not found.`);
    return { companyId: row.company_id };
  }

  private requireSupplier(supplierId: string): { companyId: string; name: string } {
    const row = this.db.prepare("SELECT company_id, name FROM suppliers WHERE id = ?").get(supplierId) as
      { company_id: string; name: string } | undefined;
    if (row === undefined) throw new RepositoryValidationError(`Supplier ${supplierId} was not found.`);
    return { companyId: row.company_id, name: row.name };
  }

  private assertIsoDate(label: string, value: string): void {
    if (!isValidIsoDate(value)) throw new RepositoryValidationError(`${label} must be a real date written as YYYY-MM-DD.`);
  }

  // ---- suppliers

  public createSupplier(input: SupplierInput): string {
    this.requireCompany(input.companyId);
    this.validateClassification(input.classification);
    if (input.name.trim() === "") throw new RepositoryValidationError("Supplier name cannot be empty.");
    const id = input.id ?? randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO suppliers (id, company_id, name, email, phone, phone2, classification, gstin, website,
             billing_address, shipping_address, internal_notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, input.companyId, input.name, input.email ?? null, input.phone ?? null, input.phone2 ?? null,
          input.classification ?? null, input.gstin ?? null, input.website ?? null, input.billingAddress ?? null,
          input.shippingAddress ?? null, input.internalNotes ?? null, new Date().toISOString(),
        );
      this.insertAuditEvent({ action: "supplier.created", entityId: id, occurredAt: new Date().toISOString() });
    })();
    return id;
  }

  public updateSupplier(supplierId: string, patch: SupplierPatch): void {
    this.requireSupplier(supplierId);
    this.validateClassification(patch.classification);
    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new RepositoryValidationError("Supplier name cannot be empty.");
    }
    const columns: Array<[string, string | null | undefined]> = [
      ["name", patch.name], ["email", patch.email], ["phone", patch.phone], ["phone2", patch.phone2],
      ["classification", patch.classification], ["gstin", patch.gstin], ["website", patch.website],
      ["billing_address", patch.billingAddress], ["shipping_address", patch.shippingAddress],
      ["internal_notes", patch.internalNotes],
    ];
    const changed = columns.filter(([, value]) => value !== undefined);
    if (changed.length === 0) return;
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE suppliers SET ${changed.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .run(...changed.map(([, value]) => value as string | null), supplierId);
      this.insertAuditEvent({ action: "supplier.updated", entityId: supplierId, occurredAt: new Date().toISOString() });
    })();
  }

  public setSupplierActive(supplierId: string, active: boolean): void {
    this.requireSupplier(supplierId);
    this.db.transaction(() => {
      this.db.prepare("UPDATE suppliers SET active = ? WHERE id = ?").run(active ? 1 : 0, supplierId);
      this.insertAuditEvent({
        action: active ? "supplier.activated" : "supplier.deactivated",
        entityId: supplierId,
        occurredAt: new Date().toISOString(),
      });
    })();
  }

  public listSuppliers(companyId?: string, options: { activeOnly?: boolean } = {}): readonly SupplierRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (companyId !== undefined) { conditions.push("company_id = ?"); params.push(companyId); }
    if (options.activeOnly === true) conditions.push("active = 1");
    const rows = this.db
      .prepare(
        `SELECT id, company_id, name, email, phone, phone2, classification, gstin, website, billing_address,
                shipping_address, internal_notes, active FROM suppliers
         ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`} ORDER BY name, rowid`,
      )
      .all(...params) as Array<{
      id: string; company_id: string; name: string; email: string | null; phone: string | null; phone2: string | null;
      classification: string | null; gstin: string | null; website: string | null; billing_address: string | null;
      shipping_address: string | null; internal_notes: string | null; active: number;
    }>;
    return rows.map((row) => ({
      id: row.id, companyId: row.company_id, name: row.name, email: row.email, phone: row.phone, phone2: row.phone2,
      classification: row.classification, gstin: row.gstin, website: row.website, billingAddress: row.billing_address,
      shippingAddress: row.shipping_address, internalNotes: row.internal_notes, active: row.active === 1,
    }));
  }

  // ---- expense categories

  public createExpenseCategory(input: { id?: string; companyId: string; name: string }): string {
    this.requireCompany(input.companyId);
    const name = input.name.trim();
    if (name === "") throw new RepositoryValidationError("Expense category name cannot be empty.");
    const duplicate = this.db
      .prepare("SELECT 1 FROM expense_categories WHERE company_id = ? AND LOWER(name) = LOWER(?)")
      .get(input.companyId, name);
    if (duplicate !== undefined) throw new RepositoryValidationError(`Expense category "${name}" already exists.`);
    const id = input.id ?? randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO expense_categories (id, company_id, name, created_at) VALUES (?, ?, ?, ?)")
        .run(id, input.companyId, name, new Date().toISOString());
      this.insertAuditEvent({ action: "expense_category.created", entityId: id, occurredAt: new Date().toISOString() });
    })();
    return id;
  }

  public listExpenseCategories(companyId?: string): readonly ExpenseCategoryRecord[] {
    const statement = companyId === undefined
      ? this.db.prepare("SELECT id, company_id, name, active FROM expense_categories ORDER BY name, rowid")
      : this.db.prepare("SELECT id, company_id, name, active FROM expense_categories WHERE company_id = ? ORDER BY name, rowid");
    const rows = (companyId === undefined ? statement.all() : statement.all(companyId)) as Array<{
      id: string; company_id: string; name: string; active: number;
    }>;
    return rows.map((row) => ({ id: row.id, companyId: row.company_id, name: row.name, active: row.active === 1 }));
  }

  // ---- purchase bills

  public createPurchaseBill(input: PurchaseBillInput): PurchaseBillRecord {
    const id = input.id ?? randomUUID();
    const taxType = input.taxType ?? "NONE";
    const rate = input.taxRateBasisPoints ?? 0;
    this.db.transaction(() => {
      const business = this.requireBusinessCompany(input.businessId);
      const supplier = this.requireSupplier(input.supplierId);
      if (supplier.companyId !== business.companyId) {
        throw new RepositoryValidationError("The supplier must belong to the same company as the business.");
      }
      if (input.number.trim() === "") throw new RepositoryValidationError("Bill number cannot be empty.");
      this.assertIsoDate("Bill date", input.billDate);
      if (input.dueDate !== undefined) {
        this.assertIsoDate("Due date", input.dueDate);
        if (input.dueDate < input.billDate) throw new RepositoryValidationError("Due date cannot be before the bill date.");
      }
      this.assertDocumentFair(input.fairId, business.companyId, "Bill");
      this.guard(() => validatePurchaseTax(taxType, rate));
      if (input.lines.length === 0) throw new RepositoryValidationError("A purchase bill must contain at least one line.");
      let subtotal = 0;
      for (const line of input.lines) {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
          throw new RepositoryValidationError("Bill quantities must be positive whole numbers.");
        }
        if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
          throw new RepositoryValidationError("Bill unit prices must be non-negative whole paise.");
        }
        if (line.description.trim() === "") throw new RepositoryValidationError("Bill line description cannot be empty.");
        subtotal += line.quantity * line.unitPricePaise;
        if (line.itemId !== undefined) {
          const item = this.db.prepare("SELECT company_id FROM items WHERE id = ?").get(line.itemId) as
            { company_id: string } | undefined;
          if (item === undefined) throw new RepositoryValidationError(`Item ${line.itemId} was not found.`);
          if (item.company_id !== business.companyId) {
            throw new RepositoryValidationError("Bill items must belong to the same company as the business.");
          }
        }
      }
      if (subtotal <= 0) throw new RepositoryValidationError("A purchase bill must have a total above zero.");
      this.db
        .prepare(
          `INSERT INTO purchase_bills (id, business_id, supplier_id, number, supplier_invoice_number, bill_date, due_date,
             notes, tax_type, tax_rate_basis_points, payment_account, status, created_at, fair_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
        )
        .run(
          id, input.businessId, input.supplierId, input.number, input.supplierInvoiceNumber ?? null, input.billDate,
          input.dueDate ?? null, input.notes ?? null, taxType, rate, input.paymentAccount, new Date().toISOString(),
          input.fairId ?? null,
        );
      const lineStatement = this.db.prepare(
        "INSERT INTO purchase_bill_lines (bill_id, item_id, description, quantity, unit_price_paise) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of input.lines) {
        lineStatement.run(id, line.itemId ?? null, line.description, line.quantity, line.unitPricePaise);
      }
      this.insertAuditEvent({ action: "purchase_bill.created", entityId: id, occurredAt: new Date().toISOString() });
    })();
    return this.getPurchaseBill(id);
  }

  public getPurchaseBill(billId: string): PurchaseBillRecord {
    const row = this.db.prepare("SELECT * FROM purchase_bills WHERE id = ?").get(billId) as {
      id: string; business_id: string; supplier_id: string; number: string; supplier_invoice_number: string | null;
      bill_date: string; due_date: string | null; notes: string | null; tax_type: InvoiceTaxType;
      tax_rate_basis_points: number; payment_account: PurchasePaymentAccount; status: PurchaseDocumentStatus;
      fair_id: string | null;
    } | undefined;
    if (row === undefined) throw new RepositoryValidationError(`Purchase bill ${billId} was not found.`);
    const lineRows = this.db
      .prepare("SELECT item_id, description, quantity, unit_price_paise FROM purchase_bill_lines WHERE bill_id = ? ORDER BY id")
      .all(billId) as InvoiceLineRow[];
    const lines = lineRows.map((line): PurchaseBillLine => ({
      ...(line.item_id === null ? {} : { itemId: line.item_id }),
      description: line.description,
      quantity: line.quantity,
      unitPricePaise: line.unit_price_paise,
    }));
    const subtotalPaise = lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0);
    const taxPaise = row.tax_type === "NONE" ? 0 : Math.round(subtotalPaise * row.tax_rate_basis_points / 10000);
    const paid = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM supplier_payments WHERE bill_id = ?")
      .get(billId) as { paid: number };
    return {
      id: row.id, businessId: row.business_id, supplierId: row.supplier_id, number: row.number,
      supplierInvoiceNumber: row.supplier_invoice_number, billDate: row.bill_date, dueDate: row.due_date,
      notes: row.notes, taxType: row.tax_type, taxRateBasisPoints: row.tax_rate_basis_points,
      paymentAccount: row.payment_account, status: row.status, lines,
      ...(row.fair_id === null ? {} : { fairId: row.fair_id }),
      subtotalPaise, taxPaise, totalPaise: subtotalPaise + taxPaise, paidPaise: paid.paid,
    };
  }

  public listPurchaseBills(filter: { businessId?: string; supplierId?: string; status?: PurchaseDocumentStatus } = {}): readonly PurchaseBillRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.businessId !== undefined) { conditions.push("business_id = ?"); params.push(filter.businessId); }
    if (filter.supplierId !== undefined) { conditions.push("supplier_id = ?"); params.push(filter.supplierId); }
    if (filter.status !== undefined) { conditions.push("status = ?"); params.push(filter.status); }
    const ids = this.db
      .prepare(`SELECT id FROM purchase_bills ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`} ORDER BY created_at, rowid`)
      .all(...params) as Array<{ id: string }>;
    return ids.map((row) => this.getPurchaseBill(row.id));
  }

  public finalizePurchaseBill(billId: string): JournalEntry {
    return this.db.transaction(() => {
      const bill = this.getPurchaseBill(billId);
      if (bill.status !== "DRAFT") throw new RepositoryValidationError("Only draft purchase bills can be finalized.");
      this.requireBusinessCompany(bill.businessId);
      let inventoryPaise = 0;
      let expensePaise = 0;
      for (const line of bill.lines) {
        const amount = line.quantity * line.unitPricePaise;
        if (line.itemId !== undefined && this.isTrackedItem(line.itemId)) {
          inventoryPaise += amount;
          this.insertStockMovement({
            itemId: line.itemId, sourceId: bill.id, movementType: "PURCHASE",
            quantityDelta: line.quantity, unitCostPaise: line.unitPricePaise, ...fairDim(bill.fairId),
          });
        } else {
          expensePaise += amount;
        }
      }
      const result = this.guard(() => purchaseEntry({
        entryId: `je-bill-${bill.id}`,
        sourceId: bill.id,
        sourceType: "PURCHASE_BILL",
        description: `Purchase bill ${bill.number}`,
        inventoryPaise,
        expensePaise,
        taxType: bill.taxType,
        taxRateBasisPoints: bill.taxRateBasisPoints,
        paymentAccount: bill.paymentAccount,
      }));
      this.insertJournalEntry(result.entry, { businessId: bill.businessId, entryDate: bill.billDate, ...fairDim(bill.fairId) });
      this.db.prepare("UPDATE purchase_bills SET status = 'FINALIZED' WHERE id = ?").run(bill.id);
      this.insertAuditEvent({ action: "purchase_bill.finalized", entityId: bill.id, occurredAt: new Date().toISOString() });
      return result.entry;
    })();
  }

  public cancelPurchaseBill(billId: string): JournalEntry {
    return this.db.transaction(() => {
      const bill = this.getPurchaseBill(billId);
      if (bill.status !== "FINALIZED") throw new RepositoryValidationError("Only finalized purchase bills can be cancelled.");
      if (bill.paidPaise > 0) {
        throw new RepositoryValidationError("A purchase bill with recorded supplier payments cannot be cancelled.");
      }
      // A finalized bill always has its accrual finalize entry to reverse.
      const original = this.getSourceJournalEntry(bill.id, "PURCHASE_BILL");
      // Per-lot check: this bill's OWN remaining layers (by source) must still cover what it bought.
      const purchased = this.db
        .prepare(
          "SELECT item_id, quantity_delta, unit_cost_paise FROM stock_movements WHERE source_id = ? AND movement_type = 'PURCHASE' ORDER BY rowid",
        )
        .all(bill.id) as Array<{ item_id: string; quantity_delta: number; unit_cost_paise: number }>;
      const needed = new Map<string, { itemId: string; unitCostPaise: number; quantity: number }>();
      for (const row of purchased) {
        const key = `${row.item_id}|${row.unit_cost_paise}`;
        const entry = needed.get(key) ?? { itemId: row.item_id, unitCostPaise: row.unit_cost_paise, quantity: 0 };
        entry.quantity += row.quantity_delta;
        needed.set(key, entry);
      }
      for (const entry of needed.values()) {
        const remaining = this.getStockLayers(entry.itemId)
          .filter((layer) => layer.sourceId === bill.id && layer.unitCostPaise === entry.unitCostPaise)
          .reduce((total, layer) => total + layer.quantity, 0);
        if (remaining < entry.quantity) {
          throw new RepositoryValidationError(
            "Part of the stock from this bill has already been sold, so the bill cannot be cancelled.",
          );
        }
      }
      for (const row of purchased) {
        this.insertStockMovement({
          itemId: row.item_id, sourceId: bill.id, movementType: "PURCHASE_REVERSAL",
          quantityDelta: -row.quantity_delta, unitCostPaise: row.unit_cost_paise, ...fairDim(bill.fairId),
        });
      }
      const reversal = this.guard(() => reverseEntry(original, `je-bill-${bill.id}-reversal`, `Cancellation of purchase bill ${bill.number}`));
      this.insertJournalEntry(reversal, { businessId: bill.businessId, entryDate: istDateOf(), ...fairDim(bill.fairId) });
      this.db.prepare("UPDATE purchase_bills SET status = 'CANCELLED' WHERE id = ?").run(bill.id);
      this.insertAuditEvent({ action: "purchase_bill.cancelled", entityId: bill.id, occurredAt: new Date().toISOString() });
      return reversal;
    })();
  }

  private getSourceJournalEntry(sourceId: string, sourceType: JournalSourceType): JournalEntry {
    const entry = this.findSourceJournalEntry(sourceId, sourceType);
    if (entry === undefined) throw new RepositoryValidationError(`Original journal entry for ${sourceId} was not found.`);
    return entry;
  }

  /** Like getSourceJournalEntry, but returns undefined when nothing was posted. */
  private findSourceJournalEntry(sourceId: string, sourceType: JournalSourceType): JournalEntry | undefined {
    const row = this.db
      .prepare(
        "SELECT id, source_id, description, is_reversal FROM journal_entries WHERE source_id = ? AND source_type = ? AND is_reversal = 0",
      )
      .get(sourceId, sourceType) as JournalEntryRow | undefined;
    return row === undefined ? undefined : { ...this.getJournalEntry(row), sourceType };
  }

  // ---- expenses

  public createExpense(input: ExpenseInput): ExpenseRecord {
    const id = input.id ?? randomUUID();
    const taxType = input.taxType ?? "NONE";
    const rate = input.taxRateBasisPoints ?? 0;
    this.db.transaction(() => {
      const business = this.requireBusinessCompany(input.businessId);
      if (input.number.trim() === "") throw new RepositoryValidationError("Expense number cannot be empty.");
      if (input.description.trim() === "") throw new RepositoryValidationError("Expense description cannot be empty.");
      this.assertIsoDate("Expense date", input.expenseDate);
      if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
        throw new RepositoryValidationError("Expense amount must be a positive whole number of paise.");
      }
      this.assertDocumentFair(input.fairId, business.companyId, "Expense");
      this.guard(() => validatePurchaseTax(taxType, rate));
      if (input.supplierId !== undefined) {
        if (this.requireSupplier(input.supplierId).companyId !== business.companyId) {
          throw new RepositoryValidationError("The supplier must belong to the same company as the business.");
        }
      } else if (input.paymentAccount === "PAYABLES") {
        throw new RepositoryValidationError("An expense payable later must name a supplier.");
      }
      if (input.categoryId !== undefined) {
        const category = this.db.prepare("SELECT company_id FROM expense_categories WHERE id = ?").get(input.categoryId) as
          { company_id: string } | undefined;
        if (category === undefined) throw new RepositoryValidationError(`Expense category ${input.categoryId} was not found.`);
        if (category.company_id !== business.companyId) {
          throw new RepositoryValidationError("The expense category must belong to the same company as the business.");
        }
      }
      this.db
        .prepare(
          `INSERT INTO expenses (id, business_id, supplier_id, category_id, number, expense_date, description, amount_paise,
             tax_type, tax_rate_basis_points, payment_account, status, created_at, fair_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
        )
        .run(
          id, input.businessId, input.supplierId ?? null, input.categoryId ?? null, input.number, input.expenseDate,
          input.description, input.amountPaise, taxType, rate, input.paymentAccount, new Date().toISOString(),
          input.fairId ?? null,
        );
      this.insertAuditEvent({ action: "expense.created", entityId: id, occurredAt: new Date().toISOString() });
    })();
    return this.getExpense(id);
  }

  public getExpense(expenseId: string): ExpenseRecord {
    const row = this.db.prepare("SELECT * FROM expenses WHERE id = ?").get(expenseId) as {
      id: string; business_id: string; supplier_id: string | null; category_id: string | null; number: string;
      expense_date: string; description: string; amount_paise: number; tax_type: InvoiceTaxType;
      tax_rate_basis_points: number; payment_account: PurchasePaymentAccount; status: PurchaseDocumentStatus;
      fair_id: string | null;
    } | undefined;
    if (row === undefined) throw new RepositoryValidationError(`Expense ${expenseId} was not found.`);
    const taxPaise = row.tax_type === "NONE" ? 0 : Math.round(row.amount_paise * row.tax_rate_basis_points / 10000);
    const paid = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM supplier_payments WHERE expense_id = ?")
      .get(expenseId) as { paid: number };
    return {
      id: row.id, businessId: row.business_id, supplierId: row.supplier_id, categoryId: row.category_id,
      number: row.number, expenseDate: row.expense_date, description: row.description, amountPaise: row.amount_paise,
      taxType: row.tax_type, taxRateBasisPoints: row.tax_rate_basis_points, paymentAccount: row.payment_account,
      status: row.status, taxPaise, totalPaise: row.amount_paise + taxPaise, paidPaise: paid.paid,
      ...(row.fair_id === null ? {} : { fairId: row.fair_id }),
    };
  }

  public listExpenses(filter: { businessId?: string; supplierId?: string; status?: PurchaseDocumentStatus } = {}): readonly ExpenseRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.businessId !== undefined) { conditions.push("business_id = ?"); params.push(filter.businessId); }
    if (filter.supplierId !== undefined) { conditions.push("supplier_id = ?"); params.push(filter.supplierId); }
    if (filter.status !== undefined) { conditions.push("status = ?"); params.push(filter.status); }
    const ids = this.db
      .prepare(`SELECT id FROM expenses ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`} ORDER BY created_at, rowid`)
      .all(...params) as Array<{ id: string }>;
    return ids.map((row) => this.getExpense(row.id));
  }

  public finalizeExpense(expenseId: string): JournalEntry {
    return this.db.transaction(() => {
      const expense = this.getExpense(expenseId);
      if (expense.status !== "DRAFT") throw new RepositoryValidationError("Only draft expenses can be finalized.");
      const result = this.guard(() => purchaseEntry({
        entryId: `je-expense-${expense.id}`,
        sourceId: expense.id,
        sourceType: "EXPENSE",
        description: `Expense ${expense.number}`,
        inventoryPaise: 0,
        expensePaise: expense.amountPaise,
        taxType: expense.taxType,
        taxRateBasisPoints: expense.taxRateBasisPoints,
        paymentAccount: expense.paymentAccount,
      }));
      this.insertJournalEntry(result.entry, { businessId: expense.businessId, entryDate: expense.expenseDate, ...fairDim(expense.fairId) });
      this.db.prepare("UPDATE expenses SET status = 'FINALIZED' WHERE id = ?").run(expense.id);
      this.insertAuditEvent({ action: "expense.finalized", entityId: expense.id, occurredAt: new Date().toISOString() });
      return result.entry;
    })();
  }

  public cancelExpense(expenseId: string): JournalEntry {
    return this.db.transaction(() => {
      const expense = this.getExpense(expenseId);
      if (expense.status !== "FINALIZED") throw new RepositoryValidationError("Only finalized expenses can be cancelled.");
      if (expense.paidPaise > 0) {
        throw new RepositoryValidationError("An expense with recorded supplier payments cannot be cancelled.");
      }
      const original = this.getSourceJournalEntry(expense.id, "EXPENSE");
      const reversal = this.guard(() => reverseEntry(original, `je-expense-${expense.id}-reversal`, `Cancellation of expense ${expense.number}`));
      this.insertJournalEntry(reversal, { businessId: expense.businessId, entryDate: istDateOf(), ...fairDim(expense.fairId) });
      this.db.prepare("UPDATE expenses SET status = 'CANCELLED' WHERE id = ?").run(expense.id);
      this.insertAuditEvent({ action: "expense.cancelled", entityId: expense.id, occurredAt: new Date().toISOString() });
      return reversal;
    })();
  }

  // ---- supplier payments

  public recordSupplierPayment(input: SupplierPaymentInput): SupplierPayment {
    return this.db.transaction(() => {
      const paidAt = this.paymentInstant(input.paidOn);
      if ((input.billId === undefined) === (input.expenseId === undefined)) {
        throw new RepositoryValidationError("Provide exactly one of billId or expenseId.");
      }
      if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
        throw new RepositoryValidationError("Payment amount must be a positive whole number of paise.");
      }
      const doc = input.billId !== undefined
        ? (() => {
            const bill = this.getPurchaseBill(input.billId);
            return { businessId: bill.businessId, fairId: bill.fairId, number: bill.number, supplierId: bill.supplierId as string | null, status: bill.status, paymentAccount: bill.paymentAccount, totalPaise: bill.totalPaise, paidPaise: bill.paidPaise, subtotalPaise: bill.subtotalPaise, taxType: bill.taxType, taxRateBasisPoints: bill.taxRateBasisPoints };
          })()
        : (() => {
            const expense = this.getExpense(input.expenseId as string);
            return { businessId: expense.businessId, fairId: expense.fairId, number: expense.number, supplierId: expense.supplierId, status: expense.status, paymentAccount: expense.paymentAccount, totalPaise: expense.totalPaise, paidPaise: expense.paidPaise, subtotalPaise: expense.amountPaise, taxType: expense.taxType, taxRateBasisPoints: expense.taxRateBasisPoints };
          })();
      if (doc.status !== "FINALIZED") throw new RepositoryValidationError("Only finalized documents can receive supplier payments.");
      if (doc.paymentAccount !== "PAYABLES") throw new RepositoryValidationError("Only documents payable later can receive supplier payments.");
      if (doc.supplierId === null) throw new RepositoryValidationError("The document has no supplier to pay.");
      if (input.amountPaise > doc.totalPaise - doc.paidPaise) {
        throw new RepositoryValidationError("Payment cannot exceed the outstanding balance.");
      }
      const sourceId = (input.billId ?? input.expenseId) as string;
      const payment: SupplierPayment = {
        id: randomUUID(),
        supplierId: doc.supplierId,
        billId: input.billId ?? null,
        expenseId: input.expenseId ?? null,
        amountPaise: input.amountPaise,
        paymentAccount: "CASH",
        paidAt,
      };
      this.db
        .prepare("INSERT INTO supplier_payments (id, supplier_id, bill_id, expense_id, amount_paise, payment_account, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(payment.id, payment.supplierId, payment.billId, payment.expenseId, payment.amountPaise, payment.paymentAccount, payment.paidAt);
      // Payments only move PAYABLES -> CASH; a finalized document always has its accrual entry.
      this.getSourceJournalEntry(sourceId, input.billId !== undefined ? "PURCHASE_BILL" : "EXPENSE");
      this.insertJournalEntry(this.guard(() => supplierPaymentEntry({
        entryId: `je-supplier-payment-${payment.id}`,
        sourceId,
        description: `Supplier payment for ${doc.number}`,
        amountPaise: payment.amountPaise,
      })), { businessId: doc.businessId, entryDate: istDateOf(payment.paidAt), ...fairDim(doc.fairId) });
      this.insertAuditEvent({ action: "supplier.payment_made", entityId: sourceId, occurredAt: new Date().toISOString() });
      return payment;
    })();
  }

  public listSupplierPayments(filter: { billId?: string; expenseId?: string; supplierId?: string } = {}): readonly SupplierPayment[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.billId !== undefined) { conditions.push("bill_id = ?"); params.push(filter.billId); }
    if (filter.expenseId !== undefined) { conditions.push("expense_id = ?"); params.push(filter.expenseId); }
    if (filter.supplierId !== undefined) { conditions.push("supplier_id = ?"); params.push(filter.supplierId); }
    const rows = this.db
      .prepare(
        `SELECT id, supplier_id, bill_id, expense_id, amount_paise, payment_account, paid_at FROM supplier_payments
         ${conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`} ORDER BY paid_at, rowid`,
      )
      .all(...params) as Array<{
      id: string; supplier_id: string; bill_id: string | null; expense_id: string | null; amount_paise: number;
      payment_account: "CASH"; paid_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id, supplierId: row.supplier_id, billId: row.bill_id, expenseId: row.expense_id,
      amountPaise: row.amount_paise, paymentAccount: row.payment_account, paidAt: row.paid_at,
    }));
  }

  // ---- purchasing reports

  /** R7b: took no filters and aged against the wall clock, exactly as getReceivables did. */
  public getPayables(filter: { businessId?: string; supplierId?: string; asAtDate?: string } = {}): readonly PayableRow[] {
    // The supplier mirror of getReceivables: reshapes the shared open-items rows.
    const now = Date.parse(`${this.asAtOrToday(filter.asAtDate)}T00:00:00.000Z`);
    return this.openSupplierItemRows({
      ...(filter.businessId === undefined ? {} : { businessId: filter.businessId }),
      ...(filter.supplierId === undefined ? {} : { supplierId: filter.supplierId }),
    }).map((item) => ({
      documentType: item.kind,
      documentId: item.documentId,
      documentNumber: item.number,
      supplierId: item.supplierId,
      documentDate: item.date,
      totalPaise: item.totalPaise,
      paidPaise: item.settledPaise,
      outstandingPaise: item.outstandingPaise,
      ageDays: Math.max(0, Math.floor((now - Date.parse(`${item.date}T00:00:00.000Z`)) / 86400000)),
    }));
  }

  public getSupplierStatement(supplierId: string): SupplierStatement {
    const supplier = this.requireSupplier(supplierId);
    const items: Array<Omit<SupplierStatementRow, "balancePaise"> & { order: number }> = [];
    for (const bill of this.listPurchaseBills({ supplierId, status: "FINALIZED" })) {
      if (bill.paymentAccount !== "PAYABLES") continue;
      items.push({ date: bill.billDate, type: "BILL", documentId: bill.id, reference: bill.number, amountPaise: bill.totalPaise, order: 0 });
    }
    for (const expense of this.listExpenses({ supplierId, status: "FINALIZED" })) {
      if (expense.paymentAccount !== "PAYABLES") continue;
      items.push({ date: expense.expenseDate, type: "EXPENSE", documentId: expense.id, reference: expense.number, amountPaise: expense.totalPaise, order: 0 });
    }
    for (const payment of this.listSupplierPayments({ supplierId })) {
      const documentId = (payment.billId ?? payment.expenseId) as string;
      const reference = payment.billId !== null ? this.getPurchaseBill(payment.billId).number : this.getExpense(documentId).number;
      items.push({ date: payment.paidAt, type: "PAYMENT", documentId, reference, amountPaise: -payment.amountPaise, order: 1 });
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
    let balance = 0;
    const rows = items.map(({ order: _order, ...item }) => {
      balance += item.amountPaise;
      return { ...item, balancePaise: balance };
    });
    return { supplierId, supplierName: supplier.name, rows, closingBalancePaise: balance };
  }

  // ---------------------------------------------------------------- auth

  public isAdminConfigured(): boolean {
    return this.db.prepare("SELECT 1 AS x FROM auth_users LIMIT 1").get() !== undefined;
  }

  public getAuthStatus(nowIso = new Date().toISOString()): { configured: boolean; locked: boolean; lockedUntil?: string } {
    const user = this.getAdminRow();
    if (user === undefined) return { configured: false, locked: false };
    if (isLocked(user.locked_until, nowIso)) {
      return { configured: true, locked: true, lockedUntil: user.locked_until as string };
    }
    return { configured: true, locked: false };
  }

  /**
   * Creates the one admin account and fixes its recovery code (S6-3).
   *
   * The raw code is returned HERE AND NOWHERE ELSE — only its hash is stored, and
   * it is deliberately kept out of the audit event, because an audit row the owner
   * can read is not a secret. If it is not written down at this moment it cannot be
   * recovered, only replaced by `mintRecoveryCode` from a signed-in session.
   */
  public setupAdmin(input: { password: string; email?: string; googleSub?: string; nowIso?: string }): {
    userId: string;
    recoveryCode: string;
  } {
    if (this.isAdminConfigured()) throw new RepositoryValidationError("An admin account already exists.");
    this.assertPasswordPolicy(input.password);
    const now = input.nowIso ?? new Date().toISOString();
    const userId = randomUUID();
    const recoveryCode = generateRecoveryCode();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO auth_users (id, role, email, google_sub, password_hash, recovery_code_hash, created_at, updated_at) VALUES (?, 'ADMIN', ?, ?, ?, ?, ?, ?)",
        )
        .run(
          userId,
          input.email ?? null,
          input.googleSub ?? null,
          hashPassword(input.password),
          hashToken(normaliseRecoveryCode(recoveryCode)),
          now,
          now,
        );
      // Exactly one audit event, as before. Adding a second here would shift every
      // audit-chain sequence assertion in the suite.
      this.insertAuditEvent({ action: "auth.admin_created", entityId: userId, occurredAt: now });
    })();
    return { userId, recoveryCode };
  }

  /**
   * Issues a fresh recovery code for a signed-in admin, replacing any previous one.
   *
   * This is the only way a database set up BEFORE v16 can get a code at all, since
   * its `recovery_code_hash` is NULL and no code for it was ever shown to anyone.
   *
   * It demands the current password as well as a valid session, exactly as
   * `changePassword` does, so that a stolen token alone cannot mint a credential
   * that outlives the session it was stolen from.
   */
  public mintRecoveryCode(input: { token: string; currentPassword: string; nowIso?: string }): {
    recoveryCode: string;
  } {
    const now = input.nowIso ?? new Date().toISOString();
    const session = this.validateSession(input.token, now);
    if (session === null) throw new AuthenticationError("Your session has expired. Please sign in again.", 401);
    const user = this.getAdminRow();
    if (user === undefined || user.id !== session.userId) {
      throw new AuthenticationError("Your session has expired. Please sign in again.", 401);
    }
    if (!verifyPassword(input.currentPassword, user.password_hash as string)) {
      throw new AuthenticationError("Incorrect password.", 401);
    }
    const recoveryCode = generateRecoveryCode();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE auth_users SET recovery_code_hash = ?, updated_at = ? WHERE id = ?")
        .run(hashToken(normaliseRecoveryCode(recoveryCode)), now, user.id);
      this.insertAuditEvent({ action: "auth.recovery_code_issued", entityId: user.id as string, occurredAt: now });
    })();
    return { recoveryCode };
  }

  public login(password: string, nowIso = new Date().toISOString()): { token: string; sessionId: string; expiresAt: string } {
    const user = this.getAdminRow();
    if (user === undefined) throw new AuthenticationError("No admin account is set up yet.", 409);
    if (isLocked(user.locked_until, nowIso)) {
      const minutes = Math.max(1, Math.ceil((Date.parse(user.locked_until as string) - Date.parse(nowIso)) / 60_000));
      this.insertAuditEvent({ action: "auth.login_blocked_locked", entityId: user.id, occurredAt: nowIso });
      throw new AuthenticationError(`Account is locked. Try again in ${minutes} minute(s).`, 423);
    }
    // A lock that has run out starts a fresh set of attempts.
    let attempts = user.failed_attempts;
    if (user.locked_until !== null) attempts = 0;

    if (!verifyPassword(password, user.password_hash)) {
      attempts += 1;
      const locks = attempts >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = locks ? new Date(Date.parse(nowIso) + LOCKOUT_MS).toISOString() : null;
      this.db.transaction(() => {
        this.db
          .prepare("UPDATE auth_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?")
          .run(attempts, lockedUntil, nowIso, user.id);
        if (locks) this.insertAuditEvent({ action: "auth.account_locked", entityId: user.id, occurredAt: nowIso });
        this.insertAuditEvent({ action: "auth.login_failed", entityId: user.id, occurredAt: nowIso });
      })();
      if (locks) {
        throw new AuthenticationError(
          `Incorrect password. Account locked for ${LOCKOUT_MS / 60_000} minutes after ${MAX_FAILED_ATTEMPTS} failed attempts.`,
          423,
        );
      }
      throw new AuthenticationError(
        `Incorrect password. ${MAX_FAILED_ATTEMPTS - attempts} attempt(s) remaining before the account locks.`,
        401,
      );
    }

    const token = generateSessionToken();
    const sessionId = randomUUID();
    const expiresAt = sessionExpiryIso(nowIso);
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE auth_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
        .run(nowIso, user.id);
      this.db
        .prepare(
          "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(sessionId, user.id, hashToken(token), nowIso, nowIso, expiresAt);
      this.insertAuditEvent({ action: "auth.login_succeeded", entityId: user.id, occurredAt: nowIso });
    })();
    return { token, sessionId, expiresAt };
  }

  /** Returns the session owner and rolls the idle window forward, or null if missing/revoked/idle-expired. */
  public validateSession(token: string, nowIso = new Date().toISOString()): { userId: string; role: string } | null {
    const row = this.db
      .prepare(
        `SELECT s.id AS id, s.user_id AS user_id, s.last_seen_at AS last_seen_at, s.revoked_at AS revoked_at, u.role AS role
         FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(hashToken(token)) as
      | { id: string; user_id: string; last_seen_at: string; revoked_at: string | null; role: string }
      | undefined;
    if (row === undefined || row.revoked_at !== null) return null;
    if (isSessionExpired(row.last_seen_at, nowIso)) {
      this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?").run(nowIso, row.id);
      return null;
    }
    this.db
      .prepare("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .run(nowIso, sessionExpiryIso(nowIso), row.id);
    return { userId: row.user_id, role: row.role };
  }

  public logout(token: string, nowIso = new Date().toISOString()): void {
    const row = this.db
      .prepare("SELECT id, user_id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL")
      .get(hashToken(token)) as { id: string; user_id: string } | undefined;
    if (row === undefined) return;
    this.db.transaction(() => {
      this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?").run(nowIso, row.id);
      this.insertAuditEvent({ action: "auth.logout", entityId: row.user_id, occurredAt: nowIso });
    })();
  }

  public changePassword(input: { token: string; currentPassword: string; newPassword: string; nowIso?: string }): void {
    const now = input.nowIso ?? new Date().toISOString();
    const session = this.validateSession(input.token, now);
    if (session === null) throw new AuthenticationError("Your session has expired. Please sign in again.", 401);
    const user = this.getAdminRow();
    if (user === undefined || user.id !== session.userId) {
      throw new AuthenticationError("Your session has expired. Please sign in again.", 401);
    }
    if (!verifyPassword(input.currentPassword, user.password_hash)) {
      throw new RepositoryValidationError("Current password is incorrect.");
    }
    this.assertPasswordPolicy(input.newPassword);
    const newHash = hashPassword(input.newPassword);
    this.db.transaction(() => {
      this.db.prepare("UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?").run(newHash, now, user.id);
      this.db
        .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?")
        .run(now, user.id, hashToken(input.token));
      this.insertAuditEvent({ action: "auth.password_changed", entityId: user.id, occurredAt: now });
    })();
  }

  /**
   * TRUST BOUNDARY: this method TRUSTS that the caller has ALREADY verified the
   * Google identity out-of-band. It only matches the supplied googleSub/email to
   * the stored identity; it performs no OAuth or network call. Live Google token
   * verification needs network + the frontend and is DEFERRED to the later UI
   * slice. Until then the /auth/recover route must not be exposed beyond localhost.
   */
  /**
   * Resets a forgotten admin password against the recovery code (S6-3).
   *
   * This endpoint is reachable WITHOUT a session — it has to be, or it could not
   * help the one person it exists for — so the code is the entire trust boundary.
   * The old behaviour, resetting on a bare `email` or `google_sub` match with no
   * secret at all, is gone: anyone who knew the owner's email address could take
   * the books over.
   *
   * A row whose `recovery_code_hash` is NULL REFUSES. That is an admin created
   * before v16, for whom no code was ever shown to anyone; falling back to the old
   * match for those rows would leave the hole open on exactly the database that
   * matters. Such an owner signs in and calls `mintRecoveryCode` instead.
   *
   * Using the code BURNS it: a new one is issued in the same transaction as the
   * reset and returned once, so a code read over someone's shoulder cannot be
   * replayed, and the owner is never left without a way back in.
   */
  public recoverPassword(input: { recoveryCode: string; newPassword: string; nowIso?: string }): {
    recoveryCode: string;
  } {
    const now = input.nowIso ?? new Date().toISOString();
    const user = this.getAdminRow();
    if (user === undefined) throw new AuthenticationError("No admin account is set up yet.", 409);
    const storedHash = user.recovery_code_hash as string | null;
    if (storedHash === null || storedHash === undefined) {
      throw new AuthenticationError(
        "This workspace has no recovery code. Sign in and create one before you need it.",
        409,
      );
    }
    if (hashToken(normaliseRecoveryCode(input.recoveryCode)) !== storedHash) {
      throw new AuthenticationError("That recovery code is not correct.", 401);
    }
    this.assertPasswordPolicy(input.newPassword);
    const newHash = hashPassword(input.newPassword);
    const recoveryCode = generateRecoveryCode();
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE auth_users SET password_hash = ?, recovery_code_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
        )
        .run(newHash, hashToken(normaliseRecoveryCode(recoveryCode)), now, user.id);
      this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, user.id);
      this.insertAuditEvent({ action: "auth.password_recovered", entityId: user.id, occurredAt: now });
    })();
    return { recoveryCode };
  }

  private getAdminRow(): AuthUserRow | undefined {
    return this.db
      .prepare(
        "SELECT id, email, google_sub, password_hash, failed_attempts, locked_until, recovery_code_hash FROM auth_users ORDER BY created_at, rowid LIMIT 1",
      )
      .get() as AuthUserRow | undefined;
  }

  private assertPasswordPolicy(password: string): void {
    const problem = passwordPolicyProblem(password);
    if (problem !== null) throw new RepositoryValidationError(problem);
  }

  private insertAuditEvent(event: AuditEvent): void {
    appendAuditEvent(this.db, event);
  }

  // ---------------------------------------------------------------------------
  // Financial years and the period lock (CLAUDE_FINISHING_PLAN.md section 19).
  // The lock is ENFORCED in the posting door (ledger.ts), which is the only writer of journal
  // entries. These methods only define the periods and flip their state.
  // ---------------------------------------------------------------------------

  public listFinancialYears(businessId: string): readonly FinancialYear[] {
    const rows = this.db
      .prepare(
        "SELECT id, business_id, starts_on, ends_on, status, locked_at FROM financial_years WHERE business_id = ? ORDER BY starts_on",
      )
      .all(businessId) as Array<{
      id: string; business_id: string; starts_on: string; ends_on: string;
      status: "OPEN" | "LOCKED"; locked_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      status: row.status,
      lockedAt: row.locked_at,
    }));
  }

  public createFinancialYear(input: { businessId: string; startsOn: string; endsOn: string; id?: string }): string {
    this.requireBusiness(input.businessId);
    for (const [label, date] of [["start", input.startsOn], ["end", input.endsOn]] as const) {
      if (!isValidIsoDate(date)) {
        throw new RepositoryValidationError(`A financial year ${label} date must be a real date written as YYYY-MM-DD.`);
      }
    }
    if (input.endsOn < input.startsOn) {
      throw new RepositoryValidationError("A financial year cannot end before it starts.");
    }
    // Overlapping years would make "which year is this date in" ambiguous, and the lock with it.
    const clash = this.db
      .prepare(
        `SELECT starts_on, ends_on FROM financial_years
          WHERE business_id = ? AND starts_on <= ? AND ends_on >= ? LIMIT 1`,
      )
      .get(input.businessId, input.endsOn, input.startsOn) as { starts_on: string; ends_on: string } | undefined;
    if (clash !== undefined) {
      throw new RepositoryValidationError(
        `That period overlaps the financial year ${clash.starts_on} to ${clash.ends_on}.`,
      );
    }
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO financial_years (id, business_id, starts_on, ends_on, status, locked_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPEN', NULL, ?, ?)",
        )
        .run(id, input.businessId, input.startsOn, input.endsOn, now, now);
      appendAuditEvent(this.db, {
        action: "FINANCIAL_YEAR_CREATED",
        entityId: id,
        entityType: "financial_year",
        occurredAt: now,
        afterValues: { businessId: input.businessId, startsOn: input.startsOn, endsOn: input.endsOn, status: "OPEN" },
      });
    })();
    return id;
  }

  /**
   * Locks or reopens a year. Reopening is deliberately POSSIBLE but loudly audited: section 19
   * wants corrections to need controlled permissions, and phase 1 has exactly one Admin, so the
   * honest implementation is an audited reopen rather than a door that cannot be opened at all.
   */
  public setFinancialYearLocked(id: string, locked: boolean, reason?: string): void {
    const year = this.db
      .prepare("SELECT id, business_id, starts_on, ends_on, status FROM financial_years WHERE id = ?")
      .get(id) as { id: string; business_id: string; starts_on: string; ends_on: string; status: "OPEN" | "LOCKED" } | undefined;
    if (year === undefined) throw new RepositoryValidationError(`Financial year ${id} was not found.`);
    const wanted = locked ? "LOCKED" : "OPEN";
    if (year.status === wanted) return;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE financial_years SET status = ?, locked_at = ?, updated_at = ? WHERE id = ?")
        .run(wanted, locked ? now : null, now, id);
      appendAuditEvent(this.db, {
        action: locked ? "FINANCIAL_YEAR_LOCKED" : "FINANCIAL_YEAR_REOPENED",
        entityId: id,
        entityType: "financial_year",
        occurredAt: now,
        ...(reason === undefined ? {} : { reason }),
        beforeValues: { status: year.status },
        afterValues: { status: wanted, startsOn: year.starts_on, endsOn: year.ends_on },
      });
    })();
  }

  /** True when this business could post an entry dated `date` - i.e. no locked year covers it. */
  public isPeriodOpen(businessId: string, date: string): boolean {
    try {
      assertPeriodOpen(this.db, businessId, date);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Opening balances (R4a, section 14). ONE journal entry dated asAt, posted through the one door,
  // with OPENING_BALANCE_EQUITY as the plug. Corrected by reversal only.
  // ---------------------------------------------------------------------------

  public saveOpeningBalances(input: {
    id: string;
    businessId: string;
    asAt: string;
    lines: readonly OpeningBalanceLineInput[];
  }): string {
    const { companyId } = this.requireBusinessCompany(input.businessId);
    this.assertIsoDate("The opening balance date", input.asAt);
    if (input.lines.length === 0) {
      throw new RepositoryValidationError("Opening balances need at least one line.");
    }
    const classify = this.db.prepare("SELECT code, company_id, role, active FROM chart_accounts WHERE code = ?");
    for (const line of input.lines) {
      if (!Number.isInteger(line.debitPaise) || !Number.isInteger(line.creditPaise) || line.debitPaise < 0 || line.creditPaise < 0) {
        throw new RepositoryValidationError(`Opening balance for ${line.account} must be a non-negative whole number of paise.`);
      }
      if ((line.debitPaise > 0) === (line.creditPaise > 0)) {
        throw new RepositoryValidationError(`Opening balance for ${line.account} must have exactly one of debit or credit above zero.`);
      }
      if (line.account === OPENING_BALANCE_EQUITY_CODE) {
        throw new RepositoryValidationError(
          "Opening Balance Equity cannot be typed in: it is the plug the system fills in to balance the other lines.",
        );
      }
      // Role comes from the CHART by lookup, never from a list of codes.
      const account = classify.get(line.account) as
        | { code: string; company_id: string | null; role: AccountRole | null; active: number }
        | undefined;
      if (account === undefined) {
        throw new RepositoryValidationError(`Account ${line.account} does not exist in the chart of accounts.`);
      }
      if (account.active === 0) {
        throw new RepositoryValidationError(`Account ${line.account} is not active. Reactivate it, or pick another account.`);
      }
      if (account.company_id !== null && account.company_id !== companyId) {
        throw new RepositoryValidationError(`Account ${line.account} belongs to another company.`);
      }
      if (account.role !== null && (OPENING_CONTROL_ROLES as readonly string[]).includes(account.role)) {
        throw new RepositoryValidationError(
          `Account ${line.account} cannot be opened here: its balance comes from its own sub-ledger (opening customer balances, supplier balances or stock). Entering it here would leave the ledger out of step with that sub-ledger.`,
        );
      }
    }
    if (this.db.prepare("SELECT 1 FROM opening_balances WHERE id = ?").get(input.id) !== undefined) {
      throw new RepositoryValidationError(`Opening balance set ${input.id} already exists.`);
    }
    const live = this.db
      .prepare("SELECT id FROM opening_balances WHERE business_id = ? AND reversed_at IS NULL")
      .get(input.businessId) as { id: string } | undefined;
    if (live !== undefined) {
      throw new RepositoryValidationError(
        `This business already has opening balances (${live.id}). Reverse them first, then enter the corrected set.`,
      );
    }

    const debitTotal = input.lines.reduce((total, line) => total + line.debitPaise, 0);
    const creditTotal = input.lines.reduce((total, line) => total + line.creditPaise, 0);
    const gap = debitTotal - creditTotal; // > 0: debits exceed credits, so the plug is a credit
    const plug: JournalEntry["lines"] =
      gap === 0
        ? []
        : [{ account: OPENING_BALANCE_EQUITY_CODE, debitPaise: gap < 0 ? -gap : 0, creditPaise: gap > 0 ? gap : 0 }];

    const journalEntryId = `je-opening-balance-${input.id}`;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      // sourceType: a type of its own, so the cash view keys it as its own "document" and it can
      // never be mistaken for an invoice (the default). OPENING_BALANCE is now a member of
      // JournalSourceType. NOTE: the cash view does not visit this source type at all - it walks
      // invoices, bills and expenses - so opening INCOME is currently DROPPED from the cash P&L,
      // not passed through on the opening date. Pinned in opening-balances.test.ts; honouring
      // S5-2 (income only where opening Sales sit behind a receivable) needs the walk extended.
      this.insertJournalEntry(
        {
          id: journalEntryId,
          sourceId: input.id,
          sourceType: "OPENING_BALANCE",
          description: `Opening balances as at ${input.asAt}`,
          isReversal: false,
          lines: [...input.lines.map((l) => ({ account: l.account, debitPaise: l.debitPaise, creditPaise: l.creditPaise })), ...plug],
        },
        { businessId: input.businessId, entryDate: input.asAt },
      );
      this.db
        .prepare("INSERT INTO opening_balances (id, business_id, as_at, journal_entry_id, reversed_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)")
        .run(input.id, input.businessId, input.asAt, journalEntryId, now);
      const insertLine = this.db.prepare(
        "INSERT INTO opening_balance_lines (id, opening_balance_id, account, debit_paise, credit_paise) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of input.lines) insertLine.run(randomUUID(), input.id, line.account, line.debitPaise, line.creditPaise);
      appendAuditEvent(this.db, {
        action: "OPENING_BALANCES_SAVED",
        entityId: input.id,
        entityType: "opening_balances",
        occurredAt: now,
        afterValues: {
          businessId: input.businessId,
          asAt: input.asAt,
          lines: input.lines.length,
          debitPaise: debitTotal,
          creditPaise: creditTotal,
          balancingPaise: Math.abs(gap),
        },
      });
    })();
    return input.id;
  }

  /** Posts the negation of the set's entry, dated `reversedOn`. The original is never touched. */
  public reverseOpeningBalances(input: { id: string; reversedOn: string }): JournalEntry {
    const header = this.db
      .prepare("SELECT id, business_id, as_at, journal_entry_id, reversed_at FROM opening_balances WHERE id = ?")
      .get(input.id) as
      | { id: string; business_id: string; as_at: string; journal_entry_id: string; reversed_at: string | null }
      | undefined;
    if (header === undefined) throw new RepositoryValidationError(`Opening balance set ${input.id} was not found.`);
    if (header.reversed_at !== null) {
      throw new RepositoryValidationError(`Opening balance set ${input.id} has already been reversed on ${header.reversed_at}.`);
    }
    this.assertIsoDate("The reversal date", input.reversedOn);
    if (input.reversedOn < header.as_at) {
      throw new RepositoryValidationError(`The reversal date cannot be before the opening balance date ${header.as_at}.`);
    }
    return this.db.transaction(() => {
      const lines = this.db
        .prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
        .all(header.journal_entry_id) as Array<{ account: string; debit_paise: number; credit_paise: number }>;
      const reversal: JournalEntry = {
        id: `je-opening-balance-reversal-${header.id}`,
        sourceId: header.id,
        sourceType: "OPENING_BALANCE",
        description: `Reversal of opening balances as at ${header.as_at}`,
        isReversal: true,
        lines: lines.map((l) => ({ account: l.account, debitPaise: l.credit_paise, creditPaise: l.debit_paise })),
      };
      this.insertJournalEntry(reversal, { businessId: header.business_id, entryDate: input.reversedOn });
      this.db.prepare("UPDATE opening_balances SET reversed_at = ? WHERE id = ?").run(input.reversedOn, header.id);
      appendAuditEvent(this.db, {
        action: "OPENING_BALANCES_REVERSED",
        entityId: header.id,
        entityType: "opening_balances",
        occurredAt: new Date().toISOString(),
        beforeValues: { reversedAt: null },
        afterValues: { reversedAt: input.reversedOn },
      });
      return reversal;
    })();
  }

  /** Every set for the business, oldest first (a reversed one stays as history), with its lines. */
  public getOpeningBalances(businessId: string): readonly OpeningBalanceSet[] {
    this.requireBusiness(businessId);
    const headers = this.db
      .prepare(
        "SELECT id, business_id, as_at, journal_entry_id, reversed_at, created_at FROM opening_balances WHERE business_id = ? ORDER BY created_at, rowid",
      )
      .all(businessId) as Array<{ id: string; business_id: string; as_at: string; journal_entry_id: string; reversed_at: string | null; created_at: string }>;
    const linesOf = this.db.prepare(
      "SELECT account, debit_paise, credit_paise FROM opening_balance_lines WHERE opening_balance_id = ? ORDER BY rowid",
    );
    const plugOf = this.db.prepare(
      "SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? AND account = ?",
    );
    type Row = { account: string; debit_paise: number; credit_paise: number };
    const asLine = (r: Row): OpeningBalanceLineInput => ({ account: r.account, debitPaise: r.debit_paise, creditPaise: r.credit_paise });
    return headers.map((h) => {
      const plug = plugOf.get(h.journal_entry_id, OPENING_BALANCE_EQUITY_CODE) as Row | undefined;
      return {
        id: h.id,
        businessId: h.business_id,
        asAt: h.as_at,
        journalEntryId: h.journal_entry_id,
        reversedAt: h.reversed_at,
        createdAt: h.created_at,
        lines: (linesOf.all(h.id) as Row[]).map(asLine),
        balancingLine: plug === undefined ? null : asLine(plug),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Opening customer and supplier balances (R4b). Each is a DOCUMENT with its own sub-ledger row and
  // ONE posted entry dated as-at; the general opening Trial Balance (above) refuses the control
  // accounts these feed. Corrected by reversal only. Receipts and settlements post through their
  // own tables because payments.payment_account is still CHECK IN ('CASH').
  // ---------------------------------------------------------------------------

  /** The chart row an opening income account must be: active, this company's or a system account, and INCOME. */
  private requireOpeningIncomeAccount(code: string, companyId: string): void {
    const account = this.db
      .prepare("SELECT code, company_id, type, active FROM chart_accounts WHERE code = ?")
      .get(code) as { code: string; company_id: string | null; type: AccountType; active: number } | undefined;
    if (account === undefined) throw new RepositoryValidationError(`Account ${code} does not exist in the chart of accounts.`);
    if (account.active === 0) throw new RepositoryValidationError(`Account ${code} is not active. Reactivate it, or pick another account.`);
    if (account.company_id !== null && account.company_id !== companyId) {
      throw new RepositoryValidationError(`Account ${code} belongs to another company.`);
    }
    // The CLASS decides, never a list of codes: an income account the user created works the same.
    if (account.type !== "INCOME") {
      throw new RepositoryValidationError(`Account ${code} is not an income account, so it cannot hold the income behind an opening balance.`);
    }
  }

  public saveOpeningCustomerBalance(input: {
    id: string;
    businessId: string;
    customerId: string;
    asAt: string;
    amountPaise: number;
    incomePaise: number;
    incomeAccount?: string;
  }): string {
    const { companyId } = this.requireBusinessCompany(input.businessId);
    this.assertIsoDate("The opening balance date", input.asAt);
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new RepositoryValidationError("An opening customer balance must be a whole number of paise above zero.");
    }
    if (!Number.isInteger(input.incomePaise) || input.incomePaise < 0) {
      throw new RepositoryValidationError("The income behind an opening balance must be a whole number of paise, zero or more.");
    }
    if (input.incomePaise > input.amountPaise) {
      throw new RepositoryValidationError(
        `The income behind an opening balance cannot exceed the balance itself (${input.incomePaise} paise of income against ${input.amountPaise} paise owed).`,
      );
    }
    if (input.incomePaise > 0 && input.incomeAccount === undefined) {
      throw new RepositoryValidationError("An income account is required when part of the balance is income.");
    }
    if (input.incomePaise === 0 && input.incomeAccount !== undefined) {
      throw new RepositoryValidationError("Leave the income account empty when no income is behind the balance.");
    }
    const customer = this.db.prepare("SELECT company_id FROM customers WHERE id = ?").get(input.customerId) as { company_id: string } | undefined;
    if (customer === undefined) throw new RepositoryValidationError(`Customer ${input.customerId} was not found.`);
    if (customer.company_id !== companyId) {
      throw new RepositoryValidationError("That customer belongs to another company.");
    }
    if (input.incomeAccount !== undefined) this.requireOpeningIncomeAccount(input.incomeAccount, companyId);
    if (this.db.prepare("SELECT 1 FROM opening_customer_balances WHERE id = ?").get(input.id) !== undefined) {
      throw new RepositoryValidationError(`Opening customer balance ${input.id} already exists.`);
    }
    const live = this.db
      .prepare("SELECT id FROM opening_customer_balances WHERE business_id = ? AND customer_id = ? AND reversed_at IS NULL")
      .get(input.businessId, input.customerId) as { id: string } | undefined;
    if (live !== undefined) {
      throw new RepositoryValidationError(
        `This customer already has an opening balance (${live.id}). Reverse it first, then enter the corrected one.`,
      );
    }

    const journalEntryId = `je-opening-customer-${input.id}`;
    const equityPaise = input.amountPaise - input.incomePaise;
    const lines: JournalEntry["lines"] = [
      { account: "RECEIVABLES", debitPaise: input.amountPaise, creditPaise: 0 },
      // The income sits behind the receivable HERE, on the document itself, and nowhere else: it is
      // not typed into the general opening Trial Balance as well, where the two could disagree.
      ...(input.incomePaise > 0 && input.incomeAccount !== undefined
        ? [{ account: input.incomeAccount, debitPaise: 0, creditPaise: input.incomePaise }]
        : []),
      ...(equityPaise > 0 ? [{ account: OPENING_BALANCE_EQUITY_CODE, debitPaise: 0, creditPaise: equityPaise }] : []),
    ];
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.insertJournalEntry(
        {
          id: journalEntryId,
          sourceId: input.id,
          sourceType: "OPENING_BALANCE",
          description: `Opening customer balance as at ${input.asAt}`,
          isReversal: false,
          lines,
        },
        { businessId: input.businessId, entryDate: input.asAt },
      );
      this.db
        .prepare(
          `INSERT INTO opening_customer_balances
             (id, business_id, customer_id, as_at, amount_paise, income_paise, income_account, journal_entry_id, reversed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(input.id, input.businessId, input.customerId, input.asAt, input.amountPaise, input.incomePaise, input.incomeAccount ?? null, journalEntryId, now);
      appendAuditEvent(this.db, {
        action: "OPENING_CUSTOMER_BALANCE_SAVED",
        entityId: input.id,
        entityType: "opening_customer_balances",
        occurredAt: now,
        afterValues: {
          businessId: input.businessId, customerId: input.customerId, asAt: input.asAt,
          amountPaise: input.amountPaise, incomePaise: input.incomePaise, incomeAccount: input.incomeAccount ?? null,
        },
      });
    })();
    return input.id;
  }

  public reverseOpeningCustomerBalance(input: { id: string; reversedOn: string }): JournalEntry {
    const header = this.db
      .prepare("SELECT id, business_id, as_at, journal_entry_id, reversed_at FROM opening_customer_balances WHERE id = ?")
      .get(input.id) as { id: string; business_id: string; as_at: string; journal_entry_id: string; reversed_at: string | null } | undefined;
    if (header === undefined) throw new RepositoryValidationError(`Opening customer balance ${input.id} was not found.`);
    if (header.reversed_at !== null) {
      throw new RepositoryValidationError(`Opening customer balance ${input.id} has already been reversed on ${header.reversed_at}.`);
    }
    this.assertIsoDate("The reversal date", input.reversedOn);
    if (input.reversedOn < header.as_at) {
      throw new RepositoryValidationError(`The reversal date cannot be before the opening balance date ${header.as_at}.`);
    }
    // Once money has been collected, reversing the balance would leave the receipts with nothing to
    // settle and the cash view with income it had already recognised. Nothing is edited or deleted:
    // the way to correct it is to reverse the receipts' effect first, which this slice does not offer.
    if (this.db.prepare("SELECT 1 FROM opening_balance_receipts WHERE opening_customer_balance_id = ?").get(input.id) !== undefined) {
      throw new RepositoryValidationError(`Opening customer balance ${input.id} has receipts recorded against it, so it can no longer be reversed.`);
    }
    return this.db.transaction(() => {
      const reversal = this.reverseOpeningEntry(header.journal_entry_id, `je-opening-customer-reversal-${header.id}`, header.id, `Reversal of opening customer balance as at ${header.as_at}`, header.business_id, input.reversedOn);
      this.db.prepare("UPDATE opening_customer_balances SET reversed_at = ? WHERE id = ?").run(input.reversedOn, header.id);
      appendAuditEvent(this.db, {
        action: "OPENING_CUSTOMER_BALANCE_REVERSED",
        entityId: header.id,
        entityType: "opening_customer_balances",
        occurredAt: new Date().toISOString(),
        beforeValues: { reversedAt: null },
        afterValues: { reversedAt: input.reversedOn },
      });
      return reversal;
    })();
  }

  /** Negates every line of a posted opening entry, dated `reversedOn`, through the one posting door. */
  private reverseOpeningEntry(
    journalEntryId: string, reversalId: string, sourceId: string, description: string, businessId: string, reversedOn: string,
  ): JournalEntry {
    const lines = this.db
      .prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
      .all(journalEntryId) as Array<{ account: string; debit_paise: number; credit_paise: number }>;
    const reversal: JournalEntry = {
      id: reversalId,
      sourceId,
      sourceType: "OPENING_BALANCE",
      description,
      isReversal: true,
      lines: lines.map((l) => ({ account: l.account, debitPaise: l.credit_paise, creditPaise: l.debit_paise })),
    };
    this.insertJournalEntry(reversal, { businessId, entryDate: reversedOn });
    return reversal;
  }

  public listOpeningCustomerBalances(businessId: string): readonly OpeningCustomerBalanceRecord[] {
    this.requireBusiness(businessId);
    return (
      this.db
        .prepare(
          `SELECT id, business_id, customer_id, as_at, amount_paise, income_paise, income_account, journal_entry_id, reversed_at, created_at,
                  COALESCE((SELECT SUM(r.amount_paise) FROM opening_balance_receipts r WHERE r.opening_customer_balance_id = b.id), 0) AS received_paise
             FROM opening_customer_balances b WHERE business_id = ? ORDER BY created_at, rowid`,
        )
        .all(businessId) as Array<{
        id: string; business_id: string; customer_id: string; as_at: string; amount_paise: number; income_paise: number;
        income_account: string | null; journal_entry_id: string; reversed_at: string | null; created_at: string; received_paise: number;
      }>
    ).map((r) => ({
      id: r.id, businessId: r.business_id, customerId: r.customer_id, asAt: r.as_at, amountPaise: r.amount_paise,
      incomePaise: r.income_paise, incomeAccount: r.income_account, journalEntryId: r.journal_entry_id,
      reversedAt: r.reversed_at, createdAt: r.created_at, receivedPaise: r.received_paise,
    }));
  }

  /** Dr CASH|BANK / Cr RECEIVABLES, dated `receivedOn`. The cash view recognises income from this row. */
  public recordOpeningBalanceReceipt(input: {
    id: string;
    openingCustomerBalanceId: string;
    amountPaise: number;
    receivedOn: string;
    paymentAccount: "CASH" | "BANK";
  }): JournalEntry {
    return this.db.transaction(() => {
      const balance = this.db
        .prepare("SELECT id, business_id, as_at, amount_paise, reversed_at FROM opening_customer_balances WHERE id = ?")
        .get(input.openingCustomerBalanceId) as { id: string; business_id: string; as_at: string; amount_paise: number; reversed_at: string | null } | undefined;
      if (balance === undefined) throw new RepositoryValidationError(`Opening customer balance ${input.openingCustomerBalanceId} was not found.`);
      if (balance.reversed_at !== null) throw new RepositoryValidationError("A reversed opening balance cannot be collected.");
      if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
        throw new RepositoryValidationError("A receipt must be a whole number of paise above zero.");
      }
      if (input.paymentAccount !== "CASH" && input.paymentAccount !== "BANK") {
        throw new RepositoryValidationError("A receipt is paid into CASH or BANK.");
      }
      this.assertIsoDate("The receipt date", input.receivedOn);
      if (input.receivedOn < balance.as_at) {
        throw new RepositoryValidationError(`A receipt cannot predate the opening balance (${balance.as_at}).`);
      }
      if (this.db.prepare("SELECT 1 FROM opening_balance_receipts WHERE id = ?").get(input.id) !== undefined) {
        throw new RepositoryValidationError(`Receipt ${input.id} already exists.`);
      }
      const received = (this.db
        .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM opening_balance_receipts WHERE opening_customer_balance_id = ?")
        .get(balance.id) as { total: number }).total;
      const outstanding = balance.amount_paise - received;
      if (input.amountPaise > outstanding) {
        throw new RepositoryValidationError(
          `Only ${outstanding} paise is outstanding on this opening balance; a receipt of ${input.amountPaise} paise exceeds it.`,
        );
      }
      const entry: JournalEntry = {
        id: `je-opening-receipt-${input.id}`,
        sourceId: balance.id,
        sourceType: "OPENING_BALANCE",
        description: `Receipt against opening customer balance ${balance.id}`,
        isReversal: false,
        lines: [
          { account: input.paymentAccount, debitPaise: input.amountPaise, creditPaise: 0 },
          { account: "RECEIVABLES", debitPaise: 0, creditPaise: input.amountPaise },
        ],
      };
      const now = new Date().toISOString();
      this.insertJournalEntry(entry, { businessId: balance.business_id, entryDate: input.receivedOn });
      this.db
        .prepare(
          "INSERT INTO opening_balance_receipts (id, opening_customer_balance_id, amount_paise, received_on, payment_account, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(input.id, balance.id, input.amountPaise, input.receivedOn, input.paymentAccount, now);
      appendAuditEvent(this.db, {
        action: "OPENING_BALANCE_RECEIPT_RECORDED",
        entityId: input.id,
        entityType: "opening_balance_receipts",
        occurredAt: now,
        afterValues: { openingCustomerBalanceId: balance.id, amountPaise: input.amountPaise, receivedOn: input.receivedOn, paymentAccount: input.paymentAccount },
      });
      return entry;
    })();
  }

  public saveOpeningSupplierBalance(input: {
    id: string;
    businessId: string;
    supplierId: string;
    asAt: string;
    amountPaise: number;
  }): string {
    const { companyId } = this.requireBusinessCompany(input.businessId);
    this.assertIsoDate("The opening balance date", input.asAt);
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new RepositoryValidationError("An opening supplier balance must be a whole number of paise above zero.");
    }
    const supplier = this.db.prepare("SELECT company_id FROM suppliers WHERE id = ?").get(input.supplierId) as { company_id: string } | undefined;
    if (supplier === undefined) throw new RepositoryValidationError(`Supplier ${input.supplierId} was not found.`);
    if (supplier.company_id !== companyId) throw new RepositoryValidationError("That supplier belongs to another company.");
    if (this.db.prepare("SELECT 1 FROM opening_supplier_balances WHERE id = ?").get(input.id) !== undefined) {
      throw new RepositoryValidationError(`Opening supplier balance ${input.id} already exists.`);
    }
    const live = this.db
      .prepare("SELECT id FROM opening_supplier_balances WHERE business_id = ? AND supplier_id = ? AND reversed_at IS NULL")
      .get(input.businessId, input.supplierId) as { id: string } | undefined;
    if (live !== undefined) {
      throw new RepositoryValidationError(
        `This supplier already has an opening balance (${live.id}). Reverse it first, then enter the corrected one.`,
      );
    }
    const journalEntryId = `je-opening-supplier-${input.id}`;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.insertJournalEntry(
        {
          id: journalEntryId,
          sourceId: input.id,
          sourceType: "OPENING_BALANCE",
          description: `Opening supplier balance as at ${input.asAt}`,
          isReversal: false,
          lines: [
            { account: OPENING_BALANCE_EQUITY_CODE, debitPaise: input.amountPaise, creditPaise: 0 },
            { account: "PAYABLES", debitPaise: 0, creditPaise: input.amountPaise },
          ],
        },
        { businessId: input.businessId, entryDate: input.asAt },
      );
      this.db
        .prepare(
          "INSERT INTO opening_supplier_balances (id, business_id, supplier_id, as_at, amount_paise, journal_entry_id, reversed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
        )
        .run(input.id, input.businessId, input.supplierId, input.asAt, input.amountPaise, journalEntryId, now);
      appendAuditEvent(this.db, {
        action: "OPENING_SUPPLIER_BALANCE_SAVED",
        entityId: input.id,
        entityType: "opening_supplier_balances",
        occurredAt: now,
        afterValues: { businessId: input.businessId, supplierId: input.supplierId, asAt: input.asAt, amountPaise: input.amountPaise },
      });
    })();
    return input.id;
  }

  public reverseOpeningSupplierBalance(input: { id: string; reversedOn: string }): JournalEntry {
    const header = this.db
      .prepare("SELECT id, business_id, as_at, journal_entry_id, reversed_at FROM opening_supplier_balances WHERE id = ?")
      .get(input.id) as { id: string; business_id: string; as_at: string; journal_entry_id: string; reversed_at: string | null } | undefined;
    if (header === undefined) throw new RepositoryValidationError(`Opening supplier balance ${input.id} was not found.`);
    if (header.reversed_at !== null) {
      throw new RepositoryValidationError(`Opening supplier balance ${input.id} has already been reversed on ${header.reversed_at}.`);
    }
    this.assertIsoDate("The reversal date", input.reversedOn);
    if (input.reversedOn < header.as_at) {
      throw new RepositoryValidationError(`The reversal date cannot be before the opening balance date ${header.as_at}.`);
    }
    if (this.db.prepare("SELECT 1 FROM opening_balance_settlements WHERE opening_supplier_balance_id = ?").get(input.id) !== undefined) {
      throw new RepositoryValidationError(`Opening supplier balance ${input.id} has settlements recorded against it, so it can no longer be reversed.`);
    }
    return this.db.transaction(() => {
      const reversal = this.reverseOpeningEntry(header.journal_entry_id, `je-opening-supplier-reversal-${header.id}`, header.id, `Reversal of opening supplier balance as at ${header.as_at}`, header.business_id, input.reversedOn);
      this.db.prepare("UPDATE opening_supplier_balances SET reversed_at = ? WHERE id = ?").run(input.reversedOn, header.id);
      appendAuditEvent(this.db, {
        action: "OPENING_SUPPLIER_BALANCE_REVERSED",
        entityId: header.id,
        entityType: "opening_supplier_balances",
        occurredAt: new Date().toISOString(),
        beforeValues: { reversedAt: null },
        afterValues: { reversedAt: input.reversedOn },
      });
      return reversal;
    })();
  }

  public listOpeningSupplierBalances(businessId: string): readonly OpeningSupplierBalanceRecord[] {
    this.requireBusiness(businessId);
    return (
      this.db
        .prepare(
          `SELECT id, business_id, supplier_id, as_at, amount_paise, journal_entry_id, reversed_at, created_at,
                  COALESCE((SELECT SUM(s.amount_paise) FROM opening_balance_settlements s WHERE s.opening_supplier_balance_id = b.id), 0) AS paid_paise
             FROM opening_supplier_balances b WHERE business_id = ? ORDER BY created_at, rowid`,
        )
        .all(businessId) as Array<{
        id: string; business_id: string; supplier_id: string; as_at: string; amount_paise: number;
        journal_entry_id: string; reversed_at: string | null; created_at: string; paid_paise: number;
      }>
    ).map((r) => ({
      id: r.id, businessId: r.business_id, supplierId: r.supplier_id, asAt: r.as_at, amountPaise: r.amount_paise,
      journalEntryId: r.journal_entry_id, reversedAt: r.reversed_at, createdAt: r.created_at, paidPaise: r.paid_paise,
    }));
  }

  /** Dr PAYABLES / Cr CASH|BANK, dated `paidOn`. Paying off an opening balance is never an expense. */
  public recordOpeningBalanceSettlement(input: {
    id: string;
    openingSupplierBalanceId: string;
    amountPaise: number;
    paidOn: string;
    paymentAccount: "CASH" | "BANK";
  }): JournalEntry {
    return this.db.transaction(() => {
      const balance = this.db
        .prepare("SELECT id, business_id, as_at, amount_paise, reversed_at FROM opening_supplier_balances WHERE id = ?")
        .get(input.openingSupplierBalanceId) as { id: string; business_id: string; as_at: string; amount_paise: number; reversed_at: string | null } | undefined;
      if (balance === undefined) throw new RepositoryValidationError(`Opening supplier balance ${input.openingSupplierBalanceId} was not found.`);
      if (balance.reversed_at !== null) throw new RepositoryValidationError("A reversed opening balance cannot be paid.");
      if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
        throw new RepositoryValidationError("A settlement must be a whole number of paise above zero.");
      }
      if (input.paymentAccount !== "CASH" && input.paymentAccount !== "BANK") {
        throw new RepositoryValidationError("A settlement is paid from CASH or BANK.");
      }
      this.assertIsoDate("The payment date", input.paidOn);
      if (input.paidOn < balance.as_at) {
        throw new RepositoryValidationError(`A settlement cannot predate the opening balance (${balance.as_at}).`);
      }
      if (this.db.prepare("SELECT 1 FROM opening_balance_settlements WHERE id = ?").get(input.id) !== undefined) {
        throw new RepositoryValidationError(`Settlement ${input.id} already exists.`);
      }
      const paid = (this.db
        .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM opening_balance_settlements WHERE opening_supplier_balance_id = ?")
        .get(balance.id) as { total: number }).total;
      const outstanding = balance.amount_paise - paid;
      if (input.amountPaise > outstanding) {
        throw new RepositoryValidationError(
          `Only ${outstanding} paise is outstanding on this opening balance; a settlement of ${input.amountPaise} paise exceeds it.`,
        );
      }
      const entry: JournalEntry = {
        id: `je-opening-settlement-${input.id}`,
        sourceId: balance.id,
        sourceType: "OPENING_BALANCE",
        description: `Payment against opening supplier balance ${balance.id}`,
        isReversal: false,
        lines: [
          { account: "PAYABLES", debitPaise: input.amountPaise, creditPaise: 0 },
          { account: input.paymentAccount, debitPaise: 0, creditPaise: input.amountPaise },
        ],
      };
      const now = new Date().toISOString();
      this.insertJournalEntry(entry, { businessId: balance.business_id, entryDate: input.paidOn });
      this.db
        .prepare(
          "INSERT INTO opening_balance_settlements (id, opening_supplier_balance_id, amount_paise, paid_on, payment_account, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(input.id, balance.id, input.amountPaise, input.paidOn, input.paymentAccount, now);
      appendAuditEvent(this.db, {
        action: "OPENING_BALANCE_SETTLEMENT_RECORDED",
        entityId: input.id,
        entityType: "opening_balance_settlements",
        occurredAt: now,
        afterValues: { openingSupplierBalanceId: balance.id, amountPaise: input.amountPaise, paidOn: input.paidOn, paymentAccount: input.paymentAccount },
      });
      return entry;
    })();
  }

  /**
   * THE SHARED OPEN-ITEMS QUERY - the single definition of "what a customer still owes".
   *
   * Returns a business's (or everyone's) open items, invoices AND opening balances together, as
   * uniform rows. getReceivables reads it, and R7's ageing, customer statements and customer-balance
   * detail reports must read it too rather than re-deriving settlement from `payments`, which would
   * let a report and the ledger disagree. Only items with something outstanding are returned.
   */
  public getOpenCustomerItems(filter: { businessId?: string; customerId?: string } = {}): readonly OpenCustomerItem[] {
    return this.openCustomerItemRows(filter).map((row) => ({
      documentId: row.documentId,
      kind: row.kind,
      date: row.date,
      totalPaise: row.totalPaise,
      settledPaise: row.settledPaise,
      outstandingPaise: row.outstandingPaise,
      customerId: row.customerId,
      businessId: row.businessId,
    }));
  }

  /** The same rows with the invoice-only detail getReceivables still shows. One query, two shapes. */
  private openCustomerItemRows(filter: { businessId?: string; customerId?: string }): Array<OpenCustomerItem & {
    readonly number: string; readonly paidPaise: number; readonly creditedPaise: number;
  }> {
    const where = (alias: string): { sql: string; params: string[] } => ({
      sql: (filter.businessId === undefined ? "" : ` AND ${alias}.business_id = ?`) + (filter.customerId === undefined ? "" : ` AND ${alias}.customer_id = ?`),
      params: [...(filter.businessId === undefined ? [] : [filter.businessId]), ...(filter.customerId === undefined ? [] : [filter.customerId])],
    });
    const invoiceWhere = where("i");
    const rows = this.db
      .prepare(
        `SELECT i.id, i.number, i.business_id, i.customer_id, COALESCE(i.invoice_date, i.created_at) AS invoice_date,
                i.tax_rate_basis_points,
                (SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise)
                  + ROUND((SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise) * i.tax_rate_basis_points / 10000.0) AS total_paise,
                COALESCE((SELECT SUM(p.amount_paise) FROM payments p WHERE p.invoice_id = i.id), 0)
                  + COALESCE((SELECT SUM(a.amount_paise) FROM credit_note_applications a WHERE a.invoice_id = i.id), 0) AS paid_paise
           FROM invoices i
           JOIN invoice_lines il ON il.invoice_id = i.id
           WHERE i.status = 'FINALIZED' AND i.payment_account = 'RECEIVABLES'${invoiceWhere.sql}
           GROUP BY i.id
           ORDER BY i.created_at`,
      )
      .all(...invoiceWhere.params) as Array<{
        id: string; number: string; business_id: string; customer_id: string; invoice_date: string;
        tax_rate_basis_points: number; total_paise: number; paid_paise: number;
      }>;
    // Credit notes, read from the POSTED journal exactly as invoiceCreditedPaise does, so the
    // list and the payment cap can never disagree. Recomputing from the note lines would drift
    // the moment a note's tax is clamped. SAME DEFECT as recordPayment's cap: without this, an
    // invoice that has been fully credited still appeared on the receivables list as owed.
    const creditedByInvoice = new Map<string, number>();
    for (
      const note of this.db
        .prepare(
          `SELECT je.source_id AS invoice_id,
                  COALESCE(SUM(jl.credit_paise), 0) - COALESCE(SUM(jl.debit_paise), 0) AS credited
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.journal_entry_id
             JOIN invoices i ON i.id = je.source_id
            WHERE je.id LIKE 'je-credit-note-%' AND jl.account = i.payment_account
            GROUP BY je.source_id`,
        )
        .all() as Array<{ invoice_id: string; credited: number }>
    ) {
      creditedByInvoice.set(note.invoice_id, note.credited);
    }
    const items: Array<OpenCustomerItem & { readonly number: string; readonly paidPaise: number; readonly creditedPaise: number }> = [];
    for (const row of rows) {
      const creditedPaise = creditedByInvoice.get(row.id) ?? 0;
      items.push({
        documentId: row.id, kind: "INVOICE", date: row.invoice_date, totalPaise: row.total_paise,
        settledPaise: row.paid_paise + creditedPaise, outstandingPaise: row.total_paise - creditedPaise - row.paid_paise,
        customerId: row.customer_id, businessId: row.business_id,
        number: row.number, paidPaise: row.paid_paise, creditedPaise,
      });
    }
    const openingWhere = where("b");
    for (
      const b of this.db
        .prepare(
          `SELECT b.id, b.business_id, b.customer_id, b.as_at, b.amount_paise,
                  COALESCE((SELECT SUM(r.amount_paise) FROM opening_balance_receipts r WHERE r.opening_customer_balance_id = b.id), 0) AS received_paise
             FROM opening_customer_balances b
            WHERE b.reversed_at IS NULL${openingWhere.sql}
            ORDER BY b.created_at, b.rowid`,
        )
        .all(...openingWhere.params) as Array<{
        id: string; business_id: string; customer_id: string; as_at: string; amount_paise: number; received_paise: number;
      }>
    ) {
      items.push({
        documentId: b.id, kind: "OPENING", date: b.as_at, totalPaise: b.amount_paise, settledPaise: b.received_paise,
        outstandingPaise: b.amount_paise - b.received_paise, customerId: b.customer_id, businessId: b.business_id,
        number: "Opening balance", paidPaise: b.received_paise, creditedPaise: 0,
      });
    }
    return items.filter((item) => item.outstandingPaise > 0);
  }

  /** The supplier mirror of getOpenCustomerItems: bills, expenses on credit, and opening balances. */
  public getOpenSupplierItems(filter: { businessId?: string; supplierId?: string } = {}): readonly OpenSupplierItem[] {
    return this.openSupplierItemRows(filter).map((row) => ({
      documentId: row.documentId,
      kind: row.kind,
      date: row.date,
      totalPaise: row.totalPaise,
      settledPaise: row.settledPaise,
      outstandingPaise: row.outstandingPaise,
      supplierId: row.supplierId,
      businessId: row.businessId,
    }));
  }

  private openSupplierItemRows(filter: { businessId?: string; supplierId?: string }): Array<OpenSupplierItem & { readonly number: string }> {
    const items: Array<OpenSupplierItem & { readonly number: string }> = [];
    for (const bill of this.listPurchaseBills({ status: "FINALIZED" })) {
      if (bill.paymentAccount !== "PAYABLES") continue;
      items.push({
        documentId: bill.id, kind: "BILL", date: bill.billDate, totalPaise: bill.totalPaise, settledPaise: bill.paidPaise,
        outstandingPaise: bill.totalPaise - bill.paidPaise, supplierId: bill.supplierId, businessId: bill.businessId, number: bill.number,
      });
    }
    for (const expense of this.listExpenses({ status: "FINALIZED" })) {
      if (expense.paymentAccount !== "PAYABLES" || expense.supplierId === null) continue;
      items.push({
        documentId: expense.id, kind: "EXPENSE", date: expense.expenseDate, totalPaise: expense.totalPaise, settledPaise: expense.paidPaise,
        outstandingPaise: expense.totalPaise - expense.paidPaise, supplierId: expense.supplierId, businessId: expense.businessId, number: expense.number,
      });
    }
    for (
      const b of this.db
        .prepare(
          `SELECT b.id, b.business_id, b.supplier_id, b.as_at, b.amount_paise,
                  COALESCE((SELECT SUM(s.amount_paise) FROM opening_balance_settlements s WHERE s.opening_supplier_balance_id = b.id), 0) AS paid_paise
             FROM opening_supplier_balances b WHERE b.reversed_at IS NULL ORDER BY b.created_at, b.rowid`,
        )
        .all() as Array<{ id: string; business_id: string; supplier_id: string; as_at: string; amount_paise: number; paid_paise: number }>
    ) {
      items.push({
        documentId: b.id, kind: "OPENING", date: b.as_at, totalPaise: b.amount_paise, settledPaise: b.paid_paise,
        outstandingPaise: b.amount_paise - b.paid_paise, supplierId: b.supplier_id, businessId: b.business_id, number: "Opening balance",
      });
    }
    return items.filter(
      (item) =>
        item.outstandingPaise > 0 &&
        (filter.businessId === undefined || item.businessId === filter.businessId) &&
        (filter.supplierId === undefined || item.supplierId === filter.supplierId),
    );
  }

  private requireBusiness(businessId: string): void {
    if (this.db.prepare("SELECT 1 FROM businesses WHERE id = ?").get(businessId) === undefined) {
      throw new RepositoryValidationError(`Business ${businessId} was not found.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Chart of accounts (decision S2-1). The account-creation PAGE is UI and is deferred with all
  // other UI; this is the backend it will sit on. Every change is audited, because the chart
  // decides which report line a figure lands on.
  // ---------------------------------------------------------------------------

  public listAccounts(filter: { companyId?: string; includeInactive?: boolean } = {}): readonly ChartAccount[] {
    // A company sees its OWN accounts plus the shared system ones (company_id NULL).
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter.companyId !== undefined) {
      conditions.push("(company_id IS NULL OR company_id = ?)");
      params.push(filter.companyId);
    }
    if (filter.includeInactive !== true) conditions.push("active = 1");
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db
      .prepare(`SELECT code, company_id, name, type, role, parent_code, active FROM chart_accounts ${where} ORDER BY type, code`)
      .all(...params) as Array<{
      code: string; company_id: string | null; name: string; type: AccountType;
      role: AccountRole | null; parent_code: string | null; active: number;
    }>;
    return rows.map((row) => ({
      code: row.code,
      companyId: row.company_id,
      name: row.name,
      type: row.type,
      role: row.role,
      parentCode: row.parent_code,
      active: row.active === 1,
      system: row.company_id === null,
    }));
  }

  public getAccount(code: string): ChartAccount {
    const account = this.listAccounts({ includeInactive: true }).find((a) => a.code === code);
    if (account === undefined) throw new RepositoryValidationError(`Account ${code} was not found.`);
    return account;
  }

  /**
   * Creates a USER account. Three things are deliberately not on offer:
   *  - a `role`: control accounts (cash, bank, receivables, payables, inventory, GST) are the
   *    engine's own and cannot be user-created (S2-1);
   *  - a normal side or a cash-view/cash-flow treatment: all three DERIVE from the class;
   *  - a company_id of NULL: only the migration seeds system accounts.
   */
  public createAccount(input: { companyId: string; code: string; name: string; type: AccountType; parentCode?: string }): string {
    this.requireCompany(input.companyId);
    const code = input.code.trim().toUpperCase();
    // A code is an identifier, not prose: it ends up in SQL, in reports and in exports.
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
      throw new RepositoryValidationError(
        "An account code must be 2 to 40 characters, start with a letter, and use only letters, numbers and underscores.",
      );
    }
    const name = input.name.trim();
    if (name === "") throw new RepositoryValidationError("An account needs a name.");
    if (!(ACCOUNT_TYPES as readonly string[]).includes(input.type)) {
      throw new RepositoryValidationError(`An account class must be one of ${ACCOUNT_TYPES.join(", ")}.`);
    }
    if (code === "RETAINED_EARNINGS") {
      throw new RepositoryValidationError(
        "RETAINED_EARNINGS is derived by the Balance Sheet from income less expenses and cannot be an account.",
      );
    }
    const existing = this.db.prepare("SELECT company_id FROM chart_accounts WHERE code = ?").get(code) as { company_id: string | null } | undefined;
    if (existing !== undefined) {
      throw new RepositoryValidationError(
        existing.company_id === null
          ? `${code} is a built-in account and already exists.`
          : `An account with the code ${code} already exists.`,
      );
    }
    if (input.parentCode !== undefined) {
      const parent = this.db.prepare("SELECT type, company_id FROM chart_accounts WHERE code = ?").get(input.parentCode) as
        | { type: AccountType; company_id: string | null }
        | undefined;
      if (parent === undefined) throw new RepositoryValidationError(`Parent account ${input.parentCode} was not found.`);
      // A sub-account that reports in a different section from its parent would make the tree lie.
      if (parent.type !== input.type) {
        throw new RepositoryValidationError(
          `A sub-account of ${input.parentCode} must be classed ${parent.type}, not ${input.type}.`,
        );
      }
      if (parent.company_id !== null && parent.company_id !== input.companyId) {
        throw new RepositoryValidationError(`Parent account ${input.parentCode} belongs to another company.`);
      }
    }
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?)",
        )
        .run(code, input.companyId, name, input.type, input.parentCode ?? null, now, now);
      appendAuditEvent(this.db, {
        action: "ACCOUNT_CREATED",
        entityId: code,
        entityType: "chart_account",
        companyId: input.companyId,
        occurredAt: now,
        afterValues: { code, name, type: input.type, parentCode: input.parentCode ?? null, active: true },
      });
    })();
    return code;
  }

  /** Renames an account. The CODE never changes - that is what "rename anytime" can safely mean. */
  public renameAccount(code: string, name: string): void {
    const account = this.getAccount(code);
    const trimmed = name.trim();
    if (trimmed === "") throw new RepositoryValidationError("An account needs a name.");
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE chart_accounts SET name = ?, updated_at = ? WHERE code = ?").run(trimmed, now, code);
      appendAuditEvent(this.db, {
        action: "ACCOUNT_RENAMED",
        entityId: code,
        entityType: "chart_account",
        ...(account.companyId === null ? {} : { companyId: account.companyId }),
        occurredAt: now,
        beforeValues: { name: account.name },
        afterValues: { name: trimmed },
      });
    })();
  }

  /**
   * Deactivates or reactivates an account. Never a delete: posted history must keep its account,
   * and the v9 trigger refuses a delete outright. A control account cannot be switched off - the
   * engine posts to it whether the user wants it on the list or not.
   */
  public setAccountActive(code: string, active: boolean): void {
    const account = this.getAccount(code);
    // Guard on the codes the ENGINE ITSELF emits, not just on `role`. SALES, COGS and EXPENSE
    // have no role but are hardcoded by the posting engine, so deactivating SALES made every
    // finalize and every credit note fail at the door - the app broke, from a settings screen.
    if (!active && (ACCOUNT_CODES as readonly string[]).includes(code)) {
      throw new RepositoryValidationError(
        `${code} is a built-in account that the engine posts to automatically, so it cannot be deactivated.`,
      );
    }
    if (account.active === active) return;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE chart_accounts SET active = ?, updated_at = ? WHERE code = ?").run(active ? 1 : 0, now, code);
      appendAuditEvent(this.db, {
        action: active ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED",
        entityId: code,
        entityType: "chart_account",
        ...(account.companyId === null ? {} : { companyId: account.companyId }),
        occurredAt: now,
        beforeValues: { active: account.active },
        afterValues: { active },
      });
    })();
  }

  private getOriginalJournalEntry(invoiceId: string): JournalEntry {
    const row = this.db
      .prepare(
        "SELECT id, source_id, description, is_reversal FROM journal_entries WHERE source_id = ? AND is_reversal = 0",
      )
      .get(invoiceId) as JournalEntryRow | undefined;
    if (row === undefined) {
      throw new Error(`Original journal entry for invoice ${invoiceId} was not found.`);
    }

    return this.getJournalEntry(row);
  }

  private getJournalEntry(row: JournalEntryRow): JournalEntry {
    const lines = this.db
      .prepare(
        "SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id",
      )
      .all(row.id) as JournalLineRow[];
    return {
      id: row.id,
      sourceId: row.source_id,
      description: row.description,
      isReversal: row.is_reversal === 1,
      lines: lines.map((line) => ({
        account: line.account,
        debitPaise: line.debit_paise,
        creditPaise: line.credit_paise,
      })),
    };
  }
}
