import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import { applyMoneyMovementsSchema } from "./money-movements-schema.js";
import { createInternalTransfer } from "./internal-transfers.js";
import { createVoucher } from "./vouchers.js";

/**
 * R12c test 11. Depends on Builder B's change to AccountingRepository.deriveCashView (entries with
 * source_type MONEY_VOUCHER are cash on their own date). It may fail until the builds are integrated.
 */
let r: AccountingRepository;
let businessId: string;

beforeEach(() => {
  r = new AccountingRepository();
  applyMoneyMovementsSchema(r.db);
  const companyId = r.createCompany({ name: "Co", accountingBasis: "CASH" });
  businessId = r.createBusiness({ companyId, name: "Biz" });
  const now = new Date().toISOString();
  r.db
    .prepare("INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES ('HDFC', ?, 'HDFC', 'ASSET', 'BANK', NULL, 1, ?, ?)")
    .run(companyId, now, now);
});
afterEach(() => r.close());

describe("receipt voucher on the cash basis (R12c, needs Builder B's deriveCashView change)", () => {
  it("Rs 412 interest received on 20 Oct shows as +412 October cash-basis income, and an internal transfer moves no figure", () => {
    createVoucher(r.db, {
      kind: "RECEIPT", businessId, date: "2025-10-20", moneyAccount: "HDFC",
      lines: [{ account: "OTHER_INCOME", amountPaise: 41_200 }],
    });
    const october = { fromDate: "2025-10-01", toDate: "2025-10-31" };
    expect(r.getProfitAndLoss({ ...october, basis: "ACCRUAL" }).totalIncomePaise).toBe(41_200);
    expect(r.getProfitAndLoss({ ...october, basis: "CASH" }).totalIncomePaise).toBe(41_200);

    const before = r.getProfitAndLoss({ ...october, basis: "CASH" });
    createInternalTransfer(r.db, { businessId, date: "2025-10-25", fromAccount: "HDFC", toAccount: "CASH", amountPaise: 10_000 });
    expect(r.getProfitAndLoss({ ...october, basis: "CASH" })).toEqual(before);
  });
});
