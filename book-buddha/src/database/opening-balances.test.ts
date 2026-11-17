import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { verifyAuditChain } from "./audit-log.js";
import { AccountingRepository } from "./repository.js";

/**
 * R4a - opening balances (section 14). Figures are PAISE in code; the rupee figure is in a comment.
 * Constructing AccountingRepository runs every migration, v13 included.
 */
function world(): { repository: AccountingRepository; companyId: string; businessId: string } {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Book Fair Co" });
  return { repository, companyId, businessId };
}

const AS_AT = "2025-03-31"; // the day before trading starts in Book Buddha

/** Rs 25,000 cash, Rs 1,75,000 bank, Rs 50,000 other assets | Rs 1,00,000 loan, Rs 1,00,000 capital. */
const REALISTIC = [
  { account: "CASH", debitPaise: 2_500_000, creditPaise: 0 }, // Rs 25,000
  { account: "BANK", debitPaise: 17_500_000, creditPaise: 0 }, // Rs 1,75,000
  { account: "OTHER_ASSETS", debitPaise: 5_000_000, creditPaise: 0 }, // Rs 50,000
  { account: "LOANS", debitPaise: 0, creditPaise: 10_000_000 }, // Rs 1,00,000
  { account: "CAPITAL", debitPaise: 0, creditPaise: 10_000_000 }, // Rs 1,00,000
] as const;

const net = (r: AccountingRepository, businessId: string, account: string): number => {
  const row = r.getTrialBalance({ businessId }).find((x) => x.account === account);
  return row === undefined ? 0 : row.debitPaise - row.creditPaise;
};

