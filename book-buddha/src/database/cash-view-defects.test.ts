import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";
import { todayAt } from "./test-clock.js";

/**
 * Cash-basis Profit and Loss: D9 (purchase returns, ruling S16-7(1)), D10 (GST payment voucher)
 * and D16 (a cancelled receipt, ruling S16-7(3), which replaces S8-1).
 *
 * Every figure is worked by hand and is NOT read off the code. No tax anywhere except the D10
 * case, so each expense line is the bill line and the sums are plain.
 *
 * The rule under test throughout: a month already reported NEVER moves. New events land in the
 * month they happen.
 */

interface World { repository: AccountingRepository; businessId: string; customerId: string; supplierId: string; stockItemId: string }

const open: AccountingRepository[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const repository of open.splice(0)) repository.close();
});

function world(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2025-01-02"));
  open.push(repository);
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "CASH" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Cust" });
  const supplierId = repository.createSupplier({ companyId, name: "Sup" });
  const stockItemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  return { repository, businessId, customerId, supplierId, stockItemId };
}

/** Cash-basis expense for ONE month (or an open-ended range), in paise. */
function expense(w: World, from: string, to: string): number {
  return w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "CASH", fromDate: from, toDate: to }).totalExpensesPaise;
}
const MONTHS = {
  apr: ["2025-04-01", "2025-04-30"], may: ["2025-05-01", "2025-05-31"], jun: ["2025-06-01", "2025-06-30"],
  jul: ["2025-07-01", "2025-07-31"], all: ["2025-04-01", "2025-12-31"],
} as const;
const month = (w: World, m: keyof typeof MONTHS): number => expense(w, MONTHS[m][0], MONTHS[m][1]);

/** A service bill (it lands in EXPENSE) finalized on 10 April 2025. */
function serviceBill(w: World, totalPaise: number): string {
  const bill = w.repository.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number: "PB-1", billDate: "2025-04-10", paymentAccount: "PAYABLES",
    lines: [{ description: "Service", quantity: 1, unitPricePaise: totalPaise }],
  });
  w.repository.finalizePurchaseBill(bill.id);
  return bill.id;
}
function returnOf(w: World, billId: string, valuePaise: number, returnDate: string, number = "PR-1"): string {
  const ret = w.repository.createPurchaseReturn({
    billId, number, reason: "Short", returnDate, lines: [{ description: "Service", quantity: 1, unitPricePaise: valuePaise }],
  });
  w.repository.finalizePurchaseReturn(ret.id);
  return ret.id;
}
const pay = (w: World, billId: string, amountPaise: number, paidOn: string): string =>
  w.repository.recordSupplierPayment({ billId, amountPaise, paidOn }).id;
const refund = (w: World, returnId: string, amountPaise: number, refundedOn: string): void => {
  w.repository.recordSupplierRefund({ purchaseReturnId: returnId, amountPaise, refundedOn, paymentAccount: "CASH" });
};
const accrualExpense = (w: World): number =>
  w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "ACCRUAL" }).totalExpensesPaise;

