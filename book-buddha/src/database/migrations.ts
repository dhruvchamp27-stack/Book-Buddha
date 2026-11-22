import type Database from "better-sqlite3";
import { applyBaselineSchema } from "./schema.js";
import { applyPurchasingExpensesSchema } from "./purchasing-schema.js";
import { applyJournalDimensionsSchema } from "./journal-dimensions-schema.js";
import { applyProjectDimensionSchema } from "./project-dimension-schema.js";
import { applyAttachmentsSchema } from "./attachments-schema.js";
import { applyAuditChainSchema } from "./audit-chain-schema.js";
import { applyChartOfAccountsSchema } from "./chart-accounts-schema.js";
import { applyFinancialYearsSchema } from "./financial-years-schema.js";
import { applyCreditDischargeSchema, applyCustomerCreditsSchema } from "./customer-credits-schema.js";
import { applyOpeningBalancesSchema } from "./opening-balances-schema.js";
import { applyOpeningSubLedgerSchema } from "./opening-sub-ledger-schema.js";
import { applyInterFairClearingSchema } from "./inter-fair-clearing-schema.js";
import { applyRecoveryCodeSchema } from "./recovery-code-schema.js";
import { applyPaymentCancellationSchema } from "./payment-cancellation-schema.js";
import { applyBillDiscountSchema } from "./bill-discount-schema.js";
import { applyPurchaseReturnsSchema } from "./purchase-returns-schema.js";
import { applyCreditNoteDateSchema } from "./credit-note-date-schema.js";
import { applyCashRoundingSchema } from "./cash-rounding-schema.js";
import { applyStockAdjustmentSchema } from "./stock-adjustment-schema.js";
import { applyPaymentModesSchema } from "./payment-modes-schema.js";
import { applyMoneyAccountSchema } from "./money-account-schema.js";
import { applyBankAccountsSchema } from "../banking/bank-accounts-schema.js";
import { applyMoneyMovementsSchema } from "../banking/money-movements-schema.js";
import { applyReconciliationSchema } from "../banking/reconciliation-schema.js";
import { applyStatementLinesSchema } from "../banking/statement-lines-schema.js";
import { applyBankRulesSchema } from "../banking/bank-rules-schema.js";
import { applyCashFlowSectionSchema } from "./cash-flow-section-schema.js";
import { applyQuotationLinkSchema } from "./quotation-link-schema.js";
import { applyInvoiceNumberIndexSchema } from "./invoice-number-index-schema.js";
import { applyBeforeOpeningSchema } from "./before-opening-schema.js";
import { applyLineTaxSchema } from "./line-tax-schema.js";
import { applyBillRoundOffSchema } from "./bill-round-off-schema.js";

export interface Migration {
  version: number;
  name: string;
  /**
   * Default true: `up` and the version record run in one transaction.
   * Set false ONLY when `up` must manage its own pragmas/transactions
   * (e.g. PRAGMA foreign_keys is a no-op inside a transaction).
   */
  transactional?: boolean;
  up(db: Database.Database): void;
}

export interface MigrationLogEvent {
  event: "migration_applied" | "migrations_up_to_date";
  version?: number;
  name?: string;
  at: string;
}

export type MigrationLogger = (event: MigrationLogEvent) => void;

