import type Database from "better-sqlite3";

/**
 * Migration v9 body (wired by the orchestrator in migrations.ts): a REAL chart of accounts.
 *
 * Decision S2-1 supersedes S1-4: the fixed 13-code SQL `CHECK` on journal_lines.account
 * contradicts the approved spec, which requires user-created accounts in five places. A CHECK
 * value cannot be added at runtime, so "add/rename anytime" is impossible by construction.
 *
 * Shape:
 *  1. A `chart_accounts` table. `code` is the PRIMARY KEY, so it is globally unique and can be
 *     the parent of a foreign key. System accounts are seeded ONCE with company_id NULL (the
 *     deliberate departure from ARCHITECTURE_AND_DATABASE.md:299 recorded in decisions.md).
 *  2. journal_lines is rebuilt to DROP the account CHECK and gain an FK to chart_accounts(code),
 *     plus a BEFORE INSERT trigger. The trigger is what the CHECK really bought us: it fires on
 *     every connection whatever `PRAGMA foreign_keys` says.
 *  3. Reports group by `type` through a JOIN (commit b), so "a new code is silently dropped and
 *     unbalances the sheet" stops being possible.
 *
 * `journal_lines.account` STAYS the TEXT code: no data rewrite, every existing query keeps working.
 *
 * MUST run with transactional:false - it manages its own transaction because PRAGMA foreign_keys
 * is a no-op inside one, and the rebuild needs foreign keys OFF. The closing `foreign_key_check`
 * is load-bearing twice over: it proves the rebuild left no dangling journal_entry_id, AND that
 * every account code already in the ledger maps to a seeded account.
 */

/** The five classes. Normal side, cash-view inclusion and cash-flow bucket all DERIVE from these. */
export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * What `type` cannot express. A role is the job an account does in the engine, and only system
 * accounts have one: a user account can never be a control account (S2-1). Two readers need it:
 * `gstOnSalesPaise` (OUTPUT_GST) and the cash view, which excludes the money and settlement
 * accounts - CASH, BANK, RECEIVABLES, PAYABLES - and includes everything else.
 */
/**
 * FROZEN AT v9 - do not add to this list, ever. `applyChartOfAccountsSchema` builds the role
 * CHECK from it, and it reads the constant LIVE. Widening it would give every fresh database the
 * newer CHECK at v9 while an already-migrated one kept the old CHECK, so a later migration's
 * "has it been widened yet?" guard would be true on fresh databases and false only on the
 * owner's. The rebuild would then run for the first time on real data, having never once run in
 * a test. This is exactly the trap the ACCOUNTS constant set for migration v4. New roles go in
 * ACCOUNT_ROLES below and are applied by the migration that widens the CHECK.
 */
const V9_ACCOUNT_ROLES = ["CASH", "BANK", "RECEIVABLES", "PAYABLES", "INVENTORY", "OUTPUT_GST", "INPUT_GST"] as const;