describe("D9: a purchase return on a bill the cash view is walking (ruling S16-7(1))", () => {
  it("part-paid, then returned: April stays at 5,000, nothing throws, and the later payment recognises the remainder", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    pay(w, bill, 5000, "2025-04-20");
    expect(month(w, "apr")).toBe(5000);

    returnOf(w, bill, 2000, "2025-05-05"); // sets 2,000 against the 5,000 still owed: 3,000 left owing
    expect(month(w, "apr"), "a closed month never moves").toBe(5000);
    expect(month(w, "may"), "the return itself is no cash event").toBe(0);

    pay(w, bill, 3000, "2025-06-10"); // clears the bill
    expect(month(w, "apr")).toBe(5000);
    expect(month(w, "may")).toBe(0);
    expect(month(w, "jun"), "the remaining 3,000 of the 8,000 net bill").toBe(3000);
    expect(month(w, "all"), "converges on the net-of-return accrual figure").toBe(8000);
    expect(accrualExpense(w)).toBe(8000);
  });

  it("part-paid, returned, then a SMALLER payment: the remainder is spread over what is still owed", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    pay(w, bill, 5000, "2025-04-20");
    returnOf(w, bill, 2000, "2025-05-05"); // 3,000 expense left to recognise over 3,000 owed
    pay(w, bill, 1500, "2025-06-10");
    expect(month(w, "jun")).toBe(1500);
    pay(w, bill, 1500, "2025-07-10");
    expect(month(w, "jul")).toBe(1500);
    expect(month(w, "all")).toBe(8000);
  });

  it("fully paid, returned, refunded in a LATER month: the reduction lands in the refund month", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    pay(w, bill, 10000, "2025-04-20");
    const ret = returnOf(w, bill, 1500, "2025-05-05"); // nothing owed: the whole 1,500 is money the supplier owes us
    expect(month(w, "apr")).toBe(10000);
    expect(month(w, "may"), "goods went back, but no money has").toBe(0);

    refund(w, ret, 1500, "2025-06-12");
    expect(month(w, "apr"), "April never moves").toBe(10000);
    expect(month(w, "may")).toBe(0);
    expect(month(w, "jun"), "the money came back in June").toBe(-1500);
    expect(month(w, "all")).toBe(8500);
  });

  it("a refund in two instalments recognises each in its own month", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    pay(w, bill, 10000, "2025-04-20");
    const ret = returnOf(w, bill, 1500, "2025-05-05");
    refund(w, ret, 1000, "2025-06-12");
    refund(w, ret, 500, "2025-07-03");
    expect(month(w, "jun")).toBe(-1000);
    expect(month(w, "jul")).toBe(-500);
    expect(month(w, "all")).toBe(8500);
  });

  it("a return SPLIT across PAYABLES and SUPPLIER_CREDITS: the open part lowers what is owed, the paid part waits for the refund", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    pay(w, bill, 8000, "2025-04-20"); // 2,000 still owed
    const ret = returnOf(w, bill, 4000, "2025-05-05"); // 2,000 against PAYABLES, 2,000 to SUPPLIER_CREDITS
    expect(month(w, "apr")).toBe(8000);
    expect(month(w, "may"), "owing is cleared, nothing is recognised on the return date").toBe(0);

    refund(w, ret, 2000, "2025-06-20");
    expect(month(w, "apr")).toBe(8000);
    expect(month(w, "jun")).toBe(-2000);
    expect(month(w, "all"), "10,000 less the 4,000 returned").toBe(6000);
    expect(accrualExpense(w)).toBe(6000);
  });

  it("a CANCELLED return is undone on its cancel date and the bill carries on as before", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    pay(w, bill, 5000, "2025-04-20");
    const ret = returnOf(w, bill, 2000, "2025-05-05");
    expect(month(w, "may")).toBe(0);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-06-15T06:00:00Z"));
    w.repository.cancelPurchaseReturn(ret);
    vi.useRealTimers();

    expect(month(w, "apr")).toBe(5000);
    expect(month(w, "may")).toBe(0);
    expect(month(w, "jun"), "cancelling a return is no cash event either").toBe(0);

    pay(w, bill, 5000, "2025-07-10"); // the full 5,000 still owed, so all of it is recognised
    expect(month(w, "jul")).toBe(5000);
    expect(month(w, "all")).toBe(10000);
  });

  it("a STOCK bill with a return has no P&L effect on the cash basis, whoever has been paid", () => {
    const w = world();
    const bill = w.repository.createPurchaseBill({
      businessId: w.businessId, supplierId: w.supplierId, number: "PB-S", billDate: "2025-04-10", paymentAccount: "PAYABLES",
      lines: [{ itemId: w.stockItemId, description: "Atlas", quantity: 2, unitPricePaise: 5000 }],
    });
    w.repository.finalizePurchaseBill(bill.id);
    pay(w, bill.id, 10000, "2025-04-20");
    const ret = w.repository.createPurchaseReturn({
      billId: bill.id, number: "PR-S", reason: "Wrong", returnDate: "2025-05-05",
      lines: [{ itemId: w.stockItemId, description: "Atlas", quantity: 1, unitPricePaise: 5000 }],
    });
    w.repository.finalizePurchaseReturn(ret.id);
    w.repository.recordSupplierRefund({ purchaseReturnId: ret.id, amountPaise: 5000, refundedOn: "2025-06-12", paymentAccount: "CASH" });

    for (const m of ["apr", "may", "jun", "all"] as const) expect(month(w, m), m).toBe(0);
    const report = w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "CASH" });
    expect(report.totalIncomePaise).toBe(0);
    expect(report.netProfitPaise).toBe(0);
  });

  it("a return that is NOT yet refunded keeps SUPPLIER_CREDITS out of the cash rows altogether", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    pay(w, bill, 10000, "2025-04-20");
    returnOf(w, bill, 1500, "2025-05-05");
    expect(w.repository.deriveCashView().recognitions.filter((r) => r.account === "SUPPLIER_CREDITS")).toEqual([]);
  });
});

