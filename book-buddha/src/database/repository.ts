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
import type { AccountingBasis } from "../accounting/types.js";
import { advanceRunDate, isValidIsoDate, type RecurrenceFrequency } from "../accounting/recurrence.js";
import { runMigrations } from "./migrations.js";
import { RepositoryValidationError } from "./errors.js";
import { postJournalEntry } from "./ledger.js";
import { appendAuditEvent } from "./audit-log.js";
import { reportConditions } from "./report-filters-sql.js";
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
  readonly account: AccountCode;
  readonly debitPaise: number;
  readonly creditPaise: number;
}

export interface ReportAccountRow {
  readonly account: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
  readonly balancePaise: number;
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
  readonly account: AccountCode;
  readonly amountPaise: number;
  readonly documentType: "INVOICE" | "PURCHASE_BILL" | "EXPENSE";
  readonly documentId: string;
}

export interface CashViewDerivation {
  readonly recognitions: readonly CashRecognitionRow[];
  /** Cash received on invoices, by date: the "gross sales" of the cash view. */
  readonly invoiceCollections: ReadonlyArray<{ readonly date: string; readonly amountPaise: number }>;
}

export interface BalanceSheetReport {
  readonly assets: readonly ReportAccountRow[];
  readonly liabilities: readonly ReportAccountRow[];
  readonly equity: readonly ReportAccountRow[];
  readonly totalAssetsPaise: number;
  readonly totalLiabilitiesPaise: number;
  readonly totalEquityPaise: number;
}

export interface GeneralLedgerRow {
  readonly journalEntryId: string;
  readonly sourceId: string;
  readonly sourceType: JournalSourceType;
  /** Posting timestamp (when the row was written). The ledger is ORDERED by entryDate. */
  readonly date: string;
  /** Transaction date (YYYY-MM-DD, IST) — what the report is read and filtered by. */
  readonly entryDate: string;
  readonly description: string;
  readonly isReversal: boolean;
  readonly account: AccountCode;
  readonly debitPaise: number;
  readonly creditPaise: number;
}

export interface ReceivableRow {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly customerId: string;
  readonly invoiceDate: string;
  readonly totalPaise: number;
  readonly paidPaise: number;
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

export interface StockMovement {
  readonly id: string;
  readonly itemId: string;
  readonly sourceId: string | null;
  /** Reporting tag only (one shared stock pool): the project this movement belongs to, if any. */
  readonly fairId?: string;
  readonly movementType: StockMovementType | "SALE" | "SALE_REVERSAL" | "PURCHASE_REVERSAL";
  readonly quantityDelta: number;
  readonly unitCostPaise: number;
  readonly occurredAt: string;
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

