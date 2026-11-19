import type Database from "better-sqlite3";

/**
 * Migration v22 body: the two stock movement types that let stock come back OUT by hand.
 *
 * WHY (owner ruling S10-4, "yes, before R9"). `addStockMovement` has only ever accepted a
 * POSITIVE quantity and there has never been a reversal or a delete, so the only public stock
 * operations were add and list. Shrinkage and breakage had no way in, and since R4c a mistyped
 * opening quantity was wrong in the stock reports AND in `OPENING_BALANCE_EQUITY` with no
 * correction path at all. That sits against cancel-with-reversal, a fixed rule of this project.
 *
 * WHAT. Exactly one change: `stock_movements.movement_type` gains `ADJUSTMENT_OUT` and
 * `ADJUSTMENT_REVERSAL`. No new table, no new column, no new account (STOCK_ADJUSTMENT was seeded
 * at v13 and OPENING_BALANCE_EQUITY long before), nothing backfilled, and not one existing row
 * changed. So there is no new frozen seed list and `migration-v15-seeding.test.ts` is untouched.
 *
 * The two types are separate on purpose, because they remove stock by DIFFERENT rules:
 *   - `ADJUSTMENT_OUT` is a write-down (shrinkage, breakage, a recount finding less). It consumes
 *     the FIFO queue exactly as a SALE does, one row per layer it eats, each row carrying THAT
 *     layer's unit cost. `getStockLayers` needs no special case for it — a negative row that is
 *     not a lot-specific reversal already falls to the FIFO branch.
 *   - `ADJUSTMENT_REVERSAL` undoes ONE named hand-entered movement, so it must take that
 *     movement's OWN lot back out, never the oldest lot. It carries the reversed movement's id in
 *     `source_id`, and `getStockLayers` matches it to the layer by that id.
 *
 * WHY THE TABLE IS REBUILT AT ALL. SQLite cannot widen a CHECK constraint in place, so the table
 * is recreated and copied, the way v4 did for the same column. Three things that must not be got
 * wrong, each of which has bitten this project or a project like it:
 *   1. `rowid` IS COPIED. FIFO order is `ORDER BY occurred_at, rowid` and `id` is a TEXT key, so
 *      losing rowid order would silently re-measure COGS that is already posted.
 *   2. `fair_id` IS IN THE NEW TABLE. v4's rebuild predates the project dimension (v6 adds the
 *      column), so copying v4's column list verbatim would drop `fair_id` and every project tag
 *      with it — a silent data loss that `tsc` cannot see. The column set is asserted below
 *      rather than assumed: if a later migration adds a column to this table and nobody updates
 *      this file, the migration FAILS LOUDLY instead of quietly discarding it.
 *   3. `DROP TABLE` TAKES THE INDEXES WITH IT. Both are recreated after the rename.
 * No trigger in this schema is defined on `stock_movements` and none mentions it, but any that
 * exists is read first and replayed, because `DROP TABLE` drops a table's triggers too.
 *
 * Additive and idempotent: it is guarded on the CHECK text, so a second run does nothing, and
 * nothing else in the schema references `stock_movements`, so no foreign key needs disabling and
 * this can stay inside the ordinary migration transaction.
 */

/** The live shape of `stock_movements` at v21, in column order. */
const EXPECTED_COLUMNS = [
  "id",
  "item_id",
  "source_id",
  "movement_type",
  "quantity_delta",
  "unit_cost_paise",
  "occurred_at",
  "fair_id",
] as const;

const NEW_MOVEMENT_TYPES =
  "'OPENING', 'PURCHASE', 'ADJUSTMENT', 'SALE', 'SALE_REVERSAL', 'PURCHASE_REVERSAL', 'ADJUSTMENT_OUT', 'ADJUSTMENT_REVERSAL'";

export function applyStockAdjustmentSchema(db: Database.Database): void {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_movements'")
    .get() as { sql: string } | undefined;
  if (table === undefined) {
    throw new Error("v22 cannot run: stock_movements does not exist.");
  }
  // Already widened: nothing to do. This is what makes a re-run a no-op.
  if (table.sql.includes("ADJUSTMENT_OUT")) return;

  const columns = (db.prepare("PRAGMA table_info(stock_movements)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (columns.join(",") !== EXPECTED_COLUMNS.join(",")) {
    throw new Error(
      `v22 expected stock_movements to hold exactly (${EXPECTED_COLUMNS.join(", ")}) in that order, and found ` +
        `(${columns.join(", ")}). A column was added to this table without updating the v22 rebuild, which ` +
        "would have dropped it. Update src/database/stock-adjustment-schema.ts deliberately.",
    );
  }

  const rowsBefore = (db.prepare("SELECT COUNT(*) AS n FROM stock_movements").get() as { n: number }).n;
  const triggers = (db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL AND tbl_name = 'stock_movements'")
    .all() as Array<{ sql: string }>).map((row) => row.sql);

  db.exec(`
    CREATE TABLE stock_movements_v22 (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      source_id TEXT,
      movement_type TEXT NOT NULL CHECK(movement_type IN (${NEW_MOVEMENT_TYPES})),
      quantity_delta INTEGER NOT NULL CHECK(quantity_delta <> 0),
      unit_cost_paise INTEGER NOT NULL CHECK(unit_cost_paise >= 0),
      occurred_at TEXT NOT NULL,
      fair_id TEXT REFERENCES fairs(id)
    );
    INSERT INTO stock_movements_v22 (rowid, id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id)
      SELECT rowid, id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id
        FROM stock_movements ORDER BY rowid;
    DROP TABLE stock_movements;
    ALTER TABLE stock_movements_v22 RENAME TO stock_movements;
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id, occurred_at, id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source_id);
  `);
  for (const trigger of triggers) db.exec(trigger);

  // Gate: the copy moved every row, and the widened CHECK really is in place.
  const rowsAfter = (db.prepare("SELECT COUNT(*) AS n FROM stock_movements").get() as { n: number }).n;
  if (rowsAfter !== rowsBefore) {
    throw new Error(`v22 copied ${rowsAfter} stock movements where ${rowsBefore} went in.`);
  }
  const rebuilt = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_movements'")
    .get() as { sql: string } | undefined;
  if (rebuilt === undefined || !rebuilt.sql.includes("ADJUSTMENT_REVERSAL")) {
    throw new Error("v22 rebuilt stock_movements without the widened movement_type CHECK.");
  }
}
