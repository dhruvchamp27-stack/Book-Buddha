import type Database from "better-sqlite3";
import { isValidIsoDate } from "../accounting/recurrence.js";
import { appendAuditEvent } from "./audit-log.js";
import { CASH_FLOW_SECTIONS, type CashFlowSection } from "./cash-flow-section-schema.js";
import { RepositoryValidationError } from "./errors.js";

/**
 * Cash Flow Statement, DIRECT method (owner ruling S17-6). Read-only: it walks the posted ledger.
 *
 * WHAT IS CASH. Chart accounts with role CASH or BANK, except an overdraft / cash-credit bank
 * account whose `bank_accounts.part_of_cash_management = 0` (ruling S15-4): that one is a FINANCING
 * counterpart, not cash.
 *
 * HOW A FLOW IS READ. Every journal entry dated in [from, to] that has a cash line is one movement
 * of cash, net across its cash lines (debit less credit; positive = in). That net is attributed to
 * the entry's NON-cash lines that sit on the OPPOSITE side to the cash (a receipt's credit lines, a
 * payment's debit lines), pro rata to their amounts, largest-remainder so the parts add up to the
 * paise. Lines on the cash's own side are other half of the same entry (e.g. the COGS / INVENTORY
 * pair of a sale, or a receivable a part-payment leaves open) and are not cash.
 *   - An entry whose only lines are cash accounts (internal transfer, cash deposited to bank) is not a
 *     flow (ruling 12c): it has no counterpart line, so it contributes nothing.
 *   - Opening-balance entries (see OPENING_POSITION) are never flows. They
 *     make up cash at the beginning: opening cash = cash balance from entries dated before `from`
 *     PLUS opening-balance entries dated inside the period.
 *   - Cancellations are ordinary entries (is_reversal = 1) and are flows that net out.
 *
 * TIE. openingCash + netChange must equal the cash accounts' ledger balance at `to`. When it does
 * not, `tie.ok` is false; nothing throws.
 */

export type { CashFlowSection };

