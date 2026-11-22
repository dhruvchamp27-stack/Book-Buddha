import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AccountingRepository, RepositoryValidationError, istDateOf } from "./repository.js";
import { verifyAuditChain } from "./audit-log.js";
import { buildApi } from "../api/server.js";

/**
 * R4c - opening stock and stock adjustments reach the GENERAL LEDGER (owner ruling S5-3), and the
 * backfill that gives the movements already in a live database the entry they never got.
 *
 * Figures are PAISE in code with the rupee figure in a comment, as every acceptance test here does.
 * Constructing AccountingRepository runs every migration, so STOCK_ADJUSTMENT (seeded at v13) and
 * OPENING_BALANCE_EQUITY are both present.
 */
interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  customerId: string;
  supplierId: string;
  itemId: string;
}

function world(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  const itemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  return { repository, companyId, businessId, customerId, supplierId, itemId };
}

/** The INVENTORY balance AS THE LEDGER HAS IT: debits less credits across every posted entry. */
function inventoryLedgerPaise(r: AccountingRepository, businessId: string): number {
  const row = r.db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account = 'INVENTORY' AND je.business_id = ?`,
    )
    .get(businessId) as { net: number };
  return row.net;
}

/** What the STOCK says it is worth: the FIFO layers, which is what the ledger must tie out to. */
function valuationPaise(r: AccountingRepository): number {
  return r.getInventoryValuation().reduce((total, row) => total + row.valuePaise, 0);
}

function accountNetPaise(r: AccountingRepository, businessId: string, account: string): number {
  const row = r.db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account = ? AND je.business_id = ?`,
    )
    .get(account, businessId) as { net: number };
  return row.net;
}

function journalCount(r: AccountingRepository): number {
  return (r.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
}

function movementCount(r: AccountingRepository): number {
  return (r.db.prepare("SELECT COUNT(*) AS n FROM stock_movements").get() as { n: number }).n;
}

function sell(w: World, id: string, quantity: number, unitPricePaise: number): void {
  w.repository.saveDraft({
    id, number: id, businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", status: "DRAFT",
    lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise }],
  });
  w.repository.finalizeInvoice(id);
}

/** A movement as it exists in a database built BEFORE R4c: stock moved, nothing posted. */
function insertGlLessMovement(
  r: AccountingRepository,
  input: { itemId: string; movementType: "OPENING" | "ADJUSTMENT" | "PURCHASE"; quantity: number; unitCostPaise: number; occurredAt: string; fairId?: string },
): string {
  const id = randomUUID();
  r.db
    .prepare(
      "INSERT INTO stock_movements (id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at, fair_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
    )
    .run(id, input.itemId, input.movementType, input.quantity, input.unitCostPaise, input.occurredAt, input.fairId ?? null);
  return id;
}

