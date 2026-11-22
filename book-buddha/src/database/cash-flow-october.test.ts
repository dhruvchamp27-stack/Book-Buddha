import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { applyCashFlowSectionSchema } from "./cash-flow-section-schema.js";
import { getCashFlow } from "./cash-flow.js";
import { AccountingRepository } from "./repository.js";

/**
 * Cash Flow Statement on the October 2025 world. This file only BUILDS that world (the same
 * business events as src/e2e/october.e2e.test.ts, through the real HTTP routes) and asserts the
 * cash-flow report. It asserts no other figure: the October figures are owned by the e2e test.
 * "Today" is pinned to 31 Oct 2025 (IST) so the cancellation lands on 31 Oct.
 */
const RS = (rupees: number): number => rupees * 100;
const TIMEOUT = 120_000;

let repository: AccountingRepository;
let app: FastifyInstance;
let tmp: string;

async function call<T>(method: "GET" | "POST", url: string, payload?: object, status = 200): Promise<T> {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
}

interface QueueEntry { line: { id: string; txnDate: string } }

const STATEMENT = [
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "03/10/25,CASH DEPOSIT-FAIR,,03/10/25,,\"12,000.00\",\"62,000.00\"",
  "08/10/25,NEFT CR-RAMAN BOOKS,UTR123,08/10/25,,\"23,600.00\",\"85,600.00\"",
  "20/10/25,UPI-PRINTING HOUSE,UPI-20OCT,20/10/25,\"1,180.00\",,\"84,420.00\"",
  "31/10/25,CHGS INCL GST,,31/10/25,354.00,,\"84,066.00\"",
].join("\r\n");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2025-10-31T06:30:00Z"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cashflow-oct-"));
  repository = new AccountingRepository();
  applyCashFlowSectionSchema(repository.db);
  app = buildApi(repository, { __unsafeDisableAuthForTests: true, attachmentStorageRoot: path.join(tmp, "a"), backupsRoot: path.join(tmp, "b") });
  await app.ready();
});

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  repository.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Cash Flow Statement on the October 2025 world", () => {
  it("1-31 Oct 2025: opening 70,000, closing 80,516, every line, and it ties to the ledger", async () => {
    const companyId = (await call<{ id: string }>("POST", "/companies", { name: "Demo Books", accountingBasis: "ACCRUAL" }, 201)).id;
    const businessId = (await call<{ id: string }>("POST", "/businesses", { companyId, name: "Book Fairs" }, 201)).id;
    await call("POST", "/financial-years", { businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" }, 201);
    const raman = (await call<{ id: string }>("POST", "/customers", { companyId, name: "Raman Books" }, 201)).id;
    const sunrise = (await call<{ id: string }>("POST", "/customers", { companyId, name: "Sunrise School" }, 201)).id;
    const om = (await call<{ id: string }>("POST", "/suppliers", { companyId, name: "Om Publishers" }, 201)).id;
    const printHub = (await call<{ id: string }>("POST", "/suppliers", { companyId, name: "Print Hub" }, 201)).id;
    const novel = (await call<{ id: string }>("POST", "/items", { companyId, name: "Novel A", unit: "each", trackStock: true }, 201)).id;
    const notebook = (await call<{ id: string }>("POST", "/items", { companyId, name: "Notebook", unit: "each", trackStock: true }, 201)).id;
    await call("POST", "/accounts", { companyId, code: "PRINTING", name: "Printing", type: "EXPENSE" }, 201);
    await call("POST", "/accounts", { companyId, code: "BANK_CHARGES", name: "Bank Charges", type: "EXPENSE" }, 201);
    const HDFC = (await call<{ bankAccount: { code: string } }>("POST", "/bank-accounts", { companyId, name: "HDFC Current", kind: "CURRENT" }, 201)).bankAccount.code;
    const fairId = (await call<{ id: string }>("POST", "/fairs", { companyId, hostCustomerId: sunrise, name: "Pune Book Fair", startsAt: "2025-10-20", endsAt: "2025-10-22" }, 201)).id;

    // Events 1-4 (1 Oct): opening cash and bank, Raman owes 5,900, we owe Om 3,000, opening stock.
    await call("POST", "/opening-balances", {
      businessId, asAt: "2025-10-01",
      lines: [{ account: HDFC, debitPaise: RS(50_000), creditPaise: 0 }, { account: "CASH", debitPaise: RS(20_000), creditPaise: 0 }],
    }, 201);
    const openingRaman = (await call<{ id: string }>("POST", "/opening-customer-balances", { businessId, customerId: raman, asAt: "2025-10-01", amountPaise: RS(5_900), incomePaise: 0 }, 201)).id;
    const openingOm = (await call<{ id: string }>("POST", "/opening-supplier-balances", { businessId, supplierId: om, asAt: "2025-10-01", amountPaise: RS(3_000) }, 201)).id;
    await call("POST", "/inventory/movements", { itemId: novel, movementType: "OPENING", quantity: 150, unitCostPaise: RS(100), businessId, occurredOn: "2025-10-01" }, 201);

    // Events 5-7: INV-001 on credit, fair cash banked (transfer), the opening supplier balance paid in cash.
    await call("POST", "/invoices", {
      id: "inv-001",businessId, customerId: raman, paymentAccount: "RECEIVABLES",
      invoiceDate: "2025-10-02", taxType: "NONE", taxRateBasisPoints: 0,
      lines: [{ itemId: novel, description: "Novel A", quantity: 118, unitPricePaise: RS(200) }],
    }, 201);
    await call("POST", "/invoices/inv-001/finalize", {});
    await call("POST", "/internal-transfers", { businessId, date: "2025-10-03", fromAccount: "CASH", toAccount: HDFC, amountPaise: RS(12_000), memo: "Fair cash banked" }, 201);
    await call("POST", `/opening-supplier-balances/${openingOm}/settlements`, { amountPaise: RS(3_000), paidOn: "2025-10-06", moneyAccount: "CASH" }, 201);

    // The bank statement arrives; its lines feed events 8, 13 and 23.
    const file = { fileName: "hdfc-oct.csv", contentBase64: Buffer.from(STATEMENT, "utf8").toString("base64") };
    const inspected = await call<{ suggestedMap: Record<string, string> }>("POST", "/bank-statements/inspect", file);
    await call("POST", "/bank-statements/commit", { ...file, companyId, accountCode: HDFC, businessId, columnMap: inspected.suggestedMap, dateFormat: "DD/MM/YYYY" });
    const queueOf = async (): Promise<QueueEntry[]> => (await call<{ lines: QueueEntry[] }>("GET", `/bank-feed/lines?companyId=${companyId}&accountCode=${HDFC}`)).lines;
    const lineOn = async (date: string): Promise<string> => (await queueOf()).find((q) => q.line.txnDate === date)!.line.id;

    // Event 8: the 23,600 NEFT is the payment of INV-001.
    await call("POST", `/bank-feed/lines/${await lineOn("2025-10-08")}/match`, {
      documents: [{ kind: "INVOICE", id: "inv-001", amountPaise: RS(23_600) }], paymentMode: "NEFT", confirm: true,
    });
    // Events 9-12: PB-001 on credit, paid by cheque; PB-002 in cash with GST; PR-001 return.
    const pb001 = (await call<{ id: string }>("POST", "/purchase-bills", {
      businessId, supplierId: om, number: "PB-001", billDate: "2025-10-10", paymentAccount: "PAYABLES",
      lines: [{ itemId: novel, description: "Novel A", quantity: 120, unitPricePaise: RS(150) }],
    }, 201)).id;
    await call("POST", `/purchase-bills/${pb001}/finalize`, {});
    await call("POST", "/supplier-payments", { billId: pb001, amountPaise: RS(18_000), paidOn: "2025-10-15", moneyAccount: HDFC, paymentMode: "CHEQUE", paymentReference: "CHQ 000451" }, 201);
    const pb002 = (await call<{ id: string }>("POST", "/purchase-bills", {
      businessId, supplierId: printHub, number: "PB-002", billDate: "2025-10-16", paymentAccount: "CASH", moneyAccount: "CASH",
      taxType: "CGST_SGST", taxRateBasisPoints: 1800,
      lines: [{ itemId: notebook, description: "Notebook", quantity: 100, unitPricePaise: RS(25) }],
    }, 201)).id;
    await call("POST", `/purchase-bills/${pb002}/finalize`, {});
    const pr001 = (await call<{ id: string }>("POST", "/purchase-returns", {
      billId: pb001,reason: "Damaged copies", returnDate: "2025-10-18",
      lines: [{ itemId: novel, description: "Novel A", quantity: 10, unitPricePaise: RS(150) }],
    }, 201)).id;
    await call("POST", `/purchase-returns/${pr001}/finalize`, {});

    // Events 13-21: printer voucher from the feed, fair cash sales, stall rent, CN-001, INV-004, refund, receipts.
    await call("POST", `/bank-feed/lines/${await lineOn("2025-10-20")}/add`, {
      splits: [{ accountCode: "PRINTING", amountPaise: RS(1_000) }, { accountCode: "INPUT_CGST", amountPaise: RS(90) }, { accountCode: "INPUT_SGST", amountPaise: RS(90) }],
      partyName: "Printing House", paymentMode: "UPI", confirm: true,
    });
    await call("POST", "/invoices", {
      id: "inv-002",businessId, customerId: sunrise, buyerName: "Walk-in buyer", paymentAccount: "CASH", moneyAccount: "CASH", fairId,
      invoiceDate: "2025-10-21", taxType: "NONE", taxRateBasisPoints: 0,
      lines: [{ itemId: novel, description: "Novel A", quantity: 30, unitPricePaise: RS(200) }],
    }, 201);
    await call("POST", "/invoices/inv-002/finalize", {});
    await call("POST", "/invoices", {
      id: "inv-003",businessId, customerId: sunrise, buyerName: "Walk-in buyer", paymentAccount: "CASH", moneyAccount: "CASH", fairId,
      invoiceDate: "2025-10-21", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
      lines: [{ itemId: notebook, description: "Notebook", quantity: 50, unitPricePaise: RS(40) }],
    }, 201);
    await call("POST", "/invoices/inv-003/finalize", {});
    const exp = (await call<{ id: string }>("POST", "/expenses", {
      businessId, number: "EXP-001", expenseDate: "2025-10-21", description: "Fair stall rent", amountPaise: RS(2_000),
      paymentAccount: "CASH", moneyAccount: "CASH", taxType: "CGST_SGST", taxRateBasisPoints: 1800, fairId,
    }, 201)).id;
    await call("POST", `/expenses/${exp}/finalize`, {});
    const cn = (await call<{ id: string }>("POST", "/credit-notes", {
      invoiceId: "inv-002",reason: "Customer returned 5 books", noteDate: "2025-10-22",
      lines: [{ itemId: novel, description: "Novel A", quantity: 5, unitPricePaise: RS(200) }],
    }, 201)).id;
    await call("POST", `/credit-notes/${cn}/finalize`, {});
    await call("POST", "/invoices", {
      id: "inv-004",businessId, customerId: sunrise, paymentAccount: "RECEIVABLES", fairId,
      invoiceDate: "2025-10-22", taxType: "NONE", taxRateBasisPoints: 0,
      lines: [{ itemId: novel, description: "Novel A", quantity: 20, unitPricePaise: RS(250) }],
    }, 201);
    await call("POST", "/invoices/inv-004/finalize", {});
    await call("POST", `/purchase-returns/${pr001}/refunds`, { amountPaise: RS(1_500), refundedOn: "2025-10-24", moneyAccount: "CASH" }, 201);
    const pay = (await call<{ id: string }>("POST", "/invoices/inv-004/payments", { amountPaise: RS(5_000), paidOn: "2025-10-25", moneyAccount: "CASH" }, 201)).id;
    await call("POST", `/opening-customer-balances/${openingRaman}/receipts`, { amountPaise: RS(5_900), receivedOn: "2025-10-28", moneyAccount: HDFC, paymentMode: "CHEQUE" }, 201);

    // Events 22-23 (31 Oct): the 25 Oct payment is cancelled by reversal; bank charges added from the feed.
    await call("POST", `/payments/${pay}/cancel`, { reason: "Recorded in error" });
    await call("POST", `/bank-feed/lines/${await lineOn("2025-10-31")}/add`, {
      splits: [{ accountCode: "BANK_CHARGES", amountPaise: RS(300) }, { accountCode: "INPUT_CGST", amountPaise: RS(27) }, { accountCode: "INPUT_SGST", amountPaise: RS(27) }],
      partyName: "HDFC Bank", confirm: true,
    });

    // ---- The cash-flow report (the only figures asserted in this file).
    const r = getCashFlow(repository.db, { businessId, from: "2025-10-01", to: "2025-10-31" });
    expect(r.openingCashPaise).toBe(RS(70_000)); // HDFC 50,000 + Cash 20,000, opening balances dated 1 Oct
    expect(r.sections.operating).toEqual([
      // in: 23,600 NEFT + 6,000 + 2,360 fair sales + 5,000 receipt (25 Oct) + 5,900 opening receipt; out: 1,000 credit-note refund + 5,000 cancellation
      { label: "Cash received from customers", inflowPaise: RS(42_860), outflowPaise: RS(6_000), netPaise: RS(36_860) },
      // out: Om settlement 3,000 + Print Hub 18,000 + PB-002 2,950 (stock plus its GST); in: 1,500 supplier refund
      { label: "Cash paid to suppliers", inflowPaise: RS(1_500), outflowPaise: RS(23_950), netPaise: -RS(22_450) },
      // out: rent 2,000 + GST 360, printing 1,000 + GST 180, bank charges 300 + GST 54
      { label: "Cash paid for expenses", inflowPaise: 0, outflowPaise: RS(3_894), netPaise: -RS(3_894) },
    ]);
    expect(r.sections.investing).toEqual([]);
    expect(r.sections.financing).toEqual([]);
    expect(r.netChangePaise).toBe(RS(10_516));
    expect(r.closingCashPaise).toBe(RS(80_516)); // HDFC 71,966 + Cash 8,550
    expect(r.tie).toEqual({ closingFromLedgerPaise: RS(80_516), ok: true });
  }, TIMEOUT);
});
