import { describe, expect, it } from "vitest";
import { buildApi } from "./server.js";
import { AccountingRepository } from "../database/repository.js";

describe("local API", () => {
  it("supports a validated invoice lifecycle", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyResponse = await app.inject({
        method: "POST",
        url: "/companies",
        payload: { name: "API Company" },
      });
      expect(companyResponse.statusCode).toBe(201);
      const companyId = companyResponse.json<{ id: string }>().id;

      const businessResponse = await app.inject({
        method: "POST",
        url: "/businesses",
        payload: { companyId, name: "API Business" },
      });
      const businessId = businessResponse.json<{ id: string }>().id;

      const customerResponse = await app.inject({
        method: "POST",
        url: "/customers",
        payload: { companyId, name: "API Customer" },
      });
      const customerId = customerResponse.json<{ id: string }>().id;
      const itemResponse = await app.inject({
        method: "POST",
        url: "/items",
        payload: { companyId, name: "API Book", unit: "each", trackStock: false },
      });
      const itemId = itemResponse.json<{ id: string }>().id;

      const invoiceResponse = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          businessId,
          customerId,
          paymentAccount: "CASH",
          lines: [{ itemId, description: "Book", quantity: 1, unitPricePaise: 10000 }],
        },
      });
      expect(invoiceResponse.statusCode).toBe(201);
      const invoiceId = invoiceResponse.json<{ id: string }>().id;
      expect(invoiceResponse.json<InvoiceResponse>().lines[0]?.itemId).toBe(itemId);

      const finalizeResponse = await app.inject({
        method: "POST",
        url: `/invoices/${invoiceId}/finalize`,
      });
      expect(finalizeResponse.statusCode).toBe(200);
      expect(finalizeResponse.json().journalEntry.lines).toHaveLength(2);

      const cancelResponse = await app.inject({
        method: "POST",
        url: `/invoices/${invoiceId}/cancel`,
      });
      expect(cancelResponse.statusCode).toBe(200);
      expect(cancelResponse.json().reversalEntry.isReversal).toBe(true);

      const profitAndLoss = await app.inject({
        method: "GET",
        url: "/reports/profit-and-loss",
      });
      expect(profitAndLoss.statusCode).toBe(200);
      expect(profitAndLoss.json<{ netProfitPaise: number }>().netProfitPaise).toBe(0);

      const balanceSheet = await app.inject({
        method: "GET",
        url: "/reports/balance-sheet",
      });
      expect(balanceSheet.statusCode).toBe(200);
      expect(balanceSheet.json<{ totalAssetsPaise: number }>().totalAssetsPaise).toBe(0);

      const generalLedger = await app.inject({
        method: "GET",
        url: "/reports/general-ledger",
      });
      expect(generalLedger.statusCode).toBe(200);
      expect(generalLedger.json<unknown[]>().length).toBe(4);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("returns a clear validation response", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/companies",
        payload: { name: "" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "Request validation failed.",
      });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("rejects invoice references from different companies", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyA = (await app.inject({
        method: "POST",
        url: "/companies",
        payload: { name: "Company A" },
      })).json<{ id: string }>().id;
      const companyB = (await app.inject({
        method: "POST",
        url: "/companies",
        payload: { name: "Company B" },
      })).json<{ id: string }>().id;
      const businessId = (await app.inject({
        method: "POST",
        url: "/businesses",
        payload: { companyId: companyA, name: "Business A" },
      })).json<{ id: string }>().id;
      const customerAId = (await app.inject({
        method: "POST",
        url: "/customers",
        payload: { companyId: companyA, name: "Customer A" },
      })).json<{ id: string }>().id;
      const customerId = (await app.inject({
        method: "POST",
        url: "/customers",
        payload: { companyId: companyB, name: "Customer B" },
      })).json<{ id: string }>().id;
      const itemId = (await app.inject({
        method: "POST",
        url: "/items",
        payload: { companyId: companyB, name: "Item B", unit: "each" },
      })).json<{ id: string }>().id;

      const response = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          businessId,
          customerId,
          paymentAccount: "CASH",
          lines: [{ itemId, description: "Item B", quantity: 1, unitPricePaise: 1000 }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invoice business and customer must belong to the same company.",
      });

      const itemResponse = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          businessId,
          customerId: customerAId,
          paymentAccount: "CASH",
          lines: [{ itemId, description: "Item B", quantity: 1, unitPricePaise: 1000 }],
        },
      });
      expect(itemResponse.statusCode).toBe(400);
      expect(itemResponse.json()).toEqual({
        error: "Invoice items must belong to the same company as the business.",
      });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("updates drafts but rejects edits after finalization", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = app
        ? (await app.inject({ method: "POST", url: "/companies", payload: { name: "Edit Company" } })).json<{ id: string }>().id
        : "";
      const businessId = (await app.inject({ method: "POST", url: "/businesses", payload: { companyId, name: "Edit Business" } })).json<{ id: string }>().id;
      const customerId = (await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "Edit Customer" } })).json<{ id: string }>().id;
      const created = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          businessId,
          customerId,
          paymentAccount: "CASH",
          lines: [{ description: "Original", quantity: 1, unitPricePaise: 1000 }],
        },
      });
      const invoiceId = created.json<{ id: string }>().id;
      const updated = await app.inject({
        method: "PUT",
        url: `/invoices/${invoiceId}`,
        payload: {
          businessId,
          customerId,
          paymentAccount: "CASH",
          lines: [{ description: "Updated", quantity: 2, unitPricePaise: 2500 }],
        },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json<InvoiceResponse>().lines[0]?.description).toBe("Updated");

      await app.inject({ method: "POST", url: `/invoices/${invoiceId}/finalize` });
      const rejected = await app.inject({
        method: "PUT",
        url: `/invoices/${invoiceId}`,
        payload: {
          businessId,
          customerId,
          paymentAccount: "CASH",
          lines: [{ description: "Not allowed", quantity: 1, unitPricePaise: 1000 }],
        },
      });
      expect(rejected.statusCode).toBe(500);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("records receivable payments and exposes ageing data", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Payment Company" } })).json<{ id: string }>().id;
      const businessId = (await app.inject({ method: "POST", url: "/businesses", payload: { companyId, name: "Payment Business" } })).json<{ id: string }>().id;
      const customerId = (await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "Payment Customer" } })).json<{ id: string }>().id;
      const created = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          businessId,
          customerId,
          paymentAccount: "RECEIVABLES",
          lines: [{ description: "Book", quantity: 1, unitPricePaise: 25000 }],
        },
      });
      const invoiceId = created.json<{ id: string }>().id;
      await app.inject({ method: "POST", url: `/invoices/${invoiceId}/finalize` });
      const payment = await app.inject({
        method: "POST",
        url: `/invoices/${invoiceId}/payments`,
        payload: { amountPaise: 10000 },
      });
      expect(payment.statusCode).toBe(201);
      expect(payment.json<{ amountPaise: number }>().amountPaise).toBe(10000);
      const receivables = await app.inject({ method: "GET", url: "/reports/receivables" });
      expect(receivables.json<Array<{ outstandingPaise: number }>>()[0]?.outstandingPaise).toBe(15000);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("creates fairs and reports finalized fair sales", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Fair API Company" } })).json<{ id: string }>().id;
      const businessId = (await app.inject({ method: "POST", url: "/businesses", payload: { companyId, name: "Fair API Business" } })).json<{ id: string }>().id;
      const customerId = (await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "Fair Host" } })).json<{ id: string }>().id;
      const fairId = (await app.inject({
        method: "POST",
        url: "/fairs",
        payload: { companyId, hostCustomerId: customerId, name: "Spring Fair" },
      })).json<{ id: string }>().id;
      const invoiceId = (await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          businessId,
          customerId,
          fairId,
          buyerName: "Visitor",
          buyerContact: "visitor@example.test",
          paymentAccount: "CASH",
          lines: [{ description: "Book", quantity: 2, unitPricePaise: 1500 }],
        },
      })).json<{ id: string }>().id;
      await app.inject({ method: "POST", url: `/invoices/${invoiceId}/finalize` });
      const report = await app.inject({ method: "GET", url: `/reports/fair-sales?fairId=${fairId}` });
      expect(report.statusCode).toBe(200);
      expect(report.json<Array<{ invoiceCount: number; totalPaise: number }>>()[0]).toMatchObject({
        invoiceCount: 1,
        totalPaise: 3000,
      });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("adds inventory and rejects a sale that would make stock negative", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Stock API Company" } })).json<{ id: string }>().id;
      const businessId = (await app.inject({ method: "POST", url: "/businesses", payload: { companyId, name: "Stock API Business" } })).json<{ id: string }>().id;
      const customerId = (await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "Stock API Customer" } })).json<{ id: string }>().id;
      const itemId = (await app.inject({ method: "POST", url: "/items", payload: { companyId, name: "Tracked Book", unit: "each", trackStock: true } })).json<{ id: string }>().id;
      const movement = await app.inject({
        method: "POST",
        url: "/inventory/movements",
        payload: { itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 1200 },
      });
      expect(movement.statusCode).toBe(201);
      const created = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          businessId,
          customerId,
          paymentAccount: "CASH",
          lines: [{ itemId, description: "Tracked Book", quantity: 2, unitPricePaise: 2500 }],
        },
      });
      const invoiceId = created.json<{ id: string }>().id;
      const finalized = await app.inject({ method: "POST", url: `/invoices/${invoiceId}/finalize` });
      expect(finalized.statusCode).toBe(400);
      expect(finalized.json()).toEqual({ error: `Insufficient stock for item ${itemId}.` });
      const stock = await app.inject({ method: "GET", url: "/inventory/stock" });
      expect(stock.json<Array<{ quantity: number }>>()[0]?.quantity).toBe(1);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("lists credit notes, rejects over-returns and keeps ledger balanced", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "CN Company" } })).json<{ id: string }>().id;
      const businessId = (await app.inject({ method: "POST", url: "/businesses", payload: { companyId, name: "CN Business" } })).json<{ id: string }>().id;
      const customerId = (await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "CN Customer" } })).json<{ id: string }>().id;
      const itemId = (await app.inject({ method: "POST", url: "/items", payload: { companyId, name: "CN Book", unit: "each", trackStock: false } })).json<{ id: string }>().id;
      const invoiceId = (await app.inject({
        method: "POST", url: "/invoices",
        payload: { businessId, customerId, paymentAccount: "CASH", lines: [{ itemId, description: "Book", quantity: 3, unitPricePaise: 10000 }] },
      })).json<{ id: string }>().id;
      await app.inject({ method: "POST", url: `/invoices/${invoiceId}/finalize` });

      const tooMany = await app.inject({
        method: "POST", url: "/credit-notes",
        payload: { invoiceId, reason: "Too many", lines: [{ itemId, description: "Book", quantity: 4, unitPricePaise: 10000 }] },
      });
      expect(tooMany.statusCode).toBe(400);

      const created = await app.inject({
        method: "POST", url: "/credit-notes",
        payload: { invoiceId, reason: "Damaged", lines: [{ itemId, description: "Book", quantity: 2, unitPricePaise: 10000 }] },
      });
      expect(created.statusCode).toBe(201);
      const creditNoteId = created.json<{ id: string }>().id;

      const drafts = await app.inject({ method: "GET", url: `/credit-notes?invoiceId=${invoiceId}` });
      expect(drafts.json<Array<{ status: string; totalPaise: number; invoiceNumber: string }>>())
        .toEqual([expect.objectContaining({ status: "DRAFT", totalPaise: 20000, invoiceNumber: expect.stringMatching(/^INV-001\/\d{2}-\d{2}$/) })]);
      expect((await app.inject({ method: "GET", url: "/credit-notes?status=FINALIZED" })).json()).toEqual([]);
      expect((await app.inject({ method: "GET", url: "/credit-notes?status=BOGUS" })).statusCode).toBe(400);

      expect((await app.inject({ method: "POST", url: `/credit-notes/${creditNoteId}/finalize` })).statusCode).toBe(200);
      const finalized = (await app.inject({ method: "GET", url: "/credit-notes?status=FINALIZED" })).json<Array<{ number: string; totalPaise: number }>>();
      expect(finalized).toEqual([expect.objectContaining({ number: expect.stringMatching(/^CN-001\/\d{2}-\d{2}$/), totalPaise: 20000 })]);

      const pl = (await app.inject({ method: "GET", url: "/reports/profit-and-loss" })).json<{ totalIncomePaise: number }>();
      expect(pl.totalIncomePaise).toBe(10000);
    } finally {
      await app.close();
      repository.close();
    }
  });

  /**
   * S4-1 / S4-5 over HTTP: the three ways a credit note is settled. Without these routes the
   * refund path existed only inside the repository and nothing could reach it.
   */
  it("refunds, applies and cancels a credit note over HTTP", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      // A credit note is dated by its created_at, i.e. now, so every discharge date has to be
      // after today. Fake timers are not an option here: they stall Fastify's own async work.
      const inDays = (days: number): string => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      // An empty object rather than no payload at all: the routes that ignore the body do not
      // parse it, and a conditional spread trips exactOptionalPropertyTypes.
      const post = async (url: string, payload: object = {}) => app.inject({ method: "POST", url, payload });
      const idOf = async (url: string, payload: object): Promise<string> =>
        (await post(url, payload)).json<{ id: string }>().id;

      const companyId = await idOf("/companies", { name: "Refund Company" });
      const businessId = await idOf("/businesses", { companyId, name: "Refund Business" });
      const customerId = await idOf("/customers", { companyId, name: "Refund Customer" });
      const itemId = await idOf("/items", { companyId, name: "Refund Book", unit: "each", trackStock: false });

      const invoiceId = await idOf("/invoices", {
        businessId, customerId, paymentAccount: "RECEIVABLES",
        lines: [{ itemId, description: "Book", quantity: 4, unitPricePaise: 10000 }],
      });
      await post(`/invoices/${invoiceId}/finalize`);
      // Paid in full, so any credit note is money owed BACK.
      expect((await post(`/invoices/${invoiceId}/payments`, { amountPaise: 40000, paidOn: inDays(-1) })).statusCode).toBe(201);

      const noteId = await idOf("/credit-notes", {
        invoiceId, reason: "Returned",
        lines: [{ itemId, description: "Book", quantity: 2, unitPricePaise: 10000 }],
      });
      await post(`/credit-notes/${noteId}/finalize`);

      const balance = await app.inject({ method: "GET", url: `/credit-notes/${noteId}/balance` });
      expect(balance.json()).toEqual({ refundablePaise: 20000, dischargedPaise: 0, outstandingPaise: 20000 });

      // A real date is required - today is not assumed, or the reduction would land in the
      // wrong month of the cash P&L.
      expect((await post(`/credit-notes/${noteId}/refunds`, { amountPaise: 5000, paymentAccount: "CASH" })).statusCode).toBe(400);
      expect((await post(`/credit-notes/${noteId}/refunds`, { amountPaise: 5000, refundedOn: "nonsense", paymentAccount: "CASH" })).statusCode).toBe(400);
      // RECEIVABLES is not somewhere money can go out to.
      expect((await post(`/credit-notes/${noteId}/refunds`, { amountPaise: 5000, refundedOn: inDays(2), paymentAccount: "RECEIVABLES" })).statusCode).toBe(400);

      // Half back in cash, and the rest set against a second invoice.
      const refunded = await post(`/credit-notes/${noteId}/refunds`, { amountPaise: 5000, refundedOn: inDays(2), paymentAccount: "BANK" });
      expect(refunded.statusCode).toBe(201);
      expect(refunded.json<{ balance: { outstandingPaise: number } }>().balance.outstandingPaise).toBe(15000);

      const nextInvoiceId = await idOf("/invoices", {
        businessId, customerId, paymentAccount: "RECEIVABLES",
        lines: [{ itemId, description: "Book", quantity: 4, unitPricePaise: 10000 }],
      });
      await post(`/invoices/${nextInvoiceId}/finalize`);
      const applied = await post(`/credit-notes/${noteId}/applications`, {
        invoiceId: nextInvoiceId, amountPaise: 15000, appliedOn: inDays(3),
      });
      expect(applied.statusCode).toBe(201);
      expect(applied.json<{ balance: { outstandingPaise: number } }>().balance.outstandingPaise).toBe(0);
      // Nothing left, so a further refund is refused rather than overdrawing the note.
      expect((await post(`/credit-notes/${noteId}/refunds`, { amountPaise: 1, refundedOn: inDays(4), paymentAccount: "CASH" })).statusCode).toBe(400);
      // And the second invoice really was settled by that credit: 40,000 less 15,000.
      const receivables = (await app.inject({ method: "GET", url: "/reports/receivables" }))
        .json<Array<{ invoiceId: string; outstandingPaise: number }>>();
      expect(receivables.find((r) => r.invoiceId === nextInvoiceId)?.outstandingPaise).toBe(25000);

      // A discharged note cannot be cancelled; an untouched one can.
      expect((await post(`/credit-notes/${noteId}/cancel`)).statusCode).toBe(400);
      const cleanNoteId = await idOf("/credit-notes", {
        invoiceId: nextInvoiceId, reason: "Mistake",
        lines: [{ itemId, description: "Book", quantity: 1, unitPricePaise: 10000 }],
      });
      await post(`/credit-notes/${cleanNoteId}/finalize`);
      expect((await post(`/credit-notes/${cleanNoteId}/cancel`)).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/credit-notes/${cleanNoteId}` })).json<{ status: string }>().status).toBe("CANCELLED");
      // Cancelling put the 10,000 back on the bill.
      const after = (await app.inject({ method: "GET", url: "/reports/receivables" }))
        .json<Array<{ invoiceId: string; outstandingPaise: number }>>();
      expect(after.find((r) => r.invoiceId === nextInvoiceId)?.outstandingPaise).toBe(25000);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("runs the auth flow: setup, login, session, change-password, logout", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      expect((await app.inject({ method: "GET", url: "/auth/status" })).json()).toEqual({ configured: false, locked: false });
      expect((await app.inject({ method: "POST", url: "/auth/setup", payload: { password: "weak" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/auth/setup", payload: { password: "Secret123" } })).statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: "/auth/setup", payload: { password: "Secret123" } })).statusCode).toBe(400);

      const bad = await app.inject({ method: "POST", url: "/auth/login", payload: { password: "Wrong1234" } });
      expect(bad.statusCode).toBe(401);
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { password: "Secret123" } });
      expect(login.statusCode).toBe(200);
      const { token } = login.json<{ token: string }>();
      const auth = { authorization: `Bearer ${token}` };

      expect((await app.inject({ method: "GET", url: "/auth/session" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/auth/session", headers: auth })).json()).toMatchObject({ role: "ADMIN" });
      const changed = await app.inject({
        method: "POST", url: "/auth/change-password", headers: auth,
        payload: { currentPassword: "Secret123", newPassword: "NewSecret456" },
      });
      expect(changed.statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/auth/logout", headers: auth })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/auth/session", headers: auth })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/auth/login", payload: { password: "NewSecret456" } })).statusCode).toBe(200);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("locks the account after repeated wrong passwords (423)", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      await app.inject({ method: "POST", url: "/auth/setup", payload: { password: "Secret123" } });
      for (let i = 0; i < 5; i++) {
        await app.inject({ method: "POST", url: "/auth/login", payload: { password: "Wrong1234" } });
      }
      const locked = await app.inject({ method: "POST", url: "/auth/login", payload: { password: "Secret123" } });
      expect(locked.statusCode).toBe(423);
      expect(locked.json<{ error: string }>().error).toMatch(/locked/i);
      expect((await app.inject({ method: "GET", url: "/auth/status" })).json()).toMatchObject({ configured: true, locked: true });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("manages recurring invoice templates and generates drafts", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Rec Co" } })).json<{ id: string }>().id;
      const businessId = (await app.inject({ method: "POST", url: "/businesses", payload: { companyId, name: "Rec Biz" } })).json<{ id: string }>().id;
      const customerId = (await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "Rec Cust" } })).json<{ id: string }>().id;

      const bad = await app.inject({
        method: "POST", url: "/recurring-invoices",
        payload: { businessId, customerId, paymentAccount: "CASH", frequency: "DAILY", startDate: "2026-01-01", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }] },
      });
      expect(bad.statusCode).toBe(400);

      const created = await app.inject({
        method: "POST", url: "/recurring-invoices",
        payload: { businessId, customerId, paymentAccount: "CASH", frequency: "MONTHLY", startDate: "2026-01-10", lines: [{ description: "Subscription", quantity: 1, unitPricePaise: 50000 }] },
      });
      expect(created.statusCode).toBe(201);
      const templateId = created.json<{ id: string }>().id;

      expect((await app.inject({ method: "GET", url: `/recurring-invoices?businessId=${businessId}&active=true` })).json()).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: `/recurring-invoices/${templateId}` })).json()).toMatchObject({ nextRunDate: "2026-01-10", active: true });
      expect((await app.inject({ method: "GET", url: "/reports/upcoming-recurring-invoices" })).json()).toEqual([
        expect.objectContaining({ templateId, totalPaise: 50000 }),
      ]);

      const generated = await app.inject({ method: "POST", url: "/recurring-invoices/generate", payload: { asOfDate: "2026-02-10" } });
      expect(generated.statusCode).toBe(200);
      const body = generated.json<{ invoices: Array<{ id: string; status: string; invoiceDate: string }>; failures: unknown[] }>();
      expect(body.invoices.map((invoice) => [invoice.status, invoice.invoiceDate])).toEqual([["DRAFT", "2026-01-10"], ["DRAFT", "2026-02-10"]]);
      expect(body.failures).toEqual([]);
      expect((await app.inject({ method: "GET", url: `/recurring-invoices/${templateId}` })).json()).toMatchObject({ nextRunDate: "2026-03-10" });
      expect((await app.inject({ method: "GET", url: "/invoices" })).json()).toHaveLength(2);

      expect((await app.inject({ method: "POST", url: `/invoices/${body.invoices[0]!.id}/finalize` })).statusCode).toBe(200);

      expect((await app.inject({ method: "PATCH", url: `/recurring-invoices/${templateId}`, payload: {} })).statusCode).toBe(400);
      const patched = await app.inject({ method: "PATCH", url: `/recurring-invoices/${templateId}`, payload: { nextRunDate: "2026-06-10" } });
      expect(patched.json()).toMatchObject({ nextRunDate: "2026-06-10" });
      const deactivated = await app.inject({ method: "POST", url: `/recurring-invoices/${templateId}/deactivate` });
      expect(deactivated.json()).toMatchObject({ active: false });
      const noBody = await app.inject({ method: "POST", url: "/recurring-invoices/generate" });
      expect(noBody.statusCode).toBe(200);
      expect(noBody.json<{ invoices: unknown[] }>().invoices).toEqual([]);
      expect((await app.inject({ method: "GET", url: "/recurring-invoices/nope" })).statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });
});

interface InvoiceResponse {
  lines: Array<{ itemId?: string; description: string }>;
}
