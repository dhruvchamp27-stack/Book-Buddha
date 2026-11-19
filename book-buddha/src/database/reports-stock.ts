import type Database from "better-sqlite3";
import { isValidIsoDate } from "../accounting/recurrence.js";
import { AGEING_BANDS, ageingBandIndex } from "./ageing-bands.js";
import { RepositoryValidationError } from "./errors.js";
import { istDateOf } from "./ist-date.js";
import { datedStockLayers, type StockLayerDateBasis } from "./stock-layers.js";

/**
 * Session 12, reports 4 and 5: stock ageing and inventory valuation detail.
 *
 * Both are the SAME FIFO replay as `getInventoryValuation` (they call the one `datedStockLayers`),
 * only grouped differently, so each ties to the valuation summary by construction and the tests
 * prove it. Integer paise only; every total is the sum of its own rows.
 *
 * WHAT `asAtDate` DOES, AND DOES NOT. Layers are the stock on the shelf NOW; there is no history
 * of past FIFO states to replay. `asAtDate` therefore only moves the date ages are measured FROM
 * ("how old would today's stock look on that date"). It does not reconstruct what was on the shelf
 * then. A layer received after `asAtDate` cannot have a negative age, so it is aged as 0 and counted
 * in `futureDatedLayerCount`, rather than being hidden or dropped (the tie-out would break).
 *
 * NO FAIR OR BUSINESS FILTER, deliberately. A layer has no business dimension (items belong to a
 * company, and `stock_movements.fair_id` is a reporting tag that FIFO never reads); inventing one
 * here would be a second idea of which stock belongs to which fair. See "Known limitations" in the
 * report definitions.
 */

export interface StockReportFilter {
  readonly asAtDate?: string;
}

export interface StockAgeingBucketTotal {
  /** One of AGEING_BANDS' labels: the same bands the customer and supplier ageing reports use. */
  readonly label: string;
  readonly quantity: number;
  readonly valuePaise: number;
}

export interface StockAgeingRow {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly buckets: readonly StockAgeingBucketTotal[];
  readonly quantity: number;
  readonly valuePaise: number;
}

export interface StockAgeingReport {
  readonly asAtDate: string;
  /** Every stock-tracked item, in the order getInventoryValuation lists them, so the two line up row for row. */
  readonly rows: readonly StockAgeingRow[];
  readonly totals: {
    readonly buckets: readonly StockAgeingBucketTotal[];
    readonly quantity: number;
    readonly valuePaise: number;
  };
  /**
   * Layers whose date is only the day the row was inserted (a source-less PURCHASE posts no journal
   * entry, so nothing else dates it). They are in the buckets; this says how much to trust them.
   */
  readonly entryInstantLayerCount: number;
  /** Layers received AFTER `asAtDate`, aged as 0 days. Zero unless an as-at date in the past was asked for. */
  readonly futureDatedLayerCount: number;
}

export interface InventoryValuationDetailRow {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly movementId: string;
  readonly receivedOn: string;
  readonly dateBasis: StockLayerDateBasis;
  /** Whole days from receivedOn to the as-at date, floored at 0. */
  readonly ageDays: number;
  readonly quantity: number;
  readonly unitCostPaise: number;
  /** quantity x unitCostPaise. */
  readonly valuePaise: number;
  readonly sourceId: string | null;
}

export interface InventoryValuationDetailReport {
  readonly asAtDate: string;
  readonly rows: readonly InventoryValuationDetailRow[];
  readonly totals: { readonly quantity: number; readonly valuePaise: number };
  readonly entryInstantLayerCount: number;
}

/** Same rule, same wording as the shared report-filter module's date check. */
function resolveAsAt(filter: StockReportFilter): string {
  if (filter.asAtDate === undefined) return istDateOf();
  if (!isValidIsoDate(filter.asAtDate)) {
    throw new RepositoryValidationError("As-at date must be a real date written as YYYY-MM-DD.");
  }
  return filter.asAtDate;
}

/** Whole calendar days from one YYYY-MM-DD to another, computed in UTC so no clock change can shift a day. */
function daysBetween(fromDate: string, toDate: string): number {
  const toMs = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((toMs(toDate) - toMs(fromDate)) / 86_400_000);
}

