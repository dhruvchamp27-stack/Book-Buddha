/**
 * HTTP for bank rules (R12g). Rules only PRE-FILL a suggestion for a statement line; nothing here posts.
 *
 *   GET    /bank-rules?companyId=
 *   POST   /bank-rules                 {companyId, name, action, targetAccount, conditions[], accountScope?, direction?, matchMode?, businessId?, fairId?, partyName?, memo?}
 *   PATCH  /bank-rules/:id             {companyId, <any rule field>, active?}
 *   DELETE /bank-rules/:id?companyId=
 *   POST   /bank-rules/reorder         {companyId, orderedIds[]}
 *   POST   /bank-rules/test            {companyId, accountCode, ruleId} or {companyId, accountCode, rule: <draft>}
 *
 * Kept out of `server.ts`; the orchestrator wires `registerBankRuleRoutes(app, { repository })`.
 * Bad input is a `RepositoryValidationError`, which the server's error handler maps to 400.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";
import {
  createBankRule,
  deleteBankRule,
  listBankRules,
  reorderBankRules,
  setBankRuleActive,
  testBankRule,
  updateBankRule,
} from "../banking/bank-rules.js";
import {
  BANK_RULE_ACTIONS,
  BANK_RULE_DIRECTIONS,
  BANK_RULE_FIELDS,
  BANK_RULE_MATCH_MODES,
  BANK_RULE_OPERATORS,
} from "../banking/bank-rules-schema.js";

export interface BankRuleRoutesContext {
  readonly repository: AccountingRepository;
}

const id = z.string().trim().min(1);
const optText = z.string().nullable().optional();

const condition = z.object({
  field: z.enum(BANK_RULE_FIELDS),
  operator: z.enum(BANK_RULE_OPERATORS),
  valueText: optText,
  valuePaise: z.number().nullable().optional(),
});
const ruleFields = {
  name: z.string(),
  accountScope: optText,
  direction: z.enum(BANK_RULE_DIRECTIONS).optional(),
  matchMode: z.enum(BANK_RULE_MATCH_MODES).optional(),
  action: z.enum(BANK_RULE_ACTIONS),
  targetAccount: z.string(),
  businessId: optText,
  fairId: optText,
  partyName: optText,
  memo: optText,
  conditions: z.array(condition),
};
const companyQuery = z.object({ companyId: id });
const createBody = z.object({ companyId: id, ...ruleFields });
const patchBody = z.object({ companyId: id, ...z.object(ruleFields).partial().shape, active: z.boolean().optional() });
const reorderBody = z.object({ companyId: id, orderedIds: z.array(id) });
const testBody = z.object({ companyId: id, accountCode: id, ruleId: id.optional(), rule: z.object(ruleFields).optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new RepositoryValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || where}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function registerBankRuleRoutes(app: FastifyInstance, context: BankRuleRoutesContext): void {
  const db = context.repository.db;

  app.get("/bank-rules", async (request) => {
    const { companyId } = parse(companyQuery, request.query, "query");
    return { rules: listBankRules(db, companyId) };
  });

  app.post("/bank-rules", async (request, reply) => {
    const { companyId, ...draft } = parse(createBody, request.body, "body");
    return reply.code(201).send({ rule: createBankRule(db, companyId, draft) });
  });

  // Registered before the `:id` routes so "reorder" and "test" are never read as an id.
  app.post("/bank-rules/reorder", async (request) => {
    const { companyId, orderedIds } = parse(reorderBody, request.body, "body");
    return { rules: reorderBankRules(db, companyId, orderedIds) };
  });

  app.post("/bank-rules/test", async (request) => {
    const body = parse(testBody, request.body, "body");
    if ((body.ruleId === undefined) === (body.rule === undefined)) {
      throw new RepositoryValidationError("Send either ruleId (an existing rule) or rule (a draft to test), not both and not neither.");
    }
    const target = body.ruleId ?? body.rule;
    if (target === undefined) throw new RepositoryValidationError("Nothing to test.");
    return { lines: testBankRule(db, body.companyId, body.accountCode, target) };
  });

  app.patch<{ Params: { id: string } }>("/bank-rules/:id", async (request) => {
    const { companyId, active, ...patch } = parse(patchBody, request.body, "body");
    const fields = Object.values(patch).some((v) => v !== undefined);
    if (!fields && active === undefined) throw new RepositoryValidationError("Send at least one field to change.");
    let rule = fields ? updateBankRule(db, companyId, request.params.id, patch) : undefined;
    if (active !== undefined) rule = setBankRuleActive(db, companyId, request.params.id, active);
    return { rule };
  });

  app.delete<{ Params: { id: string } }>("/bank-rules/:id", async (request) => {
    const { companyId } = parse(companyQuery, request.query, "query");
    deleteBankRule(db, companyId, request.params.id);
    return { deleted: true };
  });
}
