import Fastify, { type FastifyContextConfig, type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Invoice } from "../accounting/types.js";
import type { CreditNote } from "../accounting/types.js";
import { ACCOUNT_TYPES } from "../database/chart-accounts-schema.js";
import {
  AccountingRepository,
  AuthenticationError,
  CUSTOMER_CLASSIFICATIONS,
  CUSTOMER_NUMBERING_CATEGORIES,
  RepositoryValidationError,
} from "../database/repository.js";

const id = z.string().trim().min(1);
const name = z.string().trim().min(1);
const invoiceLine = z.object({
  itemId: id.optional(),
  description: name,
  quantity: z.number().int().positive(),
  unitPricePaise: z.number().int().nonnegative(),
});

const companyInput = z.object({
  name,
  accountingBasis: z.enum(["CASH", "ACCRUAL"]).default("ACCRUAL"),
});
const businessInput = z.object({ companyId: id, name });
const optionalText = z.string().trim().min(1);
const customerInput = z.object({
  companyId: id,
  name,
  email: z.string().email().optional(),
  phone: z.string().trim().min(1).optional(),
  classification: z.enum(CUSTOMER_CLASSIFICATIONS).optional(),
  gstin: optionalText.optional(),
  website: optionalText.optional(),
  phone2: optionalText.optional(),
  billingAddress: optionalText.optional(),
  shippingAddress: optionalText.optional(),
  internalNotes: optionalText.optional(),
  numberingCategory: z.enum(CUSTOMER_NUMBERING_CATEGORIES).optional(),
});
const nullableText = optionalText.nullable().optional();
const customerPatchInput = z.object({
  name: name.optional(),
  email: z.string().email().nullable().optional(),
  phone: nullableText,
  classification: z.enum(CUSTOMER_CLASSIFICATIONS).nullable().optional(),
  gstin: nullableText,
  website: nullableText,
  phone2: nullableText,
  billingAddress: nullableText,
  shippingAddress: nullableText,
  internalNotes: nullableText,
});
const itemInput = z.object({
  companyId: id,
  name,
  unit: name,
  trackStock: z.boolean().optional(),
  description: optionalText.optional(),
  sellingPricePaise: z.number().int().nonnegative().optional(),
  costPricePaise: z.number().int().nonnegative().optional(),
  mrpPaise: z.number().int().nonnegative().optional(),
  reorderThreshold: z.number().int().nonnegative().optional(),
});
const itemPatchInput = z.object({
  name: name.optional(),
  unit: name.optional(),
  description: nullableText,
  sellingPricePaise: z.number().int().nonnegative().nullable().optional(),
  costPricePaise: z.number().int().nonnegative().nullable().optional(),
  mrpPaise: z.number().int().nonnegative().nullable().optional(),
  reorderThreshold: z.number().int().nonnegative().nullable().optional(),
});
const activeInput = z.object({ active: z.boolean() });
// Chart of accounts (S2-1). No role, no normal side, no cash-view flag: control accounts are the
// engine's own and the rest is derived from the class.
const accountInput = z.object({
  companyId: id,
  code: z.string().trim().min(2).max(40),
  name: name,
  type: z.enum(ACCOUNT_TYPES),
  parentCode: id.optional(),
});
const accountRenameInput = z.object({ name: name });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date written as YYYY-MM-DD");
const financialYearInput = z.object({ businessId: id, startsOn: isoDate, endsOn: isoDate });
const lockInput = z.object({ locked: z.boolean(), reason: z.string().trim().min(1).optional() });
/** R8. Cancelling a payment: an optional reason, recorded on the row beside the reversal. */
const cancellationInput = z.object({ reason: z.string().trim().min(1).optional() })
  .strict().transform((value) => definedOnly(value));
