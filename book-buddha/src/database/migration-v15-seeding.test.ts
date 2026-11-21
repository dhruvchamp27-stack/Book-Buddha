import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import { applyInterFairClearingSchema } from "./inter-fair-clearing-schema.js";
import { SEED_ACCOUNTS, V11_SEED_ACCOUNTS, V13_ADDED_ACCOUNTS, V15_ADDED_ACCOUNTS, V18_ADDED_ACCOUNTS, V19_ADDED_ACCOUNTS, V21_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * v15 adds INTER_FAIR_CLEARING (S5-11). Same trap as v13: if an earlier migration seeded from the
 * LIVE SEED_ACCOUNTS, every fresh database would get the account early and v15's own seeding would
 * never run in any test. These tests build to v14 so v15's seeding runs for real.
 *
 */
const at = (version: number) => migrations.filter((m) => m.version <= version);

type ChartRow = { code: string; company_id: string | null; name: string; type: string; role: string | null; parent_code: string | null; active: number; created_at: string; updated_at: string };
let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
});
afterEach(() => db.close());

const chart = (): ChartRow[] =>
  db.prepare("SELECT code, company_id, name, type, role, parent_code, active, created_at, updated_at FROM chart_accounts ORDER BY code").all() as ChartRow[];
const versions = (): number[] =>
  (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version);
const objectsSql = (type: "trigger" | "index"): unknown[] =>
  db.prepare("SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY name").all(type);

describe("the v15 seed list is frozen", () => {
  it("the live chart is the frozen lists in order, and the v13 and v11 lists did NOT gain INTER_FAIR_CLEARING", () => {
    expect(V15_ADDED_ACCOUNTS).toEqual([{ code: "INTER_FAIR_CLEARING", name: "Inter-fair Clearing", type: "ASSET" }]);
    expect(V15_ADDED_ACCOUNTS[0]?.role).toBeUndefined();
    expect(V13_ADDED_ACCOUNTS.map((a) => a.code)).toEqual(["STOCK_ADJUSTMENT"]);
    expect(V11_SEED_ACCOUNTS.map((a) => a.code)).not.toContain("INTER_FAIR_CLEARING");
    // Session 9: was a hardcoded ["STOCK_ADJUSTMENT", "INTER_FAIR_CLEARING"], which is a snapshot
    // of the chart as it stood at v15 and goes stale at every later migration that seeds an
    // account (v18 did). Stated as the concatenation instead, which is what this test is NAMED
    // for and is the guard that actually matters: an account appended to the live list without
    // being in SOME frozen list -- the v11 trap -- still fails here.
    expect(SEED_ACCOUNTS.map((a) => a.code).filter((c) => !V11_SEED_ACCOUNTS.some((a) => a.code === c))).toEqual([
      ...V13_ADDED_ACCOUNTS.map((a) => a.code),
      ...V15_ADDED_ACCOUNTS.map((a) => a.code),
      ...V18_ADDED_ACCOUNTS.map((a) => a.code),
      ...V19_ADDED_ACCOUNTS.map((a) => a.code),
      ...V21_ADDED_ACCOUNTS.map((a) => a.code),
    ]);
  });

  it("a database built to v14 does NOT have INTER_FAIR_CLEARING (nothing earlier may seed from the live list)", () => {
    runMigrations(db, at(14));
    expect(chart().map((r) => r.code)).not.toContain("INTER_FAIR_CLEARING");
  });
});

describe("v15 seeding from a database built to v14", () => {
  it("adds exactly INTER_FAIR_CLEARING (ASSET, no role), leaving every existing row byte-identical", () => {
    runMigrations(db, at(14));
    const before = chart();
    const triggersBefore = objectsSql("trigger");

    const ran = runMigrations(db, migrations);
    expect(ran).toEqual(migrations.filter((m) => m.version > 14).map((m) => m.version));

    const after = chart();
    for (const row of before) expect(after.find((r) => r.code === row.code)).toEqual(row);
    const added = after.filter((r) => !before.some((b) => b.code === r.code));
    // This runs the WHOLE tail of the chain, not v15 alone, so every migration after v14 that
    // seeds an account shows up here -- v18 added two. The assertion is still exact: the chart
    // gained precisely the frozen accounts of v15 and v18, and nothing else crept in.
    expect(added.map((r) => r.code).sort()).toEqual(
      [...V15_ADDED_ACCOUNTS, ...V18_ADDED_ACCOUNTS, ...V19_ADDED_ACCOUNTS, ...V21_ADDED_ACCOUNTS].map((a) => a.code).sort(),
    );
    expect(added.find((r) => r.code === "INTER_FAIR_CLEARING"))
      .toMatchObject({ name: "Inter-fair Clearing", type: "ASSET", role: null, company_id: null, parent_code: null, active: 1 });
    // chart_accounts was NOT rebuilt: v15 is additive (no role widened).
    // v24 (R12b) adds its own money_account guard triggers on other tables; every trigger that
    // existed before must still be here, byte-identical, and nothing else may have appeared.
    expect((objectsSql("trigger") as Array<{ name: string }>).filter((t) => !/^trg_\w+_money_account_(insert|update)$/.test(t.name))).toEqual(triggersBefore);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(versions()).toEqual(migrations.map((m) => m.version));
  });

  it("is a clean no-op the second time", () => {
    runMigrations(db, migrations);
    const rows = chart();
    expect(runMigrations(db, migrations)).toEqual([]);
    applyInterFairClearingSchema(db);
    expect(chart()).toEqual(rows);
  });

  it("throws and rolls back to v14 when INTER_FAIR_CLEARING is already taken under a different class", () => {
    runMigrations(db, at(14));
    db.exec(`
      INSERT INTO companies (id, name, created_at) VALUES ('co1', 'Owner Co', '2025-04-01T00:00:00.000Z');
      INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at)
        VALUES ('INTER_FAIR_CLEARING', 'co1', 'My Own Thing', 'INCOME', NULL, NULL, 1, '2025-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z');
    `);
    const rowsBefore = chart();
    const triggersBefore = objectsSql("trigger");
    const indexesBefore = objectsSql("index");

    expect(() => runMigrations(db, migrations)).toThrow(
      /found account INTER_FAIR_CLEARING as INCOME\/null but expected ASSET\/null.*rolled back/,
    );

    expect(versions()).toEqual(at(14).map((m) => m.version));
    expect(chart()).toEqual(rowsBefore);
    expect(objectsSql("trigger")).toEqual(triggersBefore);
    expect(objectsSql("index")).toEqual(indexesBefore);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
