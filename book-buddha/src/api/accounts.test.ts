import { describe, expect, it } from "vitest";
import { buildApi } from "./server.js";
import { AccountingRepository, type ChartAccount } from "../database/repository.js";
import { SEED_ACCOUNTS } from "../database/chart-accounts-schema.js";
import { verifyAuditChain } from "../database/audit-log.js";

/**
 * The backend the (deferred) account-creation page will sit on: decision S2-1's "pick a
 * ready-made set OR build your own; add/rename anytime".
 */
describe("chart of accounts API", () => {
  it("lists the seeded chart, creates, renames and deactivates a user account", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Co" } })).json<{ id: string }>().id;

      // The ready-made set is there from the first run - the chart is never empty.
      const seeded = (await app.inject({ method: "GET", url: `/accounts?companyId=${companyId}` })).json<ChartAccount[]>();
      expect(seeded).toHaveLength(SEED_ACCOUNTS.length);
      expect(seeded.every((a) => a.system)).toBe(true);
      expect(seeded.find((a) => a.code === "SALES")).toMatchObject({ type: "INCOME", active: true, companyId: null });

      const created = await app.inject({
        method: "POST", url: "/accounts",
        payload: { companyId, code: "stall_rent", name: "Stall rent", type: "EXPENSE" },
      });
      expect(created.statusCode).toBe(201);
      // A code is an identifier: normalised to upper case so it reads the same everywhere.
      expect(created.json<{ code: string }>().code).toBe("STALL_RENT");

      const withUser = (await app.inject({ method: "GET", url: `/accounts?companyId=${companyId}` })).json<ChartAccount[]>();
      expect(withUser.find((a) => a.code === "STALL_RENT")).toMatchObject({
        name: "Stall rent", type: "EXPENSE", role: null, companyId, active: true, system: false,
      });

      expect((await app.inject({ method: "PATCH", url: "/accounts/STALL_RENT", payload: { name: "Fair stall rent" } })).statusCode).toBe(200);
      expect(
        (await app.inject({ method: "GET", url: `/accounts?companyId=${companyId}` })).json<ChartAccount[]>()
          .find((a) => a.code === "STALL_RENT")?.name,
      ).toBe("Fair stall rent");

      expect((await app.inject({ method: "POST", url: "/accounts/STALL_RENT/active", payload: { active: false } })).statusCode).toBe(200);
      const active = (await app.inject({ method: "GET", url: `/accounts?companyId=${companyId}` })).json<ChartAccount[]>();
      expect(active.map((a) => a.code)).not.toContain("STALL_RENT");
      const all = (await app.inject({ method: "GET", url: `/accounts?companyId=${companyId}&includeInactive=true` })).json<ChartAccount[]>();
      expect(all.find((a) => a.code === "STALL_RENT")).toMatchObject({ active: false });

      // Every change is audited, and the hash chain still verifies afterwards.
      const actions = (repository.db.prepare("SELECT action, entity_id FROM audit_events WHERE entity_type = 'chart_account' ORDER BY id").all() as Array<{ action: string; entity_id: string }>);
      expect(actions.map((a) => a.action)).toEqual(["ACCOUNT_CREATED", "ACCOUNT_RENAMED", "ACCOUNT_DEACTIVATED"]);
      expect(actions.every((a) => a.entity_id === "STALL_RENT")).toBe(true);
      expect(verifyAuditChain(repository.db).ok).toBe(true);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("refuses the things that would corrupt the chart", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Co" } })).json<{ id: string }>().id;
      const post = (payload: unknown) => app.inject({ method: "POST", url: "/accounts", payload: payload as never });

      // A code that is not an identifier, or a class outside the five.
      expect((await post({ companyId, code: "has space", name: "X", type: "EXPENSE" })).statusCode).toBe(400);
      expect((await post({ companyId, code: "9LEADING", name: "X", type: "EXPENSE" })).statusCode).toBe(400);
      expect((await post({ companyId, code: "TAXES", name: "X", type: "TAX" })).statusCode).toBe(400);
      // A duplicate, including one that shadows a built-in account.
      expect((await post({ companyId, code: "SALES", name: "My sales", type: "INCOME" })).statusCode).toBe(400);
      // RETAINED_EARNINGS is derived by the Balance Sheet; an account of that code would double it.
      expect((await post({ companyId, code: "RETAINED_EARNINGS", name: "RE", type: "EQUITY" })).statusCode).toBe(400);
      // An unknown company, and an unknown parent.
      expect((await post({ companyId: "nope", code: "X_ACC", name: "X", type: "EXPENSE" })).statusCode).toBe(400);
      expect((await post({ companyId, code: "X_ACC", name: "X", type: "EXPENSE", parentCode: "NOPE" })).statusCode).toBe(400);
      // A sub-account must report in its parent's section, or the tree lies.
      expect((await post({ companyId, code: "X_ACC", name: "X", type: "INCOME", parentCode: "EXPENSE" })).statusCode).toBe(400);
      expect((await post({ companyId, code: "SUB_EXPENSE", name: "Sub", type: "EXPENSE", parentCode: "EXPENSE" })).statusCode).toBe(201);

      // A control account the engine posts to cannot be switched off.
      expect((await app.inject({ method: "POST", url: "/accounts/CASH/active", payload: { active: false } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/accounts/RECEIVABLES/active", payload: { active: false } })).statusCode).toBe(400);
      // Nor an account the ENGINE hardcodes but that has no role: deactivating SALES used to be
      // allowed and then broke every finalize and every credit note at the posting door.
      for (const code of ["SALES", "COGS", "EXPENSE", "INVENTORY", "PAYABLES", "OUTPUT_CGST", "INPUT_IGST"]) {
        expect(
          (await app.inject({ method: "POST", url: `/accounts/${code}/active`, payload: { active: false } })).statusCode,
          `${code} must not be deactivatable`,
        ).toBe(400);
      }
      // A system account the engine never posts to on its own MAY be retired - a company with no
      // loans need not see LOANS on the list.
      expect((await app.inject({ method: "POST", url: "/accounts/LOANS/active", payload: { active: false } })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/accounts/CAPITAL/active", payload: { active: false } })).statusCode).toBe(200);

      // Renaming an account that does not exist, and renaming to nothing.
      expect((await app.inject({ method: "PATCH", url: "/accounts/NOPE", payload: { name: "X" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PATCH", url: "/accounts/SALES", payload: { name: "  " } })).statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("keeps one company's accounts out of another's list", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const a = (await app.inject({ method: "POST", url: "/companies", payload: { name: "A" } })).json<{ id: string }>().id;
      const b = (await app.inject({ method: "POST", url: "/companies", payload: { name: "B" } })).json<{ id: string }>().id;
      await app.inject({ method: "POST", url: "/accounts", payload: { companyId: a, code: "A_ONLY", name: "A only", type: "EXPENSE" } });

      const forA = (await app.inject({ method: "GET", url: `/accounts?companyId=${a}` })).json<ChartAccount[]>().map((x) => x.code);
      const forB = (await app.inject({ method: "GET", url: `/accounts?companyId=${b}` })).json<ChartAccount[]>().map((x) => x.code);
      expect(forA).toContain("A_ONLY");
      expect(forB).not.toContain("A_ONLY");
      // Both still see the shared system accounts.
      expect(forB).toContain("SALES");
      // And a code is globally unique, so B cannot reuse it (the documented consequence of
      // seeding system accounts once, with the code as the primary key).
      expect((await app.inject({ method: "POST", url: "/accounts", payload: { companyId: b, code: "A_ONLY", name: "B's", type: "EXPENSE" } })).statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
