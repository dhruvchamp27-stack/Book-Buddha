import type Database from "better-sqlite3";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";
import { BANK_ACCOUNT_KINDS, type BankAccountKind } from "./bank-accounts-schema.js";

export { BANK_ACCOUNT_KINDS, type BankAccountKind };

/** What `listBankAccounts` returns for one bank account. The seeded BANK has `kind` null and `isSystem` true. */
export interface BankAccountView {
  readonly code: string;
  readonly name: string;
  readonly type: "ASSET" | "LIABILITY";
  readonly kind: BankAccountKind | null;
  readonly bankName: string | null;
  readonly branch: string | null;
  readonly accountNumberLast4: string | null;
  readonly ifsc: string | null;
  readonly partOfCashManagement: boolean;
  readonly sanctionedLimitPaise: number | null;
  readonly active: boolean;
  readonly isSystem: boolean;
  /** Debit less credit over the company's own businesses. An overdraft in use is NEGATIVE. */
  readonly balancePaise: number;
}

export interface CreateBankAccountInput {
  readonly companyId: string;
  readonly name: string;
  readonly kind: BankAccountKind;
  readonly code?: string | undefined;
  readonly bankName?: string | null | undefined;
  readonly branch?: string | null | undefined;
  readonly accountNumberLast4?: string | null | undefined;
  readonly ifsc?: string | null | undefined;
  readonly partOfCashManagement?: boolean | undefined;
  readonly sanctionedLimitPaise?: number | null | undefined;
}

/** `undefined` = leave as is; `null` = clear. Kind, type and code can never change. */
export interface UpdateBankAccountInput {
  readonly name?: string | undefined;
  readonly bankName?: string | null | undefined;
  readonly branch?: string | null | undefined;
  readonly accountNumberLast4?: string | null | undefined;
  readonly ifsc?: string | null | undefined;
  readonly partOfCashManagement?: boolean | undefined;
  readonly sanctionedLimitPaise?: number | null | undefined;
}

interface DetailRow {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY";
  active: number;
  company_id: string | null;
  kind: BankAccountKind | null;
  bank_name: string | null;
  branch: string | null;
  account_number_last4: string | null;
  ifsc: string | null;
  part_of_cash_management: number | null;
  sanctioned_limit_paise: number | null;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const DETAIL_SELECT = `SELECT c.code, c.name, c.type, c.active, c.company_id,
              b.kind, b.bank_name, b.branch, b.account_number_last4, b.ifsc, b.part_of_cash_management, b.sanctioned_limit_paise
         FROM chart_accounts c LEFT JOIN bank_accounts b ON b.account_code = c.code`;

/** Whole paise as Indian-grouped rupees: 15000000 -> "Rs 1,50,000", 150050 -> "Rs 1,500.50". */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const digits = String(whole);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest === "" ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  return `${sign}Rs ${grouped}${frac === 0 ? "" : `.${String(frac).padStart(2, "0")}`}`;
}