/**
 * Ordered list. NEVER edit or reorder an applied migration; append new ones
 * with the next version number. Every migration must be non-destructive.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "baseline_schema",
    // The baseline includes legacy-upgrade steps that toggle PRAGMA foreign_keys,
    // which SQLite ignores inside a transaction. It stays outside one, exactly as
    // the pre-migration bootstrap behaved, and is fully idempotent.
    transactional: false,
    up: applyBaselineSchema,
  },
  {
    version: 2,
    name: "auth_foundation",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_users (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL DEFAULT 'ADMIN' CHECK(role IN ('ADMIN')),
          email TEXT,
          google_sub TEXT,
          password_hash TEXT NOT NULL,
          failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
          locked_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES auth_users(id),
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          expires_at TEXT,
          revoked_at TEXT
        );
      `);
    },
  },
  {
    version: 3,
    name: "customer_item_inventory",
    // Additive only: new nullable/defaulted columns plus one new table.
    // Enum/paise validation lives in the repository layer.
    up: (db) => {
      db.exec(`
        ALTER TABLE customers ADD COLUMN customer_number TEXT;
        ALTER TABLE customers ADD COLUMN classification TEXT;
        ALTER TABLE customers ADD COLUMN gstin TEXT;
        ALTER TABLE customers ADD COLUMN website TEXT;
        ALTER TABLE customers ADD COLUMN phone2 TEXT;
        ALTER TABLE customers ADD COLUMN billing_address TEXT;
        ALTER TABLE customers ADD COLUMN shipping_address TEXT;
        ALTER TABLE customers ADD COLUMN internal_notes TEXT;
        ALTER TABLE customers ADD COLUMN numbering_category TEXT;
        ALTER TABLE customers ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1));
        ALTER TABLE items ADD COLUMN description TEXT;
        ALTER TABLE items ADD COLUMN selling_price_paise INTEGER;
        ALTER TABLE items ADD COLUMN cost_price_paise INTEGER;
        ALTER TABLE items ADD COLUMN mrp_paise INTEGER;
        ALTER TABLE items ADD COLUMN reorder_threshold INTEGER;
        ALTER TABLE items ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1));
        CREATE TABLE IF NOT EXISTS customer_number_counters (
          company_id TEXT NOT NULL,
          category TEXT NOT NULL,
          next_seq INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (company_id, category)
        );
      `);
    },
  },
  {
    version: 4,
    name: "purchasing_expenses",
    // Rebuilds journal_entries / journal_lines / stock_movements, which needs
    // PRAGMA foreign_keys = OFF (a no-op inside a transaction), so it manages its own.
    transactional: false,
    up: applyPurchasingExpensesSchema,
  },
  {
    version: 5,
    name: "journal_business_and_date",
    // Additive: two nullable columns on journal_entries, backfilled from each entry source
    // document. Default (transactional) so a failed assertion rolls everything back.
    up: applyJournalDimensionsSchema,
  },
  {
    version: 6,
    name: "project_dimension",
    // Additive: a nullable (permanently optional) fair_id on journal entries, stock movements,
    // purchase bills and expenses; journal entries backfilled from their source invoice.
    // Default (transactional) so a failed gate rolls everything back.
    up: applyProjectDimensionSchema,
  },
  {
    version: 7,
    name: "attachments",
    // Additive: one new table (plus its index) for document metadata. The files themselves
    // live on disk outside the database, so nothing here touches existing rows.
    // Default (transactional) so a failed create rolls back.
    up: applyAttachmentsSchema,
  },
  {
    version: 8,
    name: "audit_hardening",
    // Additive: ALTER TABLE ADD COLUMN for the section-20 audit fields plus the hash-chain
    // columns, a backfill of the chain over existing rows, and the append-only / immutability
    // triggers. Never a table rebuild, so no cascade-delete hazard.
    // Default (transactional) so a failed backfill rolls the whole thing back.
    up: applyAuditChainSchema,
  },
  {
    version: 9,
    name: "chart_of_accounts",
    // Rebuilds journal_lines to drop the fixed account CHECK in favour of an FK + trigger against
    // the new chart_accounts table, so accounts can be created at runtime (decision S2-1). The
    // rebuild needs PRAGMA foreign_keys = OFF (a no-op inside a transaction), so it manages its own.
    transactional: false,
    up: applyChartOfAccountsSchema,
  },
  {
    version: 10,
    name: "financial_years",
    // Additive: one new table (plus its indexes) for financial years and their lock state.
    // Nothing existing is touched. Default (transactional) so a failed create rolls back.
    up: applyFinancialYearsSchema,
  },
  {
    version: 11,
    name: "customer_credits",
    // Rebuilds chart_accounts to widen the `role` CHECK so CUSTOMER_CREDITS can exist (S4-1),
    // and seeds the accounts added since v9 - CUSTOMER_CREDITS and UNCATEGORIZED_INCOME (S4-4).
    // The rebuild must drop and replay EVERY trigger whose body mentions chart_accounts,
    // including journal_lines_account_exists which lives on another table: SQLite re-parses
    // triggers during ALTER TABLE ... RENAME and the rename fails otherwise. Like v9 it needs
    // PRAGMA foreign_keys = OFF, a no-op inside a transaction, so it manages its own.
    transactional: false,
    up: applyCustomerCreditsSchema,
  },
  {
    version: 12,
    name: "credit_discharge",
    // Additive: the two tables a credit note is discharged through - refunds and applications
    // against a later invoice (S4-5) - plus credit_notes.refundable_paise, which persists how
    // much of a note was NOT set against an open balance. Default (transactional).
    up: applyCreditDischargeSchema,
  },
  {
    version: 13,
    name: "opening_balances",
    // Additive: the opening-balance set and its lines (S14), plus the accounts added since v11 -
    // STOCK_ADJUSTMENT, the expense side of a mid-year stock adjustment (S5-3). It seeds from the
    // FROZEN V13_ADDED_ACCOUNTS, never the live list: v11 reads V11_SEED_ACCOUNTS for the same
    // reason, so a fresh database and the owner's take the identical path. The role CHECK is
    // untouched (STOCK_ADJUSTMENT is an EXPENSE with no role), so no table rebuild is needed and
    // this can stay transactional.
    up: applyOpeningBalancesSchema,
  },
  {
    version: 14,
    name: "opening_sub_ledger",
    // Additive: the opening CUSTOMER and SUPPLIER balances, and the two tables they are settled
    // through. Their own settlement tables on purpose - payments.payment_account is still
    // CHECK IN ('CASH'), so BANK is unusable there; credit-note refunds already dodge it the same
    // way. An opening customer balance carries the income figure behind it (S5-2), which is what
    // the cash view recognises proportionately on each receipt. Default (transactional).
    up: applyOpeningSubLedgerSchema,
  },
  {
    version: 15,
    name: "inter_fair_clearing",
    // Additive: seeds INTER_FAIR_CLEARING (S5-11), the account a cross-fair credit application
    // passes through so CUSTOMER_CREDITS nets to zero inside the fair that created it. An ASSET
    // with no role, so the role CHECK is untouched and no table is rebuilt. Seeds from the FROZEN
    // V15_ADDED_ACCOUNTS for the same reason v11 and v13 do: a live list would hand the account to
    // a fresh database at an EARLIER version, this migration's guard would then skip, and its
    // first real run would be on the owner's database. Default (transactional).
    up: applyInterFairClearingSchema,
  },
  {
    version: 16,
    name: "recovery_code",
    // Additive: one nullable column on auth_users holding the HASH of the admin's recovery code
    // (S6-3). Closes the hole where an email match alone could reset the password. No table is
    // rebuilt, so no trigger needs replaying, and nothing is backfilled — an admin created before
    // v16 keeps a NULL, and recovery on such a row refuses rather than falling back to the old
    // email match. Default (transactional).
    up: applyRecoveryCodeSchema,
  },
  {
    version: 17,
    name: "payment_cancellation",
    // Additive: two nullable columns on payments and supplier_payments, marking a payment
    // cancelled without deleting it (R8). No table is rebuilt, so no trigger needs replaying,
    // and nothing is backfilled -- every payment that exists today is a live one, which is
    // exactly what `cancelled_at IS NULL` means. The reversing journal entry is posted by the
    // repository through the normal door, never by this migration. Default (transactional).
    up: applyPaymentCancellationSchema,
  },
  {
    version: 18,
    name: "bill_discount",
    // Additive: two NOT NULL DEFAULT 0 columns on purchase_bills and two new chart accounts
    // (PURCHASE_DISCOUNT, PURCHASE_EXTRA_CHARGES), seeded from the FROZEN V18 list. No table is
    // rebuilt, so no trigger needs replaying, and nothing is backfilled -- a bill finalized before
    // v18 had no discount, and re-deriving its posted entry would rewrite history.
    // Default (transactional).
    up: applyBillDiscountSchema,
  },
  {
    version: 19,
    name: "purchase_returns",
    // Additive: purchase_returns, purchase_return_lines and supplier_refunds are new tables, plus
    // SUPPLIER_CREDITS from the FROZEN V19 list. No existing table is altered or rebuilt, so no
    // trigger needs replaying, and there is nothing to backfill. Default (transactional).
    up: applyPurchaseReturnsSchema,
  },
  {
    version: 20,
    name: "credit_note_date",
    // Additive: one nullable column, credit_notes.note_date (S11-4). The table is not rebuilt, so
    // no trigger needs replaying. Backfilled so no posted figure moves: a posted note takes its
    // entry's entry_date, any other stays NULL (no date given, S11-20). Guarded: a FINALIZED note left
    // undated throws and rolls the whole of v20 back. Default (transactional).
    up: applyCreditNoteDateSchema,
  },
  {
    version: 21,
    name: "cash_rounding",
    // Additive: seeds ROUNDING (INCOME, no role) from the FROZEN V21 list, so the derived cash view
    // can show the paise by which per-line rounding differs from the cash that moved. No table is
    // rebuilt, nothing is backfilled. Default (transactional).
    up: applyCashRoundingSchema,
  },
  {
    version: 22,
    name: "stock_adjustment",
    // Rebuilds stock_movements ONCE to widen the movement_type CHECK with ADJUSTMENT_OUT and
    // ADJUSTMENT_REVERSAL (ruling S10-4). rowid and fair_id are copied, both indexes are recreated,
    // any trigger on the table is replayed, and a changed column set makes it throw. No account, no
    // seed list, nothing backfilled. Default (transactional): nothing references stock_movements,
    // so no foreign key needs switching off.
    up: applyStockAdjustmentSchema,
  },
  {
    version: 23,
    name: "payment_modes",
    // Additive: one new table, payment_modes, seeded from the FROZEN V23 list (Cash, NEFT, RTGS,
    // IMPS, UPI, Cheque, Other; spec §9.1, ruling S15). No table is rebuilt, nothing is backfilled.
    // R12 shared contract. Default (transactional).
    up: applyPaymentModesSchema,
  },
  {
    version: 24,
    name: "money_account",
    // Additive, no table rebuild: money_account / payment_mode / payment_reference on nine tables,
    // backfilled ('CASH', or the old CASH/BANK payment_account where that already named it), plus
    // BEFORE INSERT/UPDATE triggers. The old payment_account columns keep their CHECKs and meaning.
    // R12b. Default (transactional).
    up: applyMoneyAccountSchema,
  },
  {
    version: 25,
    name: "bank_accounts",
    // Additive: one side table, bank_accounts (kind CURRENT/SAVINGS/OVERDRAFT/CASH_CREDIT, bank name,
    // last 4 digits, IFSC, part_of_cash_management, sanctioned limit) keyed on a BANK-role chart
    // account. OD/CC are chart type LIABILITY (ruling S15-4). R12a. Default (transactional).
    up: applyBankAccountsSchema,
  },
  {
    version: 26,
    name: "money_movements",
    // Additive: internal_transfers, vouchers, voucher_lines (Internal Transfers TRF-, Receipt
    // Vouchers RV-, Payment Vouchers PV-; numbered per company per financial year). R12c.
    up: applyMoneyMovementsSchema,
  },
  {
    version: 27,
    name: "bank_reconciliations",
    // Additive: bank_reconciliations + bank_reconciliation_lines. Posted journal lines are never
    // touched; reconciliation state lives only in these tables. R12d.
    up: applyReconciliationSchema,
  },
  {
    version: 28,
    name: "bank_statement_lines",
    // Additive: bank_statement_imports, bank_statement_lines (held OUTSIDE the books, "For review"),
    // bank_statement_line_links (a line → the journal line it became or was matched to; one journal
    // line belongs to at most one statement line). R12 set two shared contract.
    up: applyStatementLinesSchema,
  },
  {
    version: 29,
    name: "bank_rules",
    // Additive: bank_rules + bank_rule_conditions. Rules only PRE-FILL a suggestion for a statement
    // line (FD §D5); they never post. R12g.
    up: applyBankRulesSchema,
  },
  {
    version: 30,
    name: "cash_flow_section",
    // Additive: chart_accounts.cash_flow_section (OPERATING/INVESTING/FINANCING, NULL = derive).
    // ALTER TABLE ADD COLUMN, no rebuild. R13 direct-method Cash Flow Statement (ruling S17-6).
    up: applyCashFlowSectionSchema,
  },
  {
    version: 31,
    name: "quotation_link",
    // Additive: invoices.source_quotation_id (nullable, → invoices.id) + index. An invoice made from
    // a quotation keeps a link to it (ruling S17-4). ALTER TABLE ADD COLUMN, no rebuild.
    up: applyQuotationLinkSchema,
  },
  {
    version: 32,
    name: "invoice_number_index",
    // Additive: index invoices(business_id, number) - the per-save number check and the S17-4 series
    // read stop scanning every invoice of the business (R10 2,000-invoice timing). Not unique (D11).
    up: applyInvoiceNumberIndexSchema,
  },
  {
    version: 33,
    name: "before_opening",
    // Additive: before_opening 0/1 on invoices, purchase_bills, expenses, credit_notes,
    // purchase_returns, payments, supplier_payments. Items dated on/before the opening date are kept
    // as HISTORY, never posted (rulings S16-2(c), Q13, S17-12). ALTER TABLE ADD COLUMN, no rebuild.
    up: applyBeforeOpeningSchema,
  },
  {
    version: 34,
    name: "line_tax",
    // Additive: tax_rate_basis_points on the five document LINE tables (backfilled from the document,
    // notes and returns joining through to the parent), items.default_tax_rate_basis_points as an
    // optional pre-fill, invoices.round_off_paise and invoices.total_paise (the STORED rounded total,
    // backfilled to open-items.ts's current figures so no receivable moves), the two reverses-link
    // columns, and the roleless ROUND_OFF account. GST per line + rupee round-off (rulings S18-3
    // I-Q1..I-Q10, S18-5 I-Q11..I-Q14). ALTER TABLE ADD COLUMN, no rebuild.
    up: applyLineTaxSchema,
  },
  {
    version: 35,
    name: "bill_round_off",
    // Additive: an OPTIONAL signed round_off_paise on purchase_bills and expenses, capped below one
    // rupee by CHECK, so a bill can match the supplier's printed total (ruling I-Q6, confirmed
    // 22 Nov). NOT calculated - unlike an invoice, a bill only carries what the owner types.
    // Nothing is backfilled: every existing row keeps 0 from the DEFAULT, so no posted bill or
    // expense moves. ALTER TABLE ADD COLUMN, no rebuild.
    up: applyBillRoundOffSchema,
  },
];

export function runMigrations(
  db: Database.Database,
  list: readonly Migration[] = migrations,
  log: MigrationLogger = () => undefined,
): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((r) => r.version),
  );
  const ordered = [...list].sort((a, b) => a.version - b.version);
  const record = db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
  const ran: number[] = [];
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    const apply = (): void => {
      migration.up(db);
      record.run(migration.version, migration.name, new Date().toISOString());
    };
    if (migration.transactional === false) {
      apply();
    } else {
      db.transaction(apply)();
    }
    ran.push(migration.version);
    log({ event: "migration_applied", version: migration.version, name: migration.name, at: new Date().toISOString() });
  }
  if (ran.length === 0) log({ event: "migrations_up_to_date", at: new Date().toISOString() });
  return ran;
}

/** Compatibility shim for the previous bootstrap entry point. */
export function initializeSchema(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  runMigrations(db);
}
