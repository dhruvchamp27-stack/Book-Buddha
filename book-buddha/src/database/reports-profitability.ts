import type Database from "better-sqlite3";
import { assertReportFairExists, reportConditions } from "./report-filters-sql.js";
import { salesByItem } from "./reports-sales.js";

/**
 * Item profitability - report 6 (REPORT_DEFINITIONS_S12, section 6 and RESOLUTION R7).
 *
 * WHAT IT MEANS. Per item: what it sold for, less what the goods cost us - the gross margin. Margin
 * as a PERCENTAGE is deliberately not a field here: it is derived for display only by the screen, so
 * no paise is ever lost to rounding a percentage into an integer.
 *
 * WHERE EACH FIGURE COMES FROM
 *  - Revenue (netSalesPaise, netQuantity) is `salesByItem`, called as it stands with the same filter.
 *    There is no second revenue query, so revenue here cannot drift from the Sales by Item report.
 *  - COGS (cogsPaise) is the stock sub-ledger: SUM(-quantity_delta x unit_cost_paise) over
 *    `stock_movements` of type SALE and SALE_REVERSAL. consumeInvoiceStock writes one SALE row per
 *    FIFO layer, each at that layer's own cost, and posts exactly that sum to COGS - so this figure
 *    IS the posted COGS, not a re-derivation. A return (SALE_REVERSAL, goods back) is negative COGS.
 *
 * WHICH STOCK ROWS COUNT. Each row's source is resolved by looking its source_id up in `invoices`
 * first and then in `credit_notes` - never by movement type, because cancelCreditNote writes a SALE
 * row under the NOTE's id (R7.2).
 *  - An invoice must be FINALIZED (the test salesByItem applies), and its date, business and fair
 *    come from its own posted entry exactly as salesByItem takes them (source_type = 'INVOICE',
 *    is_reversal = 0, MIN(entry_date), grouped by source_id). A cancelled invoice drops out on the
 *    same test that drops its revenue.
 *  - A credit note is dated, and business/fair-filtered, from its entry `je-credit-note-<note id>`,
 *    which is the entry salesReturnReport joins. Unlike salesReturnReport (FINALIZED notes only,
 *    because a cancelled note is not a return) the note's stock rows are taken whatever its status:
 *    a finalized note's SALE_REVERSAL and its cancellation's SALE rows then net to nil, as the
 *    journal does, while its revenue side is absent on both reports.
 *  - `occurred_at` is never used for dating.
 *
 * TIES TO. With no date filter, totals.cogsPaise equals the COGS account's debits less credits in
 * the journal, exactly. Revenue ties to Sales by Item, NOT to net sales in the journal: see notes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *  - No customer filter in this slice (the filter has businessId, fairId, fromDate, toDate, itemId).
 *  - No spreading of invoice-level discount, extra charge or GST across lines. That waits on the
 *    owner's odd-paise ruling (S11-1 / S11-2); this report must not invent an answer.
 *  - No cash basis.
 */

export interface ItemProfitabilityFilter {
  readonly businessId?: string;
  readonly fairId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly itemId?: string;
}

export interface ItemProfitabilityRow {
  /** null for a free-text line that names no item; the row is then named by its description. */
  readonly itemId: string | null;
  readonly itemName: string;
  readonly unit: string | null;
  readonly netQuantity: number;
  /** Quantity x unit price, net of returns, before invoice-level discount, extra charge and GST. */
  readonly netSalesPaise: number;
  /** Cost of the goods, from the stock sub-ledger; negative contributions are returns. */
  readonly cogsPaise: number;
  /** netSalesPaise - cogsPaise. The percentage is derived by the screen, never stored. */
  readonly grossMarginPaise: number;
}

export interface ItemProfitabilityReport {
  readonly rows: readonly ItemProfitabilityRow[];
  readonly totals: {
    readonly netSalesPaise: number;
    readonly cogsPaise: number;
    readonly grossMarginPaise: number;
  };
  readonly notes: readonly string[];
}

const NOTES: readonly string[] = [
  "Revenue is quantity x unit price per line. Invoice-level discount, extra charge and GST are not spread across lines, so revenue ties to Sales by Item, not to net sales in the journal.",
  "With a date filter, COGS may differ from the COGS ledger, because a cancellation posts on the day it happens while its stock rows keep the document's date.",
];

