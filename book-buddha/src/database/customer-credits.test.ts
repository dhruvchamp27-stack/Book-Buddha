import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository } from "./repository.js";
import { ACCOUNT_ROLES, SETTLEMENT_ROLES } from "./chart-accounts-schema.js";
import { runMigrations } from "./migrations.js";

/**
 * Migrations v11 and v12 - the credit-discharge slice (S4-1, S4-4, S4-5).
 *
 * The rebuild these assert is NOT a path only the owner's database takes. v9's role and seed
 * lists are frozen literals, so a brand new database gets the narrow v9 CHECK and is then
 * rebuilt by v11 exactly as a migrated one is. Every test below therefore exercises the rebuild.
 */
describe("v11: widening the chart_accounts role CHECK", () => {
  const sqlOf = (repository: AccountingRepository, name: string): string =>
    (repository.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string })
      .sql;

  it("rebuilds the table so the new role is accepted, and keeps every account", () => {
    const repository = new AccountingRepository();
    try {
      expect(sqlOf(repository, "chart_accounts")).toContain("'CUSTOMER_CREDITS'");
      // Every role the engine knows about is in the CHECK, so no reader can name one the table
      // would refuse.
      for (const role of ACCOUNT_ROLES) expect(sqlOf(repository, "chart_accounts")).toContain(`'${role}'`);
      const accounts = repository.db
        .prepare("SELECT code, name, type, role FROM chart_accounts ORDER BY code")
        .all() as Array<{ code: string; name: string; type: string; role: string | null }>;
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      // The 22 seeded at v9 survived the rebuild, and the two added since are present.
      expect(accounts.length).toBe(24);
      expect(byCode.get("CUSTOMER_CREDITS")).toMatchObject({ type: "LIABILITY", role: "CUSTOMER_CREDITS" });
      expect(byCode.get("UNCATEGORIZED_INCOME")).toMatchObject({ type: "INCOME", role: null });
      // S4-4: the code is immutable, so the expense side keeps it and only the name moves.
      expect(byCode.get("UNCATEGORIZED")).toMatchObject({ type: "EXPENSE", name: "Uncategorised Expense" });
    } finally {
      repository.close();
    }
  });

  it("replays every trigger the rebuild had to drop, including the one on another table", () => {
    const repository = new AccountingRepository();
    try {
      const triggers = (
        repository.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{
          name: string;
        }>
      ).map((t) => t.name);
      // journal_lines_account_exists lives on journal_lines but READS chart_accounts. SQLite
      // re-parses triggers during ALTER TABLE ... RENAME, so the rebuild has to drop it and put
      // it back; capturing only tbl_name = 'chart_accounts' fails the rename outright.
      expect(triggers).toContain("journal_lines_account_exists");
      expect(triggers).toContain("chart_accounts_no_delete");
      expect(triggers).toContain("chart_accounts_no_reclass");
      // And the replayed trigger still BITES, rather than merely existing. Straight at the
      // table, because the point is the trigger itself, not the door in front of it.
      expect(() =>
        repository.db
          .prepare(
            "INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-x', 'NO_SUCH_ACCOUNT', 100, 0)",
          )
          .run(),
      ).toThrow(/must be a code that exists in chart_accounts/);
    } finally {
      repository.close();
    }
  });

  it("is idempotent: re-running the migrations changes nothing", () => {
    const repository = new AccountingRepository();
    try {
      const snapshot = () =>
        JSON.stringify({
          table: sqlOf(repository, "chart_accounts"),
          accounts: repository.db.prepare("SELECT * FROM chart_accounts ORDER BY code").all(),
          triggers: repository.db
            .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
            .all(),
          indexes: repository.db
            .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
            .all(),
        });
      const before = snapshot();
      runMigrations(repository.db);
      expect(snapshot()).toBe(before);
    } finally {
      repository.close();
    }
  });

  it("treats CUSTOMER_CREDITS as a settlement account, not performance", () => {
    // If it were not excluded, a credit note's own tax-inclusive value in the cash-view walk -
    // measured as the negated sum of its NON-settlement lines - would be wrong the moment any
    // part of a note became refundable.
    expect(SETTLEMENT_ROLES).toContain("CUSTOMER_CREDITS");
  });
});