/** The live list: what the role CHECK should be TODAY. v11 widened it to carry CUSTOMER_CREDITS. */
export const ACCOUNT_ROLES = [...V9_ACCOUNT_ROLES, "CUSTOMER_CREDITS"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/**
 * Roles whose lines are settlement, not performance: excluded from the cash view. CUSTOMER_CREDITS
 * belongs here for the same reason RECEIVABLES does - it records who owes whom, not what was
 * earned. Leaving it out would also corrupt a credit note's own tax-inclusive value in the walk,
 * which is measured as the negated sum of the note's NON-settlement lines.
 */
export const SETTLEMENT_ROLES = ["CASH", "BANK", "RECEIVABLES", "PAYABLES", "CUSTOMER_CREDITS"] as const;

export interface SeedAccount {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly role?: AccountRole;
}

/**
 * The 13 codes already in use plus the 9 the owner approved this session (S2-1).
 * UNCATEGORIZED is seeded as an EXPENSE: it is the landing account for an uncategorised bank
 * debit, and the overwhelming majority of those are costs. ASSUMPTION - flagged to the owner.
 */
export const V9_SEED_ACCOUNTS: readonly SeedAccount[] = [
  // Assets
  { code: "CASH", name: "Cash", type: "ASSET", role: "CASH" },
  { code: "BANK", name: "Bank", type: "ASSET", role: "BANK" },
  { code: "RECEIVABLES", name: "Accounts Receivable", type: "ASSET", role: "RECEIVABLES" },
  { code: "INVENTORY", name: "Inventory", type: "ASSET", role: "INVENTORY" },
  { code: "INPUT_CGST", name: "Input CGST", type: "ASSET", role: "INPUT_GST" },
  { code: "INPUT_SGST", name: "Input SGST", type: "ASSET", role: "INPUT_GST" },
  { code: "INPUT_IGST", name: "Input IGST", type: "ASSET", role: "INPUT_GST" },
  { code: "OTHER_ASSETS", name: "Other Assets", type: "ASSET" },
  // Liabilities
  { code: "PAYABLES", name: "Accounts Payable", type: "LIABILITY", role: "PAYABLES" },
  { code: "OUTPUT_CGST", name: "Output CGST", type: "LIABILITY", role: "OUTPUT_GST" },
  { code: "OUTPUT_SGST", name: "Output SGST", type: "LIABILITY", role: "OUTPUT_GST" },
  { code: "OUTPUT_IGST", name: "Output IGST", type: "LIABILITY", role: "OUTPUT_GST" },
  { code: "UNEARNED_REVENUE", name: "Unearned Revenue", type: "LIABILITY" },
  { code: "LOANS", name: "Loans", type: "LIABILITY" },
  { code: "OTHER_LIABILITIES", name: "Other Liabilities", type: "LIABILITY" },
  // Equity
  { code: "OPENING_BALANCE_EQUITY", name: "Opening Balance Equity", type: "EQUITY" },
  { code: "CAPITAL", name: "Capital", type: "EQUITY" },
  // Income
  { code: "SALES", name: "Sales", type: "INCOME" },
  { code: "OTHER_INCOME", name: "Other Income", type: "INCOME" },
  // Expenses
  { code: "COGS", name: "Cost of Goods Sold", type: "EXPENSE" },
  { code: "EXPENSE", name: "Expenses", type: "EXPENSE" },
  { code: "UNCATEGORIZED", name: "Uncategorised", type: "EXPENSE" },
];

/**
 * FROZEN AT v11 - do not add to this list, ever. It is what v11 (`applyCustomerCreditsSchema`)
 * seeds: the frozen v9 list with UNCATEGORIZED renamed, plus the two accounts v11 added.
 *
 * - CUSTOMER_CREDITS - money owed BACK to a customer, created when a credit note is worth more
 *   than the invoice still owes (S4-1). It is a liability, and it is discharged either by
 *   refunding cash or by setting the credit against the customer's next invoice (S4-5).
 * - UNCATEGORIZED_INCOME - the owner's S4-4 ruling. UNCATEGORIZED keeps its code (codes are
 *   immutable under S2-1) and becomes explicitly the EXPENSE side; an uncategorised bank RECEIPT
 *   now has somewhere of its own to land instead of reading as a negative expense.
 *
 * WHY FROZEN: v11 used to loop over the live SEED_ACCOUNTS. Appending an account there would hand
 * it to every FRESH database at v11, so the migration that is meant to add it would never run its
 * seeding in any test, and its insert would execute for the first time on the owner's real
 * database. This is the same trap V9_ACCOUNT_ROLES / V9_SEED_ACCOUNTS were frozen to prevent.
 * Accounts added later belong in a V<n>_ADDED_ACCOUNTS list seeded by the migration that adds them.
 */
export const V11_SEED_ACCOUNTS: readonly SeedAccount[] = [
  ...V9_SEED_ACCOUNTS.map((a) => (a.code === "UNCATEGORIZED" ? { ...a, name: "Uncategorised Expense" } : a)),
  { code: "CUSTOMER_CREDITS", name: "Customer Credits", type: "LIABILITY", role: "CUSTOMER_CREDITS" },
  { code: "UNCATEGORIZED_INCOME", name: "Uncategorised Income", type: "INCOME" },
];

/**
 * FROZEN AT v13 - the accounts v13 (`applyOpeningBalancesSchema`) seeds, and ONLY those. v13 reads
 * this list, never the live one, for the reason given on V11_SEED_ACCOUNTS.
 *
 * - STOCK_ADJUSTMENT - S5-3: a mid-year stock ADJUSTMENT posts against this EXPENSE account, while
 *   OPENING stock posts Dr INVENTORY / Cr OPENING_BALANCE_EQUITY. EXPENSE with NO role, so the
 *   role CHECK needs no widening and v13 needs no table rebuild. This slice only seeds the
 *   account; the stock posting itself is a later slice.
 */
export const V13_ADDED_ACCOUNTS: readonly SeedAccount[] = [
  { code: "STOCK_ADJUSTMENT", name: "Stock Adjustment", type: "EXPENSE" },
];

/**
 * FROZEN AT v15 - the accounts v15 (`applyInterFairClearingSchema`) seeds, and ONLY those. v15 reads
 * this list, never the live one, for the reason given on V11_SEED_ACCOUNTS.
 *
 * - INTER_FAIR_CLEARING - S5-11: when a credit note raised at one fair is applied to an invoice at
 *   another (or tagged vs untagged), the application is posted as TWO single-fair entries that
 *   meet in this account, so CUSTOMER_CREDITS nets to zero inside the fair that created it. ASSET
 *   with NO role, so the role CHECK needs no widening and v15 needs no table rebuild. It nets to
 *   zero company-wide by construction; a non-zero company-wide balance would be a bug.
 */
export const V15_ADDED_ACCOUNTS: readonly SeedAccount[] = [
  { code: "INTER_FAIR_CLEARING", name: "Inter-fair Clearing", type: "ASSET" },
];

/**
 * FROZEN AT v18 - the accounts v18 (`applyBillDiscountSchema`) seeds, and ONLY those. v18 reads
 * this list, never the live one, for the reason given on V11_SEED_ACCOUNTS.
 *
 * R8 bill discount. A purchase bill gains a header-level discount and extra charge, mirroring the
 * invoice. They could NOT be netted into the goods cost the way the invoice nets its discount
 * into SALES, for two reasons found while building it:
 *
 *  - A stock layer stores an integer `unit_cost_paise`, so a discount pushed into inventory cost
 *    cannot be made exact: quantity x unit cost will not hit an arbitrary discounted total, and
 *    the residue would put the INVENTORY ledger permanently out of step with the stock-layer
 *    value. Keeping INVENTORY at the full line cost keeps those two equal to the paise.
 *  - On a bill of nothing but stock lines there is no expense debit for a discount to reduce, so
 *    netting it would drive EXPENSE to a CREDIT balance - the same shape as the SALES-in-debit
 *    hole closed in session 8.
 *
 * So each gets an account of its own, which also shows the owner the discount he won as a line he
 * can actually see:
 *  - PURCHASE_DISCOUNT - "Discount Received". INCOME, the ordinary Indian treatment of a supplier
 *    discount, and the side that keeps the entry balanced without any account going negative.
 *  - PURCHASE_EXTRA_CHARGES - freight, packing and the like added by the supplier on the bill
 *    itself. EXPENSE.
 * Both are plain INCOME/EXPENSE with NO role, so the role CHECK needs no widening and v18 rebuilds
 * no table. The owner can rename either in the chart; the CODES are immutable under S2-1.
 *
 * TRADE-OFF HE SHOULD KNOW ABOUT, written here because nothing else records it: a discount on a
 * bill of stock does NOT reduce the carrying value of that stock. Strict AS 2 would deduct a trade
 * discount from inventory cost. Doing that needs the stock layer to carry a total cost rather than
 * a unit cost, which is a change to the FIFO core and not a reporting slice. Net profit is the
 * same either way; what differs is timing - the discount lands in the month of the bill instead of
 * the month the goods are sold - and the balance-sheet value of unsold stock.
 */
export const V18_ADDED_ACCOUNTS: readonly SeedAccount[] = [
  { code: "PURCHASE_DISCOUNT", name: "Discount Received", type: "INCOME" },
  { code: "PURCHASE_EXTRA_CHARGES", name: "Purchase Extra Charges", type: "EXPENSE" },
];

/** The live chart: what should exist TODAY. The frozen lists above, in migration order. */
/**
 * FROZEN AT v19 - R8 purchase returns. Read by `applyPurchaseReturnsSchema` and nothing else; the
 * reason a migration seeds its OWN frozen list is on V11_SEED_ACCOUNTS.
 *
 * SUPPLIER_CREDITS is the mirror of CUSTOMER_CREDITS, and sits on the opposite side of the books.
 * CUSTOMER_CREDITS is a LIABILITY - a credit note we have not yet refunded is money we owe the
 * customer. A purchase return the supplier has not yet refunded is money the supplier owes US, so
 * SUPPLIER_CREDITS is an ASSET.
 *
 * It exists for the same reason CUSTOMER_CREDITS does: returning goods on a bill that is already
 * PAID would otherwise drive PAYABLES into a debit balance - a negative liability, the shape this
 * project has now had to close three times. The return debits PAYABLES only as far as the bill is
 * still open; whatever exceeds that becomes a supplier credit, and PAYABLES stops at zero.
 */
export const V19_ADDED_ACCOUNTS: readonly SeedAccount[] = [
  { code: "SUPPLIER_CREDITS", name: "Supplier Credits Receivable", type: "ASSET" },
];

/**
 * FROZEN AT v21 - the account v21 (`applyCashRoundingSchema`) seeds, and ONLY that. v21 reads this
 * list, never the live one, for the reason given on V11_SEED_ACCOUNTS.
 *
 * - ROUNDING - the cash view recognises each line of a document as round(line x paid / total), each
 *   line rounded on its own, so the shares need not sum to the cash that moved (Rs 118 invoice
 *   part-paid Rs 50 recognises 4,999 paise of the 5,000 collected). The difference is recognised
 *   here so the cash view ties to the cash, to the paise. ONE account, INCOME, and the amount on
 *   it is SIGNED: a negative line is correct and is never split into an income and an expense
 *   side. It exists only in the derived cash view; nothing is ever posted to it.
 */
export const V21_ADDED_ACCOUNTS: readonly SeedAccount[] = [
  { code: "ROUNDING", name: "Rounding", type: "INCOME" },
];

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  ...V11_SEED_ACCOUNTS, ...V13_ADDED_ACCOUNTS, ...V15_ADDED_ACCOUNTS, ...V18_ADDED_ACCOUNTS,
  ...V19_ADDED_ACCOUNTS, ...V21_ADDED_ACCOUNTS,
];

