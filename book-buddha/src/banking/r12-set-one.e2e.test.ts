import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository } from "../database/repository.js";

/**
 * ACCEPTANCE R12 set one, END TO END (orchestrator, S15). The hand-worked HDFC October example from
 * the R12 plan (Progress.md, "Acceptance (hand-worked, S11-14)"), driven ONLY through the real HTTP
 * routes of buildApi - bank account (12a), money through a bank with mode and reference (12b),
 * Internal Transfer and Payment Voucher (12c), reconciliation (12d) - with migrations v23-v27 run
 * by the normal migration chain. Figures are the plan's; if this goes red, the code is wrong.
 *
 * Money is whole PAISE; the rupee figure is in the comment.
 */

const RS = (rupees: number): number => rupees * 100;

let repository: AccountingRepository;
let app: FastifyInstance;

beforeEach(async () => {
  repository = new AccountingRepository();
  app = buildApi(repository, { __unsafeDisableAuthForTests: true });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  repository.close();
});

async function post<T>(url: string, payload: object, status = 201): Promise<T> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(status);
  return res.json<T>();
}
async function get<T>(url: string): Promise<T> {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res.json<T>();
}

interface Candidate { journalLineId: number; entryDate: string; inPaise: number; outPaise: number; ticked: boolean }
interface Detail { header: { id: string; beginningBalancePaise: number; status: string }; candidates: Candidate[]; clearedBalancePaise: number; differencePaise: number }

