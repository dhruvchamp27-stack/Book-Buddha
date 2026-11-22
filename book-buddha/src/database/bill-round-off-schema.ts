import type Database from "better-sqlite3";

/**
 * Migration v35 body (I-Q6, confirmed by the owner 22 Nov): an OPTIONAL round-off on purchase bills
 * and expenses, so a bill can be made to match the total the supplier actually printed.
 *
 * His wording: optional, default zero, stored in whole paise, bills and expenses ONLY, kept separate
 * from the existing document totals, old posted documents unchanged, and no historical document ever
 * re-rounded.
 *
 * SIGNED, and capped below one rupee. Signed because a supplier's printed total can be either side of
 * the computed one, and a single signed column is how this codebase already treats ROUNDING and
 * ROUND_OFF - never an income side and an expense side. Capped by a CHECK at +/- 99 paise because
 * I-Q6 says "under Rs 1": the cap is the ruling, so the database enforces it rather than trusting
 * every future caller.
 *
 * UNLIKE invoices (I-Q5), this is NOT calculated. An invoice rounds itself to the nearest rupee; a
 * bill only carries what the owner types. Nothing here rounds anything.
 *
 * ADDITIVE ONLY and IDEMPOTENT: each ALTER is guarded by PRAGMA table_info. NOTHING IS BACKFILLED -
 * every existing bill and expense keeps 0 through the column DEFAULT, which is precisely "preserve old
 * posted documents unchanged". NOT registered here; `migrations.ts` owns version numbers.
 *
 * Bills and expenses store no total (both are computed on read, `repository.getPurchaseBill` and
 * `getExpense`), so there is no stored figure for this to drift against - which is why it needs no
 * equivalent of the invoice's `total_paise`.
 */
export const BILL_ROUND_OFF_TABLES = ["purchase_bills", "expenses"] as const;

export function applyBillRoundOffSchema(db: Database.Database): void {
  for (const table of BILL_ROUND_OFF_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "round_off_paise")) {
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN round_off_paise INTEGER NOT NULL DEFAULT 0 CHECK (round_off_paise > -100 AND round_off_paise < 100)`,
      );
    }
  }
}
