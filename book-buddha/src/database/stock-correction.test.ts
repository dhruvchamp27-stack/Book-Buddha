import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { migrations, runMigrations } from "./migrations.js";
import { applyStockAdjustmentSchema } from "./stock-adjustment-schema.js";
import { datedStockLayers } from "./stock-layers.js";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";
import { todayAt } from "./test-clock.js";

/**
 * Ruling S10-4 - stock can be taken OUT by hand (a write-down) and a hand-entered movement can be
 * reversed, with the ledger and the stock sub-ledger moving together (migration v22).
 *
 * Figures are PAISE in code with the rupee figure in a comment. The assertion that matters in every
 * scenario is `expectTies`: the INVENTORY account in the ledger equals the FIFO valuation, and the
 * whole ledger balances. It is the assertion that caught session 9's wrong-source_id bug.
 */

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  customerId: string;
  itemId: string;
}

/** The pinned "today" of every world here (ruling G): a reversal is dated today, so it is also the expected date. */
const TODAY = "2025-04-01";

function world(): World {
  const repository = new AccountingRepository(":memory:", todayAt(TODAY));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const itemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  return { repository, companyId, businessId, customerId, itemId };
}

function net(r: AccountingRepository, businessId: string, account: string): number {
  return (r.db.prepare(
    `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS net
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account = ? AND je.business_id = ?`,
  ).get(account, businessId) as { net: number }).net;
}

function valuation(r: AccountingRepository): number {
  return r.getInventoryValuation().reduce((total, row) => total + row.valuePaise, 0);
}

function onHand(r: AccountingRepository): number {
  return r.getInventoryValuation().reduce((total, row) => total + row.quantity, 0);
}

/** THE tie-out: INVENTORY in the ledger == the FIFO valuation, and every entry balances. */
function expectTies(w: World): void {
  expect(net(w.repository, w.businessId, "INVENTORY")).toBe(valuation(w.repository));
  const totals = w.repository.db.prepare(
    "SELECT COALESCE(SUM(debit_paise), 0) AS d, COALESCE(SUM(credit_paise), 0) AS c FROM journal_lines",
  ).get() as { d: number; c: number };
  expect(totals.d).toBe(totals.c);
}

function movementCount(r: AccountingRepository): number {
  return (r.db.prepare("SELECT COUNT(*) AS n FROM stock_movements").get() as { n: number }).n;
}

function journalCount(r: AccountingRepository): number {
  return (r.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
}

function sell(w: World, id: string, quantity: number): void {
  w.repository.saveDraft({
    id, number: id, businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", status: "DRAFT",
    lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise: 90_000 }],
  });
  w.repository.finalizeInvoice(id);
}

function refused(action: () => unknown, message: RegExp): void {
  expect(action).toThrow(RepositoryValidationError);
  expect(action).toThrow(message);
}

/** A year that covers the pinned TODAY, locked. */
function lockCurrentYear(w: World): void {
  const year = Number(TODAY.slice(0, 4));
  const id = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: `${year - 1}-01-01`, endsOn: `${year + 1}-12-31` });
  w.repository.setFinancialYearLocked(id, true, "filed");
}

