import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository } from "../database/repository.js";
import {
  createBankRule,
  deleteBankRule,
  listBankRules,
  reorderBankRules,
  setBankRuleActive,
  suggestFor,
  testBankRule,
  updateBankRule,
  type BankRuleDraft,
} from "./bank-rules.js";
import { applyBankRulesSchema } from "./bank-rules-schema.js";
import { insertStatementLine, type StatementLine } from "./statement-lines.js";
import { applyStatementLinesSchema } from "./statement-lines-schema.js";

const RS = (rupees: number): number => rupees * 100;

let repository: AccountingRepository;
let db: Database.Database;
let companyId: string;
let otherCompanyId: string;
let businessId: string;
let otherBusinessId: string;

function addAccount(code: string, name: string, type: string, role: string | null, owner: string | null): void {
  db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)",
  ).run(code, owner, name, type, role, "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
}

const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

function line(description: string, amountPaise: number, opts: { account?: string; company?: string; reference?: string } = {}): StatementLine {
  return insertStatementLine(db, {
    companyId: opts.company ?? companyId,
    accountCode: opts.account ?? "HDFC",
    txnDate: "2025-10-31",
    description,
    reference: opts.reference ?? null,
    amountPaise,
  });
}

const draft = (over: Partial<BankRuleDraft> = {}): BankRuleDraft => ({
  name: "Bank charges",
  action: "ADD",
  targetAccount: "BANK_CHARGES",
  conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "chgs" }],
  ...over,
});

const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeEach(() => {
  repository = new AccountingRepository();
  db = repository.db;
  applyStatementLinesSchema(db);
  applyBankRulesSchema(db);
  companyId = repository.createCompany({ name: "Co X", accountingBasis: "ACCRUAL" });
  otherCompanyId = repository.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
  businessId = repository.createBusiness({ companyId, name: "Fair Co" });
  otherBusinessId = repository.createBusiness({ companyId: otherCompanyId, name: "Other Biz" });
  addAccount("HDFC", "HDFC Current", "ASSET", "BANK", companyId);
  addAccount("SBI", "SBI Current", "ASSET", "BANK", companyId);
  addAccount("BANK_CHARGES", "Bank Charges", "EXPENSE", null, companyId);
  addAccount("TRAVEL", "Travel", "EXPENSE", null, companyId);
  addAccount("GENERAL", "General Expense", "EXPENSE", null, null);
});
afterEach(() => repository.close());