export const CHART_ACCOUNTS_TRIGGER_NAMES = [
  "chart_accounts_no_delete",
  "chart_accounts_no_reclass",
  "journal_lines_account_exists",
] as const;

type TriggerRow = { name: string; sql: string };

const tableSql = (db: Database.Database, name: string): string | undefined =>
  (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string } | undefined)?.sql;

/** The identity of journal_lines that the rebuild must not change. */
type LinesFingerprint = {
  triggers: string;
  indexes: string;
  rows: number;
  debits: number;
  credits: number;
  maxId: number | null;
};

function fingerprint(db: Database.Database): LinesFingerprint {
  const objects = (type: "trigger" | "index") =>
    JSON.stringify(
      (db
        .prepare(
          `SELECT name, sql FROM sqlite_master WHERE type = ? AND tbl_name = 'journal_lines' AND sql IS NOT NULL ORDER BY name`,
        )
        .all(type) as TriggerRow[]).map((r) => [r.name, r.sql]),
    );
  const totals = db
    .prepare(
      "SELECT COUNT(*) AS rows, COALESCE(SUM(debit_paise), 0) AS debits, COALESCE(SUM(credit_paise), 0) AS credits, MAX(id) AS maxId FROM journal_lines",
    )
    .get() as { rows: number; debits: number; credits: number; maxId: number | null };
  return { triggers: objects("trigger"), indexes: objects("index"), ...totals };
}

