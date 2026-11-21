import type Database from "better-sqlite3";
import { istDateOf } from "./ist-date.js";

/**
 * Where a layer's `receivedOn` came from, so a report can say how firm the date is.
 *   BILL           the posted entry date of the purchase bill that brought the goods in;
 *   JOURNAL        the entry date of the stock movement's own journal entry (OPENING / ADJUSTMENT);
 *   CREDIT_NOTE    goods returned by a customer (SALE_REVERSAL): the entry date of the credit note;
 *   ENTRY_INSTANT  nothing dated the layer, so it is the IST date the row was INSERTED. Left for
 *                  the one genuine hole, a source-less PURCHASE (it posts no journal entry), so the
 *                  fallback count a report shows means something.
 */
export type StockLayerDateBasis = "BILL" | "JOURNAL" | "CREDIT_NOTE" | "ENTRY_INSTANT";

export interface DatedStockLayer {
  /** stock_movements.id of the movement that created the layer. */
  movementId: string;
  /** Mutated while the replay consumes it; what is returned is what survives. */
  quantity: number;
  unitCostPaise: number;
  sourceId: string | null;
  /** YYYY-MM-DD. A LABEL ONLY: FIFO order never looks at it. */
  receivedOn: string;
  dateBasis: StockLayerDateBasis;
}

/**
 * The surviving FIFO lots of one item, each carrying the date it should AGE from.
 *
 * THE REPLAY IS MOVED, NOT CHANGED. It used to live in AccountingRepository.getStockLayers and
 * everything that costs stock (invoicing, credit notes, bill cancellation, purchase returns,
 * valuation) still reads it through there, so its behaviour must be exactly what it was:
 * every positive movement opens a lot; PURCHASE_REVERSAL takes goods out of that purchase's OWN lot
 * (same source and cost), never the oldest; everything else consumes oldest-first.
 *
 * ORDER IS SACRED. `ORDER BY occurred_at, rowid` is what FIFO means here. `receivedOn` is NOT used
 * to sort anything: a back-dated opening layer must keep its place in the queue, otherwise COGS
 * already posted would be silently re-measured (addStockMovement's own comment explains why
 * `occurred_at` stays the insertion instant).
 *
 * WHY A SEPARATE DATE AT ALL. `occurred_at` is when the row was inserted, so ageing from it would
 * call opening stock entered today "today's stock", which is the one thing an ageing report must
 * not do. The dates are therefore looked up from the ledger - one query per kind for the whole item,
 * not one per lot.
 */