describe("ACCEPTANCE R12 set one: HDFC October, end to end over HTTP", () => {
  it("books 72,320; statement 84,066; tick four -> -354; Rs 354 charge -> 0; books 71,966; November begins 84,066", async () => {
    // ---- Set-up: company, business, customer, supplier, a bank-charges expense account.
    const { id: companyId } = await post<{ id: string }>("/companies", { name: "Fair Books", accountingBasis: "ACCRUAL" });
    const { id: businessId } = await post<{ id: string }>("/businesses", { companyId, name: "Book Fair" });
    const { id: customerId } = await post<{ id: string }>("/customers", { companyId, name: "Asha School" });
    const { id: supplierId } = await post<{ id: string }>("/suppliers", { companyId, name: "Paper Co" });
    await post("/accounts", { companyId, code: "BANK_CHARGES", name: "Bank Charges", type: "EXPENSE" });

    // ---- 12a: the HDFC current account, by the bank-account route.
    const created = await post<{ bankAccount: { code: string; type: string; role: string } }>(
      "/bank-accounts", { companyId, name: "HDFC Current", kind: "CURRENT", bankName: "HDFC Bank", accountNumberLast4: "4321", ifsc: "HDFC0001234" },
    );
    const HDFC = created.bankAccount.code;
    expect(created.bankAccount).toMatchObject({ type: "ASSET" });

    // ---- Opening balances 1 Oct: HDFC Rs 50,000, cash in hand Rs 20,000.
    const opening = await post<{ id: string }>("/opening-balances", {
      businessId, asAt: "2025-10-01",
      lines: [{ account: HDFC, debitPaise: RS(50_000), creditPaise: 0 }, { account: "CASH", debitPaise: RS(20_000), creditPaise: 0 }],
    });

    // ---- 3 Oct: fair cash banked, an Internal Transfer CASH -> HDFC Rs 12,000 (12c).
    const trf = await post<{ number: string }>("/internal-transfers", {
      businessId, date: "2025-10-03", fromAccount: "CASH", toAccount: HDFC, amountPaise: RS(12_000), paymentMode: "CASH", memo: "Fair cash banked",
    });
    expect(trf.number).toBe("TRF-001/25-26");

    // ---- 8 Oct: customer pays Rs 23,600 by NEFT into HDFC (12b).
    await post("/invoices", { id: "inv-a",businessId, customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-10-02", taxType: "NONE", taxRateBasisPoints: 0, lines: [{ description: "Books", quantity: 1, unitPricePaise: RS(23_600) }] });
    await post("/invoices/inv-a/finalize", {}, 200);
    const neft = await post<{ id: string; moneyAccount: string; paymentMode: string; paymentReference: string }>(
      "/invoices/inv-a/payments", { amountPaise: RS(23_600), paidOn: "2025-10-08", moneyAccount: HDFC, paymentMode: "NEFT", paymentReference: "UTR8OCT" },
    );
    expect(neft).toMatchObject({ moneyAccount: HDFC, paymentMode: "NEFT", paymentReference: "UTR8OCT" });

    // ---- 15 Oct: supplier paid Rs 18,000 by cheque from HDFC (not presented till November).
    const bill = await post<{ id: string }>("/purchase-bills", { businessId, supplierId, number: "PB-001", billDate: "2025-10-10", paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: RS(18_000) }] });
    await post(`/purchase-bills/${bill.id}/finalize`, {}, 200);
    await post("/supplier-payments", { billId: bill.id, amountPaise: RS(18_000), paidOn: "2025-10-15", moneyAccount: HDFC, paymentMode: "CHEQUE", paymentReference: "CHQ 000451" });

    // ---- 20 Oct: an expense of Rs 1,180 paid at once by UPI from HDFC.
    const expense = await post<{ id: string }>("/expenses", { businessId, number: "EXP-001", expenseDate: "2025-10-20", description: "Printing", amountPaise: RS(1_180), paymentAccount: "CASH", moneyAccount: HDFC, paymentMode: "UPI", paymentReference: "UPI-20OCT" });
    await post(`/expenses/${expense.id}/finalize`, {}, 200);

    // ---- 28 Oct: customer cheque Rs 5,900 deposited into HDFC (clears in November).
    await post("/invoices", { id: "inv-b",businessId, customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-10-25", taxType: "NONE", taxRateBasisPoints: 0, lines: [{ description: "Books", quantity: 1, unitPricePaise: RS(5_900) }] });
    await post("/invoices/inv-b/finalize", {}, 200);
    await post("/invoices/inv-b/payments", { amountPaise: RS(5_900), paidOn: "2025-10-28", moneyAccount: HDFC, paymentMode: "CHEQUE", paymentReference: "CHQ 778812" });

    // ---- 12a register: book balance 31 Oct = 72,320; cash in hand 20,000 - 12,000 = 8,000.
    const register = await get<{ closingBalancePaise: number; rows: Array<{ runningBalancePaise: number }> }>(`/bank-accounts/${HDFC}/register?companyId=${companyId}`);
    expect(register.rows.map((r) => r.runningBalancePaise)).toEqual([50_000, 62_000, 85_600, 67_600, 66_420, 72_320].map(RS));
    expect(register.closingBalancePaise).toBe(RS(72_320));
    const cash = await get<{ closingBalancePaise: number }>(`/bank-accounts/CASH/register?companyId=${companyId}`);
    expect(cash.closingBalancePaise).toBe(RS(8_000));

    // ---- 12d: reconcile against the 31 Oct statement, Rs 84,066.
    let rec = await post<Detail>("/reconciliations", { companyId, accountCode: HDFC, statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(84_066) });
    expect(rec.header.beginningBalancePaise).toBe(0);
    expect(rec.candidates).toHaveLength(6);
    const line = (d: Detail, date: string, inRs: number, outRs: number): number => {
      const hit = d.candidates.filter((c) => c.entryDate === date && c.inPaise === RS(inRs) && c.outPaise === RS(outRs));
      expect(hit, `${date} in ${inRs} out ${outRs}`).toHaveLength(1);
      return hit[0]!.journalLineId;
    };
    const id = rec.header.id;
    rec = await post<Detail>(`/reconciliations/${id}/ticks`, {
      journalLineIds: [line(rec, "2025-10-01", 50_000, 0), line(rec, "2025-10-03", 12_000, 0), line(rec, "2025-10-08", 23_600, 0), line(rec, "2025-10-20", 0, 1_180)],
      ticked: true,
    }, 200);
    expect(rec.clearedBalancePaise).toBe(RS(84_420));
    expect(rec.differencePaise).toBe(-RS(354));
    // The register's status column: C for the four ticked, blank for the two not yet cleared.
    const statuses = async (): Promise<Array<string | null>> =>
      (await get<{ rows: Array<{ reconciliationStatus: string | null }> }>(`/bank-accounts/${HDFC}/register?companyId=${companyId}`)).rows.map((r) => r.reconciliationStatus);
    expect(await statuses()).toEqual(["C", "C", "C", null, "C", null]);
    const refused = await app.inject({ method: "POST", url: `/reconciliations/${id}/finish` });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain("Rs 354");

    // The bank's Rs 354 charge (Rs 300 + 9% CGST 27 + 9% SGST 27), a Payment Voucher from HDFC, 31 Oct.
    const pv = await post<{ number: string; totalPaise: number }>("/vouchers", {
      kind: "PAYMENT", businessId, date: "2025-10-31", moneyAccount: HDFC, partyName: "HDFC Bank", narration: "Charges per statement",
      lines: [{ account: "BANK_CHARGES", amountPaise: RS(300) }, { account: "INPUT_CGST", amountPaise: RS(27) }, { account: "INPUT_SGST", amountPaise: RS(27) }],
    });
    expect(pv).toMatchObject({ number: "PV-001/25-26", totalPaise: RS(354) });

    rec = await get<Detail>(`/reconciliations/${id}`);
    rec = await post<Detail>(`/reconciliations/${id}/ticks`, { journalLineIds: [line(rec, "2025-10-31", 0, 354)], ticked: true }, 200);
    expect(rec.differencePaise).toBe(0);
    const finished = await post<Detail>(`/reconciliations/${id}/finish`, {}, 200);
    expect(finished.header.status).toBe("FINISHED");
    // After finishing: R for the five reconciled (incl. the 31 Oct charge), blank for the two in transit.
    expect(await statuses()).toEqual(["R", "R", "R", null, "R", null, "R"]);

    // Book balance 71,966 = statement 84,066 - cheque issued 18,000 + deposit in transit 5,900.
    const after = await get<{ closingBalancePaise: number }>(`/bank-accounts/${HDFC}/register?companyId=${companyId}`);
    expect(after.closingBalancePaise).toBe(RS(71_966));
    const report = await get<{ endingBalancePaise: number; unclearedLines: Candidate[] }>(`/reconciliations/${id}/report`);
    expect(report.endingBalancePaise).toBe(RS(84_066));
    expect(report.unclearedLines.map((l) => [l.entryDate, l.inPaise, l.outPaise])).toEqual([
      ["2025-10-15", 0, RS(18_000)],
      ["2025-10-28", RS(5_900), 0],
    ]);
    expect(RS(84_066) - RS(18_000) + RS(5_900)).toBe(after.closingBalancePaise);

    // ---- November starts from the statement, with exactly the two uncleared October items offered.
    const nov = await post<Detail>("/reconciliations", { companyId, accountCode: HDFC, statementEndDate: "2025-11-30", statementEndingBalancePaise: RS(71_966) });
    expect(nov.header.beginningBalancePaise).toBe(RS(84_066));
    expect(nov.candidates.map((c) => c.entryDate)).toEqual(["2025-10-15", "2025-10-28"]);

    // ---- The books still hold: trial balance nets to zero, P&L is the same on both bases (all of
    // October's money moved in October), and the audit chain is intact.
    const tb = repository.getTrialBalance({ businessId });
    expect(tb.reduce((s, r) => s + r.debitPaise - r.creditPaise, 0)).toBe(0);
    const october = { fromDate: "2025-10-01", toDate: "2025-10-31" };
    const accrual = repository.getProfitAndLoss({ ...october, basis: "ACCRUAL" });
    const cashBasis = repository.getProfitAndLoss({ ...october, basis: "CASH" });
    expect(accrual.totalIncomePaise).toBe(RS(29_500)); // 23,600 + 5,900
    expect(cashBasis.totalIncomePaise).toBe(accrual.totalIncomePaise);
    expect(cashBasis.totalExpensesPaise).toBe(accrual.totalExpensesPaise);
    expect(verifyAuditChain(repository.db).ok).toBe(true);

    // ---- A payment cleared in October and cancelled LATER (by the real cancel route, whose
    // reversal is dated today, outside October) is still reported against October as CANCELLED.
    await post(`/payments/${neft.id}/cancel`, { reason: "Entered against the wrong customer" }, 200);
    const reportAfterCancel = await get<{ changedAfterFinishing: Array<Candidate & { change: string }> }>(`/reconciliations/${id}/report`);
    expect(reportAfterCancel.changedAfterFinishing.map((l) => [l.change, l.outPaise])).toEqual([["CANCELLED", RS(23_600)]]);

    // The opening set uses the OTHER reversal naming (je-opening-balance-reversal-<id>); reversing it
    // later must be reported too, since its HDFC line was cleared in October.
    await post(`/opening-balances/${opening.id}/reverse`, { reversedOn: "2025-12-01" }, 200);
    const reportAfterOpening = await get<{ changedAfterFinishing: Array<Candidate & { change: string }> }>(`/reconciliations/${id}/report`);
    expect(reportAfterOpening.changedAfterFinishing.map((l) => [l.change, l.outPaise]).sort()).toEqual([["CANCELLED", RS(23_600)], ["CANCELLED", RS(50_000)]].sort());
    expect(verifyAuditChain(repository.db).ok).toBe(true);
  });
});