export function applyChartOfAccountsSchema(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      createTable(db);
      seed(db);

      const linesSql = tableSql(db, "journal_lines");
      // Guard on what this migration ADDS, never on the old CHECK being absent: after the rebuild
      // the old account list is gone from the SQL, so an "is the CHECK missing" guard would
      // re-run the rebuild forever.
      if (linesSql !== undefined && !linesSql.includes("REFERENCES chart_accounts")) {
        rebuildJournalLines(db);
      }

      installTriggers(db);

      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `Migration v9 left ${violations.length} foreign key violation(s) - an account code in the ledger has no chart_accounts row; rolled back.`,
        );
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function createTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chart_accounts (
      code TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN (${ACCOUNT_TYPES.map((t) => `'${t}'`).join(", ")})),
      role TEXT CHECK(role IN (${V9_ACCOUNT_ROLES.map((r) => `'${r}'`).join(", ")})),
      parent_code TEXT REFERENCES chart_accounts(code),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chart_accounts_type ON chart_accounts(type);
    CREATE INDEX IF NOT EXISTS idx_chart_accounts_company ON chart_accounts(company_id);
  `);
}

function seed(db: Database.Database): void {
  const now = new Date().toISOString();
  // OR IGNORE, never ON CONFLICT DO UPDATE: re-running must not touch an existing row (and the
  // no-reclass trigger below would refuse anyway). company_id is NULL - these are system accounts.
  const insert = db.prepare(
    "INSERT OR IGNORE INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
  );
  // The FROZEN v9 list: see V9_ACCOUNT_ROLES. Accounts added after v9 are seeded by the
  // migration that added them, so a fresh database and the owner's take the same path.
  for (const account of V9_SEED_ACCOUNTS) {
    insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
  }
}

function rebuildJournalLines(db: Database.Database): void {
  const before = fingerprint(db);
  // DROP TABLE drops that table's triggers AND indexes. Capture both and replay them; v4 only
  // replayed triggers because it hardcoded the indexes it then re-created.
  const replay = (type: "trigger" | "index") =>
    (db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = ? AND tbl_name = 'journal_lines' AND sql IS NOT NULL`)
      .all(type) as TriggerRow[]).map((r) => r.sql);
  const triggers = replay("trigger");
  const indexes = replay("index");

  db.exec(`
    CREATE TABLE journal_lines_v3 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account TEXT NOT NULL REFERENCES chart_accounts(code),
      debit_paise INTEGER NOT NULL CHECK(debit_paise >= 0),
      credit_paise INTEGER NOT NULL CHECK(credit_paise >= 0),
      CHECK((debit_paise = 0 AND credit_paise > 0) OR (debit_paise > 0 AND credit_paise = 0))
    );
    INSERT INTO journal_lines_v3 (id, journal_entry_id, account, debit_paise, credit_paise)
      SELECT id, journal_entry_id, account, debit_paise, credit_paise FROM journal_lines ORDER BY id;
    DROP TABLE journal_lines;
    ALTER TABLE journal_lines_v3 RENAME TO journal_lines;
  `);

  for (const sql of [...triggers, ...indexes]) db.exec(sql);

  const after = fingerprint(db);
  for (const key of ["triggers", "indexes", "rows", "debits", "credits", "maxId"] as const) {
    if (before[key] !== after[key]) {
      throw new Error(
        `Migration v9 changed journal_lines.${key} during the rebuild (before ${String(before[key])}, after ${String(after[key])}); rolled back.`,
      );
    }
  }
}

