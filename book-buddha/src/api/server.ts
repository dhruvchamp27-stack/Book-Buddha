import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Invoice } from "../accounting/types.js";
import type { CreditNote } from "../accounting/types.js";
import {
  AccountingRepository,
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
const customerInput = z.object({
  companyId: id,
  name,
  email: z.string().email().optional(),
  phone: z.string().trim().min(1).optional(),
});
const itemInput = z.object({
  companyId: id,
  name,
  unit: name,
  trackStock: z.boolean().optional(),
});
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
});
const creditNoteInput = z.object({
  invoiceId: id,
  number: name,
  reason: name,
  lines: z.array(invoiceLine).min(1),
});

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
    if (error instanceof RepositoryValidationError) {
      return reply.code(400).send({ error: error.message });
    }

    request.log.error(error);
    return reply.code(500).send({ error: "Internal server error." });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/companies", async () => repository.listCompanies());

  app.get<{ Querystring: { companyId?: string } }>(
    "/businesses",
    async (request) => repository.listBusinesses(request.query.companyId),
  );

  app.get<{ Querystring: { companyId?: string } }>(
    "/fairs",
    async (request) => repository.listFairs(request.query.companyId),
  );

  app.get<{ Querystring: { companyId?: string } }>(
    "/customers",
    async (request) => repository.listCustomers(request.query.companyId),
  );

  app.get<{ Querystring: { companyId?: string } }>(
    "/items",
    async (request) => repository.listItems(request.query.companyId),
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
    });
    return reply.code(201).send({ id: customerId });
  });

  app.post("/items", async (request, reply) => {
    const input = parseBody(itemInput, request.body);
    const itemId = repository.createItem({
      companyId: input.companyId,
      name: input.name,
      unit: input.unit,
      ...(input.trackStock === undefined ? {} : { trackStock: input.trackStock }),
    });

    return reply.code(201).send({ id: itemId });
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
    return reply.code(201).send(repository.addStockMovement(input));
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

  app.get<{ Querystring: { entityId?: string } }>(
    "/audit-events",
    async (request) => repository.listAuditEvents(request.query.entityId),
  );

  app.get("/journal-entries", async () => repository.listJournalEntries());

  app.get("/reports/trial-balance", async () => repository.getTrialBalance());
  app.get("/reports/profit-and-loss", async () => repository.getProfitAndLoss());
  app.get("/reports/balance-sheet", async () => repository.getBalanceSheet());
  app.get("/reports/general-ledger", async () => repository.getGeneralLedger());
  app.get("/reports/receivables", async () => repository.getReceivables());
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
