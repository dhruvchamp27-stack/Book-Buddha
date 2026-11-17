import { describe, expect, it } from "vitest";
import { AUTH_HOOK_MESSAGES, buildApi, createApi } from "./server.js";
import { AccountingRepository } from "../database/repository.js";

const PASSWORD = "Secret123";

/**
 * The COMPLETE set of routes reachable without a session. Deliberately written out
 * in full rather than derived from the server, so that opening a new route to the
 * public is a visible, reviewable change to this list and not a silent one.
 *
 * `HEAD /health` and `HEAD /auth/status` are not hand-written routes: Fastify's
 * `exposeHeadRoutes` (on by default in 5.12.8) mirrors every GET, and the mirror
 * inherits the GET's config. So the five routes declared public in `server.ts`
 * surface as seven entries here. Verified against the running app, not assumed.
 */
const PUBLIC_ROUTES = [
  "GET /health",
  "HEAD /health",
  "GET /auth/status",
  "HEAD /auth/status",
  "POST /auth/setup",
  "POST /auth/login",
  "POST /auth/recover",
] as const;

/**
 * Routes that must never be public. Not a count and not the whole list — these are
 * anchors that make a vacuous pass impossible: if the derived route table ever comes
 * back empty or half-built, the sweep below would pass over nothing, and these
 * assertions are what catch that.
 */
const MUST_BE_PROTECTED = [
  "POST /invoices",
  "POST /invoices/:invoiceId/payments",
  "GET /reports/trial-balance",
  "POST /auth/change-password",
  // Minting a recovery code must never be public: it would hand out a permanent
  // credential to anyone who asked (S6-3).
  "POST /auth/recovery-code",
] as const;

/** Fills route parameters so the path still MATCHES the route and reaches the hook. */
const concretePath = (url: string): string => url.replace(/:[^/]+/g, "probe");

const setUpAdmin = async (app: ReturnType<typeof buildApi>): Promise<void> => {
  const response = await app.inject({ method: "POST", url: "/auth/setup", payload: { password: PASSWORD } });
  expect(response.statusCode).toBe(201);
};

const signIn = async (app: ReturnType<typeof buildApi>): Promise<string> => {
  const response = await app.inject({ method: "POST", url: "/auth/login", payload: { password: PASSWORD } });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
};

