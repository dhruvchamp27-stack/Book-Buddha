import type Database from "better-sqlite3";
import { RepositoryValidationError } from "./errors.js";
import { assertReportFairExists, reportConditions } from "./report-filters-sql.js";

/**
 * R7 part one: the transaction and stock-movement reports (spec section 13).
 *
 * Every function takes a `better-sqlite3` handle first so it can be wired into the repository and the
 * HTTP API without this file touching either. All are ACCRUAL / as-posted: none offers a cash basis,
 * because that would have to call `AccountingRepository.deriveCashView`, and a second proportional
 * formula is how defects S3-4 and S3-5 happened.
 *
 * The journal reports are anchored on journal_entries (alias `je`), so they reuse `reportConditions`
 * for business, fair and dates - all on `je.entry_date`, the TRANSACTION date, never `created_at`
 * (the posting timestamp; GeneralLedgerRow.date still exposes that one, which these reports avoid).
 * An account's class and role always come from a JOIN to chart_accounts, never a list of codes.
 *
 * Filters are applied in SQL. Leaving a filter out means "everything", untagged entries included.
 */

export interface TransactionReportFilter {
  readonly businessId?: string;
  readonly fairId?: string;
  /** Entries sourced from this customer's invoices (the invoice, its payments, credit notes, stock cost). */
  readonly customerId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface TransactionListRow {
  /** The transaction date (journal_entries.entry_date). */
  readonly date: string;
  readonly entryId: string;
  readonly description: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly isReversal: boolean;
  readonly businessId: string | null;
  readonly businessName: string;
  readonly fairId: string | null;
  readonly fairName: string;
  /** The entry's total value: the sum of its debits (which equals the sum of its credits). */
  readonly totalPaise: number;
}

export interface TransactionDetailRow {
  readonly date: string;
  readonly entryId: string;
  readonly description: string;
  readonly sourceType: string;
  readonly businessId: string | null;
  readonly fairId: string | null;
  readonly debitPaise: number;
  readonly creditPaise: number;
  /** Running balance in the account's natural direction (debit-natural for ASSET/EXPENSE, else credit-natural). */
  readonly balancePaise: number;
}

export interface TransactionDetailAccount {
  readonly account: string;
  readonly accountName: string;
  readonly type: string;
  readonly role: string | null;
  /** The balance carried in from before the from date (0 with no from date), under the same business/fair/customer scope. */
  readonly openingBalancePaise: number;
  readonly rows: readonly TransactionDetailRow[];
  readonly totalDebitPaise: number;
  readonly totalCreditPaise: number;
  readonly closingBalancePaise: number;
}

/** Stock has no business dimension, so there is deliberately no `businessId` here. */
export interface StockMovementFilter {
  readonly itemId?: string;
  readonly fairId?: string;
  /** Movements that came from this customer's invoices or credit notes (sales and returns). */
  readonly customerId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface StockMovementRow {
  readonly movementId: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  /** Calendar date in IST of occurredAt - the same convention every business date in the app uses. */
  readonly date: string;
  readonly occurredAt: string;
  /** OPENING, PURCHASE, SALE, ADJUSTMENT, plus SALE_REVERSAL and PURCHASE_REVERSAL for the undo of those. */
  readonly movementType: string;
  readonly sourceId: string | null;
  readonly fairId: string | null;
  readonly quantityIn: number;
  readonly quantityOut: number;
  readonly unitCostPaise: number;
  /** Signed: quantity moved x unit cost, negative for stock going out. */
  readonly valuePaise: number;
  /** TRUE stock on hand after this movement, counting every earlier movement even outside the period. */
  readonly quantityOnHand: number;
}

function refuseFilter(reportName: string, filter: object, key: string, label: string, hint: string): void {
  if ((filter as Record<string, unknown>)[key] !== undefined) {
    throw new RepositoryValidationError(`${reportName} cannot be filtered by ${label}: ${hint}`);
  }
}

/** Extra bound conditions appended to a `reportConditions` clause, parameters kept in order. */
function appendConditions(
  base: { where: string; params: string[] },
  extras: ReadonlyArray<{ sql: string; param?: string }>,
): { where: string; params: string[] } {
  if (extras.length === 0) return base;
  const sql = extras.map((extra) => extra.sql).join(" AND ");
  return {
    where: base.where === "" ? `WHERE ${sql}` : `${base.where} AND ${sql}`,
    params: [...base.params, ...extras.flatMap((extra) => (extra.param === undefined ? [] : [extra.param]))],
  };
}

/** Customer scope on the journal: entries whose source is one of that customer's invoices. */
function customerCondition(filter: TransactionReportFilter): Array<{ sql: string; param?: string }> {
  return filter.customerId === undefined
    ? []
    : [{
        sql: "je.source_type = 'INVOICE' AND EXISTS (SELECT 1 FROM invoices ci WHERE ci.id = je.source_id AND ci.customer_id = ?)",
        param: filter.customerId,
      }];
}

/** Every posted journal entry in the period, in date order, one row per entry. */
export function transactionListByDate(db: Database.Database, filter: TransactionReportFilter = {}): readonly TransactionListRow[] {
  refuseFilter("The transaction list", filter, "itemId", "item", "journal entries are posted per document, not per item. Use the stock movement report.");
  assertReportFairExists(db, filter.fairId);
  const { where, params } = appendConditions(reportConditions(filter), customerCondition(filter));
  const rows = db.prepare(
    `SELECT je.entry_date, je.id, je.description, je.source_type, je.source_id, je.is_reversal,
            je.business_id, COALESCE(b.name, '(No business)') AS business_name,
            je.fair_id, COALESCE(f.name, '(No fair)') AS fair_name,
            (SELECT COALESCE(SUM(jl.debit_paise), 0) FROM journal_lines jl WHERE jl.journal_entry_id = je.id) AS total_paise
       FROM journal_entries je
       LEFT JOIN businesses b ON b.id = je.business_id
       LEFT JOIN fairs f ON f.id = je.fair_id
       ${where}
      ORDER BY je.entry_date, je.created_at, je.rowid`,
  ).all(...params) as Array<{
    entry_date: string | null; id: string; description: string; source_type: string; source_id: string; is_reversal: number;
    business_id: string | null; business_name: string; fair_id: string | null; fair_name: string; total_paise: number;
  }>;
  return rows.map((row) => ({
    date: row.entry_date ?? "",
    entryId: row.id,
    description: row.description,
    sourceType: row.source_type,
    sourceId: row.source_id,
    isReversal: row.is_reversal === 1,
    businessId: row.business_id,
    businessName: row.business_name,
    fairId: row.fair_id,
    fairName: row.fair_name,
    totalPaise: row.total_paise,
  }));
}

const DEBIT_NATURAL = new Set(["ASSET", "EXPENSE"]);

/**
 * One row per journal LINE, grouped by account, each with a running balance, so the owner can see what
 * made up an account's movement. An account appears only if it has at least one line in the period.
 * Its opening balance is the net of every earlier line under the same business / fair / customer scope,
 * so the running balance is the true ledger balance and not one that restarts at zero on the from date.
 */
export function transactionDetailByAccount(db: Database.Database, filter: TransactionReportFilter = {}): readonly TransactionDetailAccount[] {
  refuseFilter("The transaction detail", filter, "itemId", "item", "journal lines are posted per document, not per item. Use the stock movement report.");
  assertReportFairExists(db, filter.fairId);
  const customer = customerCondition(filter);
  // reportConditions validates the dates (and refuses from > to) once, for the whole filter.
  const { where, params } = appendConditions(reportConditions(filter), customer);
  const lines = db.prepare(
    `SELECT jl.account, ca.name AS account_name, ca.type, ca.role,
            je.entry_date, je.id AS entry_id, je.description, je.source_type, je.business_id, je.fair_id,
            jl.debit_paise, jl.credit_paise
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       JOIN chart_accounts ca ON ca.code = jl.account
       ${where}
      ORDER BY jl.account, je.entry_date, je.created_at, je.rowid, jl.id`,
  ).all(...params) as Array<{
    account: string; account_name: string; type: string; role: string | null;
    entry_date: string | null; entry_id: string; description: string; source_type: string;
    business_id: string | null; fair_id: string | null; debit_paise: number; credit_paise: number;
  }>;

  const opening = new Map<string, { debit: number; credit: number }>();
  if (filter.fromDate !== undefined) {
    const scope = appendConditions(
      reportConditions({
        ...(filter.businessId === undefined ? {} : { businessId: filter.businessId }),
        ...(filter.fairId === undefined ? {} : { fairId: filter.fairId }),
      }),
      [...customer, { sql: "je.entry_date < ?", param: filter.fromDate }],
    );
    const rows = db.prepare(
      `SELECT jl.account, COALESCE(SUM(jl.debit_paise), 0) AS debit, COALESCE(SUM(jl.credit_paise), 0) AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         ${scope.where}
        GROUP BY jl.account`,
    ).all(...scope.params) as Array<{ account: string; debit: number; credit: number }>;
    for (const row of rows) opening.set(row.account, { debit: row.debit, credit: row.credit });
  }

  const groups: TransactionDetailAccount[] = [];
  let current: { group: Omit<TransactionDetailAccount, "closingBalancePaise" | "totalDebitPaise" | "totalCreditPaise" | "rows">; rows: TransactionDetailRow[]; debit: number; credit: number; balance: number; natural: number } | undefined;
  const close = (): void => {
    if (current === undefined) return;
    groups.push({ ...current.group, rows: current.rows, totalDebitPaise: current.debit, totalCreditPaise: current.credit, closingBalancePaise: current.balance });
  };
  for (const line of lines) {
    if (current === undefined || current.group.account !== line.account) {
      close();
      const carried = opening.get(line.account) ?? { debit: 0, credit: 0 };
      const natural = DEBIT_NATURAL.has(line.type) ? 1 : -1;
      const openingBalance = natural * (carried.debit - carried.credit);
      current = {
        group: { account: line.account, accountName: line.account_name, type: line.type, role: line.role, openingBalancePaise: openingBalance },
        rows: [], debit: 0, credit: 0, balance: openingBalance, natural,
      };
    }
    current.balance += current.natural * (line.debit_paise - line.credit_paise);
    current.debit += line.debit_paise;
    current.credit += line.credit_paise;
    current.rows.push({
      date: line.entry_date ?? "",
      entryId: line.entry_id,
      description: line.description,
      sourceType: line.source_type,
      businessId: line.business_id,
      fairId: line.fair_id,
      debitPaise: line.debit_paise,
      creditPaise: line.credit_paise,
      balancePaise: current.balance,
    });
  }
  close();
  return groups;
}

/**
 * WHERE clause (alias `m`, the windowed stock-movement subquery below) for a stock filter, with bound
 * parameters, in the same {where, params} shape as `reportConditions`.
 *
 * A second helper was needed because that one is written for journal_entries (`je`), and a stock
 * movement has no journal entry: it carries its own fair column, there is no business dimension, the
 * customer is only reachable through the invoice or credit note it came from, and its date is a UTC
 * timestamp that must be converted to an IST calendar date before it is compared with a YYYY-MM-DD
 * bound. Dates are still validated by `reportConditions` itself (called for validation only), so the
 * wording and the from-after-to refusal are identical and not copied here.
 */
export function stockMovementConditions(filter: StockMovementFilter): { where: string; params: string[] } {
  refuseFilter(
    "The stock movement report", filter, "businessId", "business",
    "stock movements are not recorded per business. Filter by fair, customer or item instead.",
  );
  reportConditions({
    ...(filter.fromDate === undefined ? {} : { fromDate: filter.fromDate }),
    ...(filter.toDate === undefined ? {} : { toDate: filter.toDate }),
  });
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter.itemId !== undefined) { conditions.push("m.item_id = ?"); params.push(filter.itemId); }
  if (filter.fairId !== undefined) { conditions.push("m.fair_id = ?"); params.push(filter.fairId); }
  if (filter.customerId !== undefined) { conditions.push("m.customer_id = ?"); params.push(filter.customerId); }
  if (filter.fromDate !== undefined) { conditions.push("m.movement_date >= ?"); params.push(filter.fromDate); }
  if (filter.toDate !== undefined) { conditions.push("m.movement_date <= ?"); params.push(filter.toDate); }
  return { where: conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`, params };
}

/**
 * Every stock movement in the period, per item, oldest first. The running quantity on hand is a window
 * over the item's WHOLE history, computed in the inner query and filtered only afterwards, so a report
 * that starts mid-way still shows the true stock rather than one that restarts at zero. The order
 * (occurred_at, then rowid) is the one FIFO costing itself uses.
 */
export function stockMovementReport(db: Database.Database, filter: StockMovementFilter = {}): readonly StockMovementRow[] {
  assertReportFairExists(db, filter.fairId);
  const { where, params } = stockMovementConditions(filter);
  const rows = db.prepare(
    `SELECT * FROM (
       SELECT sm.rowid AS rid, sm.id, sm.item_id, it.name AS item_name, it.unit, sm.movement_type,
              sm.quantity_delta, sm.unit_cost_paise, sm.occurred_at, sm.source_id, sm.fair_id,
              date(sm.occurred_at, '+330 minutes') AS movement_date,
              COALESCE(inv.customer_id, note_inv.customer_id) AS customer_id,
              SUM(sm.quantity_delta) OVER (PARTITION BY sm.item_id ORDER BY sm.occurred_at, sm.rowid) AS quantity_on_hand
         FROM stock_movements sm
         JOIN items it ON it.id = sm.item_id
         LEFT JOIN invoices inv ON inv.id = sm.source_id
         LEFT JOIN credit_notes cn ON cn.id = sm.source_id
         LEFT JOIN invoices note_inv ON note_inv.id = cn.invoice_id
     ) m
     ${where}
     ORDER BY m.item_name, m.item_id, m.occurred_at, m.rid`,
  ).all(...params) as Array<{
    id: string; item_id: string; item_name: string; unit: string; movement_type: string; quantity_delta: number;
    unit_cost_paise: number; occurred_at: string; source_id: string | null; fair_id: string | null;
    movement_date: string; quantity_on_hand: number;
  }>;
  return rows.map((row) => ({
    movementId: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    date: row.movement_date,
    occurredAt: row.occurred_at,
    movementType: row.movement_type,
    sourceId: row.source_id,
    fairId: row.fair_id,
    quantityIn: Math.max(0, row.quantity_delta),
    quantityOut: Math.max(0, -row.quantity_delta),
    unitCostPaise: row.unit_cost_paise,
    valuePaise: row.quantity_delta * row.unit_cost_paise,
    quantityOnHand: row.quantity_on_hand,
  }));
}
