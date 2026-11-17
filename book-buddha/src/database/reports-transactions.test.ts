import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postJournalEntry } from "./ledger.js";
import { AccountingRepository } from "./repository.js";
import { stockMovementReport, transactionDetailByAccount, transactionListByDate } from "./reports-transactions.js";

/**
 * R7 part one: the transaction and stock-movement reports. Money is paise (Rs 1 = 100 paise).
 *
 * THE WORKED WORLD (Rs). Items: Atlas and Banyan, both stock-tracked. Only `Date` is faked.
 *   01 Mar  Opening stock: Atlas 10 @ 50 = 500 (Books A), Banyan 5 @ 20 = 100 (Books B)
 *   05 Mar  Purchase of Atlas 5 @ 60                            (stock only - the bill posts GL)
 *   10 Mar  INV-S1  Alpha, Books A, Fair One: 4 Atlas @ 100 = 400. Cost 4 x 50 = 200.
 *   11 Mar  INV-S2  Beta, Books B, no fair:   2 Banyan @ 40 = 80.  Cost 2 x 20 = 40.
 *   12 Mar  Adjustment: +2 Atlas @ 55 = 110, Books A, tagged Fair One. Alpha pays 150 on INV-S1.
 *   15 Mar  CN-S1 on INV-S1 returns 1 Atlas @ 100 (stock back at its cost of 50).
 * TEN journal entries result: invoice + cost for each sale, the payment, the note + its stock
 * (seven), and - new in R4c - the two opening-stock entries and the adjustment. A bare PURCHASE
 * movement still posts nothing, because a real purchase posts its GL on the bill.
 */
const PAISE = (rupees: number): number => rupees * 100;
const at = (date: string): void => { vi.setSystemTime(new Date(`${date}T06:00:00.000Z`)); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-03-01");
});
afterEach(() => {
  vi.useRealTimers();
});

function world() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const bizA = repository.createBusiness({ companyId, name: "Books A" });
  const bizB = repository.createBusiness({ companyId, name: "Books B" });
  const alpha = repository.createCustomer({ companyId, name: "Alpha School" });
  const beta = repository.createCustomer({ companyId, name: "Beta School" });
  const atlas = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const banyan = repository.createItem({ companyId, name: "Banyan", unit: "each", trackStock: true });
  const fair1 = repository.createFair({ companyId, hostCustomerId: alpha, name: "Fair One" });
  const invoice = (id: string, businessId: string, customerId: string, itemId: string, quantity: number, unit: number, date: string, fairId?: string): void => {
    repository.saveDraft({
      id, number: id, businessId, customerId, invoiceDate: date, status: "DRAFT", paymentAccount: "RECEIVABLES",
      taxType: "NONE", taxRateBasisPoints: 0, ...(fairId === undefined ? {} : { fairId }),
      lines: [{ itemId, description: "Goods", quantity, unitPricePaise: PAISE(unit) }],
    });
    repository.finalizeInvoice(id);
  };
  // R4c: these now POST, so the business is named - this company has two, and the repository
  // refuses to guess between them rather than picking one silently.
  repository.addStockMovement({ itemId: atlas, movementType: "OPENING", quantity: 10, unitCostPaise: PAISE(50), businessId: bizA });
  repository.addStockMovement({ itemId: banyan, movementType: "OPENING", quantity: 5, unitCostPaise: PAISE(20), businessId: bizB });
  at("2026-03-05");
  repository.addStockMovement({ itemId: atlas, movementType: "PURCHASE", quantity: 5, unitCostPaise: PAISE(60) });
  at("2026-03-10");
  invoice("INV-S1", bizA, alpha, atlas, 4, 100, "2026-03-10", fair1);
  at("2026-03-11");
  invoice("INV-S2", bizB, beta, banyan, 2, 40, "2026-03-11");
  at("2026-03-12");
  repository.addStockMovement({ itemId: atlas, movementType: "ADJUSTMENT", quantity: 2, unitCostPaise: PAISE(55), fairId: fair1, businessId: bizA });
  repository.recordPayment("INV-S1", PAISE(150), "2026-03-12");
  at("2026-03-15");
  repository.saveCreditNote({
    id: "CN-S1", invoiceId: "INV-S1", number: "CN-S1", reason: "Return", status: "DRAFT",
    lines: [{ itemId: atlas, description: "Returned", quantity: 1, unitPricePaise: PAISE(100) }],
  });
  repository.finalizeCreditNote("CN-S1");
  return { repository, companyId, bizA, bizB, alpha, beta, atlas, banyan, fair1 };
}

