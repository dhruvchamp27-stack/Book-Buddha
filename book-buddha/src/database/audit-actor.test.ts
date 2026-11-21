import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";
import { auditActor, verifyAuditChain } from "./audit-log.js";

let repo: AccountingRepository;
let app: FastifyInstance;

beforeEach(async () => {
  repo = new AccountingRepository();
  app = buildApi(repo); // REAL auth
  await app.ready();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  repo.close();
});

async function call(method: "GET" | "POST", url: string, payload?: object, token?: string) {
  const res = await app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
  });
  let body: any;
  try { body = res.json(); } catch { body = res.body; }
  return { status: res.statusCode, body };
}
const lastAudit = () =>
  repo.db.prepare("SELECT id, action, actor_id FROM audit_events ORDER BY id DESC LIMIT 1").get() as { id: number; action: string; actor_id: string | null };

describe("D13: audit actor", () => {
  it("a JSON-body POST under real auth records the logged-in user as actor, and the chain verifies", async () => {
    const setup = await call("POST", "/auth/setup", { password: "Secret123" });
    expect(setup.status).toBe(201);
    const userId = setup.body.id as string;
    const login = await call("POST", "/auth/login", { password: "Secret123" });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    const company = await call("POST", "/companies", { name: "Co" }, token);
    expect(company.status).toBe(201);
    const before = lastAudit().id;
    const cust = await call("POST", "/customers", { companyId: company.body.id, name: "Asha School" }, token);
    expect(cust.status).toBe(201);
    const row = lastAudit();
    expect(row.id).toBeGreaterThan(before);
    expect(row.actor_id).toBe(userId);
    expect(verifyAuditChain(repo.db).ok).toBe(true);
    // nothing leaks into the surrounding (non-request) context
    expect(auditActor.getStore()).toBeUndefined();
  });

  it("a later request without a session does not inherit the previous actor", async () => {
    await call("POST", "/auth/setup", { password: "Secret123" });
    const login = await call("POST", "/auth/login", { password: "Secret123" });
    const token = login.body.token as string;
    const company = await call("POST", "/companies", { name: "Co" }, token);
    const cust = await call("POST", "/customers", { companyId: company.body.id, name: "Asha" }, token);
    expect(cust.status).toBe(201);
    expect(lastAudit().actor_id).not.toBeNull();
    const seen = lastAudit().id;

    // refused request (no token) is 401
    const refused = await call("POST", "/customers", { companyId: company.body.id, name: "X" });
    expect(refused.status).toBe(401);
    // public route writing an audit row (wrong password -> failed-login event) must not carry the old actor
    const bad = await call("POST", "/auth/login", { password: "wrong-password" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const row = lastAudit();
    expect(row.id).toBeGreaterThan(seen); // control: the public route did write an audit row
    expect(row.actor_id).toBeNull();
    expect(auditActor.getStore()).toBeUndefined();
    expect(verifyAuditChain(repo.db).ok).toBe(true);
  });

  it("an explicit actorId on the event still wins over the request actor", async () => {
    const { appendAuditEvent } = await import("./audit-log.js");
    auditActor.run("ctx-user", () => {
      appendAuditEvent(repo.db, { action: "T", entityId: "e1", occurredAt: new Date().toISOString(), actorId: "explicit" });
      appendAuditEvent(repo.db, { action: "T", entityId: "e2", occurredAt: new Date().toISOString() });
    });
    const rows = repo.db.prepare("SELECT entity_id, actor_id FROM audit_events WHERE action = 'T' ORDER BY id").all();
    expect(rows).toEqual([{ entity_id: "e1", actor_id: "explicit" }, { entity_id: "e2", actor_id: "ctx-user" }]);
    expect(verifyAuditChain(repo.db).ok).toBe(true);
  });
});