describe("S10-4 write-down (ADJUSTMENT_OUT)", () => {
  it("eats two FIFO layers at their own costs and posts Dr STOCK_ADJUSTMENT / Cr INVENTORY once", () => {
    const w = world();
    const r = w.repository;
    try {
      // Lot 1: 10 opening @ Rs 100 = Rs 1,000. Lot 2: 5 adjustment @ Rs 120 = Rs 600.
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 10_000 });
      r.addStockMovement({ itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 5, unitCostPaise: 12_000 });
      expect(net(r, w.businessId, "INVENTORY")).toBe(160_000);

      // Write down 12: all 10 of lot 1 (10 x Rs 100 = Rs 1,000) and 2 of lot 2 (2 x Rs 120 = Rs 240).
      // Posted: Rs 1,240 = 124,000 paise. Left: 3 @ Rs 120 = Rs 360 = 36,000 paise.
      const result = r.writeDownStock({ itemId: w.itemId, quantity: 12, reason: "water damage" });
      expect(result.valuePaise).toBe(124_000);
      expect(result.movementIds).toHaveLength(2);
      const rows = r.listStockMovements(w.itemId).filter((m) => m.movementType === "ADJUSTMENT_OUT");
      expect(rows.map((m) => [m.quantityDelta, m.unitCostPaise, m.sourceId])).toEqual([
        [-10, 10_000, result.writedownId],
        [-2, 12_000, result.writedownId],
      ]);
      expect(onHand(r)).toBe(3);
      expect(valuation(r)).toBe(36_000);
      expect(net(r, w.businessId, "STOCK_ADJUSTMENT")).toBe(-60_000 + 124_000); // +Rs 600 credit earlier, Rs 1,240 debit now
      const lines = r.db.prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
        .all(`je-stock-writedown-${result.writedownId}`);
      expect(lines).toEqual([
        { account: "STOCK_ADJUSTMENT", debit_paise: 124_000, credit_paise: 0 },
        { account: "INVENTORY", debit_paise: 0, credit_paise: 124_000 },
      ]);
      expectTies(w);

      // It is an expense, never cost of goods sold.
      expect(net(r, w.businessId, "COGS")).toBe(0);
    } finally { r.close(); }
  });

  it("is refused for too much, zero, negative, fractional, an untracked item, and a locked year", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 4, unitCostPaise: 10_000, occurredOn: "2025-06-01" });
      const untracked = r.createItem({ companyId: w.companyId, name: "Service", unit: "job", trackStock: false });
      const before = [movementCount(r), journalCount(r)];

      refused(() => r.writeDownStock({ itemId: w.itemId, quantity: 5 }), /Only 4 of Atlas are on hand/);
      refused(() => r.writeDownStock({ itemId: w.itemId, quantity: 0 }), /positive whole number/);
      refused(() => r.writeDownStock({ itemId: w.itemId, quantity: -1 }), /positive whole number/);
      refused(() => r.writeDownStock({ itemId: w.itemId, quantity: 1.5 }), /positive whole number/);
      refused(() => r.writeDownStock({ itemId: untracked, quantity: 1 }), /stock tracking/);
      refused(() => r.writeDownStock({ itemId: "nope", quantity: 1 }), /not found/);

      const year = r.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      r.setFinancialYearLocked(year, true, "filed");
      refused(() => r.writeDownStock({ itemId: w.itemId, quantity: 1, occurredOn: "2025-12-01" }), /locked/);
      expect([movementCount(r), journalCount(r)]).toEqual(before); // the refusal left no stock row behind
      expectTies(w);
    } finally { r.close(); }
  });
});

