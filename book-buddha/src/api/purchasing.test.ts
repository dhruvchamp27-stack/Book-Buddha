import { describe, expect, it } from "vitest";
import { buildApi } from "./server.js";
import { AccountingRepository } from "../database/repository.js";

describe("purchasing & expenses API", () => {
  it("runs suppliers, bills, payments, expenses and reports end to end", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    const post = async (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });
    try {
      const companyId = (await post("/companies", { name: "Co" })).json<{ id: string }>().id;
      const businessId = (await post("/businesses", { companyId, name: "Books" })).json<{ id: string }>().id;
      const itemId = (await post("/items", { companyId, name: "Atlas", unit: "each", trackStock: true })).json<{ id: string }>().id;

      // Suppliers
      const created = await post("/suppliers", { companyId, name: "Paper House", classification: "Company", phone: "999" });
      expect(created.statusCode).toBe(201);
      const supplierId = created.json<{ id: string }>().id;
      expect((await post("/suppliers", { companyId, name: "Bad", classification: "NOPE" })).statusCode).toBe(400);
      expect((await app.inject({ method: "PATCH", url: `/suppliers/${supplierId}`, payload: { gstin: "07AAAAA0000A1Z5", phone: null } })).statusCode).toBe(200);
      const suppliers = (await app.inject({ method: "GET", url: `/suppliers?companyId=${companyId}` })).json<Array<Record<string, unknown>>>();
      expect(suppliers[0]).toMatchObject({ id: supplierId, gstin: "07AAAAA0000A1Z5", phone: null, active: true });
      expect((await post(`/suppliers/${supplierId}/active`, { active: false })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/suppliers?companyId=${companyId}&activeOnly=true` })).json<unknown[]>()).toHaveLength(0);
      await post(`/suppliers/${supplierId}/active`, { active: true });

      // Purchase bill: draft -> finalize
      const draft = await post("/purchase-bills", {
        businessId, supplierId, number: "PB-1", billDate: "2026-10-01", paymentAccount: "PAYABLES",
        taxType: "IGST", taxRateBasisPoints: 1800,
        lines: [{ itemId, description: "Atlas", quantity: 10, unitPricePaise: 1000 }],
      });
      expect(draft.statusCode).toBe(201);
      const bill = draft.json<{ id: string; totalPaise: number; status: string }>();
      expect(bill).toMatchObject({ status: "DRAFT", totalPaise: 11800 });
      expect((await post("/purchase-bills", { businessId, supplierId, number: "X", paymentAccount: "CASH", lines: [] })).statusCode).toBe(400);
      expect((await post("/purchase-bills", {
        businessId, supplierId, number: "X", paymentAccount: "CASH", taxType: "NONE", taxRateBasisPoints: 500,
        lines: [{ description: "x", quantity: 1, unitPricePaise: 1 }],
      })).statusCode).toBe(400);

      const finalized = await post(`/purchase-bills/${bill.id}/finalize`, {});
      expect(finalized.statusCode).toBe(200);
      expect(finalized.json<{ journalEntry: { lines: unknown[] } }>().journalEntry.lines).toEqual([
        { account: "INVENTORY", debitPaise: 10000, creditPaise: 0 },
        { account: "INPUT_IGST", debitPaise: 1800, creditPaise: 0 },
        { account: "PAYABLES", debitPaise: 0, creditPaise: 11800 },
      ]);
      expect((await post(`/purchase-bills/${bill.id}/finalize`, {})).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: `/purchase-bills/${bill.id}` })).json<{ status: string }>().status).toBe("FINALIZED");
      expect((await app.inject({ method: "GET", url: `/purchase-bills?supplierId=${supplierId}&status=FINALIZED` })).json<unknown[]>()).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/purchase-bills?status=BOGUS" })).statusCode).toBe(400);

      // Payments
      const payment = await post("/supplier-payments", { billId: bill.id, amountPaise: 3800 });
      expect(payment.statusCode).toBe(201);
      expect((await post("/supplier-payments", { billId: bill.id, amountPaise: 99999 })).statusCode).toBe(400);
      expect((await post("/supplier-payments", { amountPaise: 100 })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: `/supplier-payments?billId=${bill.id}` })).json<unknown[]>()).toHaveLength(1);

      const payables = (await app.inject({ method: "GET", url: "/reports/payables" })).json<Array<Record<string, unknown>>>();
      expect(payables).toMatchObject([{ documentId: bill.id, totalPaise: 11800, paidPaise: 3800, outstandingPaise: 8000 }]);
      const statement = (await app.inject({ method: "GET", url: `/reports/supplier-statement?supplierId=${supplierId}` })).json<{ closingBalancePaise: number; rows: unknown[] }>();
      expect(statement).toMatchObject({ closingBalancePaise: 8000 });
      expect(statement.rows).toHaveLength(2);
      expect((await app.inject({ method: "GET", url: "/reports/supplier-statement" })).statusCode).toBe(400);

      // Cancel refused while payments exist.
      expect((await post(`/purchase-bills/${bill.id}/cancel`, {})).statusCode).toBe(400);

      // Expenses
      const categoryId = (await post("/expense-categories", { companyId, name: "Rent" })).json<{ id: string }>().id;
      expect((await post("/expense-categories", { companyId, name: "RENT" })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: `/expense-categories?companyId=${companyId}` })).json<unknown[]>()).toHaveLength(1);
      const expense = await post("/expenses", {
        businessId, categoryId, number: "EX-1", expenseDate: "2026-10-02", description: "Stall rent",
        amountPaise: 5000, paymentAccount: "CASH",
      });
      expect(expense.statusCode).toBe(201);
      const expenseId = expense.json<{ id: string }>().id;
      expect((await post("/expenses", { businessId, number: "EX-2", description: "x", amountPaise: 100, paymentAccount: "PAYABLES" })).statusCode).toBe(400);
      expect((await post(`/expenses/${expenseId}/finalize`, {})).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/expenses?businessId=${businessId}&status=FINALIZED` })).json<unknown[]>()).toHaveLength(1);
      const cancelled = await post(`/expenses/${expenseId}/cancel`, {});
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json<{ reversalEntry: { isReversal: boolean } }>().reversalEntry.isReversal).toBe(true);
      expect((await app.inject({ method: "GET", url: `/expenses/${expenseId}` })).json<{ status: string }>().status).toBe("CANCELLED");

      // Reports reflect the new accounts.
      const trial = (await app.inject({ method: "GET", url: "/reports/trial-balance" })).json<Array<{ account: string; debitPaise: number; creditPaise: number }>>();
      const get = (account: string) => trial.find((row) => row.account === account);
      expect(get("INVENTORY")).toMatchObject({ debitPaise: 10000, creditPaise: 0 });
      expect(get("INPUT_IGST")).toMatchObject({ debitPaise: 1800 });
      expect(get("PAYABLES")).toMatchObject({ debitPaise: 3800, creditPaise: 11800 });
      expect(get("EXPENSE")).toMatchObject({ debitPaise: 5000, creditPaise: 5000 });
      const sheet = (await app.inject({ method: "GET", url: "/reports/balance-sheet" })).json<{ totalAssetsPaise: number; totalLiabilitiesPaise: number; totalEquityPaise: number }>();
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("cancels a bill via the API and refuses unknown ids", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    const post = async (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });
    try {
      const companyId = (await post("/companies", { name: "Co" })).json<{ id: string }>().id;
      const businessId = (await post("/businesses", { companyId, name: "Books" })).json<{ id: string }>().id;
      const supplierId = (await post("/suppliers", { companyId, name: "S" })).json<{ id: string }>().id;
      const bill = (await post("/purchase-bills", {
        businessId, supplierId, number: "PB", billDate: "2026-10-01", paymentAccount: "CASH",
        lines: [{ description: "Misc", quantity: 1, unitPricePaise: 700 }],
      })).json<{ id: string }>();
      await post(`/purchase-bills/${bill.id}/finalize`, {});
      expect((await post(`/purchase-bills/${bill.id}/cancel`, {})).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/reports/trial-balance" })).json<Array<{ account: string; debitPaise: number; creditPaise: number }>>()
        .every((row) => row.debitPaise === row.creditPaise)).toBe(true);
      expect((await post("/purchase-bills/nope/finalize", {})).statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