describe("D16: a cancelled receipt is taken back in the month it is cancelled (ruling S16-7(3), replacing S8-1)", () => {
  function receipt(w: World, amountPaise: number, paidOn: string): { invoiceId: string; paymentId: string } {
    w.repository.saveDraft({
      id: "inv-1", number: "INV-1", businessId: w.businessId, customerId: w.customerId, invoiceDate: "2025-01-10",
      paymentAccount: "RECEIVABLES", status: "DRAFT",
      lines: [{ description: "Books", quantity: 1, unitPricePaise: 10000 }],
    });
    w.repository.finalizeInvoice("inv-1");
    return { invoiceId: "inv-1", paymentId: w.repository.recordPayment("inv-1", amountPaise, paidOn).id };
  }
  const income = (w: World, from: string, to: string): number =>
    w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "CASH", fromDate: from, toDate: to }).totalIncomePaise;
  const cancelOn = (w: World, paymentId: string, instant: string): void => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(instant));
    try { w.repository.cancelPayment(paymentId); } finally { vi.useRealTimers(); }
  };

  it("received in January, cancelled in February: January stays 100, February shows -100", () => {
    const w = world();
    const { paymentId } = receipt(w, 10000, "2025-01-20");
    expect(income(w, "2025-01-01", "2025-01-31")).toBe(10000);
    cancelOn(w, paymentId, "2025-02-15T06:00:00Z");
    expect(income(w, "2025-01-01", "2025-01-31"), "a closed month never changes").toBe(10000);
    expect(income(w, "2025-02-01", "2025-02-28")).toBe(-10000);
    expect(income(w, "2025-01-01", "2025-02-28"), "the two months net to nothing").toBe(0);
  });

  it("cancelled in the SAME month: that month nets to zero, as before", () => {
    const w = world();
    const { paymentId } = receipt(w, 10000, "2025-01-20");
    cancelOn(w, paymentId, "2025-01-25T06:00:00Z");
    expect(income(w, "2025-01-01", "2025-01-31")).toBe(0);
  });

  it("the money can be received again after a cancellation and is recognised once, in full", () => {
    const w = world();
    const { invoiceId, paymentId } = receipt(w, 4000, "2025-01-20");
    cancelOn(w, paymentId, "2025-02-15T06:00:00Z");
    w.repository.recordPayment(invoiceId, 10000, "2025-03-05");
    expect(income(w, "2025-01-01", "2025-01-31")).toBe(4000);
    expect(income(w, "2025-02-01", "2025-02-28")).toBe(-4000);
    expect(income(w, "2025-03-01", "2025-03-31")).toBe(10000);
    expect(income(w, "2025-01-01", "2025-12-31")).toBe(10000);
  });

  it("the cash COGS that followed the receipt is reversed in the cancellation month too", () => {
    const w = world();
    // A stock invoice: sales 10,000, cost 3,000 (from a cash purchase bill of one unit).
    const bill = w.repository.createPurchaseBill({
      businessId: w.businessId, supplierId: w.supplierId, number: "PB-S", billDate: "2025-01-02", paymentAccount: "CASH",
      lines: [{ itemId: w.stockItemId, description: "Atlas", quantity: 1, unitPricePaise: 3000 }],
    });
    w.repository.finalizePurchaseBill(bill.id);
    w.repository.saveDraft({
      id: "inv-s", number: "INV-S", businessId: w.businessId, customerId: w.customerId, invoiceDate: "2025-01-10",
      paymentAccount: "RECEIVABLES", status: "DRAFT",
      lines: [{ itemId: w.stockItemId, description: "Atlas", quantity: 1, unitPricePaise: 10000 }],
    });
    w.repository.finalizeInvoice("inv-s");
    const paymentId = w.repository.recordPayment("inv-s", 10000, "2025-01-20").id;
    const jan = { businessId: w.businessId, basis: "CASH", fromDate: "2025-01-01", toDate: "2025-01-31" } as const;
    const feb = { businessId: w.businessId, basis: "CASH", fromDate: "2025-02-01", toDate: "2025-02-28" } as const;
    expect(w.repository.getProfitAndLoss(jan).netProfitPaise).toBe(7000);
    cancelOn(w, paymentId, "2025-02-15T06:00:00Z");
    expect(w.repository.getProfitAndLoss(jan).netProfitPaise).toBe(7000);
    expect(w.repository.getProfitAndLoss(feb).totalIncomePaise).toBe(-10000);
    expect(w.repository.getProfitAndLoss(feb).totalExpensesPaise).toBe(-3000);
    expect(w.repository.getProfitAndLoss(feb).netProfitPaise).toBe(-7000);
  });

  it("a supplier payment cancelled later follows the same rule", () => {
    const w = world();
    const bill = serviceBill(w, 10000);
    const paymentId = pay(w, bill, 10000, "2025-04-20");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-05-15T06:00:00Z"));
    try { w.repository.cancelSupplierPayment(paymentId); } finally { vi.useRealTimers(); }
    expect(month(w, "apr")).toBe(10000);
    expect(month(w, "may")).toBe(-10000);
  });

  it("a payment cancelled, THEN the invoice cancelled: nothing throws and everything nets to zero", () => {
    const w = world();
    const { paymentId } = receipt(w, 10000, "2025-01-20");
    cancelOn(w, paymentId, "2025-02-15T06:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-03-10T06:00:00Z"));
    try { w.repository.cancelInvoice("inv-1"); } finally { vi.useRealTimers(); }
    expect(income(w, "2025-01-01", "2025-01-31")).toBe(10000);
    expect(income(w, "2025-02-01", "2025-02-28")).toBe(-10000);
    expect(income(w, "2025-03-01", "2025-03-31")).toBe(0);
    expect(income(w, "2025-01-01", "2025-12-31")).toBe(0);
  });
});