describe("S10-4 reversal (ADJUSTMENT_REVERSAL)", () => {
  it("reversing an OPENING that is NOT the oldest lot removes exactly that lot", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 10, unitCostPaise: 10_000 }); // oldest lot: 10 @ Rs 100
      const typo = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 5, unitCostPaise: 20_000 }); // the mistyped one: 5 @ Rs 200
      expect(net(r, w.businessId, "OPENING_BALANCE_EQUITY")).toBe(-100_000);

      const result = r.reverseStockMovement(typo.id, { reason: "typed twice" });
      expect(result.valuePaise).toBe(100_000);
      const reversal = r.listStockMovements(w.itemId).find((m) => m.movementType === "ADJUSTMENT_REVERSAL");
      expect(reversal).toMatchObject({ quantityDelta: -5, unitCostPaise: 20_000, sourceId: typo.id });
      expect(onHand(r)).toBe(10);
      expect(valuation(r)).toBe(100_000);
      expect(net(r, w.businessId, "OPENING_BALANCE_EQUITY")).toBe(0); // the equity credit is gone
      expectTies(w);

      // The oldest lot is what is left, so selling 3 costs 3 x Rs 100 = Rs 300, NOT 3 x Rs 200.
      sell(w, "I1", 3);
      expect(net(r, w.businessId, "COGS")).toBe(30_000);
      expectTies(w);
    } finally { r.close(); }
  });

  it("reversing an ADJUSTMENT mirrors Dr INVENTORY / Cr STOCK_ADJUSTMENT", () => {
    const w = world();
    const r = w.repository;
    try {
      const adj = r.addStockMovement({ itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 3, unitCostPaise: 5_000 });
      expect(net(r, w.businessId, "STOCK_ADJUSTMENT")).toBe(-15_000);
      r.reverseStockMovement(adj.id);
      expect(net(r, w.businessId, "STOCK_ADJUSTMENT")).toBe(0);
      expect(onHand(r)).toBe(0);
      expectTies(w);
      const entry = r.db.prepare("SELECT is_reversal, entry_date, source_type FROM journal_entries WHERE id = ?")
        .get(`je-stock-movement-${adj.id}-reversal`);
      expect(entry).toEqual({ is_reversal: 1, entry_date: TODAY, source_type: "STOCK_MOVEMENT" });
    } finally { r.close(); }
  });

  it("refuses to reverse a lot that has already been consumed, by a sale or a write-down", () => {
    const w = world();
    const r = w.repository;
    try {
      const opening = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 10_000 });
      sell(w, "I1", 4);
      refused(() => r.reverseStockMovement(opening.id), /6 of the 10 units|4 of the 10 units/);
      const after = [movementCount(r), journalCount(r)];
      r.writeDownStock({ itemId: w.itemId, quantity: 6 });
      refused(() => r.reverseStockMovement(opening.id), /already gone out/);
      expect(movementCount(r)).toBe(after[0]! + 1);
      expectTies(w);
    } finally { r.close(); }
  });

  it("puts a reversed write-down back at the END of the queue, dated by its own entry", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 10_000 }); // A: 10 @ Rs 100
      const down = r.writeDownStock({ itemId: w.itemId, quantity: 4 }); // eats 4 of A (Rs 400); A has 6 left
      r.addStockMovement({ itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 5, unitCostPaise: 15_000 }); // B: 5 @ Rs 150
      expect(valuation(r)).toBe(60_000 + 75_000);

      const result = r.reverseStockMovement(down.writedownId);
      expect(result).toMatchObject({ kind: "WRITE_DOWN", valuePaise: 40_000 });
      expect(onHand(r)).toBe(15);
      expect(valuation(r)).toBe(60_000 + 75_000 + 40_000);
      expectTies(w);

      // Queue is now A(6 @ 100), B(5 @ 150), restored(4 @ 100). Selling 12 takes all of A (Rs 600), all
      // of B (Rs 750) and 1 restored (Rs 100) = Rs 1,450. A restored lot that jumped the queue would cost Rs 1,300.
      const layers = datedStockLayers(r.db, w.itemId);
      expect(layers.map((l) => [l.quantity, l.unitCostPaise])).toEqual([[6, 10_000], [5, 15_000], [4, 10_000]]);
      expect(layers[2]).toMatchObject({ dateBasis: "JOURNAL", receivedOn: TODAY });
      sell(w, "I1", 12);
      expect(net(r, w.businessId, "COGS")).toBe(145_000);
      expectTies(w);
    } finally { r.close(); }
  });

  it("accepts the write-down id or any one of its row ids", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 3, unitCostPaise: 10_000 });
      const down = r.writeDownStock({ itemId: w.itemId, quantity: 2 });
      r.reverseStockMovement(down.movementIds[0]!); // a row id
      expect(onHand(r)).toBe(3);
      refused(() => r.reverseStockMovement(down.writedownId), /already been reversed/);
      expectTies(w);
    } finally { r.close(); }
  });

  it("refuses everything that must not be reversed here", () => {
    const w = world();
    const r = w.repository;
    try {
      const opening = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 10_000 });
      // S17: the door refuses a bare PURCHASE. An old source-less row is built by hand instead.
      expect(() => r.addStockMovement({ itemId: w.itemId, movementType: "PURCHASE", quantity: 2, unitCostPaise: 10_000 }))
        .toThrow("Stock comes in through a purchase bill, opening stock, or a stock adjustment.");
      sell(w, "I1", 1);
      const rows = r.listStockMovements(w.itemId);
      const saleRow = rows.find((m) => m.movementType === "SALE")!;
      const raw = (id: string, type: string, source: string | null, quantity: number) =>
        r.db.prepare("INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at) VALUES (?, ?, ?, ?, ?, 10000, ?)")
          .run(id, w.itemId, source, type, quantity, new Date().toISOString());
      raw("bare", "PURCHASE", null, 2);
      raw("billed", "PURCHASE", "some-bill", 1);
      raw("bill-rev", "PURCHASE_REVERSAL", "some-bill", -1);
      raw("sale-rev", "SALE_REVERSAL", "some-note", 1);

      refused(() => r.reverseStockMovement(saleRow.id), /Cancel the document/);
      refused(() => r.reverseStockMovement("sale-rev"), /Cancel the document/);
      refused(() => r.reverseStockMovement("bill-rev"), /cancelled bill or a purchase return/);
      refused(() => r.reverseStockMovement("billed"), /Cancel the bill/);
      refused(() => r.reverseStockMovement("bare"), /posted nothing/);
      refused(() => r.reverseStockMovement("no-such-id"), /not found/);
      refused(() => r.reverseStockMovement(opening.id), /already gone out/); // 1 of its 10 was sold
    } finally { r.close(); }

    const x = world();
    try {
      const opening = x.repository.addStockMovement({ itemId: x.itemId, movementType: "OPENING", quantity: 2, unitCostPaise: 10_000 });
      x.repository.reverseStockMovement(opening.id);
      refused(() => x.repository.reverseStockMovement(opening.id), /already been reversed/); // twice
      const reversalRow = x.repository.listStockMovements(x.itemId).find((m) => m.movementType === "ADJUSTMENT_REVERSAL")!;
      refused(() => x.repository.reverseStockMovement(reversalRow.id), /itself a reversal/); // a reversal
      expectTies(x);
    } finally { x.repository.close(); }
  });

  it("is refused when TODAY's financial year is locked, and leaves nothing behind", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 4, unitCostPaise: 10_000 });
      const opening = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 3, unitCostPaise: 10_000 }); // intact: the write-down eats the OLDER lot
      const down = r.writeDownStock({ itemId: w.itemId, quantity: 1 });
      lockCurrentYear(w);
      const before = [movementCount(r), journalCount(r)];
      refused(() => r.reverseStockMovement(down.writedownId), /locked/);
      refused(() => r.reverseStockMovement(opening.id), /locked/);
      expect([movementCount(r), journalCount(r)]).toEqual(before);
      expectTies(w);
    } finally { r.close(); }
  });

  it("S17: a zero-cost write-down and a zero-value movement also respect a locked financial year", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 4, unitCostPaise: 0 }); // a free sample
      lockCurrentYear(w);
      const before = [movementCount(r), journalCount(r)];
      refused(() => r.writeDownStock({ itemId: w.itemId, quantity: 1 }), /locked/);
      refused(() => r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 0 }), /locked/);
      expect([movementCount(r), journalCount(r)]).toEqual(before);
    } finally { r.close(); }
  });

  it("refuses to reverse an entry that pre-dates stock posting until the backfill has run", () => {
    const w = world();
    const r = w.repository;
    try {
      r.db.prepare("INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at) VALUES ('legacy', ?, NULL, 'OPENING', 2, 10000, ?)")
        .run(w.itemId, new Date().toISOString());
      refused(() => r.reverseStockMovement("legacy"), /backfill/);
    } finally { r.close(); }
  });
});