const openingBalanceInput = z.object({
  businessId: id,
  asAt: isoDate,
  lines: z
    .array(z.object({ account: id, debitPaise: z.number().int().nonnegative(), creditPaise: z.number().int().nonnegative() }))
    .min(1),
});
const openingBalanceReverseInput = z.object({ reversedOn: isoDate });
const openingCustomerBalanceInput = z.object({
  businessId: id,
  customerId: id,
  asAt: isoDate,
  amountPaise: z.number().int().positive(),
  incomePaise: z.number().int().nonnegative().default(0),
  incomeAccount: id.optional(),
});
const openingSupplierBalanceInput = z.object({ businessId: id, supplierId: id, asAt: isoDate, amountPaise: z.number().int().positive() });
const openingReceiptInput = z.object({ amountPaise: z.number().int().positive(), receivedOn: isoDate, paymentAccount: z.enum(["CASH", "BANK"]) });
const openingSettlementInput = z.object({ amountPaise: z.number().int().positive(), paidOn: isoDate, paymentAccount: z.enum(["CASH", "BANK"]) });
const activeOnlyQuery = (value: string | undefined): boolean => value === "true" || value === "1";
const invoiceInput = z.object({
  id: id.optional(),
  status: z.enum(["DRAFT", "QUOTATION"]).default("DRAFT"),
  number: name,
  businessId: id,
  customerId: id,
  paymentAccount: z.enum(["CASH", "RECEIVABLES"]),
  fairId: id.optional(),
  buyerName: name.optional(),
  buyerContact: z.string().trim().min(1).optional(),
  invoiceDate: z.string().date().default(new Date().toISOString().slice(0, 10)),
  dueDate: z.string().date().optional(),
  discountPaise: z.number().int().nonnegative().default(0),
  extraChargePaise: z.number().int().nonnegative().default(0),
  notes: z.string().trim().optional(),
  paymentTerms: z.string().trim().optional(),
  taxType: z.enum(["NONE", "CGST_SGST", "IGST"]).default("NONE"),
  taxRateBasisPoints: z.number().int().min(0).max(10000).default(0),
  lines: z.array(invoiceLine).min(1),
}).superRefine((input, context) => {
  if (input.dueDate !== undefined && input.dueDate < input.invoiceDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dueDate"],
      message: "Due date cannot be before the invoice date.",
    });
  }
  const subtotal = input.lines.reduce(
    (total, line) => total + line.quantity * line.unitPricePaise,
    0,
  );
  if (input.discountPaise > subtotal) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discountPaise"],
      message: "Discount cannot exceed the invoice subtotal.",
    });
  }
  if (input.taxType === "NONE" && input.taxRateBasisPoints !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["taxType"], message: "A tax rate requires a tax type." });
  }
  if (input.taxType !== "NONE" && input.taxRateBasisPoints === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["taxRateBasisPoints"], message: "Tax rate must be positive for a taxable invoice." });
  }
});
const supplierInput = z.object({
  companyId: id,
  name,
  email: z.string().email().optional(),
  phone: optionalText.optional(),
  phone2: optionalText.optional(),
  classification: z.enum(CUSTOMER_CLASSIFICATIONS).optional(),
  gstin: optionalText.optional(),
  website: optionalText.optional(),
  billingAddress: optionalText.optional(),
  shippingAddress: optionalText.optional(),
  internalNotes: optionalText.optional(),
});
const supplierPatchInput = z.object({
  name: name.optional(),
  email: z.string().email().nullable().optional(),
  phone: nullableText,
  phone2: nullableText,
  classification: z.enum(CUSTOMER_CLASSIFICATIONS).nullable().optional(),
  gstin: nullableText,
  website: nullableText,
  billingAddress: nullableText,
  shippingAddress: nullableText,
  internalNotes: nullableText,
});
const purchaseTaxFields = {
  taxType: z.enum(["NONE", "CGST_SGST", "IGST"]).default("NONE"),
  taxRateBasisPoints: z.number().int().min(0).max(10000).default(0),
};
const purchaseBillInput = z.object({
  id: id.optional(),
  businessId: id,
  supplierId: id,
  fairId: id.optional(),
  number: name,
  supplierInvoiceNumber: optionalText.optional(),
  billDate: z.string().date().default(new Date().toISOString().slice(0, 10)),
  dueDate: z.string().date().optional(),
  notes: z.string().trim().optional(),
  paymentAccount: z.enum(["CASH", "PAYABLES"]),
  ...purchaseTaxFields,
  lines: z.array(invoiceLine).min(1),
});
const expenseCategoryInput = z.object({ companyId: id, name });
const expenseInput = z.object({
  id: id.optional(),
  businessId: id,
  supplierId: id.optional(),
  categoryId: id.optional(),
  fairId: id.optional(),
  number: name,
  expenseDate: z.string().date().default(new Date().toISOString().slice(0, 10)),
  description: name,
  amountPaise: z.number().int().positive(),
  paymentAccount: z.enum(["CASH", "PAYABLES"]),
  ...purchaseTaxFields,
});
const paidOn = z.string().date("Use a real date written as YYYY-MM-DD.").optional();
const supplierPaymentInput = z.object({
  billId: id.optional(),
  expenseId: id.optional(),
  amountPaise: z.number().int().positive(),
  paidOn,
});
const documentStatus = (value: string | undefined): "DRAFT" | "FINALIZED" | "CANCELLED" | undefined => {
  if (value === undefined) return undefined;
  if (value !== "DRAFT" && value !== "FINALIZED" && value !== "CANCELLED") {
    throw new RepositoryValidationError("status must be DRAFT, FINALIZED or CANCELLED.");
  }
  return value;
};
const paymentInput = z.object({
  amountPaise: z.number().int().positive(),
  paidOn,
});
const fairInput = z.object({
  companyId: id,
  hostCustomerId: id,
  name,
  startsAt: z.string().date().optional(),
  endsAt: z.string().date().optional(),
});
const stockMovementInput = z.object({
  itemId: id,
  quantity: z.number().int().positive(),
  unitCostPaise: z.number().int().nonnegative(),
  movementType: z.enum(["OPENING", "PURCHASE", "ADJUSTMENT"]),
  fairId: id.optional(),
  /** R4c: whose ledger an OPENING/ADJUSTMENT movement posts to. Optional only when there is one. */
  businessId: id.optional(),
  /** R4c: the date the journal entry carries. The stock layer itself stays append-only. */
  occurredOn: z.string().date().optional(),
});
/** R4c: posting the journal entries that hand-entered stock movements never got. */
const stockBackfillInput = z.object({
  businessId: id,
  /** Absent or false = DRY RUN. Nothing is written unless this is explicitly true. */
  apply: z.boolean().optional(),
});
const creditNoteInput = z.object({
  invoiceId: id,
  number: name,
  reason: name,
  lines: z.array(invoiceLine).min(1),
});

/**
 * Discharging a credit note (S4-1, S4-5). The date is required on both, unlike a payment's
 * optional paidOn: a refund or an application is a deliberate, dated act, and defaulting it to
 * today would quietly drop the reduction into the wrong month of the cash P&L.
 */
const creditNoteRefundInput = z.object({
  amountPaise: z.number().int().positive(),
  refundedOn: z.string().date("Use a real date written as YYYY-MM-DD."),
  // BANK is reachable here, and only here: payments.payment_account is still CHECK IN ('CASH').
  paymentAccount: z.enum(["CASH", "BANK"]),
});

const creditNoteApplicationInput = z.object({
  invoiceId: id,
  amountPaise: z.number().int().positive(),
  appliedOn: z.string().date("Use a real date written as YYYY-MM-DD."),
});

const recurringTemplateInput = z.object({
  id: id.optional(),
  businessId: id,
  customerId: id,
  paymentAccount: z.enum(["CASH", "RECEIVABLES"]),
  fairId: id.optional(),
  buyerName: name.optional(),
  buyerContact: z.string().trim().min(1).optional(),
  discountPaise: z.number().int().nonnegative().default(0),
  extraChargePaise: z.number().int().nonnegative().default(0),
  notes: z.string().trim().optional(),
  paymentTerms: z.string().trim().optional(),
  taxType: z.enum(["NONE", "CGST_SGST", "IGST"]).default("NONE"),
  taxRateBasisPoints: z.number().int().min(0).max(10000).default(0),
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
  intervalCount: z.number().int().positive().default(1),
  startDate: z.string().date(),
  nextRunDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  lines: z.array(invoiceLine).min(1),
});
const recurringTemplateUpdate = z.object({
  active: z.boolean().optional(),
  nextRunDate: z.string().date().optional(),
}).refine((value) => value.active !== undefined || value.nextRunDate !== undefined, {
  message: "Provide active and/or nextRunDate.",
});
const generateInput = z.object({
  asOfDate: z.string().date().optional(),
}).default({});

const authSetupInput = z.object({
  password: z.string().min(1),
  email: z.string().email().optional(),
  googleSub: z.string().trim().min(1).optional(),
});
const authLoginInput = z.object({ password: z.string().min(1) });
const authChangePasswordInput = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });
// Recovery is by recovery code only (S6-3). The old googleSub/email identity match
// is gone: it was no secret at all, and it reset the password of anyone whose email
// address was known.
const authRecoverInput = z.object({
  recoveryCode: z.string().trim().min(1),
  newPassword: z.string().min(1),
});
const authRecoveryCodeInput = z.object({ currentPassword: z.string().min(1) });

const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date written as YYYY-MM-DD.");
/** Period reports (P&L, General Ledger): optional business and date range. */
const periodReportQuery = z.object({
  businessId: id.optional(),
  fairId: id.optional(),
  fromDate: reportDate.optional(),
  toDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));
/**
 * Profit and Loss: the period filters plus an optional basis. Omitted means the business's
 * company default (its stored accounting_basis), or ACCRUAL when no business is given.
 */
