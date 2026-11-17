import { describe, expect, it } from "vitest";
import { AccountingRepository, AuthenticationError, RepositoryValidationError } from "./repository.js";

const T0 = "2026-03-01T10:00:00.000Z";
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const PW = "Secret123";

function setup(extra: { email?: string; googleSub?: string } = {}): AccountingRepository {
  const repo = new AccountingRepository(":memory:");
  repo.setupAdmin({ password: PW, nowIso: T0, ...extra });
  return repo;
}

function auditActions(repo: AccountingRepository): string[] {
  return (repo.db.prepare("SELECT action FROM audit_events ORDER BY id").all() as Array<{ action: string }>).map((r) => r.action);
}

describe("auth repository", () => {
  it("creates the single admin, audits it, and refuses a second", () => {
    const repo = new AccountingRepository(":memory:");
    expect(repo.getAuthStatus()).toEqual({ configured: false, locked: false });
    repo.setupAdmin({ password: PW, nowIso: T0 });
    expect(repo.isAdminConfigured()).toBe(true);
    expect(auditActions(repo)).toContain("auth.admin_created");
    expect(() => repo.setupAdmin({ password: "Another123" })).toThrow(RepositoryValidationError);
    expect(() => new AccountingRepository(":memory:").setupAdmin({ password: "short" })).toThrow(/8 characters/);
  });

  it("stores a hash, never the plain password", () => {
    const repo = setup();
    const row = repo.db.prepare("SELECT password_hash FROM auth_users").get() as { password_hash: string };
    expect(row.password_hash).not.toContain(PW);
    expect(row.password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("logs in and validates the session, storing only the token hash", () => {
    const repo = setup();
    const { token, expiresAt } = repo.login(PW, at(1));
    expect(expiresAt).toBe(at(61));
    expect(repo.validateSession(token, at(2))).toMatchObject({ role: "ADMIN" });
    expect(repo.validateSession("not-a-token", at(2))).toBeNull();
    const row = repo.db.prepare("SELECT token_hash FROM auth_sessions").get() as { token_hash: string };
    expect(row.token_hash).not.toBe(token);
    expect(auditActions(repo)).toContain("auth.login_succeeded");
  });

  it("counts wrong passwords and locks on the 5th; correct password blocked until lock passes", () => {
    const repo = setup();
    for (let i = 1; i <= 4; i++) {
      expect(() => repo.login("Wrong1234", at(i))).toThrow(new RegExp(`${5 - i} attempt`));
    }
    expect(repo.getAuthStatus(at(5))).toEqual({ configured: true, locked: false });
    let caught: unknown;
    try { repo.login("Wrong1234", at(5)); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AuthenticationError);
    expect((caught as AuthenticationError).statusCode).toBe(423);
    expect(repo.getAuthStatus(at(6))).toMatchObject({ locked: true, lockedUntil: at(20) });

    expect(() => repo.login(PW, at(10))).toThrow(/locked.*10 minute/);
    expect(auditActions(repo)).toEqual(expect.arrayContaining(["auth.account_locked", "auth.login_failed", "auth.login_blocked_locked"]));

    // Lock expires at at(20): correct password works and the counter resets.
    const { token } = repo.login(PW, at(20));
    expect(repo.validateSession(token, at(21))).not.toBeNull();
    const user = repo.db.prepare("SELECT failed_attempts, locked_until FROM auth_users").get();
    expect(user).toEqual({ failed_attempts: 0, locked_until: null });
  });

  it("gives a fresh set of attempts after an expired lock", () => {
    const repo = setup();
    for (let i = 1; i <= 5; i++) expect(() => repo.login("Wrong1234", at(i))).toThrow();
    expect(() => repo.login("Wrong1234", at(30))).toThrow(/4 attempt/);
  });

  it("expires a session after 1 idle hour and rolls the window on activity", () => {
    const repo = setup();
    const { token } = repo.login(PW, at(0));
    expect(repo.validateSession(token, at(50))).not.toBeNull();
    expect(repo.validateSession(token, at(100))).not.toBeNull(); // 50 min after last activity
    const second = repo.login(PW, at(200)).token;
    expect(repo.validateSession(second, at(200 + 61))).toBeNull();
    expect(repo.validateSession(second, at(200 + 62))).toBeNull(); // stays dead
  });

  it("logout revokes the session", () => {
    const repo = setup();
    const { token } = repo.login(PW, at(0));
    repo.logout(token, at(1));
    expect(repo.validateSession(token, at(2))).toBeNull();
    expect(auditActions(repo)).toContain("auth.logout");
  });

  it("changePassword swaps the password, enforces policy, revokes other sessions", () => {
    const repo = setup();
    const a = repo.login(PW, at(0)).token;
    const b = repo.login(PW, at(1)).token;
    expect(() => repo.changePassword({ token: a, currentPassword: "Nope12345", newPassword: "NewSecret456", nowIso: at(2) })).toThrow(/incorrect/);
    expect(() => repo.changePassword({ token: a, currentPassword: PW, newPassword: "weak", nowIso: at(2) })).toThrow(/8 characters/);
    repo.changePassword({ token: a, currentPassword: PW, newPassword: "NewSecret456", nowIso: at(3) });
    expect(repo.validateSession(a, at(4))).not.toBeNull();
    expect(repo.validateSession(b, at(4))).toBeNull();
    expect(() => repo.login(PW, at(5))).toThrow(/Incorrect/);
    expect(repo.login("NewSecret456", at(6)).token).toBeTruthy();
    expect(auditActions(repo)).toContain("auth.password_changed");
  });

  // Rewritten for S6-3. These two tests used to prove that a matching googleSub or
  // email was ENOUGH to reset the password. That was the defect, so the behaviour
  // they pinned is gone; what survives is everything else they checked — the reset
  // clears the lockout, revokes live sessions and writes its audit event.
  it("recoverPassword resets password, lockout and sessions when the recovery code is right", () => {
    const repo = new AccountingRepository(":memory:");
    const { recoveryCode } = repo.setupAdmin({ password: PW, googleSub: "google-123", email: "a@example.com", nowIso: T0 });
    const { token } = repo.login(PW, at(0));
    for (let i = 1; i <= 5; i++) expect(() => repo.login("Wrong1234", at(i))).toThrow();
    expect(() => repo.recoverPassword({ recoveryCode: "WRONG-CODE", newPassword: "Recovered789", nowIso: at(6) })).toThrow(
      /not correct/,
    );
    repo.recoverPassword({ recoveryCode, newPassword: "Recovered789", nowIso: at(7) });
    expect(repo.validateSession(token, at(8))).toBeNull();
    expect(repo.login("Recovered789", at(9)).token).toBeTruthy();
    expect(auditActions(repo)).toContain("auth.password_recovered");
  });

  it("a matching email or googleSub is no longer enough to reset the password", () => {
    const repo = setup({ googleSub: "google-123", email: "a@example.com" });
    // The old signature does not type-check any more, so this goes through a cast:
    // the point is what the RUNTIME does if such a payload ever reaches it.
    const legacy = repo.recoverPassword.bind(repo) as unknown as (input: Record<string, string>) => unknown;
    expect(() => legacy({ googleSub: "google-123", newPassword: "Stolen789" })).toThrow();
    expect(() => legacy({ email: "a@example.com", newPassword: "Stolen789" })).toThrow();
    expect(repo.login(PW, at(3)).token).toBeTruthy();
  });
});