describe("S10-4 migration v22", () => {
  const at = (version: number) => migrations.filter((m) => m.version <= version);

  function v21(): Database.Database {
    const db = new Database(":memory:");
    runMigrations(db, at(21));
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('co', 'Co', ?)").run(now);
    db.prepare("INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu', 'co', 'Host', ?)").run(now);
    db.prepare("INSERT INTO fairs (id, company_id, host_customer_id, name, created_at) VALUES ('fair1', 'co', 'cu', 'Fair', ?)").run(now);
    db.prepare("INSERT INTO items (id, company_id, name, unit, track_stock, created_at) VALUES ('it', 'co', 'Atlas', 'each', 1, ?)").run(now);
    return db;
  }

  const insert = (db: Database.Database, rowid: number, id: string, type: string, quantity: number, cost: number, fair: string | null) =>
    db.prepare("INSERT INTO stock_movements (rowid, id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id) VALUES (?, ?, 'it', ?, ?, ?, ?, '2026-02-01T00:00:00.000Z', ?)")
      .run(rowid, id, type === "SALE" ? "inv-1" : null, type, quantity, cost, fair);

  it("keeps every row, its rowid, fair_id and values, and both indexes", () => {
    const db = v21();
    // rowids are NOT in id order and have gaps: dropping rowid from the copy would renumber them 1, 2, 3.
    insert(db, 10, "m-c", "OPENING", 7, 111, "fair1");
    insert(db, 20, "m-a", "SALE", -3, 222, null);
    insert(db, 30, "m-b", "ADJUSTMENT", 2, 333, "fair1");
    const before = db.prepare("SELECT rowid AS rid, * FROM stock_movements ORDER BY rowid").all();
    expect(before).toHaveLength(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%stock_movements%'").get()).toEqual({ n: 0 });

    applyStockAdjustmentSchema(db);

    expect(db.prepare("SELECT rowid AS rid, * FROM stock_movements ORDER BY rowid").all()).toEqual(before);
    expect(db.prepare("SELECT rowid FROM stock_movements WHERE id = 'm-c'").get()).toEqual({ rowid: 10 });
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'stock_movements'").all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_stock_movements_item", "idx_stock_movements_source"]));
    expect(db.pragma("foreign_key_check")).toEqual([]);

    // The CHECK now accepts the two new types and still refuses junk.
    insert(db, 40, "out", "ADJUSTMENT_OUT", -1, 111, null);
    insert(db, 50, "rev", "ADJUSTMENT_REVERSAL", -1, 111, null);
    expect(() => insert(db, 60, "bad", "BOGUS", 1, 1, null)).toThrow(/CHECK/);
    expect(() => insert(db, 61, "zero", "OPENING", 0, 1, null)).toThrow(/CHECK/);
    db.close();
  });

  it("a second run is a no-op", () => {
    const db = v21();
    insert(db, 5, "m1", "OPENING", 1, 100, "fair1");
    applyStockAdjustmentSchema(db);
    const sqlAfterFirst = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'stock_movements'").get();
    const rowsAfterFirst = db.prepare("SELECT rowid AS rid, * FROM stock_movements").all();
    applyStockAdjustmentSchema(db);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'stock_movements'").get()).toEqual(sqlAfterFirst);
    expect(db.prepare("SELECT rowid AS rid, * FROM stock_movements").all()).toEqual(rowsAfterFirst);
    db.close();
  });

  it("throws, rather than silently dropping data, when the table has an extra column", () => {
    const db = v21();
    db.exec("ALTER TABLE stock_movements ADD COLUMN note TEXT");
    expect(() => applyStockAdjustmentSchema(db)).toThrow(/v22 expected stock_movements/);
    db.close();
  });

  it("is registered as v22 and the whole chain reaches it", () => {
    // Registered, not necessarily LAST: later migrations (v23+) must not break this assertion.
    expect(migrations.map((m) => m.version)).toContain(22);
    const db = new Database(":memory:");
    runMigrations(db);
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'stock_movements'").get() as { sql: string }).sql).toContain("ADJUSTMENT_REVERSAL");
    db.close();
  });
});

