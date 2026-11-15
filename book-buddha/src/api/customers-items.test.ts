import { describe, expect, it } from "vitest";
import { buildApi } from "./server.js";
import { AccountingRepository } from "../database/repository.js";

describe("customers / items / inventory API", () => {
  it("creates numbered customers, patches, finds duplicates, toggles active and deletes", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Co" } })).json<{ id: string }>().id;
      const created = await app.inject({
        method: "POST", url: "/customers",
        payload: { companyId, name: "Greenfield School", classification: "Trust", numberingCategory: "SCH", phone: "999" },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<{ id: string }>().id;

      const bad = await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "X", numberingCategory: "NOPE" } });
      expect(bad.statusCode).toBe(400);

      const patched = await app.inject({ method: "PATCH", url: `/customers/${id}`, payload: { gstin: "07AAAAA0000A1Z5", phone: null } });
      expect(patched.statusCode).toBe(200);

      const list = (await app.inject({ method: "GET", url: `/customers?companyId=${companyId}` })).json<Array<{ id: string; customerNumber: string; gstin: string; phone: string | null }>>();
      expect(list[0]).toMatchObject({ id, customerNumber: "SCH0001", gstin: "07AAAAA0000A1Z5", phone: null });

      const dups = (await app.inject({ method: "GET", url: `/customers/duplicates?companyId=${companyId}&name=greenfield%20school` })).json<unknown[]>();
      expect(dups).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/customers/duplicates?name=x" })).statusCode).toBe(400);

      expect((await app.inject({ method: "POST", url: `/customers/${id}/active`, payload: { active: false } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/customers?companyId=${companyId}&activeOnly=true` })).json<unknown[]>()).toHaveLength(0);

      expect((await app.inject({ method: "DELETE", url: `/customers/${id}` })).statusCode).toBe(200);
      expect((await app.inject({ method: "DELETE", url: `/customers/${id}` })).statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("enriches items and serves the inventory reports", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Co" } })).json<{ id: string }>().id;
      const itemId = (await app.inject({
        method: "POST", url: "/items",
        payload: { companyId, name: "Atlas", unit: "each", trackStock: true, sellingPricePaise: 500, reorderThreshold: 10 },
      })).json<{ id: string }>().id;
      expect((await app.inject({ method: "POST", url: "/items", payload: { companyId, name: "Bad", unit: "each", mrpPaise: -1 } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PATCH", url: `/items/${itemId}`, payload: { costPricePaise: 300 } })).statusCode).toBe(200);
      await app.inject({ method: "POST", url: "/inventory/movements", payload: { itemId, quantity: 4, unitCostPaise: 300, movementType: "OPENING" } });

      const items = (await app.inject({ method: "GET", url: `/items?companyId=${companyId}` })).json<Array<Record<string, unknown>>>();
      expect(items[0]).toMatchObject({ sellingPricePaise: 500, costPricePaise: 300, reorderThreshold: 10, active: true });

      const valuation = (await app.inject({ method: "GET", url: "/reports/inventory-valuation" })).json<Array<Record<string, unknown>>>();
      expect(valuation[0]).toMatchObject({ itemId, quantity: 4, valuePaise: 1200 });
      const low = (await app.inject({ method: "GET", url: "/reports/low-stock" })).json<Array<Record<string, unknown>>>();
      expect(low[0]).toMatchObject({ itemId, quantity: 4, reorderThreshold: 10 });
      expect((await app.inject({ method: "GET", url: "/reports/sales-by-item" })).json<unknown[]>()).toEqual([]);

      expect((await app.inject({ method: "POST", url: `/items/${itemId}/active`, payload: { active: false } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/items?companyId=${companyId}&activeOnly=true` })).json<unknown[]>()).toHaveLength(0);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