describe("R4c - opening stock and stock adjustments post to the ledger", () => {
  // CONFIRMED by the owner on 2026-11-18 (ruling S10-6), after he corrected the trial balance to
  // Rs 15,250 a side (S10-5). The six figures he signed are asserted below: opening stock
  // Rs 10,000 to equity, the recount Rs 1,250, accrual profit Rs 2,750, cash profit Rs 1,500,
  // closing inventory Rs 8,750 tying to the stock valuation, and the balance sheet at Rs 12,750.
  it("ACCEPTANCE R4c (CONFIRMED S10-6): opening stock is equity, an adjustment is an expense, and the ledger ties to the stock", () => {
    const w = world();
    const r = w.repository;
    try {
      // 1. Opening stock: 40 atlases that cost Rs 250 each = Rs 10,000.
      const opening = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 40, unitCostPaise: 25_000, occurredOn: "2026-04-01" });
      expect(opening.journalEntryId).toBe(`je-stock-movement-${opening.id}`);
      expect(inventoryLedgerPaise(r, w.businessId)).toBe(1_000_000); // Rs 10,000 of stock on the books
      expect(accountNetPaise(r, w.businessId, "OPENING_BALANCE_EQUITY")).toBe(-1_000_000); // a CREDIT of Rs 10,000
      expect(valuationPaise(r)).toBe(1_000_000);

      // 2. A recount in the year finds 5 more, worth Rs 1,250. That is THIS YEAR'S event, so it
      //    goes to the STOCK_ADJUSTMENT expense account, not to equity (S5-3).
      const adjustment = r.addStockMovement({ itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 5, unitCostPaise: 25_000, occurredOn: "2026-08-15" });
      expect(accountNetPaise(r, w.businessId, "STOCK_ADJUSTMENT")).toBe(-125_000); // a CREDIT of Rs 1,250
      expect(accountNetPaise(r, w.businessId, "OPENING_BALANCE_EQUITY")).toBe(-1_000_000); // untouched
      expect(adjustment.journalEntryId).toBe(`je-stock-movement-${adjustment.id}`);

      // 3. Sell 10 for Rs 400 each. COGS takes 10 x Rs 250 = Rs 2,500 out of inventory.
      sell(w, "I1", 10, 40_000);
      expect(accountNetPaise(r, w.businessId, "COGS")).toBe(250_000); // Rs 2,500

      // THE TIE-OUT, which is the whole point of R4c: the INVENTORY account in the ledger and the
      // stock the app says it holds are now the SAME number, to the paise.
      // Rs 10,000 opening + Rs 1,250 recount - Rs 2,500 sold = Rs 8,750; 35 copies x Rs 250.
      expect(inventoryLedgerPaise(r, w.businessId)).toBe(875_000);
      expect(valuationPaise(r)).toBe(875_000);
      expect(inventoryLedgerPaise(r, w.businessId)).toBe(valuationPaise(r));

      // The trial balance still balances, which an unbalanced opening entry would have broken.
      const tb = r.getTrialBalance({ businessId: w.businessId });
      const debits = tb.reduce((t, x) => t + x.debitPaise, 0);
      const credits = tb.reduce((t, x) => t + x.creditPaise, 0);
      expect(debits).toBe(credits);
      // S10-5, THE OWNER'S CORRECTION: balancing was never enough. The report used to print each
      // account's GROSS movement, so INVENTORY read Dr 11,250 / Cr 2,500 and both totals came to
      // Rs 17,750 - balanced, and wrong, with the same Rs 2,500 duplicated on each side. A trial
      // balance carries NET balances, so the totals are Rs 15,250 and INVENTORY appears once, at
      // the Rs 8,750 actually held. This assertion is the one that would have caught it.
      expect(debits).toBe(1_525_000); // Rs 15,250
      expect(credits).toBe(1_525_000); // Rs 15,250
      expect(tb.find((x) => x.account === "INVENTORY")).toMatchObject({ debitPaise: 875_000, creditPaise: 0 });

      // The recount is a GAIN, because today a movement can only ADD stock (quantity > 0). So it
      // lands as a CREDIT in an EXPENSE account and REDUCES this year's expenses by Rs 1,250.
      // Accrual P&L: sales Rs 4,000, COGS Rs 2,500, stock adjustment -Rs 1,250 => profit Rs 2,750.
      const pl = r.getProfitAndLoss({ businessId: w.businessId, basis: "ACCRUAL" });
      expect(pl.totalIncomePaise).toBe(400_000); // Rs 4,000
      expect(pl.totalExpensesPaise).toBe(250_000 - 125_000); // Rs 2,500 COGS less the Rs 1,250 gain
      expect(pl.netProfitPaise).toBe(275_000); // Rs 2,750
      const adjustmentRow = pl.expenses.find((row) => row.account === "STOCK_ADJUSTMENT");
      expect(adjustmentRow).toMatchObject({ debitPaise: 0, creditPaise: 125_000 });

      expect(verifyAuditChain(r.db).ok).toBe(true);
    } finally {
      r.close();
    }
  });

  it("dates the journal entry on the date given while the stock layer stays append-only, so posted COGS is never re-measured", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 25_000, occurredOn: "2026-04-01" });
      sell(w, "I1", 4, 40_000);
      const cogsAfterSale = accountNetPaise(r, w.businessId, "COGS");
      expect(cogsAfterSale).toBe(100_000); // 4 x Rs 250 = Rs 1,000

      // Now a BACK-DATED opening layer at a different cost. FIFO consumes layers ORDER BY
      // occurred_at, so if this were back-dated in the stock table it would jump ahead of the
      // layer the sale above already consumed and silently re-measure COGS that is posted.
      const backDated = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 10_000, occurredOn: "2025-04-01" });
      expect(accountNetPaise(r, w.businessId, "COGS")).toBe(cogsAfterSale); // unchanged, as it must be

      // The LEDGER carries the date given; the stock layer carries today, so it is append-only.
      const entry = r.db
        .prepare("SELECT entry_date FROM journal_entries WHERE source_id = ? AND source_type = 'STOCK_MOVEMENT'")
        .get(backDated.id) as { entry_date: string };
      expect(entry.entry_date).toBe("2025-04-01");
      expect(istDateOf(backDated.occurredAt)).toBe(istDateOf());

      // And the next sale still takes the OLDER layer first - the one entered first, at Rs 250.
      sell(w, "I2", 6, 40_000);
      expect(accountNetPaise(r, w.businessId, "COGS")).toBe(100_000 + 150_000); // 6 x Rs 250
      expect(inventoryLedgerPaise(r, w.businessId)).toBe(valuationPaise(r));
    } finally {
      r.close();
    }
  });

  it("PINS what the CASH view does with these entries today: nothing at all", () => {
    const w = world();
    const r = w.repository;
    try {
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 40, unitCostPaise: 25_000, occurredOn: "2026-04-01" });
      r.addStockMovement({ itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 5, unitCostPaise: 25_000, occurredOn: "2026-08-15" });

      // The cash-basis walk visits invoices, bills and expenses - it never visits a STOCK_MOVEMENT
      // entry, exactly as it never visits an OPENING_BALANCE one. So the recount's Rs 1,250 gain
      // shows on the ACCRUAL P&L and is absent from the CASH P&L.
      //
      // Not a defect to fix inside R4c, and arguably right: no money moved, so a cash-basis P&L
      // has nothing to recognise. PINNED so that if the walk is ever extended, this is seen.
      const accrual = r.getProfitAndLoss({ businessId: w.businessId, basis: "ACCRUAL" });
      expect(accrual.expenses.find((row) => row.account === "STOCK_ADJUSTMENT")).toMatchObject({ creditPaise: 125_000 });
      const cash = r.getProfitAndLoss({ businessId: w.businessId, basis: "CASH" });
      expect(cash.expenses.find((row) => row.account === "STOCK_ADJUSTMENT")).toBeUndefined();
      expect(cash.expenses.find((row) => row.account === "OPENING_BALANCE_EQUITY")).toBeUndefined();
      expect(cash.netProfitPaise).toBe(0);
    } finally {
      r.close();
    }
  });

  it("refuses a movement dated inside a locked financial year and leaves NO stock row behind", () => {
    const w = world();
    const r = w.repository;
    try {
      const year = r.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      r.setFinancialYearLocked(year, true, "filed");
      const before = movementCount(r);
      expect(() =>
        r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 25_000, occurredOn: "2025-06-01" }),
      ).toThrow(/locked/i);
      // The movement and its entry are one transaction: a door refusal rolls the stock row back.
      expect(movementCount(r)).toBe(before);
      expect(journalCount(r)).toBe(0);
      expect(valuationPaise(r)).toBe(0);

      // Dated in an OPEN period, the same movement posts.
      r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 25_000, occurredOn: "2026-06-01" });
      expect(movementCount(r)).toBe(before + 1);
      expect(inventoryLedgerPaise(r, w.businessId)).toBe(250_000); // Rs 2,500
    } finally {
      r.close();
    }
  });

  it("posts nothing for a bare PURCHASE movement or a zero-value movement, and says so in the plan", () => {
    const w = world();
    const r = w.repository;
    try {
      // S17: the door now REFUSES a bare PURCHASE. A source-less one can still exist in an old
      // database, so it is built by hand here; it remains the one uncovered path the plan reports.
      expect(() => r.addStockMovement({ itemId: w.itemId, movementType: "PURCHASE", quantity: 5, unitCostPaise: 30_000 }))
        .toThrow("Stock comes in through a purchase bill, opening stock, or a stock adjustment.");
      insertGlLessMovement(r, { itemId: w.itemId, movementType: "PURCHASE", quantity: 5, unitCostPaise: 30_000, occurredAt: new Date().toISOString() });
      // A free sample: nothing to post, because a journal line needs an amount above zero.
      const free = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 2, unitCostPaise: 0 });
      expect(free.journalEntryId).toBeUndefined();
      expect(journalCount(r)).toBe(0);

      const plan = r.planStockJournalBackfill({ businessId: w.businessId });
      expect(plan.toPost).toEqual([]);
      expect(plan.refused).toEqual([]);
      expect(plan.nothingToPost.map((row) => row.movementId)).toEqual([free.id]);
      // The ledger does NOT tie out here, and the plan must be the thing that says so.
      expect(plan.uncoveredPurchaseMovements).toBe(1);
      expect(inventoryLedgerPaise(r, w.businessId)).not.toBe(valuationPaise(r));
    } finally {
      r.close();
    }
  });

  it("carries the movement's project (fair) onto the journal entry", () => {
    const w = world();
    const r = w.repository;
    try {
      const fairId = r.createFair({ companyId: w.companyId, hostCustomerId: w.customerId, name: "Fair A" });
      const movement = r.addStockMovement({ itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 4, unitCostPaise: 25_000, fairId, occurredOn: "2026-08-15" });
      const entry = r.db
        .prepare("SELECT fair_id FROM journal_entries WHERE source_id = ?")
        .get(movement.id) as { fair_id: string | null };
      expect(entry.fair_id).toBe(fairId);
      // And the fair's own P&L sees the adjustment, which is the point of tagging it.
      expect(accountNetPaise(r, w.businessId, "STOCK_ADJUSTMENT")).toBe(-100_000); // Rs 1,000 credit
      const fairPl = r.getProfitAndLoss({ businessId: w.businessId, fairId, basis: "ACCRUAL" });
      expect(fairPl.expenses.find((row) => row.account === "STOCK_ADJUSTMENT")).toMatchObject({ creditPaise: 100_000 });
    } finally {
      r.close();
    }
  });

  describe("which business the stock posts to", () => {
    it("derives the business when the company has exactly one", () => {
      const w = world();
      try {
        const movement = w.repository.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 25_000 });
        const entry = w.repository.db
          .prepare("SELECT business_id FROM journal_entries WHERE source_id = ?")
          .get(movement.id) as { business_id: string };
        expect(entry.business_id).toBe(w.businessId);
      } finally {
        w.repository.close();
      }
    });

    it("refuses to guess when the company has two, and names them", () => {
      const w = world();
      const r = w.repository;
      try {
        r.createBusiness({ companyId: w.companyId, name: "Stationery" });
        expect(() => r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 25_000 }))
          .toThrow(/2 businesses \(Books, Stationery\)/);
        expect(movementCount(r)).toBe(0);
        // Named, it posts to exactly the business named.
        const movement = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 25_000, businessId: w.businessId });
        const entry = r.db.prepare("SELECT business_id FROM journal_entries WHERE source_id = ?").get(movement.id) as { business_id: string };
        expect(entry.business_id).toBe(w.businessId);
      } finally {
        r.close();
      }
    });

    it("refuses a business belonging to another company, and a company with no business at all", () => {
      const w = world();
      const r = w.repository;
      try {
        const otherCompany = r.createCompany({ name: "Other Co" });
        const otherBusiness = r.createBusiness({ companyId: otherCompany, name: "Other Books" });
        expect(() => r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 25_000, businessId: otherBusiness }))
          .toThrow(/another company/);
        const orphanItem = r.createItem({ companyId: otherCompany, name: "Globe", unit: "each", trackStock: true });
        r.db.prepare("DELETE FROM businesses WHERE id = ?").run(otherBusiness);
        expect(() => r.addStockMovement({ itemId: orphanItem, movementType: "OPENING", quantity: 1, unitCostPaise: 25_000 }))
          .toThrow(/needs a business first/);
        expect(movementCount(r)).toBe(0);
      } finally {
        r.close();
      }
    });
  });

  describe("the backfill for movements that are already in the database with no entry", () => {
    it("plans, dry-runs, posts, and is idempotent on a second run", () => {
      const w = world();
      const r = w.repository;
      try {
        // Three movements as a pre-R4c database holds them: stock moved, nothing posted.
        const openingId = insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 40, unitCostPaise: 25_000, occurredAt: "2026-04-01T04:00:00.000Z" }); // Rs 10,000
        const adjustmentId = insertGlLessMovement(r, { itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 5, unitCostPaise: 25_000, occurredAt: "2026-08-15T04:00:00.000Z" }); // Rs 1,250
        const freeId = insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 2, unitCostPaise: 0, occurredAt: "2026-04-01T04:00:00.000Z" });
        expect(journalCount(r)).toBe(0);
        expect(valuationPaise(r)).toBe(1_125_000); // the stock is there: Rs 11,250
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(0); // the ledger knows nothing of it

        const plan = r.planStockJournalBackfill({ businessId: w.businessId });
        expect(plan.toPost.map((row) => row.movementId)).toEqual([openingId, adjustmentId]);
        expect(plan.toPost.map((row) => row.offsetAccount)).toEqual(["OPENING_BALANCE_EQUITY", "STOCK_ADJUSTMENT"]);
        expect(plan.toPost.map((row) => row.entryDate)).toEqual(["2026-04-01", "2026-08-15"]);
        expect(plan.totalPaise).toBe(1_125_000); // Rs 11,250
        expect(plan.nothingToPost.map((row) => row.movementId)).toEqual([freeId]);
        expect(plan.refused).toEqual([]);

        // A DRY RUN is the default and writes nothing at all.
        const dry = r.backfillStockJournals({ businessId: w.businessId });
        expect(dry.dryRun).toBe(true);
        expect(dry.postedCount).toBe(0);
        expect(journalCount(r)).toBe(0);

        const applied = r.backfillStockJournals({ businessId: w.businessId, dryRun: false });
        expect(applied.postedCount).toBe(2);
        expect(applied.postedPaise).toBe(1_125_000);
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(1_125_000);
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(valuationPaise(r)); // now it ties out
        expect(accountNetPaise(r, w.businessId, "OPENING_BALANCE_EQUITY")).toBe(-1_000_000); // Rs 10,000
        expect(accountNetPaise(r, w.businessId, "STOCK_ADJUSTMENT")).toBe(-125_000); // Rs 1,250

        // IDEMPOTENT: run it again and there is nothing left to do.
        const again = r.backfillStockJournals({ businessId: w.businessId, dryRun: false });
        expect(again.postedCount).toBe(0);
        expect(again.toPost).toEqual([]);
        expect(journalCount(r)).toBe(2);
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(1_125_000);
        expect(verifyAuditChain(r.db).ok).toBe(true);
      } finally {
        r.close();
      }
    });

    it("posts the ORIGINAL layer value even when the stock has since been sold", () => {
      const w = world();
      const r = w.repository;
      try {
        const openingId = insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 40, unitCostPaise: 25_000, occurredAt: "2026-04-01T04:00:00.000Z" });
        sell(w, "I1", 10, 40_000); // Rs 2,500 of that stock is gone, and COGS is posted for it
        expect(accountNetPaise(r, w.businessId, "COGS")).toBe(250_000);
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(-250_000); // credited with no debit behind it

        const plan = r.planStockJournalBackfill({ businessId: w.businessId });
        expect(plan.toPost).toHaveLength(1);
        // The ENTIRE original layer, Rs 10,000 - not the Rs 7,500 left of it. Posting the remainder
        // would leave COGS with no inventory behind it and the tie-out broken for ever.
        expect(plan.toPost[0]).toMatchObject({ movementId: openingId, valuePaise: 1_000_000, quantity: 40 });

        r.backfillStockJournals({ businessId: w.businessId, dryRun: false });
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(750_000); // Rs 7,500
        expect(valuationPaise(r)).toBe(750_000);
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(valuationPaise(r));
      } finally {
        r.close();
      }
    });

    it("refuses a locked year and another company's stock, lists each one, and still posts the rest", () => {
      const w = world();
      const r = w.repository;
      try {
        const year = r.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
        r.setFinancialYearLocked(year, true, "filed");
        const lockedId = insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 25_000, occurredAt: "2025-06-01T04:00:00.000Z" });
        const openId = insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 4, unitCostPaise: 25_000, occurredAt: "2026-06-01T04:00:00.000Z" });
        const otherCompany = r.createCompany({ name: "Other Co" });
        const otherItem = r.createItem({ companyId: otherCompany, name: "Globe", unit: "each", trackStock: true });
        const otherId = insertGlLessMovement(r, { itemId: otherItem, movementType: "OPENING", quantity: 3, unitCostPaise: 25_000, occurredAt: "2026-06-01T04:00:00.000Z" });

        const result = r.backfillStockJournals({ businessId: w.businessId, dryRun: false });
        expect(result.toPost.map((row) => row.movementId)).toEqual([openId]);
        expect(result.postedPaise).toBe(100_000); // Rs 1,000
        // Every refusal is NAMED with its reason, rather than the run stopping at the first.
        const refusals = result.refused.map((row) => ({ movementId: row.movementId, reason: row.reason }));
        expect(refusals).toEqual([
          { movementId: lockedId, reason: "The financial year covering 2025-06-01 is locked." },
          { movementId: otherId, reason: "The item belongs to another company than this business." },
        ]);
        expect(journalCount(r)).toBe(1);

        // Reopen the year and the refused movement posts, dated where it belongs.
        r.setFinancialYearLocked(year, false, "reopened to post opening stock");
        const second = r.backfillStockJournals({ businessId: w.businessId, dryRun: false });
        expect(second.postedCount).toBe(1);
        const entry = r.db.prepare("SELECT entry_date FROM journal_entries WHERE source_id = ?").get(lockedId) as { entry_date: string };
        expect(entry.entry_date).toBe("2025-06-01");
        expect(r.planStockJournalBackfill({ businessId: w.businessId }).refused.map((row) => row.movementId)).toEqual([otherId]);
      } finally {
        r.close();
      }
    });

    it("does not count movements that addStockMovement has already posted", () => {
      const w = world();
      const r = w.repository;
      try {
        const posted = r.addStockMovement({ itemId: w.itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 25_000, occurredOn: "2026-04-01" });
        const unposted = insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 5, unitCostPaise: 25_000, occurredAt: "2026-04-02T04:00:00.000Z" });
        const plan = r.planStockJournalBackfill({ businessId: w.businessId });
        // The guard against passing vacuously: the live one is ABSENT and the old one is PRESENT.
        expect(plan.toPost.map((row) => row.movementId)).toEqual([unposted]);
        expect(plan.toPost.map((row) => row.movementId)).not.toContain(posted.id);
      } finally {
        r.close();
      }
    });

    it("refuses to plan for a business that does not exist", () => {
      const w = world();
      try {
        expect(() => w.repository.planStockJournalBackfill({ businessId: "nope" })).toThrow(RepositoryValidationError);
      } finally {
        w.repository.close();
      }
    });

    it("carries a movement's project (fair) through the backfill too", () => {
      const w = world();
      const r = w.repository;
      try {
        const fairId = r.createFair({ companyId: w.companyId, hostCustomerId: w.customerId, name: "Fair A" });
        const tagged = insertGlLessMovement(r, { itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 4, unitCostPaise: 25_000, occurredAt: "2026-08-15T04:00:00.000Z", fairId });
        const untagged = insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 25_000, occurredAt: "2026-04-01T04:00:00.000Z" });
        expect(r.planStockJournalBackfill({ businessId: w.businessId }).toPost.map((row) => row.fairId)).toEqual([undefined, fairId]);
        r.backfillStockJournals({ businessId: w.businessId, dryRun: false });
        const fairOf = (movementId: string): string | null =>
          (r.db.prepare("SELECT fair_id FROM journal_entries WHERE source_id = ?").get(movementId) as { fair_id: string | null }).fair_id;
        expect(fairOf(tagged)).toBe(fairId);
        expect(fairOf(untagged)).toBeNull();
      } finally {
        r.close();
      }
    });
  });

  describe("over the API, which is the only way the owner can reach any of this today", () => {
    it("POST /inventory/journal-backfill is a DRY RUN unless apply is true, and is idempotent", async () => {
      const w = world();
      const r = w.repository;
      const app = buildApi(r, { __unsafeDisableAuthForTests: true });
      try {
        insertGlLessMovement(r, { itemId: w.itemId, movementType: "OPENING", quantity: 40, unitCostPaise: 25_000, occurredAt: "2026-04-01T04:00:00.000Z" }); // Rs 10,000
        insertGlLessMovement(r, { itemId: w.itemId, movementType: "ADJUSTMENT", quantity: 5, unitCostPaise: 25_000, occurredAt: "2026-08-15T04:00:00.000Z" }); // Rs 1,250

        const post = async (payload: Record<string, unknown>) =>
          app.inject({ method: "POST", url: "/inventory/journal-backfill", payload });

        // No `apply` at all: it must report and write NOTHING. This default is the whole guard on
        // "never run it on my data without my say-so", so it is pinned here.
        const dry = await post({ businessId: w.businessId });
        expect(dry.statusCode).toBe(200);
        expect(dry.json()).toMatchObject({ dryRun: true, postedCount: 0, totalPaise: 1_125_000, uncoveredPurchaseMovements: 0 });
        expect(journalCount(r)).toBe(0);
        // `apply: false` is the same as omitting it.
        await post({ businessId: w.businessId, apply: false });
        expect(journalCount(r)).toBe(0);

        const applied = await post({ businessId: w.businessId, apply: true });
        expect(applied.json()).toMatchObject({ dryRun: false, postedCount: 2, postedPaise: 1_125_000 });
        expect(journalCount(r)).toBe(2);
        expect(inventoryLedgerPaise(r, w.businessId)).toBe(valuationPaise(r));

        const again = await post({ businessId: w.businessId, apply: true });
        expect(again.json()).toMatchObject({ postedCount: 0, toPost: [] });
        expect(journalCount(r)).toBe(2);

        // An unknown business is refused, in words, not with a silent empty plan.
        const unknown = await post({ businessId: "11111111-1111-1111-1111-111111111111", apply: true });
        expect(unknown.statusCode).toBe(400);
        expect(unknown.json<{ error?: string }>().error).toMatch(/was not found/);
      } finally {
        await app.close();
        r.close();
      }
    });
  });
});