export function createBankAccount(db: Database.Database, input: CreateBankAccountInput): string {
  requireCompany(db, input.companyId);
  if (!(BANK_ACCOUNT_KINDS as readonly string[]).includes(input.kind)) {
    throw new RepositoryValidationError(`A bank account kind must be one of ${BANK_ACCOUNT_KINDS.join(", ")}.`);
  }
  const name = input.name.trim();
  if (name === "") throw new RepositoryValidationError("A bank account needs a name.");
  assertNameFree(db, input.companyId, name, undefined);

  const details = cleanDetails(input.kind, input);
  const isCredit = input.kind === "OVERDRAFT" || input.kind === "CASH_CREDIT";
  const partOfCash = input.partOfCashManagement ?? !isCredit;

  let code: string;
  if (input.code !== undefined && input.code.trim() !== "") {
    code = input.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new RepositoryValidationError(
        "An account code must be 2 to 40 characters, start with a letter, and use only letters, numbers and underscores.",
      );
    }
    if (code === "RETAINED_EARNINGS") {
      throw new RepositoryValidationError("RETAINED_EARNINGS is derived by the Balance Sheet and cannot be an account.");
    }
    const existing = db.prepare("SELECT company_id FROM chart_accounts WHERE code = ?").get(code) as { company_id: string | null } | undefined;
    if (existing !== undefined) {
      throw new RepositoryValidationError(
        existing.company_id === null ? `${code} is a built-in account and already exists.` : `An account with the code ${code} already exists.`,
      );
    }
  } else {
    code = generateCode(db, name);
  }

  const type = isCredit ? "LIABILITY" : "ASSET";
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, ?, 'BANK', NULL, 1, ?, ?)",
    ).run(code, input.companyId, name, type, now, now);
    db.prepare(
      `INSERT INTO bank_accounts (account_code, company_id, kind, bank_name, branch, account_number_last4, ifsc, part_of_cash_management, sanctioned_limit_paise, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(code, input.companyId, input.kind, details.bankName, details.branch, details.last4, details.ifsc, partOfCash ? 1 : 0, details.limit, now, now);
    appendAuditEvent(db, {
      action: "BANK_ACCOUNT_CREATED",
      entityId: code,
      entityType: "bank_account",
      companyId: input.companyId,
      occurredAt: now,
      afterValues: {
        code, name, type, kind: input.kind, bankName: details.bankName, branch: details.branch,
        accountNumberLast4: details.last4, ifsc: details.ifsc, partOfCashManagement: partOfCash,
        sanctionedLimitPaise: details.limit, active: true,
      },
    });
  })();
  return code;
}

export function updateBankAccount(db: Database.Database, companyId: string, code: string, patch: UpdateBankAccountInput): void {
  const before = editable(db, companyId, code);
  const kind = before.kind as BankAccountKind;
  let name = before.name;
  if (patch.name !== undefined) {
    name = patch.name.trim();
    if (name === "") throw new RepositoryValidationError("A bank account needs a name.");
    assertNameFree(db, companyId, name, code);
  }
  const merged = cleanDetails(kind, {
    bankName: patch.bankName === undefined ? before.bank_name : patch.bankName,
    branch: patch.branch === undefined ? before.branch : patch.branch,
    accountNumberLast4: patch.accountNumberLast4 === undefined ? before.account_number_last4 : patch.accountNumberLast4,
    ifsc: patch.ifsc === undefined ? before.ifsc : patch.ifsc,
    sanctionedLimitPaise: patch.sanctionedLimitPaise === undefined ? before.sanctioned_limit_paise : patch.sanctionedLimitPaise,
  });
  const partOfCash = patch.partOfCashManagement ?? before.part_of_cash_management === 1;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE chart_accounts SET name = ?, updated_at = ? WHERE code = ?").run(name, now, code);
    db.prepare(
      `UPDATE bank_accounts SET bank_name = ?, branch = ?, account_number_last4 = ?, ifsc = ?, part_of_cash_management = ?, sanctioned_limit_paise = ?, updated_at = ?
        WHERE account_code = ?`,
    ).run(merged.bankName, merged.branch, merged.last4, merged.ifsc, partOfCash ? 1 : 0, merged.limit, now, code);
    appendAuditEvent(db, {
      action: "BANK_ACCOUNT_UPDATED",
      entityId: code,
      entityType: "bank_account",
      companyId,
      occurredAt: now,
      beforeValues: snapshot(before),
      afterValues: {
        name, bankName: merged.bankName, branch: merged.branch, accountNumberLast4: merged.last4, ifsc: merged.ifsc,
        partOfCashManagement: partOfCash, sanctionedLimitPaise: merged.limit, active: before.active === 1,
      },
    });
  })();
}

/** Refused while the company's balance on the account is not zero. */
export function deactivateBankAccount(db: Database.Database, companyId: string, code: string): void {
  const before = editable(db, companyId, code);
  if (before.active === 0) throw new RepositoryValidationError(`${before.name} (${code}) is already inactive.`);
  const balance = companyBalance(db, companyId, code);
  if (balance !== 0) {
    throw new RepositoryValidationError(
      `${before.name} (${code}) still has a balance of ${formatRupees(balance)}${balance < 0 ? " (owed to the bank)" : ""}. Bring it to zero before deactivating it.`,
    );
  }
  setActive(db, companyId, code, before, false);
}

export function reactivateBankAccount(db: Database.Database, companyId: string, code: string): void {
  const before = editable(db, companyId, code);
  if (before.active === 1) throw new RepositoryValidationError(`${before.name} (${code}) is already active.`);
  setActive(db, companyId, code, before, true);
}

/** Every BANK-role account visible to the company (system + its own), with details and current balance. */
export function listBankAccounts(db: Database.Database, companyId: string): BankAccountView[] {
  requireCompany(db, companyId);
  const rows = db
    .prepare(`${DETAIL_SELECT} WHERE c.role = 'BANK' AND (c.company_id IS NULL OR c.company_id = ?) ORDER BY c.company_id IS NOT NULL, c.code`)
    .all(companyId) as DetailRow[];
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type,
    kind: r.kind,
    bankName: r.bank_name,
    branch: r.branch,
    accountNumberLast4: r.account_number_last4,
    ifsc: r.ifsc,
    partOfCashManagement: r.part_of_cash_management === null ? true : r.part_of_cash_management === 1,
    sanctionedLimitPaise: r.sanctioned_limit_paise,
    active: r.active === 1,
    isSystem: r.company_id === null,
    balancePaise: companyBalance(db, companyId, r.code),
  }));
}

// ---------------------------------------------------------------------------------------------

function requireCompany(db: Database.Database, companyId: string): void {
  if (typeof companyId !== "string" || db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId) === undefined) {
    throw new RepositoryValidationError(`Company ${String(companyId)} was not found.`);
  }
}

/** The account's chart + bank details, only when it is a bank account this company owns. */
function editable(db: Database.Database, companyId: string, code: string): DetailRow {
  requireCompany(db, companyId);
  const row = db.prepare(`${DETAIL_SELECT} WHERE c.code = ? AND c.role = 'BANK'`).get(code) as DetailRow | undefined;
  if (row === undefined) throw new RepositoryValidationError(`${code} is not a bank account.`);
  if (row.company_id === null) {
    throw new RepositoryValidationError(`${row.name} (${code}) is a built-in account and cannot be changed here.`);
  }
  if (row.company_id !== companyId || row.kind === null) {
    throw new RepositoryValidationError(`${code} is not a bank account of this company.`);
  }
  return row;
}

function snapshot(row: DetailRow): Record<string, unknown> {
  return {
    name: row.name, bankName: row.bank_name, branch: row.branch, accountNumberLast4: row.account_number_last4, ifsc: row.ifsc,
    partOfCashManagement: row.part_of_cash_management === 1, sanctionedLimitPaise: row.sanctioned_limit_paise, active: row.active === 1,
  };
}

function setActive(db: Database.Database, companyId: string, code: string, before: DetailRow, active: boolean): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE chart_accounts SET active = ?, updated_at = ? WHERE code = ?").run(active ? 1 : 0, now, code);
    appendAuditEvent(db, {
      action: active ? "BANK_ACCOUNT_REACTIVATED" : "BANK_ACCOUNT_DEACTIVATED",
      entityId: code,
      entityType: "bank_account",
      companyId,
      occurredAt: now,
      beforeValues: { active: before.active === 1 },
      afterValues: { active },
    });
  })();
}

/** Debit less credit on the account, over the company's own businesses only. */
function companyBalance(db: Database.Database, companyId: string, code: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit_paise - jl.credit_paise), 0) AS balance
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN businesses b ON b.id = je.business_id
        WHERE jl.account = ? AND b.company_id = ?`,
    )
    .get(code, companyId) as { balance: number };
  return row.balance;
}