/** Wraps a database so every SELECT is recorded with its bound parameters and the rows SQLite handed back. */
function spy(db: Database.Database) {
  const log: Array<{ sql: string; params: unknown[]; rows: number }> = [];
  const bindIfFunction = (target: object, prop: string | symbol): unknown => {
    const value = Reflect.get(target, prop) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  };
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop !== "prepare") return bindIfFunction(target, prop);
      return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(st, p) {
            if (p === "all") {
              return (...params: unknown[]) => {
                const rows = st.all(...params);
                log.push({ sql, params, rows: rows.length });
                return rows;
              };
            }
            return bindIfFunction(st, p);
          },
        });
      };
    },
  });
  return { db: proxy as Database.Database, log };
}

describe("transactionListByDate", () => {
  it("lists every posted entry once, in date order, with its total value", () => {
    const w = world();
    const rows = transactionListByDate(w.repository.db);
    expect(rows.map((r) => [r.date, r.entryId.replace(/payment-.*/, "payment-*").replace(/stock-movement-.*/, "stock-movement-*"), r.description, r.sourceType, r.businessName, r.fairName, r.totalPaise])).toEqual([
      // R4c: opening stock and the recount now appear here, because they are now posted entries.
      // They are listed under the business they were entered for, on their own transaction date.
      ["2026-03-01", "je-stock-movement-*", "Opening stock as at 2026-03-01", "STOCK_MOVEMENT", "Books A", "(No fair)", PAISE(500)],
      ["2026-03-01", "je-stock-movement-*", "Opening stock as at 2026-03-01", "STOCK_MOVEMENT", "Books B", "(No fair)", PAISE(100)],
      ["2026-03-10", "je-INV-S1", "Invoice INV-S1", "INVOICE", "Books A", "Fair One", PAISE(400)],
      ["2026-03-10", "je-inventory-INV-S1", expect.any(String), "INVOICE", "Books A", "Fair One", PAISE(200)],
      ["2026-03-11", "je-INV-S2", "Invoice INV-S2", "INVOICE", "Books B", "(No fair)", PAISE(80)],
      ["2026-03-11", "je-inventory-INV-S2", expect.any(String), "INVOICE", "Books B", "(No fair)", PAISE(40)],
      ["2026-03-12", "je-stock-movement-*", "Stock adjustment as at 2026-03-12", "STOCK_MOVEMENT", "Books A", "Fair One", PAISE(110)],
      ["2026-03-12", "je-payment-*", expect.any(String), "INVOICE", "Books A", "Fair One", PAISE(150)],
      ["2026-03-15", "je-credit-note-CN-S1", expect.any(String), "INVOICE", "Books A", "Fair One", PAISE(100)],
      ["2026-03-15", "je-credit-note-inventory-CN-S1", expect.any(String), "INVOICE", "Books A", "Fair One", PAISE(50)],
    ]);
    // Was rows[2] before R4c put the two opening-stock entries ahead of the invoices.
    expect(rows[4]).toMatchObject({ businessId: w.bizB, fairId: null, isReversal: false, sourceId: "INV-S2" });
  });

  it("orders on the transaction date, not the posting timestamp", () => {
    const w = world();
    // Posted today (the faked clock says 15 Mar) but DATED 1 Feb: it must sort first, not last.
    // Dated 1 FEBRUARY, not 1 March, only to keep it clear of the opening-stock entries R4c now
    // posts on 1 March - the point being tested is the ordering, not the tie-break.
    postJournalEntry(w.repository.db, {
      id: "je-backdated", sourceId: "INV-S1", description: "Back-dated", isReversal: false,
      lines: [{ account: "CASH", debitPaise: 100, creditPaise: 0 }, { account: "SALES", debitPaise: 0, creditPaise: 100 }],
    }, { businessId: w.bizA, entryDate: "2026-02-01" });
    const rows = transactionListByDate(w.repository.db);
    expect(rows[0]).toMatchObject({ entryId: "je-backdated", date: "2026-02-01" });
  });

  it("each filter narrows it; omitting every filter returns all ten, untagged included", () => {
    const w = world();
    const by = (f: Parameters<typeof transactionListByDate>[1]) => transactionListByDate(w.repository.db, f).length;
    // 7 before R4c; the two opening-stock entries and the adjustment make 10.
    expect(by({})).toBe(10);
    expect(by({ businessId: w.bizB })).toBe(3); // + Banyan's opening stock
    expect(by({ fairId: w.fair1 })).toBe(6); // + the adjustment, which is tagged Fair One
    expect(by({ customerId: w.beta })).toBe(2); // a customer filter cannot match stock entries
    expect(by({ customerId: w.alpha })).toBe(5);
    expect(by({ fromDate: "2026-03-12" })).toBe(4); // + the adjustment on 12 Mar
    expect(by({ toDate: "2026-03-10" })).toBe(4); // + both opening entries on 1 Mar
    expect(by({ fromDate: "2026-03-11", toDate: "2026-03-11" })).toBe(2);
    expect(by({ fromDate: "2026-03-01", toDate: "2026-03-01" })).toBe(2); // the opening stock alone
  });

  it("refuses a reversed range, a bad date and an item filter", () => {
    const w = world();
    expect(() => transactionListByDate(w.repository.db, { fromDate: "2026-03-02", toDate: "2026-03-01" })).toThrow("From date cannot be after the to date.");
    expect(() => transactionListByDate(w.repository.db, { toDate: "03/01/2026" })).toThrow("To date must be a real date written as YYYY-MM-DD.");
    expect(() => transactionListByDate(w.repository.db, { itemId: w.atlas } as never)).toThrow(/item/i);
  });

  it("applies the filter in SQL: excluded entries never leave SQLite", () => {
    const w = world();
    const probe = spy(w.repository.db);
    const filtered = transactionListByDate(probe.db, { businessId: w.bizB, customerId: w.beta });
    expect(filtered).toHaveLength(2);
    const query = probe.log.find((entry) => entry.sql.includes("journal_entries"));
    expect(query?.sql).toContain("je.business_id = ?");
    expect(query?.params).toEqual([w.bizB, w.beta]);
    expect(query?.rows).toBe(2);
  });
});

