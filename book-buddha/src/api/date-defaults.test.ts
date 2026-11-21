import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "./server.js";
import { AccountingRepository } from "../database/repository.js";

// D14: defaulted dates are computed per request (IST), not frozen at module load.
describe("schema date defaults", () => {
  let repo: AccountingRepository;
  let app: Awaited<ReturnType<typeof buildApi>>;
  beforeEach(async () => {
    repo = new AccountingRepository();
    app = buildApi(repo, { __unsafeDisableAuthForTests: true });
    await app.ready();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    repo.close();
  });
  const post = async (url: string, payload: object) => {
    const r = await app.inject({ method: "POST", url, payload });
    return { status: r.statusCode, body: r.json() };
  };

  it("invoice, bill and expense dates default to today in IST at request time", async () => {
    const companyId = (await post("/companies", { name: "Co" })).body.id;
    const businessId = (await post("/businesses", { companyId, name: "Books" })).body.id;
    const customerId = (await post("/customers", { companyId, name: "C" })).body.id;
    const supplierId = (await post("/suppliers", { companyId, name: "S" })).body.id;

    // 20:00 UTC on 14 Jun = 01:30 IST on 15 Jun: UTC date and IST date differ.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-06-14T20:00:00Z"));
    const inv = await post("/invoices", { id: "i1", number: "I1", businessId, customerId, paymentAccount: "RECEIVABLES", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }] });
    const bill = await post("/purchase-bills", { businessId, supplierId, number: "B1", paymentAccount: "PAYABLES", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }] });
    expect(inv.status).toBeLessThan(300);
    expect(bill.status).toBeLessThan(300);
    expect(String(inv.body.invoiceDate).slice(0, 10)).toBe("2099-06-15");
    expect(String(bill.body.billDate).slice(0, 10)).toBe("2099-06-15");

    vi.setSystemTime(new Date("2099-07-01T06:00:00Z"));
    const inv2 = await post("/invoices", { id: "i2", number: "I2", businessId, customerId, paymentAccount: "RECEIVABLES", lines: [{ description: "x", quantity: 1, unitPricePaise: 100 }] });
    expect(String(inv2.body.invoiceDate).slice(0, 10)).toBe("2099-07-01");
  });
});