describe("API authentication is enforced on every financial route", () => {
  it("exposes exactly the agreed public surface and nothing else", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await app.ready();
      const actual = app.authRoutes.filter((route) => route.isPublic).map((route) => `${route.method} ${route.url}`);
      expect(actual.slice().sort()).toEqual(PUBLIC_ROUTES.slice().sort());

      // The anchors keep the sweep below honest: an empty or half-built route table
      // would make it pass over nothing at all.
      const protectedRoutes = app.authRoutes
        .filter((route) => !route.isPublic)
        .map((route) => `${route.method} ${route.url}`);
      for (const anchor of MUST_BE_PROTECTED) expect(protectedRoutes).toContain(anchor);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("refuses every non-public route when no token is sent (derived sweep)", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await app.ready();
      // An admin MUST exist first. Without one every route answers 409, and the
      // sweep would prove nothing about tokens.
      await setUpAdmin(app);

      const leaked: string[] = [];
      const wrongMessage: string[] = [];
      for (const route of app.authRoutes) {
        if (route.isPublic) continue;
        const response = await app.inject({ method: route.method, url: concretePath(route.url) });
        if (response.statusCode !== 401) {
          leaked.push(`${route.method} ${route.url} -> ${response.statusCode}`);
          continue;
        }
        // HEAD carries no body by definition; everything else must carry the HOOK's
        // own wording, which proves the hook refused it and not a route handler.
        if (route.method !== "HEAD" && response.json<{ error: string }>().error !== AUTH_HOOK_MESSAGES.noToken) {
          wrongMessage.push(`${route.method} ${route.url} -> ${response.body}`);
        }
      }
      expect(leaked).toEqual([]);
      expect(wrongMessage).toEqual([]);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("refuses malformed authorization headers", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await setUpAdmin(app);
      for (const authorization of ["", "Bearer", "Bearer ", "Basic abc123", "Token abc123", "abc123"]) {
        const response = await app.inject({ method: "GET", url: "/companies", headers: { authorization } });
        expect(response.statusCode, `header: "${authorization}"`).toBe(401);
        expect(response.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.noToken);
      }
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("lets a valid token through, and refuses it once logged out", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await setUpAdmin(app);
      const token = await signIn(app);
      const headers = { authorization: `Bearer ${token}` };

      const allowed = await app.inject({ method: "GET", url: "/companies", headers });
      expect(allowed.statusCode).toBe(200);

      expect((await app.inject({ method: "POST", url: "/auth/logout", headers })).statusCode).toBe(200);

      const refused = await app.inject({ method: "GET", url: "/companies", headers });
      expect(refused.statusCode).toBe(401);
      expect(refused.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.invalidSession);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("refuses an expired session", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await setUpAdmin(app);
      const token = await signIn(app);
      const headers = { authorization: `Bearer ${token}` };
      expect((await app.inject({ method: "GET", url: "/companies", headers })).statusCode).toBe(200);

      // Fastify tests cannot use fake timers — they stall its async work. Instead age
      // the session out through `validateSession`'s own `nowIso` parameter, which is
      // what revokes an idle session, then prove the hook refuses the token after.
      expect(repository.validateSession(token, "2099-01-01T00:00:00.000Z")).toBeNull();

      const refused = await app.inject({ method: "GET", url: "/companies", headers });
      expect(refused.statusCode).toBe(401);
      expect(refused.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.invalidSession);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("refuses rather than serving when the database has no administrator (409, not 401)", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await app.ready();
      for (const route of ["/companies", "/reports/trial-balance", "/invoices"]) {
        const response = await app.inject({ method: "GET", url: route });
        expect(response.statusCode, route).toBe(409);
        expect(response.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.notSetUp);
      }

      // The public routes must still genuinely WORK, not merely return some status.
      // These are outcomes only the real handlers can produce.
      expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
      expect((await app.inject({ method: "GET", url: "/auth/status" })).json()).toEqual({
        configured: false,
        locked: false,
      });
      await setUpAdmin(app);
      expect((await app.inject({ method: "GET", url: "/auth/status" })).json()).toMatchObject({ configured: true });
      expect(await signIn(app)).toMatch(/\S/);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("refuses an unmatched path instead of revealing that it does not exist", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await setUpAdmin(app);
      // Verified against Fastify 5.12.8: the onRequest hook DOES run for a path that
      // matches no route, and `request.routeOptions.config` is absent there, so the
      // fail-closed default denies it. An unknown path must not answer 404 and tell
      // an unauthenticated caller which paths exist.
      for (const url of ["/definitely-not-a-route", "/admin/secrets", "/invoices/x/not-a-thing"]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode, url).toBe(401);
        expect(response.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.noToken);
      }
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("enforces through createApi, the production entry point", async () => {
    // Always an explicit in-memory path: `createApi()` would default to
    // "book-buddha.db" in the working directory, which may be a real database, and
    // opening it would run migrations on it.
    const { app, repository } = createApi(":memory:");
    try {
      await setUpAdmin(app);
      const refused = await app.inject({ method: "GET", url: "/companies" });
      expect(refused.statusCode).toBe(401);
      expect(refused.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.noToken);

      const token = await signIn(app);
      const allowed = await app.inject({
        method: "GET",
        url: "/companies",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("does not let the test opt-out reach production through createApi", async () => {
    // `createApi` does not accept the flag — the cast is the point. This is the
    // RUNTIME proof that it is neither accepted nor forwarded to `buildApi`: if it
    // were, this route would answer 200 instead of refusing.
    const forward = createApi as unknown as (
      databasePath?: string,
      options?: { __unsafeDisableAuthForTests: boolean },
    ) => ReturnType<typeof createApi>;
    const { app, repository } = forward(":memory:", { __unsafeDisableAuthForTests: true });
    try {
      await setUpAdmin(app);
      const response = await app.inject({ method: "GET", url: "/companies" });
      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.noToken);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("opens the API only when a test asks for it in code", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      // No admin, no token — and it serves. This is the escape hatch the 28 existing
      // API test worlds rely on, pinned here so its blast radius is explicit.
      expect((await app.inject({ method: "GET", url: "/companies" })).statusCode).toBe(200);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("sweeps real routes, not paths that match nothing", async () => {
    // Guards the sweep above against passing vacuously. A protected route and an
    // unmatched path now answer with the SAME 401, so if `concretePath` ever stopped
    // matching a route, that route would go unswept and the sweep would stay green.
    // Here the hook is OFF, so a path that matches no route reaches Fastify's own
    // not-found handler and is visible. Verified on 5.12.8: that body is
    // `{"message":"Route GET:/x not found","error":"Not Found","statusCode":404}`,
    // which is how it is told apart from a 404 a real handler chose to return.
    const repository = new AccountingRepository();
    const open = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      await open.ready();
      const matchedNothing: string[] = [];
      for (const route of open.authRoutes) {
        if (route.isPublic || route.method === "HEAD") continue;
        const response = await open.inject({ method: route.method, url: concretePath(route.url) });
        if (response.statusCode !== 404) continue;
        const body = response.json<{ error?: string; message?: string }>();
        if (body.error === "Not Found" && body.message?.startsWith("Route ") === true) {
          matchedNothing.push(`${route.method} ${route.url}`);
        }
      }
      expect(matchedNothing).toEqual([]);
    } finally {
      await open.close();
      repository.close();
    }
  });

  it("refuses a token that was never issued", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await setUpAdmin(app);
      const response = await app.inject({
        method: "GET",
        url: "/companies",
        headers: { authorization: "Bearer never-issued-at-all" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: string }>().error).toBe(AUTH_HOOK_MESSAGES.invalidSession);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("lets the session routes through with a valid token, and the token survives a password change", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      await setUpAdmin(app);
      const token = await signIn(app);
      const headers = { authorization: `Bearer ${token}` };

      const session = await app.inject({ method: "GET", url: "/auth/session", headers });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({ role: "ADMIN" });

      const changed = await app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers,
        payload: { currentPassword: PASSWORD, newPassword: "NewSecret456" },
      });
      expect(changed.statusCode).toBe(200);

      // Pinned because a login gate in the UI depends on it: changing the password
      // does NOT revoke the live session, so the caller is not signed out and does
      // not have to hold on to the new password to carry on.
      expect((await app.inject({ method: "GET", url: "/companies", headers })).statusCode).toBe(200);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("lets /auth/recover reach its own handler, so it is genuinely public", async () => {
    // Status alone would prove nothing here: the hook answers 409 on an unconfigured
    // database and 401 without a token, and this handler answers 409 and 401 too.
    // The wording is what separates them, so these assert the HANDLER's own words.
    const repository = new AccountingRepository();
    const app = buildApi(repository);
    try {
      const unconfigured = await app.inject({
        method: "POST",
        url: "/auth/recover",
        payload: { recoveryCode: "ABCDE-ABCDE-ABCDE-ABCDE-ABCDE-ABCDE", newPassword: "Secret123" },
      });
      expect(unconfigured.statusCode).toBe(409);
      expect(unconfigured.json<{ error: string }>().error).toBe("No admin account is set up yet.");
      expect(unconfigured.json<{ error: string }>().error).not.toBe(AUTH_HOOK_MESSAGES.notSetUp);

      await setUpAdmin(app);
      const wrongCode = await app.inject({
        method: "POST",
        url: "/auth/recover",
        payload: { recoveryCode: "ABCDE-ABCDE-ABCDE-ABCDE-ABCDE-ABCDE", newPassword: "Secret123" },
      });
      expect(wrongCode.statusCode).toBe(401);
      expect(wrongCode.json<{ error: string }>().error).toBe("That recovery code is not correct.");
      expect(wrongCode.json<{ error: string }>().error).not.toBe(AUTH_HOOK_MESSAGES.noToken);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