/** Same item list and order as getInventoryValuation, with each item's surviving dated layers. */
function stockItemsWithLayers(db: Database.Database) {
  const items = db
    .prepare("SELECT id, name, unit FROM items WHERE track_stock = 1 ORDER BY name, rowid")
    .all() as Array<{ id: string; name: string; unit: string }>;
  return items.map((item) => ({ ...item, layers: datedStockLayers(db, item.id) }));
}

export function stockAgeing(db: Database.Database, filter: StockReportFilter = {}): StockAgeingReport {
  const asAtDate = resolveAsAt(filter);
  let entryInstantLayerCount = 0;
  let futureDatedLayerCount = 0;
  const emptyTotals = (): Array<{ quantity: number; valuePaise: number }> => AGEING_BANDS.map(() => ({ quantity: 0, valuePaise: 0 }));
  const grandTotals = emptyTotals();

  const rows = stockItemsWithLayers(db).map((item): StockAgeingRow => {
    const itemTotals = emptyTotals();
    for (const layer of item.layers) {
      if (layer.dateBasis === "ENTRY_INSTANT") entryInstantLayerCount += 1;
      const rawAge = daysBetween(layer.receivedOn, asAtDate);
      if (rawAge < 0) futureDatedLayerCount += 1;
      // The bands run from 0 with an open top, so this cannot miss; guarded because a layer silently
      // dropped from an ageing report would break the tie-out to the valuation.
      const index = ageingBandIndex(Math.max(rawAge, 0));
      if (index === -1) throw new RepositoryValidationError(`No ageing band covers ${rawAge} days.`);
      const valuePaise = layer.quantity * layer.unitCostPaise;
      for (const totals of [itemTotals[index], grandTotals[index]]) {
        if (totals === undefined) continue;
        totals.quantity += layer.quantity;
        totals.valuePaise += valuePaise;
      }
    }
    const buckets = AGEING_BANDS.map((band, index): StockAgeingBucketTotal => ({
      label: band.label,
      quantity: itemTotals[index]?.quantity ?? 0,
      valuePaise: itemTotals[index]?.valuePaise ?? 0,
    }));
    return {
      itemId: item.id, itemName: item.name, unit: item.unit, buckets,
      quantity: buckets.reduce((sum, bucket) => sum + bucket.quantity, 0),
      valuePaise: buckets.reduce((sum, bucket) => sum + bucket.valuePaise, 0),
    };
  });

  const totalBuckets = AGEING_BANDS.map((band, index): StockAgeingBucketTotal => ({
    label: band.label,
    quantity: grandTotals[index]?.quantity ?? 0,
    valuePaise: grandTotals[index]?.valuePaise ?? 0,
  }));
  return {
    asAtDate,
    rows,
    totals: {
      buckets: totalBuckets,
      quantity: totalBuckets.reduce((sum, bucket) => sum + bucket.quantity, 0),
      valuePaise: totalBuckets.reduce((sum, bucket) => sum + bucket.valuePaise, 0),
    },
    entryInstantLayerCount,
    futureDatedLayerCount,
  };
}

export function inventoryValuationDetail(db: Database.Database, filter: StockReportFilter = {}): InventoryValuationDetailReport {
  const asAtDate = resolveAsAt(filter);
  const rows: InventoryValuationDetailRow[] = [];
  for (const item of stockItemsWithLayers(db)) {
    for (const layer of item.layers) {
      rows.push({
        itemId: item.id, itemName: item.name, unit: item.unit,
        movementId: layer.movementId, receivedOn: layer.receivedOn, dateBasis: layer.dateBasis,
        ageDays: Math.max(daysBetween(layer.receivedOn, asAtDate), 0),
        quantity: layer.quantity, unitCostPaise: layer.unitCostPaise,
        valuePaise: layer.quantity * layer.unitCostPaise,
        sourceId: layer.sourceId,
      });
    }
  }
  // Item name, then id (two items may share a name), then oldest first. Plain comparison, not
  // localeCompare, so the order cannot depend on the machine's locale.
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  rows.sort((a, b) =>
    compare(a.itemName, b.itemName) || compare(a.itemId, b.itemId) || compare(a.receivedOn, b.receivedOn) || compare(a.movementId, b.movementId));
  return {
    asAtDate,
    rows,
    totals: {
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      valuePaise: rows.reduce((sum, row) => sum + row.valuePaise, 0),
    },
    entryInstantLayerCount: rows.filter((row) => row.dateBasis === "ENTRY_INSTANT").length,
  };
}
