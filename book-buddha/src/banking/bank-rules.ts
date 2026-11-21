import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";
import { normaliseName } from "../import-export/codec.js";
import { assertMoneyAccount, companyOfBusiness } from "./money-accounts.js";
import { listStatementLines, type LineSuggestion, type StatementLine } from "./statement-lines.js";

/**
 * R12g bank rules. PRE-FILL ONLY (FD section D5): a rule PROPOSES an account / transfer / business /
 * fair / party for a statement line; the user still confirms in the review queue (12f). Nothing
 * here writes a journal, a voucher, a link or a line status. Rules are configuration, so a delete
 * is a hard delete, audited with the before-values.
 */
export type BankRuleDirection = "ANY" | "IN" | "OUT";
export type BankRuleMatchMode = "ALL" | "ANY";
export type BankRuleAction = "ADD" | "TRANSFER";
export type ConditionField = "DESCRIPTION" | "REFERENCE" | "AMOUNT";
export type ConditionOperator = "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "GREATER_THAN" | "LESS_THAN";

export interface BankRuleCondition {
  readonly field: ConditionField;
  readonly operator: ConditionOperator;
  /** Text conditions (DESCRIPTION / REFERENCE). Compared with `normaliseName`. */
  readonly valueText?: string | null | undefined;
  /** AMOUNT conditions: whole paise, positive; compared with the line's |amount|. */
  readonly valuePaise?: number | null | undefined;
}

/** A rule as typed by the user (create), or a draft to test. */
export interface BankRuleDraft {
  readonly name: string;
  readonly accountScope?: string | null | undefined;
  readonly direction?: BankRuleDirection | undefined;
  readonly matchMode?: BankRuleMatchMode | undefined;
  readonly action: BankRuleAction;
  readonly targetAccount: string;
  readonly businessId?: string | null | undefined;
  readonly fairId?: string | null | undefined;
  readonly partyName?: string | null | undefined;
  readonly memo?: string | null | undefined;
  readonly conditions: readonly BankRuleCondition[];
}

/** `undefined` = leave as is; for the nullable fields `null` = clear. `conditions`, when given, replaces them all. */
export type BankRulePatch = { [K in keyof BankRuleDraft]?: BankRuleDraft[K] | undefined };

