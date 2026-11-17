import { describe, expect, it } from "vitest";
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