describe("transactionDetailByAccount", () => {
  const account = (groups: ReturnType<typeof transactionDetailByAccount>, code: string) => groups.find((g) => g.account === code);

  it("groups journal lines by account with a running balance in the account's natural direction", () => {
    const w = world();
    const groups = transactionDetailByAccount(w.repository.db);
    // R4c added OPENING_BALANCE_EQUITY and STOCK_ADJUSTMENT: the opening stock and the recount
    // now have a GL side, where before they moved stock and touched no account at all.
    expect(groups.map((g) => g.account)).toEqual(["CASH", "COGS", "INVENTORY", "OPENING_BALANCE_EQUITY", "RECEIVABLES", "SALES", "STOCK_ADJUSTMENT"]);
    // Opening stock: Atlas 500 + Banyan 100 credited to equity; the recount 110 to the expense.
    expect(account(groups, "OPENING_BALANCE_EQUITY")).toMatchObject({ type: "EQUITY", totalDebitPaise: 0, totalCreditPaise: PAISE(600) });
    expect(account(groups, "STOCK_ADJUSTMENT")).toMatchObject({ type: "EXPENSE", totalDebitPaise: 0, totalCreditPaise: PAISE(110) });
    // RECEIVABLES (an asset, debit-natural): +400, +80, -150 paid, -100 note.
    const receivables = account(groups, "RECEIVABLES");
    expect(receivables).toMatchObject({ accountName: expect.any(String), type: "ASSET", openingBalancePaise: 0, totalDebitPaise: PAISE(480), totalCreditPaise: PAISE(250), closingBalancePaise: PAISE(230) });
    expect(receivables?.rows.map((r) => [r.date, r.debitPaise, r.creditPaise, r.balancePaise])).toEqual([
      ["2026-03-10", PAISE(400), 0, PAISE(400)],
      ["2026-03-11", PAISE(80), 0, PAISE(480)],
      ["2026-03-12", 0, PAISE(150), PAISE(330)],
      ["2026-03-15", 0, PAISE(100), PAISE(230)],
    ]);
    // SALES (income, credit-natural): +400, +80, then the note takes 100 back.
    const sales = account(groups, "SALES");
    expect(sales?.type).toBe("INCOME");
    expect(sales?.rows.map((r) => r.balancePaise)).toEqual([PAISE(400), PAISE(480), PAISE(380)]);
    // COGS (expense, debit-natural): 200, 40, then 50 comes back.
    expect(account(groups, "COGS")?.rows.map((r) => r.balancePaise)).toEqual([PAISE(200), PAISE(240), PAISE(190)]);
  });

  it("starts the running balance from the true opening balance when a from date is given", () => {
    const w = world();
    const groups = transactionDetailByAccount(w.repository.db, { fromDate: "2026-03-12" });
    const receivables = account(groups, "RECEIVABLES");
    // 400 + 80 were already owed before 12 Mar, so the first row in the period is 480 -> 330, not -150.
    expect(receivables?.openingBalancePaise).toBe(PAISE(480));
    expect(receivables?.rows.map((r) => r.balancePaise)).toEqual([PAISE(330), PAISE(230)]);
    expect(receivables?.closingBalancePaise).toBe(PAISE(230));
    // The opening balance honours the other filters: Fair One only had 400 owed before 12 Mar.
    const fairOne = transactionDetailByAccount(w.repository.db, { fromDate: "2026-03-12", fairId: w.fair1 });
    expect(account(fairOne, "RECEIVABLES")?.openingBalancePaise).toBe(PAISE(400));
    expect(account(fairOne, "RECEIVABLES")?.closingBalancePaise).toBe(PAISE(150));
  });

  it("each filter narrows it; omitting every filter returns everything", () => {
    const w = world();
    const lines = (f: Parameters<typeof transactionDetailByAccount>[1]) =>
      transactionDetailByAccount(w.repository.db, f).reduce((t, g) => t + g.rows.length, 0);
    const all = lines({});
    // 14 before R4c; the three new entries are two lines each, so 20.
    expect(all).toBe(20);
    expect(lines({ businessId: w.bizB })).toBe(6); // + Banyan's opening stock (2 lines)
    expect(lines({ fairId: w.fair1 })).toBe(12); // + the adjustment, tagged Fair One
    expect(lines({ customerId: w.beta })).toBe(4); // unchanged: no customer behind a stock entry
    expect(lines({ toDate: "2026-03-10" })).toBe(8); // + both opening entries on 1 Mar
    expect(lines({ fromDate: "2026-03-15" })).toBe(4);
  });

  it("groups by the chart's account class, so a user-created account appears with its own name and class", () => {
    const w = world();
    w.repository.createAccount({ companyId: w.companyId, code: "TRAVEL", name: "Travel", type: "EXPENSE" });
    postJournalEntry(w.repository.db, {
      id: "je-travel", sourceId: "INV-S1", description: "Fair travel", isReversal: false,
      lines: [{ account: "TRAVEL", debitPaise: PAISE(30), creditPaise: 0 }, { account: "CASH", debitPaise: 0, creditPaise: PAISE(30) }],
    }, { businessId: w.bizA, entryDate: "2026-03-13", fairId: w.fair1 });
    const groups = transactionDetailByAccount(w.repository.db);
    expect(account(groups, "TRAVEL")).toMatchObject({ accountName: "Travel", type: "EXPENSE", closingBalancePaise: PAISE(30) });
    expect(account(groups, "CASH")?.closingBalancePaise).toBe(PAISE(120));
  });

  it("applies the filter in SQL: excluded lines never leave SQLite", () => {
    const w = world();
    const probe = spy(w.repository.db);
    const filtered = transactionDetailByAccount(probe.db, { fromDate: "2026-03-12", customerId: w.alpha });
    const shown = filtered.reduce((t, g) => t + g.rows.length, 0);
    const detail = probe.log.find((entry) => entry.sql.includes("jl.debit_paise") && entry.sql.includes("je.entry_date >= ?"));
    expect(detail?.params).toContain("2026-03-12");
    expect(detail?.params).toContain(w.alpha);
    expect(detail?.rows).toBe(shown);
    // The opening-balance query is bounded by the same business/fair/customer scope but looks BEFORE the date.
    const opening = probe.log.find((entry) => entry.sql.includes("je.entry_date < ?"));
    expect(opening?.params).toContain(w.alpha);
  });
});