function installTriggers(db: Database.Database): void {
  const abort = (msg: string) => `SELECT RAISE(ABORT, '${msg}');`;
  for (const name of CHART_ACCOUNTS_TRIGGER_NAMES) db.exec(`DROP TRIGGER IF EXISTS ${name}`);

  // EXISTENCE ONLY, deliberately not `active`. Cancelling an old invoice posts a reversal that
  // may touch an account since deactivated; blocking that here would break cancel-with-reversal.
  // The `active` rule belongs in the door (ledger.ts), which can exempt a reversal.
  db.exec(`
    CREATE TRIGGER journal_lines_account_exists BEFORE INSERT ON journal_lines
    WHEN NOT EXISTS (SELECT 1 FROM chart_accounts WHERE code = NEW.account)
    BEGIN ${abort("journal_lines.account must be a code that exists in chart_accounts")} END;
  `);
  db.exec(`
    CREATE TRIGGER chart_accounts_no_delete BEFORE DELETE ON chart_accounts
    BEGIN ${abort("chart_accounts rows are permanent: deactivate an account, never delete it")} END;
  `);
  // Re-classing an account silently re-states every figure ever posted to it, in every past
  // period. Renaming (name) and deactivating (active) stay allowed - that is the spec's promise.
  db.exec(`
    CREATE TRIGGER chart_accounts_no_reclass BEFORE UPDATE OF code, type, role ON chart_accounts
    BEGIN ${abort("an account code, class or role can never change: posted history would be re-classified")} END;
  `);
}
