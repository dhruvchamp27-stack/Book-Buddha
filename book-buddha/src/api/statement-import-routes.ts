/**
 * HTTP for bank statement import (R12e). Lines land in the review queue as FOR_REVIEW; nothing is posted.
 *
 *   POST /bank-statements/inspect   { fileName, contentBase64 } -> headers, rowCount, first 10 rows, suggestedMap
 *   POST /bank-statements/preview   { companyId, accountCode, businessId?, fileName, contentBase64, columnMap, dateFormat }
 *   POST /bank-statements/commit    the same body; preview runs the commit path and rolls back
 *   GET  /bank-statements/imports?companyId=&accountCode=
 *
 * columnMap = { date, description, amount?, direction?, withdrawal?, deposit?, reference?, balance? } -> header names.
 * SIGN: a bank's "Debit / Withdrawal" is money OUT of the account = a NEGATIVE amount, the opposite of
 * the books' word "debit". "Credit / Deposit" is money IN = positive.
 *
 * File travels as base64 in the JSON body (like imports and attachments), so each route that takes a
 * file carries a 20 MB `bodyLimit`. A bad body, file or column map is a RepositoryValidationError (400).
 * Kept out of `server.ts`; the orchestrator wires `registerStatementImportRoutes(app, { repository })`.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";
import { commitStatement, inspectStatement, listStatementImports, previewStatement } from "../banking/statement-import.js";

export const STATEMENT_BODY_LIMIT_BYTES = 20 * 1024 * 1024;

export interface StatementImportRoutesContext {
  readonly repository: AccountingRepository;
}

const fileFields = {
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1),
};
const inspectBody = z.object(fileFields);
const runBody = z.object({
  ...fileFields,
  companyId: z.string().trim().min(1),
  accountCode: z.string().trim().min(1),
  businessId: z.string().trim().min(1).optional(),
  columnMap: z.record(z.string(), z.string()),
  dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY"]),
});
const importsQuery = z.object({ companyId: z.string().trim().min(1), accountCode: z.string().trim().min(1) });

function parseWith<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new RepositoryValidationError(result.error.issues.map((i) => `${i.path.join(".") || where}: ${i.message}`).join("; "));
  }
  return result.data;
}

function decode(contentBase64: string): Uint8Array {
  const compact = contentBase64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new RepositoryValidationError("contentBase64 is not valid base64.");
  }
  return new Uint8Array(Buffer.from(compact, "base64"));
}

export function registerStatementImportRoutes(app: FastifyInstance, context: StatementImportRoutesContext): void {
  const db = context.repository.db;
  const options = { bodyLimit: STATEMENT_BODY_LIMIT_BYTES };

  app.post("/bank-statements/inspect", options, async (request) => {
    const body = parseWith(inspectBody, request.body, "body");
    return inspectStatement({ fileName: body.fileName, bytes: decode(body.contentBase64) });
  });

  for (const mode of ["preview", "commit"] as const) {
    app.post(`/bank-statements/${mode}`, options, async (request) => {
      const body = parseWith(runBody, request.body, "body");
      const input = {
        companyId: body.companyId,
        accountCode: body.accountCode,
        businessId: body.businessId,
        fileName: body.fileName,
        bytes: decode(body.contentBase64),
        columnMap: body.columnMap,
        dateFormat: body.dateFormat,
      };
      return mode === "preview" ? previewStatement(db, input) : commitStatement(db, input);
    });
  }

  app.get("/bank-statements/imports", async (request) => {
    const q = parseWith(importsQuery, request.query, "query");
    return { imports: listStatementImports(db, q.companyId, q.accountCode) };
  });
}