describe("v12: the credit-discharge tables", () => {
  it("adds both tables and the persisted refundable column", () => {
    const repository = new AccountingRepository();
    try {
      const columns = (repository.db.pragma("table_info(credit_notes)") as Array<{ name: string }>).map((c) => c.name);
      expect(columns).toContain("refundable_paise");
      const tables = (
        repository.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'credit_note_%' ORDER BY name")
          .all() as Array<{ name: string }>
      ).map((t) => t.name);
      expect(tables).toContain("credit_note_refunds");
      expect(tables).toContain("credit_note_applications");
    } finally {
      repository.close();
    }
  });

  it("refuses a refund out of an account that is not cash or bank", () => {
    const repository = new AccountingRepository();
    try {
      expect(() =>
        repository.db
          .prepare(
            "INSERT INTO credit_note_refunds (id, credit_note_id, amount_paise, refunded_on, payment_account, created_at) VALUES ('r1', 'cn', 100, '2026-01-01', 'RECEIVABLES', 'x')",
          )
          .run(),
      ).toThrow();
    } finally {
      repository.close();
    }
  });
});

/**
 * S4-1 / S4-6: refunding a credit note. The invariant asserted throughout is the one that makes
 * the two sides agree - the CUSTOMER_CREDITS ledger balance must always equal the sum of every
 * note's (refundable - discharged). If posting and the sub-ledger ever drift apart, this fails.
 */