describe("opening balances", () => {
  it("ACCEPTANCE R4 (figures unconfirmed)", () => {
    const { repository: r, businessId } = world();
    // Debits Rs 2,50,000 (25,000 + 1,75,000 + 50,000); credits Rs 2,00,000 (1,00,000 + 1,00,000).
    // The Rs 50,000 gap must land in OPENING_BALANCE_EQUITY as a CREDIT.
    r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: REALISTIC });

    const tb = r.getTrialBalance({ businessId });
    const totalDebit = tb.reduce((t, x) => t + x.debitPaise, 0);
    const totalCredit = tb.reduce((t, x) => t + x.creditPaise, 0);
    expect(totalDebit).toBe(25_000_000); // Rs 2,50,000
    expect(totalCredit).toBe(25_000_000); // Rs 2,50,000 - the Trial Balance balances
    const row = (account: string) => tb.find((x) => x.account === account);
    expect(row("CASH")).toMatchObject({ debitPaise: 2_500_000, creditPaise: 0 });
    expect(row("BANK")).toMatchObject({ debitPaise: 17_500_000, creditPaise: 0 });
    expect(row("OTHER_ASSETS")).toMatchObject({ debitPaise: 5_000_000, creditPaise: 0 });
    expect(row("LOANS")).toMatchObject({ debitPaise: 0, creditPaise: 10_000_000 });
    expect(row("CAPITAL")).toMatchObject({ debitPaise: 0, creditPaise: 10_000_000 });
    expect(row("OPENING_BALANCE_EQUITY")).toMatchObject({ debitPaise: 0, creditPaise: 5_000_000 }); // Rs 50,000
    expect(tb).toHaveLength(6);

    const sheet = r.getBalanceSheet({ businessId });
    expect(sheet.totalAssetsPaise).toBe(25_000_000); // Rs 2,50,000
    expect(sheet.totalLiabilitiesPaise).toBe(10_000_000); // Rs 1,00,000
    expect(sheet.totalEquityPaise).toBe(15_000_000); // capital 1,00,000 + opening balance equity 50,000
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);

    const [set] = r.getOpeningBalances(businessId);
    expect(set).toMatchObject({ id: "ob1", businessId, asAt: AS_AT, reversedAt: null });
    expect(set?.lines).toHaveLength(5);
    expect(set?.balancingLine).toEqual({ account: "OPENING_BALANCE_EQUITY", debitPaise: 0, creditPaise: 5_000_000 });
    // Posted dated asAt, through the one door.
    expect(r.db.prepare("SELECT entry_date, business_id FROM journal_entries WHERE id = ?").get(set?.journalEntryId))
      .toEqual({ entry_date: AS_AT, business_id: businessId });
    // Audited, and the chain still verifies.
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'OPENING_BALANCES_SAVED' AND entity_id = 'ob1'").get())
      .toEqual({ n: 1 });
    expect(verifyAuditChain(r.db).ok).toBe(true);
  });

  it("posts no plug line when the lines already balance exactly", () => {
    const { repository: r, businessId } = world();
    r.saveOpeningBalances({
      id: "ob1", businessId, asAt: AS_AT,
      lines: [
        { account: "BANK", debitPaise: 1_000_000, creditPaise: 0 },
        { account: "CAPITAL", debitPaise: 0, creditPaise: 1_000_000 },
      ],
    });
    expect(r.getOpeningBalances(businessId)[0]?.balancingLine).toBeNull();
    expect(net(r, businessId, "OPENING_BALANCE_EQUITY")).toBe(0);
    expect(r.getTrialBalance({ businessId }).map((x) => x.account)).not.toContain("OPENING_BALANCE_EQUITY");
  });

  it("plugs on the DEBIT side when credits exceed debits", () => {
    const { repository: r, businessId } = world();
    r.saveOpeningBalances({
      id: "ob1", businessId, asAt: AS_AT,
      lines: [
        { account: "BANK", debitPaise: 1_000_000, creditPaise: 0 },
        { account: "CAPITAL", debitPaise: 0, creditPaise: 1_500_000 },
      ],
    });
    expect(r.getOpeningBalances(businessId)[0]?.balancingLine)
      .toEqual({ account: "OPENING_BALANCE_EQUITY", debitPaise: 500_000, creditPaise: 0 });
  });

  it("refuses control-role accounts, which belong to their own sub-ledgers", () => {
    const { repository: r, businessId } = world();
    for (const account of ["RECEIVABLES", "PAYABLES", "INVENTORY", "CUSTOMER_CREDITS"]) {
      expect(
        () => r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: [{ account, debitPaise: 100, creditPaise: 0 }] }),
        account,
      ).toThrow(/sub-ledger/);
    }
    expect(r.getOpeningBalances(businessId)).toEqual([]);
    expect(r.getTrialBalance({ businessId })).toEqual([]);
  });

  it("refuses OPENING_BALANCE_EQUITY as a typed line: it is the plug, not an input", () => {
    const { repository: r, businessId } = world();
    expect(() =>
      r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: [{ account: "OPENING_BALANCE_EQUITY", debitPaise: 0, creditPaise: 100 }] }),
    ).toThrow(/plug/);
    expect(r.getOpeningBalances(businessId)).toEqual([]);
  });

  it("refuses unknown and inactive accounts, and accepts a user account once it is active", () => {
    const { repository: r, businessId, companyId } = world();
    const one = (account: string) => ({ id: "ob1", businessId, asAt: AS_AT, lines: [{ account, debitPaise: 100, creditPaise: 0 }] });
    expect(() => r.saveOpeningBalances(one("NO_SUCH"))).toThrow(/does not exist/);
    r.createAccount({ companyId, code: "STALL_DEPOSIT", name: "Stall deposit", type: "ASSET" });
    r.setAccountActive("STALL_DEPOSIT", false);
    expect(() => r.saveOpeningBalances(one("STALL_DEPOSIT"))).toThrow(/not active/);
    r.setAccountActive("STALL_DEPOSIT", true);
    expect(() => r.saveOpeningBalances(one("STALL_DEPOSIT"))).not.toThrow();
  });

  it("refuses malformed input and writes nothing", () => {
    const { repository: r, businessId } = world();
    const bad = (lines: ReadonlyArray<{ account: string; debitPaise: number; creditPaise: number }>, asAt = AS_AT, biz = businessId) =>
      () => r.saveOpeningBalances({ id: "ob1", businessId: biz, asAt, lines });
    const ok = { account: "CASH", debitPaise: 100, creditPaise: 0 };
    expect(bad([])).toThrow(/at least one line/);
    expect(bad([{ account: "CASH", debitPaise: 100, creditPaise: 100 }])).toThrow(/exactly one/); // both sides
    expect(bad([{ account: "CASH", debitPaise: 0, creditPaise: 0 }])).toThrow(/exactly one/); // neither side
    expect(bad([{ account: "CASH", debitPaise: -5, creditPaise: 0 }])).toThrow(/whole number of paise/);
    expect(bad([{ account: "CASH", debitPaise: 10.5, creditPaise: 0 }])).toThrow(/whole number of paise/);
    expect(bad([ok], "2025-02-30")).toThrow(/real date/);
    expect(bad([ok], AS_AT, "nope")).toThrow(/not found/);
    expect(r.getOpeningBalances(businessId)).toEqual([]);
    expect(r.getTrialBalance({ businessId })).toEqual([]);
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM opening_balance_lines").get()).toEqual({ n: 0 });
  });

  it("allows one live set per business: a second is refused until the first is reversed", () => {
    const { repository: r, businessId } = world();
    r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: REALISTIC });
    expect(() => r.saveOpeningBalances({ id: "ob2", businessId, asAt: AS_AT, lines: REALISTIC })).toThrow(/Reverse them first/);
    expect(net(r, businessId, "CASH")).toBe(2_500_000); // still only once

    r.reverseOpeningBalances({ id: "ob1", reversedOn: "2025-04-02" });
    expect(() => r.saveOpeningBalances({ id: "ob2", businessId, asAt: AS_AT, lines: REALISTIC })).not.toThrow();
    expect(r.getOpeningBalances(businessId).map((s) => s.id)).toEqual(["ob1", "ob2"]);
  });

  it("a second business is independent", () => {
    const { repository: r, businessId, companyId } = world();
    const other = r.createBusiness({ companyId, name: "Other" });
    r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: REALISTIC });
    expect(() => r.saveOpeningBalances({ id: "ob2", businessId: other, asAt: AS_AT, lines: REALISTIC })).not.toThrow();
  });

  it("a reversal leaves the Trial Balance balanced and every opening account back at zero", () => {
    const { repository: r, businessId } = world();
    r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: REALISTIC });
    const original = r.getOpeningBalances(businessId)[0];
    const originalLines = r.db.prepare("SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY id").all(original?.journalEntryId);

    r.reverseOpeningBalances({ id: "ob1", reversedOn: "2025-04-02" });

    const tb = r.getTrialBalance({ businessId });
    expect(tb.reduce((t, x) => t + x.debitPaise, 0)).toBe(tb.reduce((t, x) => t + x.creditPaise, 0));
    for (const account of ["CASH", "BANK", "OTHER_ASSETS", "LOANS", "CAPITAL", "OPENING_BALANCE_EQUITY"]) {
      expect(net(r, businessId, account), account).toBe(0);
    }
    const [set] = r.getOpeningBalances(businessId);
    expect(set?.reversedAt).toBe("2025-04-02");
    // The original entry is untouched, and the reversal is a separate, flagged entry dated reversedOn.
    expect(r.db.prepare("SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY id").all(original?.journalEntryId)).toEqual(originalLines);
    expect(r.db.prepare("SELECT is_reversal, entry_date FROM journal_entries WHERE source_id = 'ob1' ORDER BY rowid").all())
      .toEqual([{ is_reversal: 0, entry_date: AS_AT }, { is_reversal: 1, entry_date: "2025-04-02" }]);
    // Typed lines are history: never deleted.
    expect(set?.lines).toHaveLength(5);
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'OPENING_BALANCES_REVERSED' AND entity_id = 'ob1'").get()).toEqual({ n: 1 });
    expect(verifyAuditChain(r.db).ok).toBe(true);

    // Cannot be reversed twice, nor an unknown set.
    expect(() => r.reverseOpeningBalances({ id: "ob1", reversedOn: "2025-04-03" })).toThrow(/already been reversed/);
    expect(() => r.reverseOpeningBalances({ id: "nope", reversedOn: "2025-04-03" })).toThrow(/not found/);
    expect(() => r.reverseOpeningBalances({ id: "ob1", reversedOn: "x" })).toThrow();
  });

  it("refuses a set dated inside a LOCKED financial year, writing nothing", () => {
    const { repository: r, businessId } = world();
    const year = r.createFinancialYear({ businessId, startsOn: "2024-04-01", endsOn: "2025-03-31" });
    r.setFinancialYearLocked(year, true);
    expect(() => r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: REALISTIC })).toThrow(/locked/);
    expect(r.getOpeningBalances(businessId)).toEqual([]);
    expect(r.getTrialBalance({ businessId })).toEqual([]);
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM opening_balance_lines").get()).toEqual({ n: 0 });

    // Reopen -> accepted -> lock again -> the reversal dated inside the locked year is refused too.
    r.setFinancialYearLocked(year, false);
    r.saveOpeningBalances({ id: "ob1", businessId, asAt: AS_AT, lines: REALISTIC });
    r.setFinancialYearLocked(year, true);
    expect(() => r.reverseOpeningBalances({ id: "ob1", reversedOn: "2025-03-31" })).toThrow(/locked/);
    expect(r.getOpeningBalances(businessId)[0]?.reversedAt).toBeNull();
    expect(net(r, businessId, "CASH")).toBe(2_500_000);
  });
});