  public addStockMovement(input: {
    itemId: string;
    movementType: StockMovementType;
    quantity: number;
    unitCostPaise: number;
    /** Reporting tag only; OPENING and ADJUSTMENT movements only. Never affects FIFO or quantity. */
    fairId?: string;
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
    const item = this.db.prepare("SELECT track_stock FROM items WHERE id = ?").get(input.itemId) as { track_stock: number } | undefined;
    if (item === undefined) {
      throw new RepositoryValidationError(`Item ${input.itemId} was not found.`);
    }
    if (item.track_stock !== 1) {
      throw new RepositoryValidationError("Stock movements require an item with stock tracking enabled.");
    }
    const movement: StockMovement = {
      id: randomUUID(),
      itemId: input.itemId,
      sourceId: null,
      movementType: input.movementType,
      quantityDelta: input.quantity,
      unitCostPaise: input.unitCostPaise,
      occurredAt: new Date().toISOString(),
      ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
    };
    if (input.fairId !== undefined) this.assertFairExists(input.fairId);
    this.db.prepare(
      "INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(movement.id, movement.itemId, null, movement.movementType, movement.quantityDelta, movement.unitCostPaise, movement.occurredAt, input.fairId ?? null);
    this.insertAuditEvent({ action: "stock.movement_added", entityId: movement.itemId, occurredAt: movement.occurredAt });
    return movement;
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
      const taxPaise = Math.round(taxablePaise * (invoice.taxRateBasisPoints ?? 0) / 10000);
      const taxLines: JournalEntry["lines"] = invoice.taxType === "IGST"
        ? [{ account: "OUTPUT_IGST", debitPaise: taxPaise, creditPaise: 0 }]
        : invoice.taxType === "CGST_SGST"
          ? [{ account: "OUTPUT_CGST", debitPaise: Math.floor(taxPaise / 2), creditPaise: 0 }, { account: "OUTPUT_SGST", debitPaise: taxPaise - Math.floor(taxPaise / 2), creditPaise: 0 }]
          : [];
      const entry: JournalEntry = {
        id: `je-credit-note-${note.id}`,
        sourceId: invoice.id,
        description: `Credit note ${note.number} for invoice ${invoice.number}`,
        isReversal: false,
        lines: [
          { account: "SALES", debitPaise: taxablePaise, creditPaise: 0 },
          ...taxLines,
          { account: invoice.paymentAccount, debitPaise: 0, creditPaise: taxablePaise + taxPaise },
        ],
      };
      const inventoryCost = this.restoreCreditNoteStock(note, invoice.fairId);
      const noteRow = this.db.prepare("SELECT created_at FROM credit_notes WHERE id = ?").get(note.id) as { created_at: string };
      const dims = { businessId: invoice.businessId, entryDate: istDateOf(noteRow.created_at), ...fairDim(invoice.fairId) };
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
      this.db.prepare("UPDATE credit_notes SET status = 'FINALIZED' WHERE id = ?").run(note.id);
      this.insertAuditEvent({ action: "credit_note.finalized", entityId: note.id, occurredAt: new Date().toISOString() });
      return entry;
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
      if (this.getPaidAmount(invoiceId) > 0) {
        throw new RepositoryValidationError("An invoice with recorded payments cannot be cancelled.");
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

  public recordPayment(invoiceId: string, amountPaise: number): Payment {
    const payment = this.db.transaction(() => {
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
      const totalPaise = this.invoiceTotal(invoice);
      const paidPaise = this.getPaidAmount(invoiceId);
      if (amountPaise > totalPaise - paidPaise) {
        throw new RepositoryValidationError("Payment cannot exceed the invoice outstanding balance.");
      }
      const result: Payment = {
        id: randomUUID(),
        invoiceId,
        amountPaise,
        paymentAccount: "CASH",
        paidAt: new Date().toISOString(),
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
        occurredAt: result.paidAt,
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

  public getReceivables(): readonly ReceivableRow[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.number, i.customer_id, COALESCE(i.invoice_date, i.created_at) AS invoice_date,
                (SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise)
                  + ROUND((SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise) * i.tax_rate_basis_points / 10000.0) AS total_paise,
                COALESCE((SELECT SUM(p.amount_paise) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_paise
         FROM invoices i
         JOIN invoice_lines il ON il.invoice_id = i.id
         WHERE i.status = 'FINALIZED' AND i.payment_account = 'RECEIVABLES'
         GROUP BY i.id
         ORDER BY i.created_at`,
      )
      .all() as Array<{ id: string; number: string; customer_id: string; invoice_date: string; total_paise: number; paid_paise: number }>;
    const now = Date.now();
    return rows
      .map((row) => ({
        invoiceId: row.id,
        invoiceNumber: row.number,
        customerId: row.customer_id,
        invoiceDate: row.invoice_date,
        totalPaise: row.total_paise,
        paidPaise: row.paid_paise,
        outstandingPaise: row.total_paise - row.paid_paise,
        ageDays: Math.max(0, Math.floor((now - Date.parse(row.invoice_date)) / 86400000)),
      }))
      .filter((row) => row.outstandingPaise > 0);
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
    const income = rows.filter((row) => row.account === "SALES");
    const expenses = rows.filter((row) => row.account === "COGS" || row.account === "EXPENSE");
    const totalIncomePaise = income.reduce((total, row) => total + row.creditPaise - row.debitPaise, 0);
    const totalExpensesPaise = expenses.reduce((total, row) => total + row.debitPaise - row.creditPaise, 0);
    const gstOnSalesPaise = rows
      .filter((row) => row.account === "OUTPUT_CGST" || row.account === "OUTPUT_SGST" || row.account === "OUTPUT_IGST")
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
  private cashViewAccountRows(derivation: CashViewDerivation): readonly ReportAccountRow[] {
    const totals = new Map<AccountCode, number>();
    for (const row of derivation.recognitions) {
      totals.set(row.account, (totals.get(row.account) ?? 0) + row.amountPaise);
    }
    const rows: ReportAccountRow[] = [];
    for (const [account, natural] of [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (natural === 0) continue;
      const creditNormal = account === "SALES" || account.startsWith("OUTPUT_");
      const debitPaise = creditNormal ? (natural < 0 ? -natural : 0) : (natural > 0 ? natural : 0);
      const creditPaise = creditNormal ? (natural > 0 ? natural : 0) : (natural < 0 ? -natural : 0);
      rows.push({ account, debitPaise, creditPaise, balancePaise: debitPaise - creditPaise });
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

    type Natural = { account: AccountCode; amountPaise: number };
    const accounts = ["SALES", "COGS", "EXPENSE", "INVENTORY", "OUTPUT_CGST", "OUTPUT_SGST", "OUTPUT_IGST", "INPUT_CGST", "INPUT_SGST", "INPUT_IGST"] as const;
    const creditNormal = (account: string): boolean => account === "SALES" || account.startsWith("OUTPUT_");

    // Posted lines of the P&L-side accounts, grouped by document and by entry.
    const lineRows = this.db
      .prepare(
        `SELECT je.id AS entry_id, je.source_type, je.source_id,
                COALESCE(je.entry_date, date(je.created_at, '+330 minutes')) AS entry_date,
                jl.account, jl.debit_paise, jl.credit_paise
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE jl.account IN (${accounts.map(() => "?").join(",")})
          ORDER BY je.rowid, jl.id`,
      )
      .all(...accounts) as Array<{
      entry_id: string; source_type: string; source_id: string; entry_date: string;
      account: AccountCode; debit_paise: number; credit_paise: number;
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
      const sums = new Map<AccountCode, number>();
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

      // Credit document: scale the netted lines by cumulative cash / total, per payment.
      const totalPaise = doc.totalPaise();
      if (totalPaise <= 0) continue;
      const lines = sumByAccount(docLines);
      let paidBefore = 0;
      for (const payment of paymentsOf.get(key) ?? []) {
        const paidAfter = Math.min(paidBefore + payment.amountPaise, totalPaise);
        const date = istDateOf(payment.paidAt);
        if (paidAfter > paidBefore) {
          if (inPeriod(date)) {
            const shares = allocateProportionally({
              lineAmountsPaise: lines.map((line) => line.amountPaise), totalPaise, paidBeforePaise: paidBefore, paidAfterPaise: paidAfter,
            });
            lines.forEach((line, index) => {
              const share = shares[index] as number;
              if (share !== 0) recognitions.push({ date, account: line.account, amountPaise: share, documentType: doc.type, documentId: doc.id });
            });
            if (doc.type === "INVOICE") invoiceCollections.push({ date, amountPaise: payment.amountPaise });
          }
        }
        paidBefore = paidAfter;
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
    const assets = rows.filter((row) =>
      row.account === "CASH" || row.account === "RECEIVABLES" || row.account === "INVENTORY"
      || row.account === "INPUT_CGST" || row.account === "INPUT_SGST" || row.account === "INPUT_IGST");
    // Liabilities are credit-normal: present them as credit - debit so owed amounts are positive.
    const liabilities = rows
      .filter((row) =>
        row.account === "OUTPUT_CGST" || row.account === "OUTPUT_SGST" || row.account === "OUTPUT_IGST"
        || row.account === "PAYABLES")
      .map((row) => ({ ...row, balancePaise: row.creditPaise - row.debitPaise }));
    // Retained earnings = SALES - COGS - EXPENSE (net of debit/credit), so the sheet balances.
    const netProfitPaise = rows
      .filter((row) => row.account === "SALES")
      .reduce((total, row) => total + row.creditPaise - row.debitPaise, 0)
      - rows
        .filter((row) => row.account === "COGS" || row.account === "EXPENSE")
        .reduce((total, row) => total + row.debitPaise - row.creditPaise, 0);
    const equity: readonly ReportAccountRow[] = [{
      account: "RETAINED_EARNINGS",
      debitPaise: netProfitPaise < 0 ? Math.abs(netProfitPaise) : 0,
      creditPaise: netProfitPaise > 0 ? netProfitPaise : 0,
      balancePaise: netProfitPaise,
    }];
    return {
      assets,
      liabilities,
      equity,
      totalAssetsPaise: assets.reduce((total, row) => total + row.balancePaise, 0),
      totalLiabilitiesPaise: liabilities.reduce((total, row) => total + row.balancePaise, 0),
      totalEquityPaise: netProfitPaise,
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
      date: row.created_at,
      entryDate: row.entry_date ?? row.created_at.slice(0, 10),
      description: row.description,
      isReversal: row.is_reversal === 1,
      account: row.account,
      debitPaise: row.debit_paise,
      creditPaise: row.credit_paise,
    }));
  }

  private insertJournalEntry(entry: JournalEntry, dimensions: { businessId: string; entryDate: string; fairId?: string }): void {
    postJournalEntry(this.db, entry, dimensions);
  }

  private invoiceTotal(invoice: Invoice): number {
    const taxablePaise = invoice.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0)
      - (invoice.discountPaise ?? 0)
      + (invoice.extraChargePaise ?? 0);
    return taxablePaise + Math.round(taxablePaise * (invoice.taxRateBasisPoints ?? 0) / 10000);
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
    if (creditTotal + alreadyCredited.total > this.invoiceTotal(invoice)) {
      throw new RepositoryValidationError("Credit notes cannot exceed the original invoice total.");
    }
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

  private getPaidAmount(invoiceId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS paid_paise FROM payments WHERE invoice_id = ?")
      .get(invoiceId) as { paid_paise: number };
    return row.paid_paise;
  }

  private reportConditions(filter: { businessId?: string; fairId?: string; fromDate?: string; toDate?: string; asAtDate?: string }): { where: string; params: string[] } {
    return reportConditions(filter);
  }

  private getReportAccountRows(filter: { businessId?: string; fairId?: string; fromDate?: string; toDate?: string; asAtDate?: string } = {}): readonly ReportAccountRow[] {
    const { where, params } = this.reportConditions(filter);
    const rows = this.db
      .prepare(
        `SELECT jl.account AS account, SUM(jl.debit_paise) AS debit_paise, SUM(jl.credit_paise) AS credit_paise
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         ${where}
         GROUP BY jl.account ORDER BY jl.account`,
      )
      .all(...params) as Array<{
      account: AccountCode;
      debit_paise: number;
      credit_paise: number;
    }>;
    return rows.map((row) => ({
      account: row.account,
      debitPaise: row.debit_paise,
      creditPaise: row.credit_paise,
      balancePaise: row.debit_paise - row.credit_paise,
    }));
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
        paidAt: new Date().toISOString(),
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
      this.insertAuditEvent({ action: "supplier.payment_made", entityId: sourceId, occurredAt: payment.paidAt });
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

  public getPayables(): readonly PayableRow[] {
    const now = Date.now();
    const rows: PayableRow[] = [];
    for (const bill of this.listPurchaseBills({ status: "FINALIZED" })) {
      if (bill.paymentAccount !== "PAYABLES") continue;
      rows.push({
        documentType: "BILL", documentId: bill.id, documentNumber: bill.number, supplierId: bill.supplierId,
        documentDate: bill.billDate, totalPaise: bill.totalPaise, paidPaise: bill.paidPaise,
        outstandingPaise: bill.totalPaise - bill.paidPaise,
        ageDays: Math.max(0, Math.floor((now - Date.parse(bill.billDate)) / 86400000)),
      });
    }
    for (const expense of this.listExpenses({ status: "FINALIZED" })) {
      if (expense.paymentAccount !== "PAYABLES" || expense.supplierId === null) continue;
      rows.push({
        documentType: "EXPENSE", documentId: expense.id, documentNumber: expense.number, supplierId: expense.supplierId,
        documentDate: expense.expenseDate, totalPaise: expense.totalPaise, paidPaise: expense.paidPaise,
        outstandingPaise: expense.totalPaise - expense.paidPaise,
        ageDays: Math.max(0, Math.floor((now - Date.parse(expense.expenseDate)) / 86400000)),
      });
    }
    return rows.filter((row) => row.outstandingPaise > 0);
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

  public setupAdmin(input: { password: string; email?: string; googleSub?: string; nowIso?: string }): { userId: string } {
    if (this.isAdminConfigured()) throw new RepositoryValidationError("An admin account already exists.");
    this.assertPasswordPolicy(input.password);
    const now = input.nowIso ?? new Date().toISOString();
    const userId = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO auth_users (id, role, email, google_sub, password_hash, created_at, updated_at) VALUES (?, 'ADMIN', ?, ?, ?, ?, ?)",
        )
        .run(userId, input.email ?? null, input.googleSub ?? null, hashPassword(input.password), now, now);
      this.insertAuditEvent({ action: "auth.admin_created", entityId: userId, occurredAt: now });
    })();
    return { userId };
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
  public recoverPassword(input: { googleSub?: string; email?: string; newPassword: string; nowIso?: string }): void {
    const now = input.nowIso ?? new Date().toISOString();
    const user = this.getAdminRow();
    if (user === undefined) throw new AuthenticationError("No admin account is set up yet.", 409);
    const matches =
      input.googleSub !== undefined && user.google_sub !== null
        ? input.googleSub === user.google_sub
        : input.email !== undefined && user.email !== null && input.email.toLowerCase() === user.email.toLowerCase();
    if (!matches) throw new AuthenticationError("The identity does not match the admin account.", 401);
    this.assertPasswordPolicy(input.newPassword);
    const newHash = hashPassword(input.newPassword);
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE auth_users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
        .run(newHash, now, user.id);
      this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, user.id);
      this.insertAuditEvent({ action: "auth.password_recovered", entityId: user.id, occurredAt: now });
    })();
  }

  private getAdminRow(): AuthUserRow | undefined {
    return this.db
      .prepare("SELECT id, email, google_sub, password_hash, failed_attempts, locked_until FROM auth_users ORDER BY created_at, rowid LIMIT 1")
      .get() as AuthUserRow | undefined;
  }

  private assertPasswordPolicy(password: string): void {
    const problem = passwordPolicyProblem(password);
    if (problem !== null) throw new RepositoryValidationError(problem);
  }

  private insertAuditEvent(event: AuditEvent): void {
    appendAuditEvent(this.db, event);
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