const profitAndLossQuery = z.object({
  businessId: id.optional(),
  fairId: id.optional(),
  fromDate: reportDate.optional(),
  toDate: reportDate.optional(),
  basis: z.enum(["CASH", "ACCRUAL"]).optional(),
}).strict().transform((value) => definedOnly(value));
/** Balance Sheet: optional business and a single as-at date. No fairId (strict): there is no per-fair Balance Sheet. */
const asAtReportQuery = z.object({
  businessId: id.optional(),
  asAtDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));
/** Trial Balance: the as-at filters plus an optional project (fair). */
const trialBalanceQuery = z.object({
  businessId: id.optional(),
  fairId: id.optional(),
  asAtDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));

/** R7b. The sales reports: period filters plus a customer. */
const salesReportQuery = z.object({
  businessId: id.optional(),
  fairId: id.optional(),
  customerId: id.optional(),
  fromDate: reportDate.optional(),
  toDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));
/**
 * The credit-note and returns reports also take an item. The money reports refuse it by name
 * (sales are posted per invoice, not per item), which is why it is not on `salesReportQuery`.
 */
const creditNoteReportQuery = z.object({
  businessId: id.optional(),
  fairId: id.optional(),
  customerId: id.optional(),
  itemId: id.optional(),
  fromDate: reportDate.optional(),
  toDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));
/** R7b. The day book and account detail. */
const transactionReportQuery = salesReportQuery;
/**
 * R7b. What is still owed, and its ageing. `asAtDate` is the date everything is aged against;
 * omitted means today. It is passed IN rather than read from the clock so the same books asked
 * the same question twice give the same answer.
 */
const customerOpenItemsQuery = z.object({
  businessId: id.optional(),
  customerId: id.optional(),
  asAtDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));
/** The supplier mirror. */
const openItemsQuery = z.object({
  businessId: id.optional(),
  supplierId: id.optional(),
  asAtDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));
/** R7b. Stock movements, which are keyed on item rather than business. */
const stockMovementQuery = z.object({
  itemId: id.optional(),
  fairId: id.optional(),
  customerId: id.optional(),
  fromDate: reportDate.optional(),
  toDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));

/** Drops keys whose value is undefined (keeps null, which means "clear"). */
function definedOnly<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new RequestValidationError(result.error.issues);
  }
  return result.data;
}

class RequestValidationError extends Error {
  public readonly issues: readonly z.core.$ZodIssue[];

  public constructor(issues: readonly z.core.$ZodIssue[]) {
    super("Request validation failed.");
    this.name = "RequestValidationError";
    this.issues = issues;
  }
}

/** One registered route, with the authentication decision that applies to it. */
export interface ApiRouteRecord {
  readonly method: string;
  readonly url: string;
  readonly isPublic: boolean;
}

/**
 * The exact wording the authentication hook refuses with. Exported so a test can
 * prove the HOOK did the refusing rather than a route handler that happens to
 * return the same status — `/auth/session`, `/auth/logout` and
 * `/auth/change-password` all answer 401 on their own account.
 */
export const AUTH_HOOK_MESSAGES = {
  notSetUp: "This Book Buddha database is not set up yet. Create the administrator first.",
  noToken: "Sign in required to use Book Buddha.",
  invalidSession: "Your session is no longer valid. Please sign in again.",
} as const;

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Marks a route as reachable WITHOUT a session. Absence means NOT public, so
     * the default is deny and a newly added route is protected until someone
     * deliberately opens it here.
     */
    public?: boolean;
  }

  interface FastifyInstance {
    /**
     * Every route this instance registered, with the authentication decision that
     * applies to it. Collected by an `onRoute` hook inside `buildApi`, because
     * `onRoute` does not fire retroactively — a hook added after `buildApi`
     * returns sees nothing — and `printRoutes()` only yields a tree string that
     * would have to be parsed. `src/api/auth-enforcement.test.ts` derives its
     * route sweep from this, so a route added later is swept automatically
     * without anyone editing a list.
     */
    authRoutes: readonly ApiRouteRecord[];
  }
}

export interface BuildApiOptions {
  /**
   * Turns the authentication hook OFF so the API answers unauthenticated
   * requests. **TESTS ONLY — never set this anywhere a user's data can reach.**
   *
   * Why it exists: the test suite builds 28 API worlds whose repositories never
   * run `setupAdmin`, so a fail-closed API would answer all 208 of their injects
   * with 409. Signing in inside each world is not an option either — `setupAdmin`
   * and `login` write audit events and session rows, which would shift the
   * audit-chain sequence assertions and the fake-clock files.
   *
   * It is opt-in and defaults to OFF, so production is protected by default. It is
   * deliberately unreachable from `createApi` and from `src/api/main.ts`, and it is
   * read from no environment variable and no config file: a test has to pass it
   * here, in code, where a reader can see it.
   */
  readonly __unsafeDisableAuthForTests?: boolean;
}

