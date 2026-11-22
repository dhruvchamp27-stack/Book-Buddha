import type Database from "better-sqlite3";

/**
 * Migration v30 body (S17, Cash Flow Statement, direct method): one nullable column on
 * `chart_accounts`, `cash_flow_section` (OPERATING | INVESTING | FINANCING). NULL means "derive":
 * see `sectionOf` in cash-flow.ts.
 *
 * ADDITIVE ONLY and IDEMPOTENT. It is `ALTER TABLE ... ADD COLUMN`, deliberately NOT a rebuild of
 * chart_accounts: a rebuild drops the table's triggers (chart_accounts_no_delete / _no_reclass)
 * and would have to replay them. The reclass trigger fires only on UPDATE OF code, type, role, so
 * writing this column is allowed. Nothing is backfilled and no existing row changes.
 *
 * NOT registered here: `migrations.ts` owns version numbers (see the other *-schema.ts files).
 */
export const CASH_FLOW_SECTIONS = ["OPERATING", "INVESTING", "FINANCING"] as const;
export type CashFlowSection = (typeof CASH_FLOW_SECTIONS)[number];

export function applyCashFlowSectionSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(chart_accounts)").all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === "cash_flow_section")) return;
  db.exec(
    `ALTER TABLE chart_accounts ADD COLUMN cash_flow_section TEXT NULL
       CHECK (cash_flow_section IN (${CASH_FLOW_SECTIONS.map((s) => `'${s}'`).join(", ")}))`,
  );
}