describe("stockMovementReport", () => {
  const view = (rows: ReturnType<typeof stockMovementReport>) =>
    rows.map((r) => [r.itemName, r.date, r.movementType, r.quantityIn, r.quantityOut, r.unitCostPaise, r.valuePaise, r.quantityOnHand]);

  it("lists every movement per item with the running quantity on hand", () => {
    const w = world();
    const rows = stockMovementReport(w.repository.db);
    expect(view(rows)).toEqual([
      ["Atlas", "2026-03-01", "OPENING", 10, 0, PAISE(50), PAISE(500), 10],
      ["Atlas", "2026-03-05", "PURCHASE", 5, 0, PAISE(60), PAISE(300), 15],
      ["Atlas", "2026-03-10", "SALE", 0, 4, PAISE(50), -PAISE(200), 11],
      ["Atlas", "2026-03-12", "ADJUSTMENT", 2, 0, PAISE(55), PAISE(110), 13],
      ["Atlas", "2026-03-15", "SALE_REVERSAL", 1, 0, PAISE(50), PAISE(50), 14],
      ["Banyan", "2026-03-01", "OPENING", 5, 0, PAISE(20), PAISE(100), 5],
      ["Banyan", "2026-03-11", "SALE", 0, 2, PAISE(20), -PAISE(40), 3],
    ]);
    // The running quantity ends where the repository's own stock balance says it does.
    const balances = w.repository.getStockBalances();
    expect(balances.find((b) => b.itemId === w.atlas)?.quantity).toBe(14);
    expect(balances.find((b) => b.itemId === w.banyan)?.quantity).toBe(3);
  });

  it("each filter narrows it; omitting every filter returns all seven, untagged included", () => {
    const w = world();
    const by = (f: Parameters<typeof stockMovementReport>[1]) => stockMovementReport(w.repository.db, f);
    expect(by({})).toHaveLength(7);
    expect(by({ itemId: w.banyan })).toHaveLength(2);
    expect(by({ fairId: w.fair1 }).map((r) => r.movementType)).toEqual(["SALE", "ADJUSTMENT", "SALE_REVERSAL"]);
    expect(by({ customerId: w.alpha }).map((r) => r.movementType)).toEqual(["SALE", "SALE_REVERSAL"]);
    expect(by({ customerId: w.beta }).map((r) => r.itemName)).toEqual(["Banyan"]);
    expect(by({ toDate: "2026-03-04" })).toHaveLength(2);
    expect(by({ fromDate: "2026-03-11", toDate: "2026-03-12" })).toHaveLength(2);
  });

  it("keeps the true quantity on hand when the period starts after earlier movements", () => {
    const w = world();
    const rows = stockMovementReport(w.repository.db, { itemId: w.atlas, fromDate: "2026-03-10" });
    // Opening and purchase are before the period, but the sale still leaves 11 - not -4.
    expect(rows.map((r) => r.quantityOnHand)).toEqual([11, 13, 14]);
  });

  it("refuses a business filter, a reversed range and a bad date", () => {
    const w = world();
    expect(() => stockMovementReport(w.repository.db, { businessId: w.bizA } as never)).toThrow(/business/i);
    expect(() => stockMovementReport(w.repository.db, { fromDate: "2026-03-05", toDate: "2026-03-01" })).toThrow("From date cannot be after the to date.");
    expect(() => stockMovementReport(w.repository.db, { fromDate: "2026-13-01" })).toThrow("From date must be a real date written as YYYY-MM-DD.");
  });

  it("applies the filter in SQL: excluded movements never leave SQLite", () => {
    const w = world();
    const probe = spy(w.repository.db);
    const filtered = stockMovementReport(probe.db, { itemId: w.banyan, fromDate: "2026-03-10" });
    expect(view(filtered)).toEqual([["Banyan", "2026-03-11", "SALE", 0, 2, PAISE(20), -PAISE(40), 3]]);
    const query = probe.log.find((entry) => entry.sql.includes("stock_movements"));
    expect(query?.params).toEqual([w.banyan, "2026-03-10"]);
    expect(query?.rows).toBe(1);
  });
});