describe("refunding a credit note", () => {
  // A credit note is dated by its created_at, so the clock has to be pinned or every refund
  // date in these tests would predate the note.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  interface World {
    repository: AccountingRepository;
    businessId: string;
    customerId: string;
    itemId: string;
  }

  function world(): World {
    const repository = new AccountingRepository();
    const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
    const businessId = repository.createBusiness({ companyId, name: "Business" });
    const customerId = repository.createCustomer({ companyId, name: "Customer" });
    const itemId = repository.createItem({ companyId, name: "Item", unit: "each", trackStock: false });
    return { repository, businessId, customerId, itemId };
  }

  function invoice(w: World, id: string, totalPaise: number, paymentAccount: "RECEIVABLES" | "CASH" = "RECEIVABLES"): void {
    w.repository.saveDraft({
      id,
      number: `INV-${id}`,
      businessId: w.businessId,
      customerId: w.customerId,
      invoiceDate: "2026-01-01",
      status: "DRAFT",
      paymentAccount,
      taxType: "NONE",
      taxRateBasisPoints: 0,
      lines: [{ itemId: w.itemId, description: "Line", quantity: 1, unitPricePaise: totalPaise }],
    });
    w.repository.finalizeInvoice(id);
  }

  function note(w: World, id: string, invoiceId: string, taxablePaise: number): void {
    w.repository.saveCreditNote({
      id,
      invoiceId,
      number: `CN-${id}`,
      reason: "Return",
      status: "DRAFT",
      lines: [{ itemId: w.itemId, description: "Returned", quantity: 1, unitPricePaise: taxablePaise }],
    });
    w.repository.finalizeCreditNote(id);
  }

  /** THE INVARIANT: ledger CUSTOMER_CREDITS == sum over notes of (refundable - discharged). */
  function assertCreditsAgree(w: World): void {
    const ledger = w.repository.db
      .prepare(
        "SELECT COALESCE(SUM(credit_paise), 0) - COALESCE(SUM(debit_paise), 0) AS balance FROM journal_lines WHERE account = 'CUSTOMER_CREDITS'",
      )
      .get() as { balance: number };
    const noteIds = (
      w.repository.db.prepare("SELECT id FROM credit_notes WHERE status = 'FINALIZED'").all() as Array<{ id: string }>
    ).map((r) => r.id);
    const subLedger = noteIds.reduce((total, id) => total + w.repository.getCreditNoteBalance(id).outstandingPaise, 0);
    expect(ledger.balance).toBe(subLedger);
  }

  it("telescopes partial refunds and lands exactly, never a paisa adrift", () => {
    const w = world();
    try {
      invoice(w, "inv1", 100000);
      w.repository.recordPayment("inv1", 100000, "2026-01-05");
      note(w, "cn1", "inv1", 99999); // odd value, fully refundable
      assertCreditsAgree(w);

      // Odd-sized refunds against an odd balance: the cumulative allocator must telescope.
      for (const [index, amount] of [1, 7, 33333, 66658].entries()) {
        w.repository.recordCreditNoteRefund({
          id: `rf${index}`,
          creditNoteId: "cn1",
          amountPaise: amount,
          refundedOn: "2026-02-01",
          paymentAccount: "CASH",
        });
        assertCreditsAgree(w);
      }
      expect(w.repository.getCreditNoteBalance("cn1")).toMatchObject({ refundablePaise: 99999, dischargedPaise: 99999, outstandingPaise: 0 });

      // Fully discharged, so the cash view has now seen the whole note: it equals accrual.
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash.totalIncomePaise).toBe(accrual.totalIncomePaise);
      expect(cash.totalIncomePaise).toBe(1);
    } finally {
      w.repository.close();
    }
  });

  it("refunds out of the BANK, which payments still cannot do", () => {
    const w = world();
    try {
      invoice(w, "inv1", 50000);
      w.repository.recordPayment("inv1", 50000, "2026-01-05");
      note(w, "cn1", "inv1", 50000);
      // payments.payment_account is still CHECK IN ('CASH'), so this is the first money-out path
      // in the app that can use the bank at all. Its own table is why.
      w.repository.recordCreditNoteRefund({ id: "rf1", creditNoteId: "cn1", amountPaise: 50000, refundedOn: "2026-02-01", paymentAccount: "BANK" });
      const bank = w.repository.getTrialBalance().find((r) => r.account === "BANK");
      expect((bank?.creditPaise ?? 0) - (bank?.debitPaise ?? 0)).toBe(50000);
      assertCreditsAgree(w);
    } finally {
      w.repository.close();
    }
  });

  it("refuses a refund that predates its note, exceeds the balance, or is not a whole positive amount", () => {
    const w = world();
    try {
      invoice(w, "inv1", 50000);
      w.repository.recordPayment("inv1", 50000, "2026-01-05");
      note(w, "cn1", "inv1", 50000);
      const refund = (amountPaise: number, refundedOn: string) =>
        w.repository.recordCreditNoteRefund({ id: `rf-${amountPaise}-${refundedOn}`, creditNoteId: "cn1", amountPaise, refundedOn, paymentAccount: "CASH" });
      expect(() => refund(10000, "2020-01-01")).toThrow(/cannot predate its credit note/);
      expect(() => refund(50001, "2026-02-01")).toThrow(/50000 paise left to give back/);
      expect(() => refund(0, "2026-02-01")).toThrow(/whole number of paise above zero/);
      expect(() => refund(-5, "2026-02-01")).toThrow(/whole number of paise above zero/);
      assertCreditsAgree(w);
    } finally {
      w.repository.close();
    }
  });

  it("does not split a CASH invoice's note: there the note IS the refund", () => {
    const w = world();
    try {
      invoice(w, "inv1", 50000, "CASH");
      note(w, "cn1", "inv1", 50000);
      // Nothing is owed back as a liability, because the money already went back across the
      // counter. The cash view recognises a paid-at-once document on its entries' own dates.
      expect(w.repository.getCreditNoteBalance("cn1")).toMatchObject({ refundablePaise: 0, outstandingPaise: 0 });
      const credits = w.repository.getTrialBalance().find((r) => r.account === "CUSTOMER_CREDITS");
      expect((credits?.creditPaise ?? 0) - (credits?.debitPaise ?? 0)).toBe(0);
      assertCreditsAgree(w);
    } finally {
      w.repository.close();
    }
  });

  it("keeps receivables at zero rather than negative, however the note is split", () => {
    const w = world();
    try {
      for (const [index, paid] of [100000, 70000, 0].entries()) {
        const id = `inv${index}`;
        invoice(w, id, 100000);
        if (paid > 0) w.repository.recordPayment(id, paid, "2026-01-05");
        note(w, `cn${index}`, id, 100000);
        const row = w.repository.db
          .prepare(
            `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS balance
               FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
              WHERE je.source_id = ? AND jl.account = 'RECEIVABLES'`,
          )
          .get(id) as { balance: number };
        expect(row.balance).toBe(0);
        expect(w.repository.getCreditNoteBalance(`cn${index}`).refundablePaise).toBe(paid);
      }
      assertCreditsAgree(w);
    } finally {
      w.repository.close();
    }
  });
});

