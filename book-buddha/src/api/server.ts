import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Invoice } from "../accounting/types.js";
import type { CreditNote } from "../accounting/types.js";
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
const supplierPaymentInput = z.object({
  billId: id.optional(),
  expenseId: id.optional(),
  amountPaise: z.number().int().positive(),
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
});
const creditNoteInput = z.object({
  invoiceId: id,
  number: name,
  reason: name,
  lines: z.array(invoiceLine).min(1),
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
const authRecoverInput = z.object({
  googleSub: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  newPassword: z.string().min(1),
}).refine((value) => value.googleSub !== undefined || value.email !== undefined, {
  message: "Provide googleSub or email.",
});

const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date written as YYYY-MM-DD.");
/** Period reports (P&L, General Ledger): optional business and date range. */
const periodReportQuery = z.object({
  businessId: id.optional(),
  fromDate: reportDate.optional(),
  toDate: reportDate.optional(),
}).strict().transform((value) => definedOnly(value));
/**
 * Profit and Loss: the period filters plus an optional basis. Omitted means the business's
 * company default (its stored accounting_basis), or ACCRUAL when no business is given.
 */
const profitAndLossQuery = z.object({
  businessId: id.optional(),
  fromDate: reportDate.optional(),
  toDate: reportDate.optional(),
  basis: z.enum(["CASH", "ACCRUAL"]).optional(),
}).strict().transform((value) => definedOnly(value));
/** As-at reports (Trial Balance, Balance Sheet): optional business and a single as-at date. */
const asAtReportQuery = z.object({
  businessId: id.optional(),
  asAtDate: reportDate.optional(),
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

export function buildApi(repository: AccountingRepository): FastifyInstance {
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

  app.get("/health", async () => ({ status: "ok" }));

  // ---- Auth. Token transport: `Authorization: Bearer <token>` header only.
  // The raw token is returned once by /auth/login; the server stores only its hash.
  const bearerToken = (header: string | undefined): string => {
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    if (match === null) throw new AuthenticationError("Sign in required.", 401);
    return match[1] as string;
  };

  app.get("/auth/status", async () => repository.getAuthStatus());

  app.post("/auth/setup", async (request, reply) => {
    const input = parseBody(authSetupInput, request.body);
    const result = repository.setupAdmin({
      password: input.password,
      ...(input.email === undefined ? {} : { email: input.email }),
      ...(input.googleSub === undefined ? {} : { googleSub: input.googleSub }),
    });
    return reply.code(201).send({ id: result.userId });
  });

  app.post("/auth/login", async (request) => {
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

  // Caller must have verified the Google identity already (see recoverPassword).
  app.post("/auth/recover", async (request) => {
    const input = parseBody(authRecoverInput, request.body);
    repository.recoverPassword({
      newPassword: input.newPassword,
      ...(input.googleSub === undefined ? {} : { googleSub: input.googleSub }),
      ...(input.email === undefined ? {} : { email: input.email }),
    });
    return { ok: true };
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
    }));
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
      return reply.code(201).send(repository.recordPayment(request.params.invoiceId, input.amountPaise));
    },
  );

  app.get<{ Params: { invoiceId: string } }>(
    "/invoices/:invoiceId/payments",
    async (request) => repository.listPayments(request.params.invoiceId),
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

  app.get("/reports/payables", async () => repository.getPayables());
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
  app.get("/reports/sales-by-item", async () => repository.getSalesByItem());
  // Optional report filters. No query string = consolidated, all dates (unchanged behaviour).
  app.get("/reports/trial-balance", async (request) =>
    repository.getTrialBalance(parseBody(asAtReportQuery, request.query)));
  app.get("/reports/profit-and-loss", async (request) =>
    repository.getProfitAndLoss(parseBody(profitAndLossQuery, request.query)));
  app.get("/reports/balance-sheet", async (request) =>
    repository.getBalanceSheet(parseBody(asAtReportQuery, request.query)));
  app.get("/reports/general-ledger", async (request) =>
    repository.getGeneralLedger(parseBody(periodReportQuery, request.query)));
  app.get("/reports/receivables", async () => repository.getReceivables());
  app.get("/reports/upcoming-recurring-invoices", async () => repository.getUpcomingRecurringInvoices());
  app.get<{ Querystring: { fairId?: string } }>(
    "/reports/fair-sales",
    async (request) => repository.getFairSales(request.query.fairId),
  );

  return app;
}

export function createApi(databasePath = "book-buddha.db"): {
  app: FastifyInstance;
  repository: AccountingRepository;
} {
  const repository = new AccountingRepository(databasePath);
  return { app: buildApi(repository), repository };
}