describe("opening balances: income lines in the P&L", () => {
  it("PINNED (open ruling): what the CASH and ACCRUAL P&L do with an opening INCOME line", () => {
    const { repository: r, businessId } = world();
    // Opening Sales Rs 1,00,000 behind a Rs 1,00,000 bank balance. Balances on its own: no plug.
    r.saveOpeningBalances({
      id: "ob1", businessId, asAt: AS_AT,
      lines: [
        { account: "BANK", debitPaise: 10_000_000, creditPaise: 0 },
        { account: "SALES", debitPaise: 0, creditPaise: 10_000_000 },
      ],
    });
    // MEASURED, not designed. The CASH view is built by walking invoices, purchase bills and expenses
    // (deriveCashView iterates those three tables and looks up each one's journal lines by
    // source_type + source_id). An opening-balance entry belongs to none of them, so it is never
    // visited: the opening INCOME is IGNORED by the cash P&L - it does not pass through on the
    // opening date, on any date, or in any window. The ACCRUAL P&L, which reads the ledger directly,
    // shows all of it. If a future slice makes the cash view recognise opening income (S5-2), this
    // test is expected to fail and must be updated deliberately.
    const cash = r.getProfitAndLoss({ businessId, basis: "CASH" });
    const accrual = r.getProfitAndLoss({ businessId, basis: "ACCRUAL" });
    expect(cash.income).toEqual([]);
    expect(cash.totalIncomePaise).toBe(0); // not Rs 1,00,000
    expect(cash.netProfitPaise).toBe(0);
    expect(cash.grossSalesPaise).toBe(0);
    expect(accrual.totalIncomePaise).toBe(10_000_000); // Rs 1,00,000
    expect(accrual.income).toEqual([
      { account: "SALES", type: "INCOME", role: null, debitPaise: 0, creditPaise: 10_000_000, balancePaise: -10_000_000 },
    ]);
    // Not a date effect: the opening date itself, a window around it, and a window after it all agree.
    for (const window of [{ fromDate: AS_AT, toDate: AS_AT }, { fromDate: "2025-01-01", toDate: "2025-12-31" }, { fromDate: "2025-04-01" }]) {
      expect(r.getProfitAndLoss({ businessId, basis: "CASH", ...window }).totalIncomePaise, JSON.stringify(window)).toBe(0);
    }
    // The Balance Sheet still balances: opening income is derived into retained earnings (S5-4).
    const sheet = r.getBalanceSheet({ businessId });
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
  });
});