/**
 * S4-5: setting a credit note against a LATER invoice instead of refunding it. Per S1-6 the
 * reduction is recognised when the credit is USED.
 *
 * FIGURES UNCONFIRMED. The owner ruled that this route ships in R3 but gave no worked example,
 * so the arithmetic below is the assistant's and needs his nod before it counts as acceptance.
 */
describe("applying a credit note to a later invoice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function world() {
    const repository = new AccountingRepository();
    const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
    const businessId = repository.createBusiness({ companyId, name: "Business" });
    const otherBusinessId = repository.createBusiness({ companyId, name: "Other business" });
    const customerId = repository.createCustomer({ companyId, name: "Customer" });
    const otherCustomerId = repository.createCustomer({ companyId, name: "Other customer" });
    const itemId = repository.createItem({ companyId, name: "Item", unit: "each", trackStock: false });
    const invoice = (
      id: string,
      totalPaise: number,
      invoiceDate: string,
      options: { customerId?: string; businessId?: string } = {},
    ): void => {
      repository.saveDraft({
        id,
        number: `INV-${id}`,
        businessId: options.businessId ?? businessId,
        customerId: options.customerId ?? customerId,
        invoiceDate,
        status: "DRAFT",
        paymentAccount: "RECEIVABLES",
        taxType: "NONE",
        taxRateBasisPoints: 0,
        lines: [{ itemId, description: "Line", quantity: 1, unitPricePaise: totalPaise }],
      });
      repository.finalizeInvoice(id);
    };
    const note = (id: string, invoiceId: string, taxablePaise: number): void => {
      repository.saveCreditNote({
        id,
        invoiceId,
        number: `CN-${id}`,
        reason: "Return",
        status: "DRAFT",
        lines: [{ itemId, description: "Returned", quantity: 1, unitPricePaise: taxablePaise }],
      });
      repository.finalizeCreditNote(id);
    };
    return { repository, businessId, otherBusinessId, customerId, otherCustomerId, itemId, invoice, note };
  }

  it("ACCEPTANCE apply (figures unconfirmed): Rs 400 of credit settles Rs 400 of the next invoice", () => {
    const w = world();
    try {
      const period = (fromDate: string, toDate: string) =>
        w.repository.getProfitAndLoss({ basis: "CASH", fromDate, toDate });

      // January: invoice A for Rs 1,000, collected in full.
      vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
      w.invoice("A", 100000, "2026-01-10");
      w.repository.recordPayment("A", 100000, "2026-01-20");
      expect(period("2026-01-01", "2026-01-31").totalIncomePaise).toBe(100000);

      // February: Rs 400 of it comes back. Nothing is owed, so the whole Rs 400 is owed BACK.
      vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
      w.note("cn1", "A", 40000);
      expect(w.repository.getCreditNoteBalance("cn1").outstandingPaise).toBe(40000);
      // February recognises nothing: the goods are back but no money has moved.
      expect(period("2026-02-01", "2026-02-28").totalIncomePaise).toBe(0);

      // March: invoice B for Rs 1,000 to the same customer, and the credit is set against it.
      vi.setSystemTime(new Date("2026-03-01T06:00:00.000Z"));
      w.invoice("B", 100000, "2026-03-01");
      w.repository.applyCreditNote({
        id: "ap1",
        creditNoteId: "cn1",
        invoiceId: "B",
        amountPaise: 40000,
        appliedOn: "2026-03-05",
      });

      // MARCH nets to nothing: -400 comes off invoice A, +400 is recognised on invoice B, and
      // not a rupee moved. That is the point of the route - the customer paid for B with the
      // credit from A.
      const march = period("2026-03-01", "2026-03-31");
      expect(march.totalIncomePaise).toBe(0);
      // Both halves really happened, rather than both being absent.
      const marchRows = w.repository.deriveCashView({ fromDate: "2026-03-01", toDate: "2026-03-31" }).recognitions;
      expect(marchRows.filter((r) => r.documentId === "A").reduce((t, r) => t + r.amountPaise, 0)).toBe(-40000);
      expect(marchRows.filter((r) => r.documentId === "B").reduce((t, r) => t + r.amountPaise, 0)).toBe(40000);

      // The credit is spent, and invoice B still owes Rs 600.
      expect(w.repository.getCreditNoteBalance("cn1").outstandingPaise).toBe(0);
      const receivable = w.repository.getReceivables().find((r) => r.invoiceId === "B");
      expect(receivable?.outstandingPaise).toBe(60000);
      // January untouched throughout: S1-6.
      expect(period("2026-01-01", "2026-01-31").totalIncomePaise).toBe(100000);
    } finally {
      w.repository.close();
    }
  });

  it("settles the target invoice for every purpose, not just the receivables list", () => {
    const w = world();
    try {
      vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
      w.invoice("A", 100000, "2026-01-10");
      w.repository.recordPayment("A", 100000, "2026-01-20");
      vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
      w.note("cn1", "A", 100000);
      w.invoice("B", 100000, "2026-02-01");
      w.repository.applyCreditNote({
        id: "ap1",
        creditNoteId: "cn1",
        invoiceId: "B",
        amountPaise: 100000,
        appliedOn: "2026-02-11",
      });

      // Fully settled by credit: no further payment, and it cannot be cancelled either. Counting
      // only the payments table would have let this invoice be cancelled while the credit stood.
      expect(() => w.repository.recordPayment("B", 1, "2026-02-12")).toThrow(/outstanding balance of 0 paise/);
      expect(() => w.repository.cancelInvoice("B")).toThrow(/payments or applied credits/);
      expect(w.repository.getReceivables().filter((r) => r.invoiceId === "B")).toHaveLength(0);
    } finally {
      w.repository.close();
    }
  });

  it("refuses the applications that would quietly move money between accounts", () => {
    const w = world();
    try {
      vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
      w.invoice("A", 100000, "2026-01-10");
      w.repository.recordPayment("A", 100000, "2026-01-20");
      vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
      w.note("cn1", "A", 100000);
      w.invoice("B", 100000, "2026-02-01");
      w.invoice("C", 100000, "2026-02-01", { customerId: w.otherCustomerId });
      w.invoice("D", 100000, "2026-02-01", { businessId: w.otherBusinessId });

      const apply = (invoiceId: string, amountPaise: number, appliedOn: string) =>
        w.repository.applyCreditNote({
          id: `ap-${invoiceId}-${amountPaise}`,
          creditNoteId: "cn1",
          invoiceId,
          amountPaise,
          appliedOn,
        });

      expect(() => apply("C", 50000, "2026-02-11")).toThrow(/same customer/);
      expect(() => apply("D", 50000, "2026-02-11")).toThrow(/same business/);
      expect(() => apply("A", 50000, "2026-02-11")).toThrow(/its own invoice/);
      expect(() => apply("B", 100001, "2026-02-11")).toThrow(/100000 paise left to give back/);
      expect(() => apply("B", 50000, "2026-01-01")).toThrow(/before its credit note/);
      expect(() => apply("B", 0, "2026-02-11")).toThrow(/whole number of paise above zero/);

      // And a credit cannot be applied before the invoice it settles exists.
      w.invoice("E", 100000, "2026-06-01");
      expect(() => apply("E", 50000, "2026-02-11")).toThrow(/before the invoice it settles/);

      // A target that owes less than the credit is refused rather than pushed past settled.
      w.repository.recordPayment("B", 90000, "2026-02-11");
      expect(() => apply("B", 50000, "2026-02-12")).toThrow(/only owes 10000 paise/);
    } finally {
      w.repository.close();
    }
  });
});