describe("D10: paying the GST over is not a sales reversal (both bases)", () => {
  it("a GST payment voucher leaves GST on sales at 18 on the accrual AND the cash basis (credit-note reversals stay in: see cash-view.test.ts)", async () => {
    const repository = new AccountingRepository(":memory:", todayAt("2025-01-02"));
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      await app.ready();
      const post = async (url: string, payload: object): Promise<any> => {
        const res = await app.inject({ method: "POST", url, payload });
        if (res.statusCode >= 300) throw new Error(`SETUP ${url} -> ${res.statusCode} ${res.body}`);
        return res.json();
      };
      const get = async (url: string): Promise<any> => (await app.inject({ method: "GET", url })).json();
      const companyId = (await post("/companies", { name: "Co", accountingBasis: "ACCRUAL" })).id;
      const businessId = (await post("/businesses", { companyId, name: "Books" })).id;
      const customerId = (await post("/customers", { companyId, name: "Cust" })).id;
      await post("/invoices", { id: "inv-10",businessId, customerId, paymentAccount: "CASH", invoiceDate: "2025-04-05", taxType: "CGST_SGST", taxRateBasisPoints: 1800, lines: [{ description: "Books", quantity: 1, unitPricePaise: 10000 }] });
      await post("/invoices/inv-10/finalize", {});
      await post("/vouchers", { kind: "PAYMENT", businessId, date: "2025-04-20", moneyAccount: "CASH", narration: "GST remittance", lines: [{ account: "OUTPUT_CGST", amountPaise: 900 }, { account: "OUTPUT_SGST", amountPaise: 900 }] });
      for (const basis of ["ACCRUAL", "CASH"]) {
        const report = await get(`/reports/profit-and-loss?businessId=${businessId}&basis=${basis}&fromDate=2025-04-01&toDate=2025-04-30`);
        expect(report.gstOnSalesPaise, basis).toBe(1800);
      }
    } finally {
      await app.close();
      repository.close();
    }
  });
});