describe("opening balances API", () => {
  it("POST, GET and reverse, with validation", async () => {
    const { repository, businessId } = world();
    const app = buildApi(repository);
    try {
      const bad = await app.inject({ method: "POST", url: "/opening-balances", payload: { businessId, asAt: "31/03/2025", lines: [] } });
      expect(bad.statusCode).toBe(400);

      const created = await app.inject({ method: "POST", url: "/opening-balances", payload: { businessId, asAt: AS_AT, lines: REALISTIC } });
      expect(created.statusCode).toBe(201);
      const { id } = created.json<{ id: string }>();

      const refused = await app.inject({
        method: "POST", url: "/opening-balances",
        payload: { businessId, asAt: AS_AT, lines: [{ account: "RECEIVABLES", debitPaise: 100, creditPaise: 0 }] },
      });
      expect(refused.statusCode).toBe(400);

      expect((await app.inject({ method: "GET", url: "/opening-balances" })).statusCode).toBe(400);
      const listed = (await app.inject({ method: "GET", url: `/opening-balances?businessId=${businessId}` })).json<Array<{ id: string; lines: unknown[]; reversedAt: string | null }>>();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id, reversedAt: null });
      expect(listed[0]?.lines).toHaveLength(5);

      expect((await app.inject({ method: "POST", url: `/opening-balances/${id}/reverse`, payload: {} })).statusCode).toBe(400);
      const reversed = await app.inject({ method: "POST", url: `/opening-balances/${id}/reverse`, payload: { reversedOn: "2025-04-02" } });
      expect(reversed.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/opening-balances?businessId=${businessId}` })).json<Array<{ reversedAt: string | null }>>()[0]?.reversedAt).toBe("2025-04-02");
      expect((await app.inject({ method: "POST", url: `/opening-balances/${id}/reverse`, payload: { reversedOn: "2025-04-03" } })).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