describe("bank rules", () => {
  it("1. Bank charges: CONTAINS chgs suggests BANK_CHARGES; case ignored; CHARGES does not match", () => {
    createBankRule(db, companyId, draft());
    const s = suggestFor(db, line("CHGS INCL GST", -RS(354)));
    expect(s).toMatchObject({ ruleName: "Bank charges", action: "ADD", accountCode: "BANK_CHARGES" });
    expect(suggestFor(db, line("monthly chgs", -RS(10)))).not.toBeNull();
    expect(suggestFor(db, line("SERVICE CHARGES", -RS(10)))).toBeNull();
  });

  it("2. NOT_CONTAINS, EQUALS, AMOUNT operators, direction filter, ALL vs ANY", () => {
    createBankRule(db, companyId, draft({ name: "r", conditions: [{ field: "DESCRIPTION", operator: "NOT_CONTAINS", valueText: "upi" }] }));
    expect(suggestFor(db, line("NEFT PAYMENT", -RS(1)))).not.toBeNull();
    expect(suggestFor(db, line("UPI-SHOP", -RS(1)))).toBeNull();
    deleteBankRule(db, companyId, listBankRules(db, companyId)[0]!.id);

    createBankRule(db, companyId, draft({ name: "eq", conditions: [{ field: "DESCRIPTION", operator: "EQUALS", valueText: "  atm   WDL " }] }));
    expect(suggestFor(db, line("ATM WDL", -RS(5)))).not.toBeNull();
    expect(suggestFor(db, line("ATM WDL CHENNAI", -RS(5)))).toBeNull();
    deleteBankRule(db, companyId, listBankRules(db, companyId)[0]!.id);

    const amt = createBankRule(db, companyId, draft({ name: "amt", conditions: [{ field: "AMOUNT", operator: "EQUALS", valuePaise: 35400 }] }));
    expect(suggestFor(db, line("anything", -35400))).not.toBeNull(); // a -354 line
    expect(suggestFor(db, line("anything", 35400))).not.toBeNull();
    expect(suggestFor(db, line("anything", -35500))).toBeNull();
    updateBankRule(db, companyId, amt.id, { conditions: [{ field: "AMOUNT", operator: "GREATER_THAN", valuePaise: 10000 }] });
    expect(suggestFor(db, line("x", -10001))).not.toBeNull();
    expect(suggestFor(db, line("x", -10000))).toBeNull();
    updateBankRule(db, companyId, amt.id, { conditions: [{ field: "AMOUNT", operator: "LESS_THAN", valuePaise: 10000 }] });
    expect(suggestFor(db, line("y", -9999))).not.toBeNull();
    expect(suggestFor(db, line("y", -10000))).toBeNull();

    // Reference condition; direction OUT ignores an IN line
    updateBankRule(db, companyId, amt.id, { direction: "OUT", conditions: [{ field: "REFERENCE", operator: "CONTAINS", valueText: "utr" }] });
    expect(suggestFor(db, line("z", -RS(1), { reference: "UTR123" }))).not.toBeNull();
    expect(suggestFor(db, line("z", RS(1), { reference: "UTR123" }))).toBeNull();
    expect(suggestFor(db, line("z", -RS(1)))).toBeNull(); // no reference

    // ALL vs ANY
    const two = [
      { field: "DESCRIPTION", operator: "CONTAINS", valueText: "fee" },
      { field: "AMOUNT", operator: "GREATER_THAN", valuePaise: 100000 },
    ] as const;
    updateBankRule(db, companyId, amt.id, { direction: "ANY", matchMode: "ALL", conditions: two });
    expect(suggestFor(db, line("annual fee", -RS(500)))).toBeNull();
    expect(suggestFor(db, line("annual fee", -RS(5000)))).not.toBeNull();
    updateBankRule(db, companyId, amt.id, { matchMode: "ANY" });
    expect(suggestFor(db, line("annual fee 2", -RS(500)))).not.toBeNull();
    expect(suggestFor(db, line("other", -RS(500)))).toBeNull();
    expect(suggestFor(db, line("other 2", -RS(5000)))).not.toBeNull();
  });

  it("3. priority order, reorder, deactivated skipped, bad reorders refused", () => {
    const a = createBankRule(db, companyId, draft({ name: "A", targetAccount: "TRAVEL" }));
    const b = createBankRule(db, companyId, draft({ name: "B", targetAccount: "GENERAL" }));
    expect([a.priority, b.priority]).toEqual([1, 2]);
    const l = line("CHGS", -RS(10));
    expect(suggestFor(db, l)?.ruleName).toBe("A");
    reorderBankRules(db, companyId, [b.id, a.id]);
    expect(suggestFor(db, l)?.ruleName).toBe("B");
    setBankRuleActive(db, companyId, b.id, false);
    expect(suggestFor(db, l)?.ruleName).toBe("A");
    setBankRuleActive(db, companyId, a.id, false);
    expect(suggestFor(db, l)).toBeNull();

    expect(message(() => reorderBankRules(db, companyId, [a.id]))).toMatch(/exactly once/);
    const foreign = createBankRule(db, otherCompanyId, draft({ name: "Y rule", targetAccount: "GENERAL" }));
    expect(message(() => reorderBankRules(db, companyId, [a.id, foreign.id]))).toMatch(/not one of this company/);
    expect(message(() => reorderBankRules(db, companyId, [a.id, a.id]))).toMatch(/twice/);
  });

  it("4. scope: HDFC-only rule skips an SBI line; unscoped fits both; another company's rule never suggests", () => {
    createBankRule(db, companyId, draft({ name: "HDFC only", accountScope: "HDFC", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "alpha" }] }));
    createBankRule(db, companyId, draft({ name: "Everywhere", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "beta" }] }));
    expect(suggestFor(db, line("alpha", -RS(1), { account: "HDFC" }))?.ruleName).toBe("HDFC only");
    expect(suggestFor(db, line("alpha", -RS(1), { account: "SBI" }))).toBeNull();
    expect(suggestFor(db, line("beta", -RS(1), { account: "HDFC" }))?.ruleName).toBe("Everywhere");
    expect(suggestFor(db, line("beta", -RS(1), { account: "SBI" }))?.ruleName).toBe("Everywhere");

    // Company Y's rule on the shared seeded BANK; company X's line on BANK
    createBankRule(db, otherCompanyId, draft({ name: "Y charges", targetAccount: "GENERAL", accountScope: "BANK", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "gamma" }] }));
    expect(suggestFor(db, line("gamma", -RS(1), { account: "BANK" }))).toBeNull();
    expect(suggestFor(db, line("gamma", -RS(1), { account: "BANK", company: otherCompanyId }))?.ruleName).toBe("Y charges");
  });

  it("5. refusals", () => {
    const refused = (over: Partial<BankRuleDraft>, re: RegExp): void => {
      expect(message(() => createBankRule(db, companyId, draft(over)))).toMatch(re);
    };
    refused({ targetAccount: "UNCATEGORIZED" }, /Uncategorised/);
    refused({ targetAccount: "UNCATEGORIZED_INCOME" }, /Uncategorised/);
    refused({ targetAccount: "RECEIVABLES" }, /RECEIVABLES/);
    refused({ targetAccount: "CASH" }, /CASH/);
    refused({ action: "TRANSFER", targetAccount: "TRAVEL" }, /not a cash or bank/);
    refused({ action: "TRANSFER", targetAccount: "HDFC", accountScope: "HDFC" }, /same bank account/);
    refused({ accountScope: "TRAVEL" }, /not a bank account/);
    refused({ conditions: [] }, /at least one condition/);
    refused({ conditions: [{ field: "AMOUNT", operator: "EQUALS", valueText: "100" }] }, /positive whole number of paise/);
    refused({ conditions: [{ field: "AMOUNT", operator: "EQUALS", valuePaise: 0 }] }, /positive whole number of paise/);
    refused({ conditions: [{ field: "AMOUNT", operator: "EQUALS", valuePaise: -5 }] }, /positive whole number of paise/);
    refused({ conditions: [{ field: "AMOUNT", operator: "EQUALS", valuePaise: 10.5 }] }, /positive whole number of paise/);
    refused({ conditions: [{ field: "DESCRIPTION", operator: "GREATER_THAN", valueText: "x" }] }, /text condition/);
    refused({ businessId: "nope" }, /not found/);
    refused({ businessId: otherBusinessId }, /another company/);
    createBankRule(db, companyId, draft());
    refused({ name: "BANK CHARGES" }, /already exists/);
    expect(listBankRules(db, companyId)).toHaveLength(1);
    // A valid transfer rule is accepted
    expect(createBankRule(db, companyId, draft({ name: "Sweep", action: "TRANSFER", targetAccount: "CASH", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "atm" }] })).action).toBe("TRANSFER");
  });

  it("6. pre-fill only: suggestFor and testBankRule over 10 lines change no books and no line", () => {
    createBankRule(db, companyId, draft());
    createBankRule(db, companyId, draft({ name: "Big", conditions: [{ field: "AMOUNT", operator: "GREATER_THAN", valuePaise: 1000 }] }));
    const lines = Array.from({ length: 10 }, (_, i) => line(i % 2 === 0 ? `CHGS ${i}` : `PAY ${i}`, -RS(10 + i)));
    const before = {
      je: count("journal_entries"), jl: count("journal_lines"), links: count("bank_statement_line_links"),
      lines: count("bank_statement_lines"), audit: count("audit_events"), rules: count("bank_rules"),
      statuses: JSON.stringify(db.prepare("SELECT id, status FROM bank_statement_lines ORDER BY id").all()),
    };
    for (const l of lines) suggestFor(db, l);
    expect(testBankRule(db, companyId, "HDFC", draft())).toHaveLength(5);
    expect(testBankRule(db, companyId, "HDFC", listBankRules(db, companyId)[1]!.id).length).toBeGreaterThan(0);
    const after = {
      je: count("journal_entries"), jl: count("journal_lines"), links: count("bank_statement_line_links"),
      lines: count("bank_statement_lines"), audit: count("audit_events"), rules: count("bank_rules"),
      statuses: JSON.stringify(db.prepare("SELECT id, status FROM bank_statement_lines ORDER BY id").all()),
    };
    expect(after).toEqual(before);
    expect(count("bank_statement_line_links")).toBe(0);
  });

  it("7. the suggestion carries the rule's business, fair, party name and memo", () => {
    const rule = createBankRule(db, companyId, draft({ businessId, fairId: "fair-1", partyName: "HDFC Bank", memo: "Monthly charges" }));
    expect(suggestFor(db, line("CHGS", -RS(1)))).toEqual({
      ruleId: rule.id, ruleName: "Bank charges", action: "ADD", accountCode: "BANK_CHARGES",
      businessId, fairId: "fair-1", partyName: "HDFC Bank", memo: "Monthly charges",
    });
  });

  it("8. audit for create / update / delete / activate / deactivate / reorder; chain verifies", () => {
    const a = createBankRule(db, companyId, draft({ name: "A" }));
    const b = createBankRule(db, companyId, draft({ name: "B" }));
    updateBankRule(db, companyId, a.id, { memo: "m" });
    setBankRuleActive(db, companyId, a.id, false);
    setBankRuleActive(db, companyId, a.id, true);
    reorderBankRules(db, companyId, [b.id, a.id]);
    deleteBankRule(db, companyId, b.id);
    const actions = (db.prepare("SELECT action FROM audit_events WHERE entity_type = 'bank_rule' ORDER BY id").all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual([
      "BANK_RULE_CREATED", "BANK_RULE_CREATED", "BANK_RULE_UPDATED", "BANK_RULE_DEACTIVATED",
      "BANK_RULE_ACTIVATED", "BANK_RULE_REORDERED", "BANK_RULE_DELETED",
    ]);
    const del = db.prepare("SELECT before_values FROM audit_events WHERE action = 'BANK_RULE_DELETED'").get() as { before_values: string };
    expect(JSON.parse(del.before_values)).toMatchObject({ name: "B" });
    expect(count("bank_rule_conditions")).toBe(1);
    expect(verifyAuditChain(db).ok).toBe(true);
  });
});