export function itemProfitability(db: Database.Database, filter: ItemProfitabilityFilter = {}): ItemProfitabilityReport {
  assertReportFairExists(db, filter.fairId);

  // Revenue: the one existing definition. (No customerId in this slice, so none is passed.)
  const revenue = salesByItem(db, filter);

  const base = reportConditions(filter);
  const conditions: string[] = base.where === "" ? [] : [base.where.slice("WHERE ".length)];
  const params: string[] = [...base.params];
  if (filter.itemId !== undefined) { conditions.push("sm.item_id = ?"); params.push(filter.itemId); }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;

  const cost = db.prepare(
    `SELECT sm.item_id, it.name AS item_name, it.unit AS unit,
            SUM(-sm.quantity_delta * sm.unit_cost_paise) AS cogs_paise
       FROM stock_movements sm
       JOIN items it ON it.id = sm.item_id
       JOIN (
             SELECT inv.id AS id, j.entry_date AS entry_date, j.business_id AS business_id, j.fair_id AS fair_id
               FROM invoices inv
               JOIN (SELECT source_id AS id, MIN(entry_date) AS entry_date, business_id, fair_id
                       FROM journal_entries
                      WHERE source_type = 'INVOICE' AND is_reversal = 0
                      GROUP BY source_id) j ON j.id = inv.id
              WHERE inv.status = 'FINALIZED'
             UNION ALL
             SELECT cn.id AS id, j.entry_date AS entry_date, j.business_id AS business_id, j.fair_id AS fair_id
               FROM credit_notes cn
               JOIN journal_entries j ON j.id = 'je-credit-note-' || cn.id
              WHERE NOT EXISTS (SELECT 1 FROM invoices x WHERE x.id = cn.id)
            ) je ON je.id = sm.source_id
      ${where === "" ? "WHERE" : `${where} AND`} sm.movement_type IN ('SALE', 'SALE_REVERSAL')
      GROUP BY sm.item_id, it.name, it.unit`,
  ).all(...params) as Array<{ item_id: string; item_name: string; unit: string; cogs_paise: number }>;

  interface Acc { itemId: string | null; itemName: string; unit: string | null; netQuantity: number; netSalesPaise: number; cogsPaise: number }
  const merged = new Map<string, Acc>();
  // Same keying as salesByItem: an item-less line is identified by its description.
  const keyOf = (itemId: string | null, itemName: string): string => (itemId === null ? `description:${itemName}` : `item:${itemId}`);
  for (const row of revenue) {
    merged.set(keyOf(row.itemId, row.itemName), {
      itemId: row.itemId, itemName: row.itemName, unit: row.unit,
      netQuantity: row.netQuantity, netSalesPaise: row.netSalesPaise, cogsPaise: 0,
    });
  }
  for (const row of cost) {
    const key = keyOf(row.item_id, row.item_name);
    const existing = merged.get(key) ?? { itemId: row.item_id, itemName: row.item_name, unit: row.unit, netQuantity: 0, netSalesPaise: 0, cogsPaise: 0 };
    merged.set(key, { ...existing, cogsPaise: row.cogs_paise });
  }

  const rows = [...merged.values()]
    // A row that nets to nothing on every measure (e.g. only a cancelled note's pair of stock rows) says nothing.
    .filter((row) => row.netQuantity !== 0 || row.netSalesPaise !== 0 || row.cogsPaise !== 0)
    .map((row): ItemProfitabilityRow => ({ ...row, grossMarginPaise: row.netSalesPaise - row.cogsPaise }))
    .sort((left, right) => left.itemName.localeCompare(right.itemName) || (left.itemId ?? "").localeCompare(right.itemId ?? ""));

  const netSalesPaise = rows.reduce((sum, row) => sum + row.netSalesPaise, 0);
  const cogsPaise = rows.reduce((sum, row) => sum + row.cogsPaise, 0);
  return { rows, totals: { netSalesPaise, cogsPaise, grossMarginPaise: netSalesPaise - cogsPaise }, notes: NOTES };
}