export function buildApi(
  repository: AccountingRepository,
  options: BuildApiOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RequestValidationError) {
      return reply.code(400).send({
        error: error.message,
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    }
    if (error instanceof AuthenticationError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof RepositoryValidationError) {
      return reply.code(400).send({ error: error.message });
    }

    request.log.error(error);
    return reply.code(500).send({ error: "Internal server error." });
  });

  // ---- Auth. Token transport: `Authorization: Bearer <token>` header only.
  // The raw token is returned once by /auth/login; the server stores only its hash.
  const bearerToken = (header: string | undefined, message = "Sign in required."): string => {
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    if (match === null) throw new AuthenticationError(message, 401);
    return match[1] as string;
  };

  // ---- Authentication enforcement. FAIL CLOSED: a route is reachable without a
  // session only when it says so, in the open, with `config: { public: true }`.
  //
  // The decision is read from the matched route's own config and NEVER from the URL
  // string, so a route added later cannot slip through by resembling a public path.
  // An unmatched path carries no route config, so it is not public either and is
  // refused rather than told which paths exist.
  const isPublic = (config: FastifyContextConfig | undefined): boolean => config?.public === true;

  // Same predicate feeds the hook and the route table, so the two cannot drift.
  const authRoutes: ApiRouteRecord[] = [];
  app.decorate("authRoutes", authRoutes);
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      authRoutes.push({ method, url: route.url, isPublic: isPublic(route.config) });
    }
  });

  if (options.__unsafeDisableAuthForTests !== true) {
    app.addHook("onRequest", async (request) => {
      if (isPublic(request.routeOptions?.config)) return;

      // An unconfigured database refuses; it does not fall open and it does not
      // serve. 409 matches the convention `getAuthStatus`/`recoverPassword` already
      // use for "this database has no administrator yet".
      if (!repository.getAuthStatus().configured) {
        throw new AuthenticationError(AUTH_HOOK_MESSAGES.notSetUp, 409);
      }

      const token = bearerToken(request.headers.authorization, AUTH_HOOK_MESSAGES.noToken);
      if (repository.validateSession(token) === null) {
        throw new AuthenticationError(AUTH_HOOK_MESSAGES.invalidSession, 401);
      }
    });
  }

  // ---- The complete public surface. Everything not marked here needs a session.
  app.get("/health", { config: { public: true } }, async () => ({ status: "ok" }));

  app.get("/auth/status", { config: { public: true } }, async () => repository.getAuthStatus());

  app.post("/auth/setup", { config: { public: true } }, async (request, reply) => {
    const input = parseBody(authSetupInput, request.body);
    const result = repository.setupAdmin({
      password: input.password,
      ...(input.email === undefined ? {} : { email: input.email }),
      ...(input.googleSub === undefined ? {} : { googleSub: input.googleSub }),
    });
    // The recovery code is returned here and never again: only its hash is stored.
    // The caller must show it to the owner to write down.
    return reply.code(201).send({ id: result.userId, recoveryCode: result.recoveryCode });
  });

  app.post("/auth/login", { config: { public: true } }, async (request) => {
    const input = parseBody(authLoginInput, request.body);
    const { token, expiresAt } = repository.login(input.password);
    return { token, expiresAt };
  });

  app.post("/auth/logout", async (request) => {
    repository.logout(bearerToken(request.headers.authorization));
    return { ok: true };
  });

  app.get("/auth/session", async (request) => {
    const session = repository.validateSession(bearerToken(request.headers.authorization));
    if (session === null) throw new AuthenticationError("Your session has expired. Please sign in again.", 401);
    return session;
  });

  app.post("/auth/change-password", async (request) => {
    const input = parseBody(authChangePasswordInput, request.body);
    repository.changePassword({
      token: bearerToken(request.headers.authorization),
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
    return { ok: true };
  });

  // Public of necessity: someone who has forgotten the password has no session to
  // prove anything with, so the recovery code is the whole trust boundary (S6-3).
  // Using a code burns it; the replacement comes back once, here.
  app.post("/auth/recover", { config: { public: true } }, async (request) => {
    const input = parseBody(authRecoverInput, request.body);
    const result = repository.recoverPassword({
      recoveryCode: input.recoveryCode,
      newPassword: input.newPassword,
    });
    return { ok: true, recoveryCode: result.recoveryCode };
  });

  // NOT public: minting a recovery code needs a live session AND the current
  // password, so a stolen token alone cannot create a credential that outlives it.
  // This is also the only way a workspace set up before v16 can obtain a code.
  app.post("/auth/recovery-code", async (request) => {
    const input = parseBody(authRecoveryCodeInput, request.body);
    const result = repository.mintRecoveryCode({
      token: bearerToken(request.headers.authorization),
      currentPassword: input.currentPassword,
    });
    return { recoveryCode: result.recoveryCode };
  });

  app.get("/companies", async () => repository.listCompanies());

  app.get<{ Querystring: { companyId?: string } }>(
    "/businesses",
    async (request) => repository.listBusinesses(request.query.companyId),
  );

  app.get<{ Querystring: { companyId?: string } }>(
    "/fairs",
    async (request) => repository.listFairs(request.query.companyId),
  );

  app.get<{ Querystring: { companyId?: string; activeOnly?: string } }>(
    "/customers",
    async (request) =>
      repository.listCustomers(request.query.companyId, { activeOnly: activeOnlyQuery(request.query.activeOnly) }),
  );

  app.get<{ Querystring: { companyId?: string; name?: string; phone?: string; email?: string; gstin?: string } }>(
    "/customers/duplicates",
    async (request) => {
      const { companyId, name: dupName, phone, email, gstin } = request.query;
      if (companyId === undefined || companyId.trim() === "") {
        throw new RepositoryValidationError("companyId is required.");
      }
      return repository.findDuplicateCustomers({
        companyId,
        ...(dupName === undefined ? {} : { name: dupName }),
        ...(phone === undefined ? {} : { phone }),
        ...(email === undefined ? {} : { email }),
        ...(gstin === undefined ? {} : { gstin }),
      });
    },
  );

  app.get<{ Querystring: { companyId?: string; activeOnly?: string } }>(
    "/items",
    async (request) =>
      repository.listItems(request.query.companyId, { activeOnly: activeOnlyQuery(request.query.activeOnly) }),
  );

  app.post("/companies", async (request, reply) => {
    const input = parseBody(companyInput, request.body);
    const companyId = repository.createCompany(input);
    return reply.code(201).send({ id: companyId });
  });

  app.post("/businesses", async (request, reply) => {
    const input = parseBody(businessInput, request.body);
    const businessId = repository.createBusiness(input);
    return reply.code(201).send({ id: businessId });
  });

  app.post("/customers", async (request, reply) => {
    const input = parseBody(customerInput, request.body);
    const customerId = repository.createCustomer({
      companyId: input.companyId,
      name: input.name,
      ...(input.email === undefined ? {} : { email: input.email }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.classification === undefined ? {} : { classification: input.classification }),
      ...(input.gstin === undefined ? {} : { gstin: input.gstin }),
      ...(input.website === undefined ? {} : { website: input.website }),
      ...(input.phone2 === undefined ? {} : { phone2: input.phone2 }),
      ...(input.billingAddress === undefined ? {} : { billingAddress: input.billingAddress }),
      ...(input.shippingAddress === undefined ? {} : { shippingAddress: input.shippingAddress }),
      ...(input.internalNotes === undefined ? {} : { internalNotes: input.internalNotes }),
      ...(input.numberingCategory === undefined ? {} : { numberingCategory: input.numberingCategory }),
    });
    return reply.code(201).send({ id: customerId });
  });

  app.patch<{ Params: { id: string } }>("/customers/:id", async (request) => {
    const patch = parseBody(customerPatchInput, request.body);
    repository.updateCustomer(request.params.id, definedOnly(patch));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/customers/:id/active", async (request) => {
    const input = parseBody(activeInput, request.body);
    repository.setCustomerActive(request.params.id, input.active);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/customers/:id", async (request) => {
    repository.deleteCustomer(request.params.id);
    return { ok: true };
  });

  app.get<{ Querystring: { businessId?: string } }>("/financial-years", async (request) => {
    const businessId = request.query.businessId;
    if (businessId === undefined) throw new RepositoryValidationError("businessId is required.");
    return repository.listFinancialYears(businessId);
  });

  app.post("/financial-years", async (request, reply) => {
    const input = parseBody(financialYearInput, request.body);
    const yearId = repository.createFinancialYear(input);
    return reply.code(201).send({ id: yearId });
  });

  app.post<{ Params: { id: string } }>("/financial-years/:id/lock", async (request) => {
    const input = parseBody(lockInput, request.body);
    repository.setFinancialYearLocked(request.params.id, input.locked, input.reason);
    return { ok: true };
  });

  /** Opening balances (R4a): one journal entry dated `asAt`, OPENING_BALANCE_EQUITY as the plug. */
  app.post("/opening-balances", async (request, reply) => {
    const input = parseBody(openingBalanceInput, request.body);
    const openingId = repository.saveOpeningBalances({ id: randomUUID(), ...input });
    return reply.code(201).send({ id: openingId });
  });

  app.get<{ Querystring: { businessId?: string } }>("/opening-balances", async (request) => {
    const businessId = request.query.businessId;
    if (businessId === undefined) throw new RepositoryValidationError("businessId is required.");
    return repository.getOpeningBalances(businessId);
  });

  /** Correction is by reversal only: the original set and its journal entry are never edited or deleted. */
  app.post<{ Params: { id: string } }>("/opening-balances/:id/reverse", async (request) => {
    const input = parseBody(openingBalanceReverseInput, request.body);
    return { journalEntry: repository.reverseOpeningBalances({ id: request.params.id, reversedOn: input.reversedOn }) };
  });

  /**
   * Opening customer balances (R4b): one entry dated `asAt`. `incomePaise` is the part that is income
   * earned before the books began (0 = a balance-sheet movement only, S5-2); `incomeAccount` is
   * required exactly when it is above zero.
   */
  app.post("/opening-customer-balances", async (request, reply) => {
    const input = parseBody(openingCustomerBalanceInput, request.body);
    const balanceId = repository.saveOpeningCustomerBalance({
      id: randomUUID(),
      businessId: input.businessId,
      customerId: input.customerId,
      asAt: input.asAt,
      amountPaise: input.amountPaise,
      incomePaise: input.incomePaise,
      ...(input.incomeAccount === undefined ? {} : { incomeAccount: input.incomeAccount }),
    });
    return reply.code(201).send({ id: balanceId });
  });

  app.get<{ Querystring: { businessId?: string } }>("/opening-customer-balances", async (request) => {
    const businessId = request.query.businessId;
    if (businessId === undefined) throw new RepositoryValidationError("businessId is required.");
    return repository.listOpeningCustomerBalances(businessId);
  });

  app.post<{ Params: { id: string } }>("/opening-customer-balances/:id/receipts", async (request, reply) => {
    const input = parseBody(openingReceiptInput, request.body);
    repository.recordOpeningBalanceReceipt({ id: randomUUID(), openingCustomerBalanceId: request.params.id, ...input });
    return reply.code(201).send({ ok: true });
  });

  /** Correction is by reversal only; refused once any money has been collected against the balance. */
  app.post<{ Params: { id: string } }>("/opening-customer-balances/:id/reverse", async (request) => {
    const input = parseBody(openingBalanceReverseInput, request.body);
    return { journalEntry: repository.reverseOpeningCustomerBalance({ id: request.params.id, reversedOn: input.reversedOn }) };
  });

  app.post("/opening-supplier-balances", async (request, reply) => {
    const input = parseBody(openingSupplierBalanceInput, request.body);
    return reply.code(201).send({ id: repository.saveOpeningSupplierBalance({ id: randomUUID(), ...input }) });
  });

  app.get<{ Querystring: { businessId?: string } }>("/opening-supplier-balances", async (request) => {
    const businessId = request.query.businessId;
    if (businessId === undefined) throw new RepositoryValidationError("businessId is required.");
    return repository.listOpeningSupplierBalances(businessId);
  });

  app.post<{ Params: { id: string } }>("/opening-supplier-balances/:id/settlements", async (request, reply) => {
    const input = parseBody(openingSettlementInput, request.body);
    repository.recordOpeningBalanceSettlement({ id: randomUUID(), openingSupplierBalanceId: request.params.id, ...input });
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/opening-supplier-balances/:id/reverse", async (request) => {
    const input = parseBody(openingBalanceReverseInput, request.body);
    return { journalEntry: repository.reverseOpeningSupplierBalance({ id: request.params.id, reversedOn: input.reversedOn }) };
  });

  app.get<{ Querystring: { companyId?: string; includeInactive?: string } }>("/accounts", async (request) => {
    const { companyId, includeInactive } = request.query;
    return repository.listAccounts({
      ...(companyId === undefined ? {} : { companyId }),
      ...(activeOnlyQuery(includeInactive) ? { includeInactive: true } : {}),
    });
  });

  app.post("/accounts", async (request, reply) => {
    const input = parseBody(accountInput, request.body);
    const code = repository.createAccount({
      companyId: input.companyId,
      code: input.code,
      name: input.name,
      type: input.type,
      ...(input.parentCode === undefined ? {} : { parentCode: input.parentCode }),
    });
    return reply.code(201).send({ code });
  });

  app.patch<{ Params: { code: string } }>("/accounts/:code", async (request) => {
    const input = parseBody(accountRenameInput, request.body);
    repository.renameAccount(request.params.code, input.name);
    return { ok: true };
  });

  app.post<{ Params: { code: string } }>("/accounts/:code/active", async (request) => {
    const input = parseBody(activeInput, request.body);
    repository.setAccountActive(request.params.code, input.active);
    return { ok: true };
  });

  app.post("/items", async (request, reply) => {
    const input = parseBody(itemInput, request.body);
    const itemId = repository.createItem({
      companyId: input.companyId,
      name: input.name,
      unit: input.unit,
      ...(input.trackStock === undefined ? {} : { trackStock: input.trackStock }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.sellingPricePaise === undefined ? {} : { sellingPricePaise: input.sellingPricePaise }),
      ...(input.costPricePaise === undefined ? {} : { costPricePaise: input.costPricePaise }),
      ...(input.mrpPaise === undefined ? {} : { mrpPaise: input.mrpPaise }),
      ...(input.reorderThreshold === undefined ? {} : { reorderThreshold: input.reorderThreshold }),
    });

    return reply.code(201).send({ id: itemId });
  });

  app.patch<{ Params: { id: string } }>("/items/:id", async (request) => {
    const patch = parseBody(itemPatchInput, request.body);
    repository.updateItem(request.params.id, definedOnly(patch));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/items/:id/active", async (request) => {
    const input = parseBody(activeInput, request.body);
    repository.setItemActive(request.params.id, input.active);
    return { ok: true };
  });

  app.post("/fairs", async (request, reply) => {
    const input = parseBody(fairInput, request.body);
    const fairId = repository.createFair({
      companyId: input.companyId,
      hostCustomerId: input.hostCustomerId,
      name: input.name,
      ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
      ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
    });

    return reply.code(201).send({ id: fairId });
  });

  app.post("/inventory/movements", async (request, reply) => {
    const input = parseBody(stockMovementInput, request.body);
    return reply.code(201).send(repository.addStockMovement({
      itemId: input.itemId,
      movementType: input.movementType,
      quantity: input.quantity,
      unitCostPaise: input.unitCostPaise,
      ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
      ...(input.businessId === undefined ? {} : { businessId: input.businessId }),
      ...(input.occurredOn === undefined ? {} : { occurredOn: input.occurredOn }),
    }));
  });

  /**
   * R4c. A DRY RUN by default: it reports what it would post and writes nothing. Only
   * `apply: true` posts, and even then it refuses movements dated inside a locked year and lists
   * them. Running it twice is safe - the second run finds nothing left to post.
   */
  app.post("/inventory/journal-backfill", async (request) => {
    const input = parseBody(stockBackfillInput, request.body);
    return repository.backfillStockJournals({ businessId: input.businessId, dryRun: input.apply !== true });
  });

  app.get<{ Querystring: { itemId?: string } }>(
    "/inventory/movements",
    async (request) => repository.listStockMovements(request.query.itemId),
  );

  app.get("/inventory/stock", async () => repository.getStockBalances());

  app.post("/invoices", async (request, reply) => {
    const input = parseBody(invoiceInput, request.body);
    const invoice: Invoice = {
      id: input.id ?? randomUUID(),
      number: input.number,
      businessId: input.businessId,
      customerId: input.customerId,
      invoiceDate: input.invoiceDate,
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      discountPaise: input.discountPaise,
      extraChargePaise: input.extraChargePaise,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.paymentTerms === undefined ? {} : { paymentTerms: input.paymentTerms }),
      taxType: input.taxType,
      taxRateBasisPoints: input.taxRateBasisPoints,
      ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
      ...(input.buyerName === undefined ? {} : { buyerName: input.buyerName }),
      ...(input.buyerContact === undefined ? {} : { buyerContact: input.buyerContact }),
      paymentAccount: input.paymentAccount,
      status: input.status,
      lines: input.lines.map((line) => ({
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
      })),
    };
    repository.saveDraft(invoice);
    return reply.code(201).send(invoice);
  });

  app.post("/credit-notes", async (request, reply) => {
    const input = parseBody(creditNoteInput, request.body);
    const note: CreditNote = {
      id: randomUUID(),
      invoiceId: input.invoiceId,
      number: input.number,
      reason: input.reason,
      status: "DRAFT",
      lines: input.lines.map((line) => ({
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
      })),
    };
    repository.saveCreditNote(note);
    return reply.code(201).send(note);
  });

  app.get<{ Querystring: { invoiceId?: string; status?: string } }>("/credit-notes", async (request) => {
    const { invoiceId, status } = request.query;
    if (status !== undefined && status !== "DRAFT" && status !== "FINALIZED" && status !== "CANCELLED") {
      throw new RepositoryValidationError("status must be DRAFT, FINALIZED or CANCELLED.");
    }
    return repository.listCreditNotes({
      ...(invoiceId === undefined ? {} : { invoiceId }),
      ...(status === undefined ? {} : { status }),
    });
  });

  app.get<{ Params: { creditNoteId: string } }>("/credit-notes/:creditNoteId", async (request) =>
    repository.getCreditNote(request.params.creditNoteId));

  app.post<{ Params: { creditNoteId: string } }>("/credit-notes/:creditNoteId/finalize", async (request) =>
    ({ journalEntry: repository.finalizeCreditNote(request.params.creditNoteId) }));

  /** What the note is worth back to the customer, and how much of it is still undischarged. */
  app.get<{ Params: { creditNoteId: string } }>("/credit-notes/:creditNoteId/balance", async (request) =>
    repository.getCreditNoteBalance(request.params.creditNoteId));

  /** Pay a credit note back in cash or from the bank (S4-1). */
  app.post<{ Params: { creditNoteId: string } }>("/credit-notes/:creditNoteId/refunds", async (request, reply) => {
    const input = parseBody(creditNoteRefundInput, request.body);
    const journalEntry = repository.recordCreditNoteRefund({
      id: randomUUID(),
      creditNoteId: request.params.creditNoteId,
      amountPaise: input.amountPaise,
      refundedOn: input.refundedOn,
      paymentAccount: input.paymentAccount,
    });
    return reply.code(201).send({ journalEntry, balance: repository.getCreditNoteBalance(request.params.creditNoteId) });
  });

  /** Set a credit note against a later invoice for the same customer instead (S4-5). */
  app.post<{ Params: { creditNoteId: string } }>("/credit-notes/:creditNoteId/applications", async (request, reply) => {
    const input = parseBody(creditNoteApplicationInput, request.body);
    const journalEntry = repository.applyCreditNote({
      id: randomUUID(),
      creditNoteId: request.params.creditNoteId,
      invoiceId: input.invoiceId,
      amountPaise: input.amountPaise,
      appliedOn: input.appliedOn,
    });
    return reply.code(201).send({ journalEntry, balance: repository.getCreditNoteBalance(request.params.creditNoteId) });
  });

  /** Undo a finalized credit note, newest first (S4-1). Reversal, never deletion. */
  app.post<{ Params: { creditNoteId: string } }>("/credit-notes/:creditNoteId/cancel", async (request) =>
    ({ journalEntry: repository.cancelCreditNote(request.params.creditNoteId) }));

  app.post("/quotations", async (request, reply) => {
    const input = parseBody(invoiceInput, request.body);
    const quotation: Invoice = {
      id: input.id ?? randomUUID(),
      number: input.number,
      businessId: input.businessId,
      customerId: input.customerId,
      invoiceDate: input.invoiceDate,
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      discountPaise: input.discountPaise,
      extraChargePaise: input.extraChargePaise,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.paymentTerms === undefined ? {} : { paymentTerms: input.paymentTerms }),
      taxType: input.taxType,
      taxRateBasisPoints: input.taxRateBasisPoints,
      ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
      ...(input.buyerName === undefined ? {} : { buyerName: input.buyerName }),
      ...(input.buyerContact === undefined ? {} : { buyerContact: input.buyerContact }),
      paymentAccount: input.paymentAccount,
      status: "QUOTATION",
      lines: input.lines.map((line) => ({
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
      })),
    };
    repository.saveDraft(quotation);
    return reply.code(201).send(quotation);
  });

  app.get<{ Querystring: { businessId?: string } }>(
    "/invoices",
    async (request) => repository.listInvoices(request.query.businessId),
  );

  app.put<{ Params: { invoiceId: string } }>(
    "/invoices/:invoiceId",
    async (request) => {
      const input = parseBody(invoiceInput, request.body);
      const invoice: Invoice = {
        id: request.params.invoiceId,
        number: input.number,
        businessId: input.businessId,
        customerId: input.customerId,
        invoiceDate: input.invoiceDate,
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        discountPaise: input.discountPaise,
        extraChargePaise: input.extraChargePaise,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.paymentTerms === undefined ? {} : { paymentTerms: input.paymentTerms }),
        taxType: input.taxType,
        taxRateBasisPoints: input.taxRateBasisPoints,
        ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
        ...(input.buyerName === undefined ? {} : { buyerName: input.buyerName }),
        ...(input.buyerContact === undefined ? {} : { buyerContact: input.buyerContact }),
        paymentAccount: input.paymentAccount,
        status: input.status,
        lines: input.lines.map((line) => ({
          ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
          description: line.description,
          quantity: line.quantity,
          unitPricePaise: line.unitPricePaise,
        })),
      };
      repository.updateDraft(invoice);
      return repository.getInvoice(invoice.id);
    },
  );

  app.get<{ Params: { invoiceId: string } }>("/invoices/:invoiceId", async (request) => {
    return repository.getInvoice(request.params.invoiceId);
  });

  app.post<{ Params: { quotationId: string } }>(
    "/quotations/:quotationId/convert",
    async (request) => repository.convertQuotation(request.params.quotationId),
  );

  app.post<{ Params: { invoiceId: string } }>(
    "/invoices/:invoiceId/finalize",
    async (request) => ({
      journalEntry: repository.finalizeInvoice(request.params.invoiceId),
    }),
  );

  app.post<{ Params: { invoiceId: string } }>(
    "/invoices/:invoiceId/payments",
    async (request, reply) => {
      const input = parseBody(paymentInput, request.body);
      return reply.code(201).send(repository.recordPayment(request.params.invoiceId, input.amountPaise, input.paidOn));
    },
  );

  app.get<{ Params: { invoiceId: string } }>(
    "/invoices/:invoiceId/payments",
    async (request) => repository.listPayments(request.params.invoiceId),
  );

  /**
   * R8. Cancel a recorded payment. Nothing is deleted: the row is marked cancelled and a
   * reversing entry is posted beside the original, so the invoice goes back to outstanding.
   */
  app.post<{ Params: { paymentId: string } }>(
    "/payments/:paymentId/cancel",
    async (request) => {
      const input = parseBody(cancellationInput, request.body ?? {});
      return { reversalEntry: repository.cancelPayment(request.params.paymentId, input.reason) };
    },
  );

  app.post<{ Params: { paymentId: string } }>(
    "/supplier-payments/:paymentId/cancel",
    async (request) => {
      const input = parseBody(cancellationInput, request.body ?? {});
      return { reversalEntry: repository.cancelSupplierPayment(request.params.paymentId, input.reason) };
    },
  );

  app.post<{ Params: { invoiceId: string } }>(
    "/invoices/:invoiceId/cancel",
    async (request) => ({
      reversalEntry: repository.cancelInvoice(request.params.invoiceId),
    }),
  );

  app.post("/recurring-invoices", async (request, reply) => {
    const input = parseBody(recurringTemplateInput, request.body);
    const template = repository.createRecurringInvoiceTemplate({
      ...(input.id === undefined ? {} : { id: input.id }),
      businessId: input.businessId,
      customerId: input.customerId,
      paymentAccount: input.paymentAccount,
      ...(input.fairId === undefined ? {} : { fairId: input.fairId }),
      ...(input.buyerName === undefined ? {} : { buyerName: input.buyerName }),
      ...(input.buyerContact === undefined ? {} : { buyerContact: input.buyerContact }),
      discountPaise: input.discountPaise,
      extraChargePaise: input.extraChargePaise,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.paymentTerms === undefined ? {} : { paymentTerms: input.paymentTerms }),
      taxType: input.taxType,
      taxRateBasisPoints: input.taxRateBasisPoints,
      frequency: input.frequency,
      intervalCount: input.intervalCount,
      startDate: input.startDate,
      ...(input.nextRunDate === undefined ? {} : { nextRunDate: input.nextRunDate }),
      ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
      lines: input.lines.map((line) => ({
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
      })),
    });
    return reply.code(201).send(template);
  });

  app.get<{ Querystring: { businessId?: string; active?: string } }>("/recurring-invoices", async (request) => {
    const { businessId, active } = request.query;
    if (active !== undefined && active !== "true" && active !== "false") {
      throw new RepositoryValidationError("active must be true or false.");
    }
    return repository.listRecurringInvoiceTemplates({
      ...(businessId === undefined ? {} : { businessId }),
      ...(active === undefined ? {} : { active: active === "true" }),
    });
  });

  app.post("/recurring-invoices/generate", async (request) => {
    const input = parseBody(generateInput, request.body);
    return repository.generateDueInvoices(input.asOfDate);
  });

  app.get<{ Params: { templateId: string } }>("/recurring-invoices/:templateId", async (request) =>
    repository.getRecurringInvoiceTemplate(request.params.templateId));

  app.patch<{ Params: { templateId: string } }>("/recurring-invoices/:templateId", async (request) => {
    const input = parseBody(recurringTemplateUpdate, request.body);
    return repository.updateRecurringInvoiceTemplate(request.params.templateId, {
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.nextRunDate === undefined ? {} : { nextRunDate: input.nextRunDate }),
    });
  });

  app.post<{ Params: { templateId: string } }>("/recurring-invoices/:templateId/deactivate", async (request) =>
    repository.deactivateRecurringInvoiceTemplate(request.params.templateId));

  // ---- Slice 6: suppliers, purchase bills, expenses, supplier payments
  app.post("/suppliers", async (request, reply) => {
    const input = parseBody(supplierInput, request.body);
    const { companyId, name: supplierName, ...rest } = input;
    return reply.code(201).send({ id: repository.createSupplier({ companyId, name: supplierName, ...definedOnly(rest) }) });
  });

  app.get<{ Querystring: { companyId?: string; activeOnly?: string } }>(
    "/suppliers",
    async (request) =>
      repository.listSuppliers(request.query.companyId, { activeOnly: activeOnlyQuery(request.query.activeOnly) }),
  );

  app.patch<{ Params: { id: string } }>("/suppliers/:id", async (request) => {
    const patch = parseBody(supplierPatchInput, request.body);
    repository.updateSupplier(request.params.id, definedOnly(patch));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/suppliers/:id/active", async (request) => {
    const input = parseBody(activeInput, request.body);
    repository.setSupplierActive(request.params.id, input.active);
    return { ok: true };
  });

  app.post("/expense-categories", async (request, reply) => {
    const input = parseBody(expenseCategoryInput, request.body);
    return reply.code(201).send({ id: repository.createExpenseCategory(input) });
  });

  app.get<{ Querystring: { companyId?: string } }>(
    "/expense-categories",
    async (request) => repository.listExpenseCategories(request.query.companyId),
  );

  app.post("/purchase-bills", async (request, reply) => {
    const input = parseBody(purchaseBillInput, request.body);
    const { lines, ...rest } = input;
    const bill = repository.createPurchaseBill({
      ...definedOnly(rest),
      businessId: input.businessId,
      supplierId: input.supplierId,
      number: input.number,
      billDate: input.billDate,
      paymentAccount: input.paymentAccount,
      lines: lines.map((line) => ({
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
      })),
    });
    return reply.code(201).send(bill);
  });

  app.get<{ Querystring: { businessId?: string; supplierId?: string; status?: string } }>("/purchase-bills", async (request) => {
    const status = documentStatus(request.query.status);
    return repository.listPurchaseBills({
      ...(request.query.businessId === undefined ? {} : { businessId: request.query.businessId }),
      ...(request.query.supplierId === undefined ? {} : { supplierId: request.query.supplierId }),
      ...(status === undefined ? {} : { status }),
    });
  });

  app.get<{ Params: { id: string } }>("/purchase-bills/:id", async (request) =>
    repository.getPurchaseBill(request.params.id));

  app.post<{ Params: { id: string } }>("/purchase-bills/:id/finalize", async (request) =>
    ({ journalEntry: repository.finalizePurchaseBill(request.params.id) }));

  app.post<{ Params: { id: string } }>("/purchase-bills/:id/cancel", async (request) =>
    ({ reversalEntry: repository.cancelPurchaseBill(request.params.id) }));

  app.post("/expenses", async (request, reply) => {
    const input = parseBody(expenseInput, request.body);
    return reply.code(201).send(repository.createExpense({
      ...definedOnly(input),
      businessId: input.businessId,
      number: input.number,
      expenseDate: input.expenseDate,
      description: input.description,
      amountPaise: input.amountPaise,
      paymentAccount: input.paymentAccount,
    }));
  });

  app.get<{ Querystring: { businessId?: string; supplierId?: string; status?: string } }>("/expenses", async (request) => {
    const status = documentStatus(request.query.status);
    return repository.listExpenses({
      ...(request.query.businessId === undefined ? {} : { businessId: request.query.businessId }),
      ...(request.query.supplierId === undefined ? {} : { supplierId: request.query.supplierId }),
      ...(status === undefined ? {} : { status }),
    });
  });

  app.get<{ Params: { id: string } }>("/expenses/:id", async (request) => repository.getExpense(request.params.id));

  app.post<{ Params: { id: string } }>("/expenses/:id/finalize", async (request) =>
    ({ journalEntry: repository.finalizeExpense(request.params.id) }));

  app.post<{ Params: { id: string } }>("/expenses/:id/cancel", async (request) =>
    ({ reversalEntry: repository.cancelExpense(request.params.id) }));

  app.post("/supplier-payments", async (request, reply) => {
    const input = parseBody(supplierPaymentInput, request.body);
    return reply.code(201).send(repository.recordSupplierPayment({
      amountPaise: input.amountPaise,
      ...(input.billId === undefined ? {} : { billId: input.billId }),
      ...(input.expenseId === undefined ? {} : { expenseId: input.expenseId }),
      ...(input.paidOn === undefined ? {} : { paidOn: input.paidOn }),
    }));
  });

  app.get<{ Querystring: { billId?: string; expenseId?: string; supplierId?: string } }>(
    "/supplier-payments",
    async (request) => repository.listSupplierPayments({
      ...(request.query.billId === undefined ? {} : { billId: request.query.billId }),
      ...(request.query.expenseId === undefined ? {} : { expenseId: request.query.expenseId }),
      ...(request.query.supplierId === undefined ? {} : { supplierId: request.query.supplierId }),
    }),
  );

  app.get("/reports/payables", async (request) =>
    repository.getPayables(parseBody(openItemsQuery, request.query)));
  // R7b. Ageing, read from the same open-items query as the two reports above, so what is
  // outstanding has ONE definition and cannot drift from the Balance Sheet control account.
  app.get("/reports/receivables-ageing", async (request) =>
    repository.getReceivablesAgeing(parseBody(customerOpenItemsQuery, request.query)));
  app.get("/reports/payables-ageing", async (request) =>
    repository.getPayablesAgeing(parseBody(openItemsQuery, request.query)));
  app.get<{ Querystring: { supplierId?: string } }>("/reports/supplier-statement", async (request) => {
    const supplierId = request.query.supplierId;
    if (supplierId === undefined || supplierId.trim() === "") throw new RepositoryValidationError("supplierId is required.");
    return repository.getSupplierStatement(supplierId);
  });

  app.get<{ Querystring: { entityId?: string } }>(
    "/audit-events",
    async (request) => repository.listAuditEvents(request.query.entityId),
  );

  app.get("/journal-entries", async () => repository.listJournalEntries());

  app.get("/reports/inventory-valuation", async () => repository.getInventoryValuation());
  app.get("/reports/low-stock", async () => repository.getLowStockItems());
  // Session 9. Both of these used to take no filters and ignore credit notes. sales-by-item takes
  // the credit-note query because an item filter IS meaningful on a per-item report.
  app.get("/reports/sales-by-item", async (request) =>
    repository.getSalesByItem(parseBody(creditNoteReportQuery, request.query)));
  // Optional report filters. No query string = consolidated, all dates (unchanged behaviour).
  app.get("/reports/trial-balance", async (request) =>
    repository.getTrialBalance(parseBody(trialBalanceQuery, request.query)));
  app.get("/reports/profit-and-loss", async (request) =>
    repository.getProfitAndLoss(parseBody(profitAndLossQuery, request.query)));
  app.get("/reports/balance-sheet", async (request) =>
    repository.getBalanceSheet(parseBody(asAtReportQuery, request.query)));
  app.get("/reports/general-ledger", async (request) =>
    repository.getGeneralLedger(parseBody(periodReportQuery, request.query)));

  // R7b. reports-sales.ts and reports-transactions.ts had no caller outside their own tests, so
  // none of these could be reached from the running app. These are the routes that reach them.
  app.get("/reports/sales-by-customer", async (request) =>
    repository.getSalesByCustomer(parseBody(salesReportQuery, request.query)));
  app.get("/reports/sales-by-business", async (request) =>
    repository.getSalesByBusiness(parseBody(salesReportQuery, request.query)));
  app.get("/reports/sales-by-fair", async (request) =>
    repository.getSalesByFairReport(parseBody(salesReportQuery, request.query)));
  app.get("/reports/sales-by-tax", async (request) =>
    repository.getSalesByTax(parseBody(salesReportQuery, request.query)));
  app.get("/reports/credit-notes", async (request) =>
    repository.getCreditNoteReport(parseBody(creditNoteReportQuery, request.query)));
  app.get("/reports/sales-returns", async (request) =>
    repository.getSalesReturnReport(parseBody(creditNoteReportQuery, request.query)));
  app.get("/reports/transactions", async (request) =>
    repository.getTransactionList(parseBody(transactionReportQuery, request.query)));
  app.get("/reports/transaction-detail", async (request) =>
    repository.getTransactionDetailByAccount(parseBody(transactionReportQuery, request.query)));
  app.get("/reports/stock-movements", async (request) =>
    repository.getStockMovementReport(parseBody(stockMovementQuery, request.query)));
  app.get("/reports/receivables", async (request) =>
    repository.getReceivables(parseBody(customerOpenItemsQuery, request.query)));
  app.get("/reports/upcoming-recurring-invoices", async () => repository.getUpcomingRecurringInvoices());
  app.get("/reports/fair-sales", async (request) =>
    repository.getFairSales(parseBody(salesReportQuery, request.query)));

  return app;
}

export function createApi(databasePath = "book-buddha.db"): {
  app: FastifyInstance;
  repository: AccountingRepository;
} {
  const repository = new AccountingRepository(databasePath);
  return { app: buildApi(repository), repository };
}