describe("S10-4 over HTTP", () => {
  it("POST /inventory/write-downs and POST /inventory/movements/:id/reverse, success and 400", async () => {
    const w = world();
    const r = w.repository;
    const app = buildApi(r, { __unsafeDisableAuthForTests: true });
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 5, unitCostPaise: 10_000 });
      const opening = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 5, unitCostPaise: 10_000 }); // the write-down eats the OLDER lot

      const ok = await app.inject({ method: "POST", url: "/inventory/write-downs", payload: { itemId: w.itemId, quantity: 2, reason: "breakage" } });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ quantity: 2, valuePaise: 20_000 });
      const bad = await app.inject({ method: "POST", url: "/inventory/write-downs", payload: { itemId: w.itemId, quantity: 0 } });
      expect(bad.statusCode).toBe(400);
      const tooMany = await app.inject({ method: "POST", url: "/inventory/write-downs", payload: { itemId: w.itemId, quantity: 99 } });
      expect(tooMany.statusCode).toBe(400);
      expect(tooMany.json().message ?? tooMany.body).toMatch(/Only 8/);
      const stray = await app.inject({ method: "POST", url: "/inventory/write-downs", payload: { itemId: w.itemId, quantity: 1, bogus: true } });
      expect(stray.statusCode).toBe(400);

      const writedownId = (ok.json() as { writedownId: string }).writedownId;
      const reverseDown = await app.inject({ method: "POST", url: `/inventory/movements/${writedownId}/reverse`, payload: {} });
      expect(reverseDown.statusCode).toBe(201);
      expect(reverseDown.json()).toMatchObject({ kind: "WRITE_DOWN", valuePaise: 20_000 });
      const reverseOpening = await app.inject({ method: "POST", url: `/inventory/movements/${opening.id}/reverse`, payload: { reason: "typo" } });
      expect(reverseOpening.statusCode).toBe(201);
      expect(reverseOpening.json()).toMatchObject({ kind: "MOVEMENT", valuePaise: 50_000 });

      const again = await app.inject({ method: "POST", url: `/inventory/movements/${opening.id}/reverse`, payload: {} });
      expect(again.statusCode).toBe(400);
      const missing = await app.inject({ method: "POST", url: "/inventory/movements/nope/reverse", payload: {} });
      expect(missing.statusCode).toBe(400);
      const strayBody = await app.inject({ method: "POST", url: `/inventory/movements/${opening.id}/reverse`, payload: { bogus: 1 } });
      expect(strayBody.statusCode).toBe(400);
      expectTies(w);
    } finally {
      await app.close();
      r.close();
    }
  });
});
