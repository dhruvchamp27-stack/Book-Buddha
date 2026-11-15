import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { cancelInvoice, finalizeInvoice } from "../accounting/engine.js";
import type {
  AccountCode,
  AuditEvent,
  CreditNote,
  CreditNoteLine,
  Invoice,
  InvoiceLine,
  JournalEntry,
  Payment,
} from "../accounting/types.js";
import type { AccountingBasis } from "../accounting/types.js";
import { advanceRunDate, isValidIsoDate, type RecurrenceFrequency } from "../accounting/recurrence.js";
import { runMigrations } from "./migrations.js";
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
}

export interface ItemInput {
  readonly id?: string;
  readonly companyId: string;
  readonly name: string;
  readonly unit: string;
  readonly trackStock?: boolean;
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
  readonly date: string;
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
  readonly movementType: StockMovementType | "SALE" | "SALE_REVERSAL";
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
}

export interface ItemRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly unit: string;
  readonly trackStock: boolean;
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

export class RepositoryValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepositoryValidationError";
  }
}

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
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        "INSERT INTO customers (id, company_id, name, email, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.companyId,
        input.name,
        input.email ?? null,
        input.phone ?? null,
        new Date().toISOString(),
      );
    return id;
  }

  public createItem(input: ItemInput): string {
    this.requireCompany(input.companyId);
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        "INSERT INTO items (id, company_id, name, unit, track_stock, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.companyId,
        input.name,
        input.unit,
        input.trackStock === true ? 1 : 0,
        new Date().toISOString(),
      );
    return id;
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
  }): StockMovement {
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
    };
    this.db.prepare(
      "INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(movement.id, movement.itemId, null, movement.movementType, movement.quantityDelta, movement.unitCostPaise, movement.occurredAt);
    this.insertAuditEvent({ action: "stock.movement_added", entityId: movement.itemId, occurredAt: movement.occurredAt });
    return movement;
  }

  public listStockMovements(itemId?: string): readonly StockMovement[] {
    const statement = itemId === undefined
      ? this.db.prepare("SELECT id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at FROM stock_movements ORDER BY occurred_at, rowid")
      : this.db.prepare("SELECT id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at FROM stock_movements WHERE item_id = ? ORDER BY occurred_at, rowid");
    const rows = (itemId === undefined ? statement.all() : statement.all(itemId)) as Array<{
      id: string; item_id: string; source_id: string | null; movement_type: StockMovement["movementType"];
      quantity_delta: number; unit_cost_paise: number; occurred_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id, itemId: row.item_id, sourceId: row.source_id, movementType: row.movement_type,
      quantityDelta: row.quantity_delta, unitCostPaise: row.unit_cost_paise, occurredAt: row.occurred_at,
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

  public listCustomers(companyId?: string): readonly CustomerRecord[] {
    const statement = companyId === undefined
      ? this.db.prepare("SELECT id, company_id, name, email, phone FROM customers ORDER BY name, id")
      : this.db.prepare("SELECT id, company_id, name, email, phone FROM customers WHERE company_id = ? ORDER BY name, id");
    const rows = (companyId === undefined ? statement.all() : statement.all(companyId)) as Array<{
      id: string;
      company_id: string;
      name: string;
      email: string | null;
      phone: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
    }));
  }

  public listItems(companyId?: string): readonly ItemRecord[] {
    const statement = companyId === undefined
      ? this.db.prepare("SELECT id, company_id, name, unit, track_stock FROM items ORDER BY name, id")
      : this.db.prepare("SELECT id, company_id, name, unit, track_stock FROM items WHERE company_id = ? ORDER BY name, id");
    const rows = (companyId === undefined ? statement.all() : statement.all(companyId)) as Array<{
      id: string;
      company_id: string;
      name: string;
      unit: string;
      track_stock: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      unit: row.unit,
      trackStock: row.track_stock === 1,
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
      const inventoryCost = this.restoreCreditNoteStock(note);
      this.insertJournalEntry(entry);
      if (inventoryCost > 0) {
        this.insertJournalEntry({
          id: `je-credit-note-inventory-${note.id}`,
          sourceId: invoice.id,
          description: `Inventory returned for credit note ${note.number}`,
          lines: [{ account: "INVENTORY", debitPaise: inventoryCost, creditPaise: 0 }, { account: "COGS", debitPaise: 0, creditPaise: inventoryCost }],
          isReversal: false,
        });
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
      const accountingBasis = this.getInvoiceAccountingBasis(invoice);
      if (accountingBasis === "ACCRUAL" || invoice.paymentAccount === "CASH") {
        this.insertJournalEntry(result.journalEntry);
      }
      if (inventoryCostPaise > 0) {
        this.insertJournalEntry(this.inventoryJournalEntry(invoice, inventoryCostPaise, false));
      }
      this.insertAuditEvent(result.auditEvent);
      return accountingBasis === "CASH" && invoice.paymentAccount === "RECEIVABLES"
        ? {
            id: `je-pending-${invoice.id}`,
            sourceId: invoice.id,
            description: `Cash-basis invoice ${invoice.number} pending payment recognition`,
            lines: [],
            isReversal: false,
          }
        : result.journalEntry;
    })();
    return finalized;
  }

  public cancelInvoice(invoiceId: string): JournalEntry {
    const cancelled = this.db.transaction(() => {
      const invoice = this.getInvoice(invoiceId);
      const cashBasisDeferred = this.getInvoiceAccountingBasis(invoice) === "CASH"
        && invoice.paymentAccount === "RECEIVABLES";
      if (cashBasisDeferred && this.getPaidAmount(invoiceId) > 0) {
        throw new RepositoryValidationError("A cash-basis invoice with recorded payments cannot be cancelled yet.");
      }
      const originalEntry = cashBasisDeferred ? undefined : this.getOriginalJournalEntry(invoiceId);
      const result = originalEntry === undefined
        ? {
            invoice: { ...invoice, status: "CANCELLED" as const },
            reversalEntry: {
              id: `je-${invoice.id}-reversal`,
              sourceId: invoice.id,
              description: `Cancellation of invoice ${invoice.number}`,
              lines: [],
              isReversal: true,
            },
            auditEvent: {
              action: "invoice.cancelled",
              entityId: invoice.id,
              occurredAt: new Date().toISOString(),
            },
          }
        : cancelInvoice(invoice, originalEntry);
      const inventoryCostPaise = this.restoreInvoiceStock(invoiceId);
      this.db
        .prepare("UPDATE invoices SET status = ? WHERE id = ?")
        .run(result.invoice.status, invoiceId);
      if (result.reversalEntry.lines.length > 0) {
        this.insertJournalEntry(result.reversalEntry);
      }
      if (inventoryCostPaise > 0) {
        this.insertJournalEntry(this.inventoryJournalEntry(invoice, inventoryCostPaise, true));
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
      const paymentLines = this.getInvoiceAccountingBasis(invoice) === "CASH"
        ? this.cashBasisPaymentLines(invoice, amountPaise)
        : [
            { account: "CASH" as const, debitPaise: amountPaise, creditPaise: 0 },
            { account: "RECEIVABLES" as const, debitPaise: 0, creditPaise: amountPaise },
          ];
      this.insertJournalEntry({
        id: `je-payment-${result.id}`,
        sourceId: invoiceId,
        description: `Payment for invoice ${invoice.number}`,
        isReversal: false,
        lines: paymentLines,
      });
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

  public getTrialBalance(): readonly TrialBalanceRow[] {
    const rows = this.db
      .prepare(
        `SELECT account, SUM(debit_paise) AS debit_paise, SUM(credit_paise) AS credit_paise
         FROM journal_lines GROUP BY account ORDER BY account`,
      )
      .all() as Array<{
      account: AccountCode;
      debit_paise: number;
      credit_paise: number;
    }>;
    return rows.map((row) => ({
      account: row.account,
      debitPaise: row.debit_paise,
      creditPaise: row.credit_paise,
    }));
  }

  public getProfitAndLoss(): ProfitAndLossReport {
    const rows = this.getReportAccountRows();
    const income = rows.filter((row) => row.account === "SALES");
    const expenses = rows.filter((row) => row.account === "COGS");
    const totalIncomePaise = income.reduce((total, row) => total + row.creditPaise - row.debitPaise, 0);
    const totalExpensesPaise = expenses.reduce((total, row) => total + row.debitPaise - row.creditPaise, 0);
    return {
      income,
      expenses,
      totalIncomePaise,
      totalExpensesPaise,
      netProfitPaise: totalIncomePaise - totalExpensesPaise,
    };
  }

  public getBalanceSheet(): BalanceSheetReport {
    const rows = this.getReportAccountRows();
    const assets = rows.filter((row) => row.account === "CASH" || row.account === "RECEIVABLES" || row.account === "INVENTORY");
    const liabilities = rows.filter((row) =>
      row.account === "OUTPUT_CGST" || row.account === "OUTPUT_SGST" || row.account === "OUTPUT_IGST");
    const netProfitPaise = rows
      .filter((row) => row.account === "SALES")
      .reduce((total, row) => total + row.creditPaise - row.debitPaise, 0);
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

  public getGeneralLedger(): readonly GeneralLedgerRow[] {
    const rows = this.db
      .prepare(
        `SELECT je.id AS journal_entry_id, je.source_id, je.created_at, je.description,
                je.is_reversal, jl.account, jl.debit_paise, jl.credit_paise
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         ORDER BY je.created_at, je.id, jl.id`,
      )
      .all() as Array<{
      journal_entry_id: string;
      source_id: string;
      created_at: string;
      description: string;
      is_reversal: number;
      account: AccountCode;
      debit_paise: number;
      credit_paise: number;
    }>;
    return rows.map((row) => ({
      journalEntryId: row.journal_entry_id,
      sourceId: row.source_id,
      date: row.created_at,
      description: row.description,
      isReversal: row.is_reversal === 1,
      account: row.account,
      debitPaise: row.debit_paise,
      creditPaise: row.credit_paise,
    }));
  }

  private insertJournalEntry(entry: JournalEntry): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(entry.id, entry.sourceId, entry.description, entry.isReversal ? 1 : 0, now);
    const statement = this.db.prepare(
      "INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES (?, ?, ?, ?)",
    );
    for (const line of entry.lines) {
      statement.run(
        entry.id,
        line.account,
        line.debitPaise,
        line.creditPaise,
      );
    }
  }

  private invoiceTotal(invoice: Invoice): number {
    const taxablePaise = invoice.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0)
      - (invoice.discountPaise ?? 0)
      + (invoice.extraChargePaise ?? 0);
    return taxablePaise + Math.round(taxablePaise * (invoice.taxRateBasisPoints ?? 0) / 10000);
  }

  private getInvoiceAccountingBasis(invoice: Invoice): AccountingBasis {
    const row = this.db.prepare(
      "SELECT c.accounting_basis FROM businesses b JOIN companies c ON c.id = b.company_id WHERE b.id = ?",
    ).get(invoice.businessId) as { accounting_basis: AccountingBasis } | undefined;
    if (row === undefined) throw new RepositoryValidationError("The invoice business company was not found.");
    return row.accounting_basis;
  }

  private cashBasisPaymentLines(invoice: Invoice, amountPaise: number): JournalEntry["lines"] {
    const taxableTotal = invoice.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0)
      - (invoice.discountPaise ?? 0) + (invoice.extraChargePaise ?? 0);
    const invoiceTotal = this.invoiceTotal(invoice);
    const taxablePayment = invoiceTotal === 0 ? 0 : Math.round(amountPaise * taxableTotal / invoiceTotal);
    const taxPayment = amountPaise - taxablePayment;
    const taxType = invoice.taxType ?? "NONE";
    const taxLines: JournalEntry["lines"] = taxType === "IGST"
      ? [{ account: "OUTPUT_IGST", debitPaise: 0, creditPaise: taxPayment }]
      : taxType === "CGST_SGST"
        ? [
            { account: "OUTPUT_CGST", debitPaise: 0, creditPaise: Math.floor(taxPayment / 2) },
            { account: "OUTPUT_SGST", debitPaise: 0, creditPaise: taxPayment - Math.floor(taxPayment / 2) },
          ]
        : [];
    return [
      { account: "CASH", debitPaise: amountPaise, creditPaise: 0 },
      { account: "SALES", debitPaise: 0, creditPaise: taxablePayment },
      ...taxLines,
    ];
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

  private restoreCreditNoteStock(note: CreditNote): number {
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

  private restoreInvoiceStock(invoiceId: string): number {
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

  private getStockLayers(itemId: string): Array<{ quantity: number; unitCostPaise: number }> {
    const rows = this.db.prepare(
      "SELECT quantity_delta, unit_cost_paise FROM stock_movements WHERE item_id = ? ORDER BY occurred_at, rowid",
    ).all(itemId) as Array<{ quantity_delta: number; unit_cost_paise: number }>;
    const layers: Array<{ quantity: number; unitCostPaise: number }> = [];
    for (const row of rows) {
      if (row.quantity_delta > 0) {
        layers.push({ quantity: row.quantity_delta, unitCostPaise: row.unit_cost_paise });
        continue;
      }
      let remaining = Math.abs(row.quantity_delta);
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
    movementType: "SALE" | "SALE_REVERSAL";
    quantityDelta: number;
    unitCostPaise: number;
  }): void {
    this.db.prepare(
      "INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), input.itemId, input.sourceId, input.movementType, input.quantityDelta, input.unitCostPaise, new Date().toISOString());
  }

  private getPaidAmount(invoiceId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS paid_paise FROM payments WHERE invoice_id = ?")
      .get(invoiceId) as { paid_paise: number };
    return row.paid_paise;
  }

  private getReportAccountRows(): readonly ReportAccountRow[] {
    const rows = this.db
      .prepare(
        `SELECT account, SUM(debit_paise) AS debit_paise, SUM(credit_paise) AS credit_paise
         FROM journal_lines GROUP BY account ORDER BY account`,
      )
      .all() as Array<{
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
    this.db
      .prepare(
        "INSERT INTO audit_events (action, entity_id, occurred_at) VALUES (?, ?, ?)",
      )
      .run(event.action, event.entityId, event.occurredAt);
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