/** Name unique among the bank accounts the company can see, case-insensitively. */
function assertNameFree(db: Database.Database, companyId: string, name: string, exceptCode: string | undefined): void {
  const clash = db
    .prepare(
      `SELECT code FROM chart_accounts
        WHERE role = 'BANK' AND (company_id IS NULL OR company_id = ?) AND lower(name) = lower(?) AND code <> ?`,
    )
    .get(companyId, name, exceptCode ?? "") as { code: string } | undefined;
  if (clash !== undefined) throw new RepositoryValidationError(`A bank account named "${name}" already exists.`);
}

function generateCode(db: Database.Database, name: string): string {
  const stem = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const base = `BANK_${stem === "" ? "ACCOUNT" : stem}`.slice(0, 36);
  const taken = db.prepare("SELECT 1 FROM chart_accounts WHERE code = ?");
  let candidate = base;
  for (let n = 2; taken.get(candidate) !== undefined; n += 1) candidate = `${base}_${n}`;
  return candidate;
}

function orNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Validates and normalises the optional detail fields; the single place the rules live. */
function cleanDetails(
  kind: BankAccountKind,
  d: {
    bankName?: string | null | undefined;
    branch?: string | null | undefined;
    accountNumberLast4?: string | null | undefined;
    ifsc?: string | null | undefined;
    sanctionedLimitPaise?: number | null | undefined;
  },
): { bankName: string | null; branch: string | null; last4: string | null; ifsc: string | null; limit: number | null } {
  const last4 = orNull(d.accountNumberLast4);
  if (last4 !== null && !/^[0-9]{4}$/.test(last4)) {
    throw new RepositoryValidationError("Enter only the last 4 digits of the account number (4 digits, no letters). The full number is never stored.");
  }
  const ifscRaw = orNull(d.ifsc);
  const ifsc = ifscRaw === null ? null : ifscRaw.toUpperCase();
  if (ifsc !== null && !IFSC_PATTERN.test(ifsc)) {
    throw new RepositoryValidationError("An IFSC code is 4 letters, a zero, then 6 letters or digits (for example HDFC0001234).");
  }
  const limit = d.sanctionedLimitPaise ?? null;
  if (limit !== null) {
    if (kind !== "OVERDRAFT" && kind !== "CASH_CREDIT") {
      throw new RepositoryValidationError("A sanctioned limit applies only to an overdraft or cash credit account.");
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RepositoryValidationError("A sanctioned limit must be a positive whole number of paise.");
    }
  }
  return { bankName: orNull(d.bankName), branch: orNull(d.branch), last4, ifsc, limit };
}