export interface CashFlowFilter {
  readonly businessId?: string | undefined;
  readonly fairId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface CashFlowLine {
  readonly label: string;
  readonly inflowPaise: number;
  readonly outflowPaise: number;
  readonly netPaise: number;
}

export interface CashFlowTotals {
  readonly inflowPaise: number;
  readonly outflowPaise: number;
  readonly netPaise: number;
}

export interface CashFlowStatement {
  readonly from: string | null;
  readonly to: string | null;
  readonly openingCashPaise: number;
  readonly sections: {
    readonly operating: CashFlowLine[];
    readonly investing: CashFlowLine[];
    readonly financing: CashFlowLine[];
  };
  readonly totals: {
    readonly operating: CashFlowTotals;
    readonly investing: CashFlowTotals;
    readonly financing: CashFlowTotals;
  };
  readonly netChangePaise: number;
  readonly closingCashPaise: number;
  readonly tie: { readonly closingFromLedgerPaise: number; readonly ok: boolean };
}

interface AccountRow {
  code: string;
  name: string;
  type: string;
  role: string | null;
  company_id: string | null;
  cash_flow_section: string | null;
}

/**
 * The opening-position entry: the cash typed into "Opening balances" (id `je-opening-balance-<set>`)
 * and its reversal (`je-opening-balance-reversal-<set>`). NOT every OPENING_BALANCE-source entry:
 * a receipt against an opening customer balance (`je-opening-receipt-`) or a settlement of an
 * opening supplier balance (`je-opening-settlement-`) moves real cash during the period and is a flow.
 */
const OPENING_POSITION = "je.source_type = 'OPENING_BALANCE' AND je.id LIKE 'je-opening-balance-%'";

const FINANCING_CODES = new Set(["CAPITAL", "OPENING_BALANCE_EQUITY", "LOANS"]);
const CUSTOMER_CODES = new Set(["SALES", "UNEARNED_REVENUE"]);
const CUSTOMER_ROLES = new Set(["OUTPUT_GST", "RECEIVABLES", "CUSTOMER_CREDITS"]);
const SUPPLIER_CODES = new Set(["PURCHASE_DISCOUNT", "PURCHASE_EXTRA_CHARGES", "STOCK_ADJUSTMENT", "SUPPLIER_CREDITS"]);
const SUPPLIER_ROLES = new Set(["PAYABLES", "INVENTORY", "INPUT_GST"]);

function accountMap(db: Database.Database): Map<string, AccountRow> {
  const rows = db
    .prepare("SELECT code, name, type, role, company_id, cash_flow_section FROM chart_accounts")
    .all() as AccountRow[];
  return new Map(rows.map((r) => [r.code, r]));
}

/** The set of cash account codes (see the file header). */
export function cashAccountCodes(db: Database.Database): Set<string> {
  const rows = db
    .prepare(
      `SELECT c.code FROM chart_accounts c
        WHERE c.role IN ('CASH', 'BANK')
          AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.account_code = c.code AND b.part_of_cash_management = 0)`,
    )
    .all() as Array<{ code: string }>;
  return new Set(rows.map((r) => r.code));
}

/**
 * Which section a (non-cash) account belongs to. An explicit setting wins, but only a USER account
 * can carry one (system accounts are fixed by the rule). Otherwise CAPITAL, OPENING_BALANCE_EQUITY,
 * LOANS and a bank account that is not part of cash management (OD / CC) are FINANCING; everything
 * else is OPERATING.
 */
export function sectionOf(account: Pick<AccountRow, "code" | "role" | "company_id" | "cash_flow_section">): CashFlowSection {
  if (account.company_id !== null && account.cash_flow_section !== null) {
    return account.cash_flow_section as CashFlowSection;
  }
  if (FINANCING_CODES.has(account.code)) return "FINANCING";
  if (account.role === "BANK" || account.role === "CASH") return "FINANCING"; // only reachable for a non-cash (OD/CC) account
  return "OPERATING";
}

function operatingLabel(a: AccountRow): string {
  if (CUSTOMER_CODES.has(a.code) || (a.role !== null && CUSTOMER_ROLES.has(a.role))) return "Cash received from customers";
  if (SUPPLIER_CODES.has(a.code) || (a.role !== null && SUPPLIER_ROLES.has(a.role))) return "Cash paid to suppliers";
  if (a.type === "EXPENSE") return "Cash paid for expenses";
  if (a.type === "INCOME") return "Other income received";
  return "Other operating";
}

/** Splits `amount` (>= 0) across `weights` (> 0) so the parts sum exactly: largest remainder, ties to the earlier line. */
export function allocateProRata(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((t, w) => t + w, 0);
  if (weights.length === 0 || total <= 0) return weights.map(() => 0);
  const a = BigInt(amount);
  const t = BigInt(total);
  const parts = weights.map((w) => (a * BigInt(w)) / t);
  const rems = weights.map((w, i) => ({ i, r: (a * BigInt(w)) % t }));
  let left = Number(a - parts.reduce((s, p) => s + p, 0n));
  rems.sort((x, y) => (x.r === y.r ? x.i - y.i : x.r > y.r ? -1 : 1));
  const out = parts.map((p) => Number(p));
  for (const { i } of rems) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

interface LineRow {
  entry_id: string;
  account: string;
  debit_paise: number;
  credit_paise: number;
}

function scope(filter: CashFlowFilter): { sql: string; args: string[] } {
  const parts: string[] = [];
  const args: string[] = [];
  if (filter.businessId !== undefined) { parts.push("je.business_id = ?"); args.push(filter.businessId); }
  if (filter.fairId !== undefined) { parts.push("je.fair_id = ?"); args.push(filter.fairId); }
  return { sql: parts.map((p) => ` AND ${p}`).join(""), args };
}

export function getCashFlow(db: Database.Database, filter: CashFlowFilter = {}): CashFlowStatement {
  for (const [label, value] of [["from", filter.from], ["to", filter.to]] as const) {
    if (value !== undefined && !isValidIsoDate(value)) {
      throw new RepositoryValidationError(`The ${label} date must be a real date written as YYYY-MM-DD.`);
    }
  }
  if (filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) {
    throw new RepositoryValidationError("The from date cannot be after the to date.");
  }
  if (filter.fairId !== undefined && db.prepare("SELECT 1 FROM fairs WHERE id = ?").get(filter.fairId) === undefined) {
    throw new RepositoryValidationError(`Fair ${filter.fairId} was not found, so no report can be produced for it.`);
  }

  const cash = cashAccountCodes(db);
  const accounts = accountMap(db);
  const cashList = [...cash];
  const inCash = cashList.length === 0 ? "('')" : `(${cashList.map(() => "?").join(",")})`;
  const sc = scope(filter);
  const from = filter.from ?? "0000-01-01";
  const to = filter.to ?? "9999-12-31";

  const cashBalance = (extra: string, ...args: string[]): number =>
    (db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit_paise - jl.credit_paise), 0) AS n
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
          WHERE jl.account IN ${inCash}${sc.sql}${extra}`,
      )
      .get(...cashList, ...sc.args, ...args) as { n: number }).n;

  const openingCashPaise =
    cashBalance(" AND je.entry_date < ?", from) +
    cashBalance(` AND je.entry_date >= ? AND je.entry_date <= ? AND ${OPENING_POSITION}`, from, to);
  const closingFromLedgerPaise = cashBalance(" AND je.entry_date <= ?", to);

  // Every line of every non-opening entry in the period that touches cash, oldest first.
  const rows = db
    .prepare(
      `SELECT jl.journal_entry_id AS entry_id, jl.account, jl.debit_paise, jl.credit_paise
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.entry_date >= ? AND je.entry_date <= ? AND NOT (${OPENING_POSITION})${sc.sql}
          AND EXISTS (SELECT 1 FROM journal_lines c WHERE c.journal_entry_id = je.id AND c.account IN ${inCash})
        ORDER BY je.entry_date, je.rowid, jl.id`,
    )
    .all(from, to, ...sc.args, ...cashList) as LineRow[];

  const byEntry = new Map<string, LineRow[]>();
  for (const r of rows) {
    const list = byEntry.get(r.entry_id);
    if (list === undefined) byEntry.set(r.entry_id, [r]);
    else list.push(r);
  }

  type Bucket = { section: CashFlowSection; label: string; inflow: number; outflow: number };
  const buckets = new Map<string, Bucket>();
  // `labelFrom` is the account whose operating label a TAX line borrows: the largest non-tax
  // counterpart of the same entry (so a cash expense's GST stays with the expense, a bill's with its stock).
  const bucketFor = (account: string, labelFrom: AccountRow | undefined): Bucket => {
    const a = accounts.get(account);
    if (a === undefined) throw new RepositoryValidationError(`Account ${account} is not in the chart.`);
    const section = sectionOf(a);
    const isTax = a.role === "INPUT_GST" || a.role === "OUTPUT_GST";
    const label = section === "OPERATING" ? operatingLabel(isTax && labelFrom !== undefined ? labelFrom : a) : a.name;
    const key = section === "OPERATING" ? `${section}|${label}` : `${section}|${a.code}`;
    let b = buckets.get(key);
    if (b === undefined) { b = { section, label, inflow: 0, outflow: 0 }; buckets.set(key, b); }
    return b;
  };
  const isTaxRole = (code: string): boolean => {
    const role = accounts.get(code)?.role;
    return role === "INPUT_GST" || role === "OUTPUT_GST";
  };

  for (const lines of byEntry.values()) {
    let cashNet = 0;
    for (const l of lines) if (cash.has(l.account)) cashNet += l.debit_paise - l.credit_paise;
    if (cashNet === 0) continue;
    const counterparts = lines.filter((l) => !cash.has(l.account));
    if (counterparts.length === 0) continue; // cash-only entry (transfer / deposit): not a flow
    const inflow = cashNet > 0;
    // The counterpart lines that sit opposite the cash: a receipt's credits, a payment's debits.
    let basis = counterparts.filter((l) => (inflow ? l.credit_paise > 0 : l.debit_paise > 0));
    if (basis.length === 0) basis = counterparts;
    const weights = basis.map((l) => Math.max(l.credit_paise, l.debit_paise));
    const shares = allocateProRata(Math.abs(cashNet), weights);
    let main: { code: string; amount: number } | undefined;
    for (const l of counterparts) {
      const amount = Math.max(l.credit_paise, l.debit_paise);
      if (!isTaxRole(l.account) && (main === undefined || amount > main.amount)) main = { code: l.account, amount };
    }
    const mainAccount = main === undefined ? undefined : accounts.get(main.code);
    basis.forEach((l, i) => {
      const share = shares[i] ?? 0;
      if (share === 0) return;
      const b = bucketFor(l.account, mainAccount);
      if (inflow) b.inflow += share;
      else b.outflow += share;
    });
  }

  const make = (section: CashFlowSection): { lines: CashFlowLine[]; totals: CashFlowTotals } => {
    const list = [...buckets.values()].filter((b) => b.section === section);
    if (section === "OPERATING") {
      const order = ["Cash received from customers", "Cash paid to suppliers", "Cash paid for expenses", "Other income received", "Other operating"];
      list.sort((x, y) => order.indexOf(x.label) - order.indexOf(y.label));
    }
    const lines = list.map((b) => ({ label: b.label, inflowPaise: b.inflow, outflowPaise: b.outflow, netPaise: b.inflow - b.outflow }));
    const inflowPaise = lines.reduce((t, l) => t + l.inflowPaise, 0);
    const outflowPaise = lines.reduce((t, l) => t + l.outflowPaise, 0);
    return { lines, totals: { inflowPaise, outflowPaise, netPaise: inflowPaise - outflowPaise } };
  };
  const operating = make("OPERATING");
  const investing = make("INVESTING");
  const financing = make("FINANCING");
  const netChangePaise = operating.totals.netPaise + investing.totals.netPaise + financing.totals.netPaise;
  const closingCashPaise = openingCashPaise + netChangePaise;

  return {
    from: filter.from ?? null,
    to: filter.to ?? null,
    openingCashPaise,
    sections: { operating: operating.lines, investing: investing.lines, financing: financing.lines },
    totals: { operating: operating.totals, investing: investing.totals, financing: financing.totals },
    netChangePaise,
    closingCashPaise,
    tie: { closingFromLedgerPaise, ok: closingCashPaise === closingFromLedgerPaise },
  };
}

/**
 * Sets (or clears, with null) the cash-flow section of a USER-created account. A system account
 * (company_id NULL) is fixed by the rule, and a cash account (role CASH / BANK) is cash itself, so
 * both are refused. Audited.
 */
export function setCashFlowSection(db: Database.Database, code: string, section: CashFlowSection | null): void {
  if (section !== null && !CASH_FLOW_SECTIONS.includes(section)) {
    throw new RepositoryValidationError("The section must be OPERATING, INVESTING or FINANCING.");
  }
  const account = db
    .prepare("SELECT code, company_id, role, cash_flow_section FROM chart_accounts WHERE code = ?")
    .get(code) as { code: string; company_id: string | null; role: string | null; cash_flow_section: string | null } | undefined;
  if (account === undefined) throw new RepositoryValidationError(`Account ${code} was not found.`);
  if (account.company_id === null) {
    throw new RepositoryValidationError(`${code} is a system account: its cash-flow section is fixed and cannot be changed.`);
  }
  if (cashAccountCodes(db).has(code)) {
    throw new RepositoryValidationError(`${code} is a cash account: it is the cash itself, so it has no cash-flow section.`);
  }
  db.transaction(() => {
    db.prepare("UPDATE chart_accounts SET cash_flow_section = ?, updated_at = ? WHERE code = ?").run(section, new Date().toISOString(), code);
    appendAuditEvent(db, {
      action: "CASH_FLOW_SECTION_SET",
      entityId: code,
      entityType: "chart_account",
      companyId: account.company_id as string,
      occurredAt: new Date().toISOString(),
      beforeValues: { cashFlowSection: account.cash_flow_section },
      afterValues: { cashFlowSection: section },
    });
  })();
}