export interface BankRule {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly priority: number;
  readonly active: boolean;
  readonly accountScope: string | null;
  readonly direction: BankRuleDirection;
  readonly matchMode: BankRuleMatchMode;
  readonly action: BankRuleAction;
  readonly targetAccount: string;
  readonly businessId: string | null;
  readonly fairId: string | null;
  readonly partyName: string | null;
  readonly memo: string | null;
  readonly conditions: readonly { field: ConditionField; operator: ConditionOperator; valueText: string | null; valuePaise: number | null }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RuleRow {
  id: string; company_id: string; name: string; priority: number; active: number; account_scope: string | null;
  direction: string; match_mode: string; action: string; target_account: string; business_id: string | null;
  fair_id: string | null; party_name: string | null; memo: string | null; created_at: string; updated_at: string;
}
interface CondRow { rule_id: string; position: number; field: string; operator: string; value_text: string | null; value_paise: number | null }

const TEXT_OPERATORS: readonly string[] = ["CONTAINS", "NOT_CONTAINS", "EQUALS"];
const AMOUNT_OPERATORS: readonly string[] = ["EQUALS", "GREATER_THAN", "LESS_THAN"];
/** An ADD rule may not post into these roles (they have their own doors). */
const REFUSED_ADD_ROLES: readonly string[] = ["CASH", "BANK", "RECEIVABLES", "PAYABLES", "CUSTOMER_CREDITS", "SUPPLIER_CREDITS", "INVENTORY"];
const HOLDING_ACCOUNTS: readonly string[] = ["UNCATEGORIZED", "UNCATEGORIZED_INCOME"];

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function loadRules(db: Database.Database, where: string, ...params: unknown[]): BankRule[] {
  const rows = db.prepare(`SELECT * FROM bank_rules WHERE ${where} ORDER BY priority, created_at, id`).all(...params) as RuleRow[];
  return rows.map((row) => {
    const conds = db
      .prepare("SELECT * FROM bank_rule_conditions WHERE rule_id = ? ORDER BY position")
      .all(row.id) as CondRow[];
    return {
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      priority: row.priority,
      active: row.active === 1,
      accountScope: row.account_scope,
      direction: row.direction as BankRuleDirection,
      matchMode: row.match_mode as BankRuleMatchMode,
      action: row.action as BankRuleAction,
      targetAccount: row.target_account,
      businessId: row.business_id,
      fairId: row.fair_id,
      partyName: row.party_name,
      memo: row.memo,
      conditions: conds.map((c) => ({
        field: c.field as ConditionField,
        operator: c.operator as ConditionOperator,
        valueText: c.value_text,
        valuePaise: c.value_paise,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/** Every rule of the company, lowest priority number first. */
export function listBankRules(db: Database.Database, companyId: string): BankRule[] {
  return loadRules(db, "company_id = ?", companyId);
}

function getRule(db: Database.Database, companyId: string, id: string): BankRule {
  const found = loadRules(db, "company_id = ? AND id = ?", companyId, id)[0];
  if (found === undefined) throw new RepositoryValidationError(`Bank rule ${id} was not found in this company.`);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Matching (pure)
// ---------------------------------------------------------------------------------------------

interface Shape {
  readonly accountScope: string | null;
  readonly direction: BankRuleDirection;
  readonly matchMode: BankRuleMatchMode;
  readonly conditions: readonly { field: ConditionField; operator: ConditionOperator; valueText: string | null; valuePaise: number | null }[];
}

function conditionHolds(c: Shape["conditions"][number], line: Pick<StatementLine, "description" | "reference" | "amountPaise">): boolean {
  if (c.field === "AMOUNT") {
    const abs = Math.abs(line.amountPaise);
    const v = c.valuePaise ?? 0;
    return c.operator === "EQUALS" ? abs === v : c.operator === "GREATER_THAN" ? abs > v : abs < v;
  }
  const hay = normaliseName(c.field === "DESCRIPTION" ? line.description : (line.reference ?? ""));
  const needle = normaliseName(c.valueText ?? "");
  if (c.operator === "CONTAINS") return hay.includes(needle);
  if (c.operator === "NOT_CONTAINS") return !hay.includes(needle);
  return hay === needle;
}

/** Does the rule's scope, direction and conditions fit this line? (Company / active are the caller's business.) */
function ruleFits(rule: Shape, line: Pick<StatementLine, "accountCode" | "description" | "reference" | "amountPaise">): boolean {
  if (rule.accountScope !== null && rule.accountScope !== line.accountCode) return false;
  if (rule.direction === "IN" && line.amountPaise < 0) return false;
  if (rule.direction === "OUT" && line.amountPaise > 0) return false;
  if (rule.conditions.length === 0) return false;
  return rule.matchMode === "ALL" ? rule.conditions.every((c) => conditionHolds(c, line)) : rule.conditions.some((c) => conditionHolds(c, line));
}

/**
 * The first ACTIVE rule of the line's company, lowest priority number first, whose scope,
 * direction and conditions fit. A pure read: nothing is written. A TRANSFER rule whose target is
 * the line's own account is skipped (no transfer to itself).
 */
export function suggestFor(db: Database.Database, line: StatementLine): LineSuggestion | null {
  const rules = loadRules(db, "company_id = ? AND active = 1", line.companyId);
  for (const rule of rules) {
    if (!ruleFits(rule, line)) continue;
    if (rule.action === "TRANSFER" && rule.targetAccount === line.accountCode) continue;
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      action: rule.action,
      accountCode: rule.targetAccount,
      businessId: rule.businessId,
      fairId: rule.fairId,
      partyName: rule.partyName,
      memo: rule.memo,
    };
  }
  return null;
}

/**
 * The FOR_REVIEW lines of `accountCode` that this rule (an existing rule's id, or a draft) fits.
 * Ignores active/priority: it answers "what does THIS rule match", not "what wins". Pure read.
 */
export function testBankRule(
  db: Database.Database,
  companyId: string,
  accountCode: string,
  ruleOrDraft: string | BankRuleDraft,
): StatementLine[] {
  const shape: Shape =
    typeof ruleOrDraft === "string"
      ? getRule(db, companyId, ruleOrDraft)
      : normaliseDraft(db, companyId, ruleOrDraft, null, false).shape;
  return listStatementLines(db, { companyId, accountCode, status: "FOR_REVIEW" }).filter((line) => ruleFits(shape, line));
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

interface Clean {
  name: string;
  accountScope: string | null;
  direction: BankRuleDirection;
  matchMode: BankRuleMatchMode;
  action: BankRuleAction;
  targetAccount: string;
  businessId: string | null;
  fairId: string | null;
  partyName: string | null;
  memo: string | null;
  conditions: { field: ConditionField; operator: ConditionOperator; valueText: string | null; valuePaise: number | null }[];
  shape: Shape;
}

const blankToNull = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

function normaliseDraft(db: Database.Database, companyId: string, draft: BankRuleDraft, ownId: string | null, checkName = true): Clean {
  const name = (draft.name ?? "").trim().replace(/\s+/g, " ");
  if (name === "") throw new RepositoryValidationError("A bank rule needs a name.");
  const dup = db
    .prepare("SELECT id FROM bank_rules WHERE company_id = ? AND lower(name) = lower(?) AND id <> ?")
    .get(companyId, name, ownId ?? "") as { id: string } | undefined;
  if (checkName && dup !== undefined) throw new RepositoryValidationError(`A bank rule named "${name}" already exists. Names are not case-sensitive; pick another.`);

  const direction = draft.direction ?? "ANY";
  if (!["ANY", "IN", "OUT"].includes(direction)) throw new RepositoryValidationError(`Direction must be ANY, IN or OUT, not "${direction}".`);
  const matchMode = draft.matchMode ?? "ALL";
  if (!["ALL", "ANY"].includes(matchMode)) throw new RepositoryValidationError(`Match mode must be ALL or ANY, not "${matchMode}".`);
  if (draft.action !== "ADD" && draft.action !== "TRANSFER") throw new RepositoryValidationError("A rule's action must be ADD or TRANSFER.");

  const accountScope = blankToNull(draft.accountScope);
  if (accountScope !== null) {
    const scope = db
      .prepare("SELECT code FROM chart_accounts WHERE code = ? AND role = 'BANK' AND (company_id IS NULL OR company_id = ?)")
      .get(accountScope, companyId);
    if (scope === undefined) throw new RepositoryValidationError(`${accountScope} is not a bank account of this company, so a rule cannot be limited to it.`);
  }

  const targetAccount = (draft.targetAccount ?? "").trim();
  if (targetAccount === "") throw new RepositoryValidationError("A bank rule needs a target account.");
  if (draft.action === "ADD") {
    if (HOLDING_ACCOUNTS.includes(targetAccount)) {
      throw new RepositoryValidationError("A rule cannot target the Uncategorised accounts: they are holding accounts for lines you have not decided. Pick a real account.");
    }
    const acct = db
      .prepare("SELECT code, role, active FROM chart_accounts WHERE code = ? AND (company_id IS NULL OR company_id = ?)")
      .get(targetAccount, companyId) as { code: string; role: string | null; active: number } | undefined;
    if (acct === undefined) throw new RepositoryValidationError(`${targetAccount} is not an account of this company.`);
    if (acct.active === 0) throw new RepositoryValidationError(`${targetAccount} is no longer active. Pick another account.`);
    if (acct.role !== null && REFUSED_ADD_ROLES.includes(acct.role)) {
      throw new RepositoryValidationError(`A rule cannot add a line to ${targetAccount}: it is a ${acct.role} account with its own way of being posted. Pick an income or expense account.`);
    }
  } else {
    assertMoneyAccount(db, targetAccount, companyId);
    if (accountScope !== null && accountScope === targetAccount) {
      throw new RepositoryValidationError("A transfer rule cannot move money to the same bank account it is limited to.");
    }
  }

  const businessId = blankToNull(draft.businessId);
  if (businessId !== null && companyOfBusiness(db, businessId) !== companyId) {
    throw new RepositoryValidationError("That business belongs to another company.");
  }

  const rawConds = draft.conditions ?? [];
  if (rawConds.length === 0) throw new RepositoryValidationError("A bank rule needs at least one condition.");
  const conditions = rawConds.map((c, i) => {
    const where = `Condition ${i + 1}`;
    if (c.field === "AMOUNT") {
      if (!AMOUNT_OPERATORS.includes(c.operator)) throw new RepositoryValidationError(`${where}: an amount condition uses EQUALS, GREATER_THAN or LESS_THAN.`);
      if (typeof c.valuePaise !== "number" || !Number.isSafeInteger(c.valuePaise) || c.valuePaise <= 0) {
        throw new RepositoryValidationError(`${where}: an amount must be a positive whole number of paise.`);
      }
      return { field: c.field, operator: c.operator, valueText: null, valuePaise: c.valuePaise };
    }
    if (c.field !== "DESCRIPTION" && c.field !== "REFERENCE") throw new RepositoryValidationError(`${where}: the field must be DESCRIPTION, REFERENCE or AMOUNT.`);
    if (!TEXT_OPERATORS.includes(c.operator)) throw new RepositoryValidationError(`${where}: a text condition uses CONTAINS, NOT_CONTAINS or EQUALS.`);
    const text = (c.valueText ?? "").trim();
    if (normaliseName(text) === "") throw new RepositoryValidationError(`${where}: type the text to look for.`);
    return { field: c.field, operator: c.operator, valueText: text, valuePaise: null };
  });

  return {
    name, accountScope, direction, matchMode, action: draft.action, targetAccount, businessId,
    fairId: blankToNull(draft.fairId), partyName: blankToNull(draft.partyName), memo: blankToNull(draft.memo),
    conditions,
    shape: { accountScope, direction, matchMode, conditions },
  };
}

const draftOf = (rule: BankRule): BankRuleDraft => ({
  name: rule.name, accountScope: rule.accountScope, direction: rule.direction, matchMode: rule.matchMode,
  action: rule.action, targetAccount: rule.targetAccount, businessId: rule.businessId, fairId: rule.fairId,
  partyName: rule.partyName, memo: rule.memo, conditions: rule.conditions,
});

const snapshot = (rule: BankRule): Record<string, unknown> => ({ ...rule });

function writeConditions(db: Database.Database, ruleId: string, conditions: Clean["conditions"]): void {
  db.prepare("DELETE FROM bank_rule_conditions WHERE rule_id = ?").run(ruleId);
  const ins = db.prepare("INSERT INTO bank_rule_conditions (rule_id, position, field, operator, value_text, value_paise) VALUES (?, ?, ?, ?, ?, ?)");
  conditions.forEach((c, i) => ins.run(ruleId, i + 1, c.field, c.operator, c.valueText, c.valuePaise));
}

// ---------------------------------------------------------------------------------------------
// Writing configuration (audited; never touches the books)
// ---------------------------------------------------------------------------------------------

/** Creates a rule, last in priority order. Active. */
export function createBankRule(db: Database.Database, companyId: string, draft: BankRuleDraft): BankRule {
  return db.transaction(() => {
    const clean = normaliseDraft(db, companyId, draft, null);
    const last = db.prepare("SELECT COALESCE(MAX(priority), 0) AS p FROM bank_rules WHERE company_id = ?").get(companyId) as { p: number };
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO bank_rules (id, company_id, name, priority, active, account_scope, direction, match_mode, action,
         target_account, business_id, fair_id, party_name, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, companyId, clean.name, last.p + 1, clean.accountScope, clean.direction, clean.matchMode, clean.action,
      clean.targetAccount, clean.businessId, clean.fairId, clean.partyName, clean.memo, now, now);
    writeConditions(db, id, clean.conditions);
    const created = getRule(db, companyId, id);
    appendAuditEvent(db, { action: "BANK_RULE_CREATED", entityId: id, entityType: "bank_rule", companyId, occurredAt: now, afterValues: snapshot(created) });
    return created;
  })();
}

/** Changes the given fields (the rest stay). `conditions`, when given, replaces all conditions. */
export function updateBankRule(db: Database.Database, companyId: string, id: string, patch: BankRulePatch): BankRule {
  return db.transaction(() => {
    const before = getRule(db, companyId, id);
    const merged: Record<string, unknown> = { ...draftOf(before) };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) merged[key] = value;
    }
    const clean = normaliseDraft(db, companyId, merged as unknown as BankRuleDraft, id);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE bank_rules SET name = ?, account_scope = ?, direction = ?, match_mode = ?, action = ?, target_account = ?,
         business_id = ?, fair_id = ?, party_name = ?, memo = ?, updated_at = ? WHERE id = ?`,
    ).run(clean.name, clean.accountScope, clean.direction, clean.matchMode, clean.action, clean.targetAccount,
      clean.businessId, clean.fairId, clean.partyName, clean.memo, now, id);
    writeConditions(db, id, clean.conditions);
    const after = getRule(db, companyId, id);
    appendAuditEvent(db, { action: "BANK_RULE_UPDATED", entityId: id, entityType: "bank_rule", companyId, occurredAt: now, beforeValues: snapshot(before), afterValues: snapshot(after) });
    return after;
  })();
}

/** Hard delete (a rule is configuration, not books); the audit event keeps the before-values. */
export function deleteBankRule(db: Database.Database, companyId: string, id: string): void {
  db.transaction(() => {
    const before = getRule(db, companyId, id);
    db.prepare("DELETE FROM bank_rule_conditions WHERE rule_id = ?").run(id);
    db.prepare("DELETE FROM bank_rules WHERE id = ?").run(id);
    appendAuditEvent(db, { action: "BANK_RULE_DELETED", entityId: id, entityType: "bank_rule", companyId, occurredAt: new Date().toISOString(), beforeValues: snapshot(before) });
  })();
}

export function setBankRuleActive(db: Database.Database, companyId: string, id: string, active: boolean): BankRule {
  return db.transaction(() => {
    const before = getRule(db, companyId, id);
    if (before.active === active) return before;
    const now = new Date().toISOString();
    db.prepare("UPDATE bank_rules SET active = ?, updated_at = ? WHERE id = ?").run(active ? 1 : 0, now, id);
    appendAuditEvent(db, {
      action: active ? "BANK_RULE_ACTIVATED" : "BANK_RULE_DEACTIVATED",
      entityId: id, entityType: "bank_rule", companyId, occurredAt: now, beforeValues: { active: before.active }, afterValues: { active },
    });
    return getRule(db, companyId, id);
  })();
}

/** Sets the priority order: every rule of the company exactly once, first = highest priority. */
export function reorderBankRules(db: Database.Database, companyId: string, orderedIds: readonly string[]): BankRule[] {
  return db.transaction(() => {
    const existing = listBankRules(db, companyId);
    const known = new Set(existing.map((r) => r.id));
    const seen = new Set<string>();
    for (const rid of orderedIds) {
      if (!known.has(rid)) throw new RepositoryValidationError(`Rule ${rid} is not one of this company's bank rules.`);
      if (seen.has(rid)) throw new RepositoryValidationError(`Rule ${rid} is listed twice.`);
      seen.add(rid);
    }
    if (seen.size !== known.size) {
      throw new RepositoryValidationError(`List every rule exactly once: this company has ${known.size} rule(s) and ${seen.size} were given.`);
    }
    const now = new Date().toISOString();
    const upd = db.prepare("UPDATE bank_rules SET priority = ?, updated_at = ? WHERE id = ?");
    orderedIds.forEach((rid, i) => upd.run(i + 1, now, rid));
    appendAuditEvent(db, {
      action: "BANK_RULE_REORDERED", entityId: companyId, entityType: "bank_rule", companyId, occurredAt: now,
      beforeValues: existing.map((r) => r.id), afterValues: [...orderedIds],
    });
    return listBankRules(db, companyId);
  })();
}