export function datedStockLayers(db: Database.Database, itemId: string): DatedStockLayer[] {
  const rows = db.prepare(
    "SELECT id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at FROM stock_movements WHERE item_id = ? ORDER BY occurred_at, rowid",
  ).all(itemId) as Array<{
    id: string; source_id: string | null; movement_type: string; quantity_delta: number; unit_cost_paise: number; occurred_at: string;
  }>;

  // A purchase is dated by its bill. Joining purchase_bills means a PURCHASE whose source_id is not
  // a bill (a source-less one, or a stray id) is simply absent from the map and falls through to
  // ENTRY_INSTANT rather than being given a date nothing supports. MIN(entry_date) over the
  // non-reversal entries, as salesByItem does, so a cancelled bill's reversal never moves it.
  const billDates = new Map(
    (db.prepare(
      `SELECT pb.id AS bill_id, MIN(je.entry_date) AS entry_date
         FROM purchase_bills pb
         JOIN journal_entries je ON je.source_id = pb.id AND je.source_type = 'PURCHASE_BILL' AND je.is_reversal = 0
        WHERE pb.id IN (SELECT source_id FROM stock_movements WHERE item_id = ? AND movement_type = 'PURCHASE' AND source_id IS NOT NULL)
        GROUP BY pb.id`,
    ).all(itemId) as Array<{ bill_id: string; entry_date: string }>).map((row) => [row.bill_id, row.entry_date] as const),
  );
  // Hand-entered stock is dated by its own journal entry, whose id is derived from the movement id
  // (addStockMovement and the backfill both write `je-stock-movement-<id>`).
  const journalDates = new Map(
    (db.prepare(
      `SELECT sm.id AS movement_id, je.entry_date AS entry_date
         FROM stock_movements sm
         JOIN journal_entries je ON je.id = 'je-stock-movement-' || sm.id
        WHERE sm.item_id = ? AND sm.movement_type IN ('OPENING', 'ADJUSTMENT')`,
    ).all(itemId) as Array<{ movement_id: string; entry_date: string }>).map((row) => [row.movement_id, row.entry_date] as const),
  );

  // A returned-goods layer carries the CREDIT NOTE's id in source_id, but the note's journal entry
  // carries the INVOICE's id in its source_id - a deliberate asymmetry in this codebase. So match on
  // the entry's own id (`je-credit-note-<note id>`), never on its source_id.
  const creditNoteDates = new Map(
    (db.prepare(
      `SELECT sm.id AS movement_id, je.entry_date AS entry_date
         FROM stock_movements sm
         JOIN journal_entries je ON je.id = 'je-credit-note-' || sm.source_id
        WHERE sm.item_id = ? AND sm.movement_type = 'SALE_REVERSAL' AND sm.source_id IS NOT NULL`,
    ).all(itemId) as Array<{ movement_id: string; entry_date: string }>).map((row) => [row.movement_id, row.entry_date] as const),
  );

  // Goods put BACK by reversing a write-down open a new lot at the end of the queue; the lot is dated
  // by the reversal's own journal entry, whose id is derived from the write-down id every one of
  // those rows carries in source_id (reverseStockMovement writes `je-stock-writedown-<id>-reversal`).
  const writedownReversalDates = new Map(
    (db.prepare(
      `SELECT sm.id AS movement_id, je.entry_date AS entry_date
         FROM stock_movements sm
         JOIN journal_entries je ON je.id = 'je-stock-writedown-' || sm.source_id || '-reversal'
        WHERE sm.item_id = ? AND sm.movement_type = 'ADJUSTMENT_REVERSAL' AND sm.quantity_delta > 0 AND sm.source_id IS NOT NULL`,
    ).all(itemId) as Array<{ movement_id: string; entry_date: string }>).map((row) => [row.movement_id, row.entry_date] as const),
  );

  const dateOf = (row: (typeof rows)[number]): { receivedOn: string; dateBasis: StockLayerDateBasis } => {
    if (row.movement_type === "ADJUSTMENT_REVERSAL") {
      const reversalDate = writedownReversalDates.get(row.id);
      if (reversalDate !== undefined) return { receivedOn: reversalDate, dateBasis: "JOURNAL" };
    }
    if (row.movement_type === "PURCHASE" && row.source_id !== null) {
      const billDate = billDates.get(row.source_id);
      if (billDate !== undefined) return { receivedOn: billDate, dateBasis: "BILL" };
    }
    if (row.movement_type === "OPENING" || row.movement_type === "ADJUSTMENT") {
      const journalDate = journalDates.get(row.id);
      if (journalDate !== undefined) return { receivedOn: journalDate, dateBasis: "JOURNAL" };
    }
    if (row.movement_type === "SALE_REVERSAL") {
      const noteDate = creditNoteDates.get(row.id);
      if (noteDate !== undefined) return { receivedOn: noteDate, dateBasis: "CREDIT_NOTE" };
    }
    return { receivedOn: istDateOf(row.occurred_at), dateBasis: "ENTRY_INSTANT" };
  };

  // Ids of the credit notes that returned THIS item, read once and only when a negative SALE row needs them.
  let creditNoteIds: Set<string> | undefined;
  const isCreditNoteId = (id: string): boolean => {
    creditNoteIds ??= new Set((db.prepare(
      "SELECT DISTINCT source_id FROM stock_movements WHERE item_id = ? AND movement_type = 'SALE_REVERSAL' AND source_id IN (SELECT id FROM credit_notes)",
    ).all(itemId) as Array<{ source_id: string }>).map((r) => r.source_id));
    return creditNoteIds.has(id);
  };

  const layers: DatedStockLayer[] = [];
  for (const row of rows) {
    if (row.quantity_delta > 0) {
      layers.push({
        movementId: row.id, quantity: row.quantity_delta, unitCostPaise: row.unit_cost_paise, sourceId: row.source_id, ...dateOf(row),
      });
      continue;
    }
    let remaining = Math.abs(row.quantity_delta);
    if (row.movement_type === "ADJUSTMENT_REVERSAL") {
      // A NEGATIVE reversal undoes ONE hand-entered movement, so it takes THAT movement's own lot
      // out, matched by the movement id it carries in source_id - never the oldest lot, and never
      // by cost (two lots can share a cost). reverseStockMovement refuses unless the lot is whole.
      for (const layer of layers) {
        if (remaining === 0) break;
        if (layer.movementId !== row.source_id) continue;
        const removed = Math.min(remaining, layer.quantity);
        layer.quantity -= removed;
        remaining -= removed;
      }
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (layers[index]?.quantity === 0) layers.splice(index, 1);
      }
      continue;
    }
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
    if (row.movement_type === "SALE" && row.source_id !== null && isCreditNoteId(row.source_id)) {
      // D5. cancelCreditNote sends a note's goods out again as a negative SALE carrying the NOTE's
      // id. It takes the note's OWN returned lot first (same source and cost), exactly like a
      // purchase return leaves from its bill's lot; only a remainder falls through to oldest-first.
      // An ordinary sale carries an INVOICE id, which is never a credit note id, so it never lands here.
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
