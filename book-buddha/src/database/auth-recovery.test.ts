import { describe, expect, it } from "vitest";
import { AccountingRepository } from "./repository.js";
import { generateRecoveryCode, normaliseRecoveryCode } from "../auth/recovery-code.js";
import { migrations, runMigrations, type Migration } from "./migrations.js";
import { applyRecoveryCodeSchema } from "./recovery-code-schema.js";
import Database from "better-sqlite3";

const T0 = "2026-03-01T10:00:00.000Z";
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const PW = "Secret123";

describe("password recovery requires the recovery code (S6-3)", () => {
  it("refuses to reset the password on a bare email match", () => {
    // THE HOLE THIS SLICE CLOSES. Before S6-3, recoverPassword reset the admin
    // password on nothing but an email that matched the admin row, so anyone who
    // knew the owner's email address could take the books over, and the reset
    // revoked every live session on the way through.
    const repo = new AccountingRepository(":memory:");
    repo.setupAdmin({ password: PW, email: "owner@example.com", nowIso: T0 });
    const legacy = repo.recoverPassword.bind(repo) as unknown as (input: Record<string, string>) => unknown;
    expect(() => legacy({ email: "owner@example.com", newPassword: "Stolen789" })).toThrow();
    expect(repo.login(PW, at(2)).token).toBeTruthy();
    repo.close();
  });

  it("gives setup a recovery code that actually works, and stores only its hash", () => {
    const repo = new AccountingRepository(":memory:");
    const { recoveryCode } = repo.setupAdmin({ password: PW, nowIso: T0 });
    expect(recoveryCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}){5}$/);

    const stored = repo.db.prepare("SELECT recovery_code_hash AS h FROM auth_users").get() as { h: string };
    expect(stored.h).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.h).not.toContain(normaliseRecoveryCode(recoveryCode));
    // The raw code must not be sitting in the audit trail either; an audit row the
    // owner can read would not be a secret. audit_events carries action, entity_id
    // and occurred_at, so every one of them is checked rather than a guessed column.
    const rows = repo.db.prepare("SELECT action, entity_id, occurred_at FROM audit_events").all() as Array<
      Record<string, string>
    >;
    expect(rows.length).toBeGreaterThan(0);
    const needle = normaliseRecoveryCode(recoveryCode);
    for (const row of rows) {
      for (const value of Object.values(row)) {
        expect(normaliseRecoveryCode(value)).not.toContain(needle);
      }
    }

    repo.recoverPassword({ recoveryCode, newPassword: "Recovered789", nowIso: at(1) });
    expect(repo.login("Recovered789", at(2)).token).toBeTruthy();
    repo.close();
  });

  it("accepts the code however it was written down", () => {
    const repo = new AccountingRepository(":memory:");
    const { recoveryCode } = repo.setupAdmin({ password: PW, nowIso: T0 });
    // Lower case, no dashes, stray spaces — all the ways a code copied off paper
    // comes back. None of them should be the reason a correct code is refused.
    const mangled = ` ${recoveryCode.replace(/-/g, "").toLowerCase()} `;
    repo.recoverPassword({ recoveryCode: mangled, newPassword: "Recovered789", nowIso: at(1) });
    expect(repo.login("Recovered789", at(2)).token).toBeTruthy();
    repo.close();
  });

  it("burns the code it just used and issues a replacement", () => {
    const repo = new AccountingRepository(":memory:");
    const { recoveryCode } = repo.setupAdmin({ password: PW, nowIso: T0 });
    const { recoveryCode: next } = repo.recoverPassword({
      recoveryCode,
      newPassword: "Recovered789",
      nowIso: at(1),
    });
    expect(next).not.toBe(recoveryCode);
    // The spent code must not work a second time, so a code read over someone's
    // shoulder cannot be replayed...
    expect(() => repo.recoverPassword({ recoveryCode, newPassword: "Again12345", nowIso: at(2) })).toThrow(/not correct/);
    // ...and the owner is never left with no way back in.
    repo.recoverPassword({ recoveryCode: next, newPassword: "Again12345", nowIso: at(3) });
    expect(repo.login("Again12345", at(4)).token).toBeTruthy();
    repo.close();
  });

  it("refuses when the workspace has no recovery code, instead of falling back", () => {
    // A database set up before v16: the column exists but the admin row predates it.
    // Falling back to the old email match for exactly these rows would leave the
    // hole open on the one database that matters — the owner's.
    const repo = new AccountingRepository(":memory:");
    repo.setupAdmin({ password: PW, email: "owner@example.com", nowIso: T0 });
    repo.db.prepare("UPDATE auth_users SET recovery_code_hash = NULL").run();

    expect(() => repo.recoverPassword({ recoveryCode: generateRecoveryCode(), newPassword: "Stolen789", nowIso: at(1) })).toThrow(
      /no recovery code/i,
    );
    const legacy = repo.recoverPassword.bind(repo) as unknown as (input: Record<string, string>) => unknown;
    expect(() => legacy({ email: "owner@example.com", newPassword: "Stolen789" })).toThrow();
    expect(repo.login(PW, at(2)).token).toBeTruthy();
    repo.close();
  });

  it("lets a signed-in admin mint a code, which is how a pre-v16 workspace gets one", () => {
    const repo = new AccountingRepository(":memory:");
    repo.setupAdmin({ password: PW, nowIso: T0 });
    repo.db.prepare("UPDATE auth_users SET recovery_code_hash = NULL").run();
    const { token } = repo.login(PW, at(0));

    const { recoveryCode } = repo.mintRecoveryCode({ token, currentPassword: PW, nowIso: at(1) });
    repo.recoverPassword({ recoveryCode, newPassword: "Recovered789", nowIso: at(2) });
    expect(repo.login("Recovered789", at(3)).token).toBeTruthy();
    repo.close();
  });

  it("will not mint a code from a stolen token alone", () => {
    const repo = new AccountingRepository(":memory:");
    repo.setupAdmin({ password: PW, nowIso: T0 });
    const { token } = repo.login(PW, at(0));
    // A token by itself must not be enough to create a credential that outlives the
    // session it was taken from.
    expect(() => repo.mintRecoveryCode({ token, currentPassword: "Wrong1234", nowIso: at(1) })).toThrow(/Incorrect/);
    expect(() => repo.mintRecoveryCode({ token: "never-issued", currentPassword: PW, nowIso: at(1) })).toThrow();
    repo.close();
  });

  it("replaces the previous code when a new one is minted", () => {
    const repo = new AccountingRepository(":memory:");
    const { recoveryCode: first } = repo.setupAdmin({ password: PW, nowIso: T0 });
    const { token } = repo.login(PW, at(0));
    const { recoveryCode: second } = repo.mintRecoveryCode({ token, currentPassword: PW, nowIso: at(1) });

    expect(second).not.toBe(first);
    expect(() => repo.recoverPassword({ recoveryCode: first, newPassword: "Recovered789", nowIso: at(2) })).toThrow(
      /not correct/,
    );
    repo.recoverPassword({ recoveryCode: second, newPassword: "Recovered789", nowIso: at(3) });
    expect(repo.login("Recovered789", at(4)).token).toBeTruthy();
    repo.close();
  });

  it("generates codes that do not repeat and avoid the letters people misread", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(generateRecoveryCode());
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).not.toMatch(/[01OI]/);
  });
});

describe("migration v16", () => {
  // Scoped to v16 alone, deliberately: asserting the whole chain's version set here
  // would go red the moment v17 lands and would say nothing useful.
  const upTo = (version: number): Migration[] => migrations.filter((m) => m.version <= version);
  const columns = (db: Database.Database): string[] =>
    (db.prepare("PRAGMA table_info(auth_users)").all() as Array<{ name: string }>).map((c) => c.name);

  /** A v15 database carrying an admin and a live session, written by raw SQL. */
  function fifteenWithAdmin(): Database.Database {
    const db = new Database(":memory:");
    expect(runMigrations(db, upTo(15))).toContain(15);
    expect(columns(db)).not.toContain("recovery_code_hash");
    db.prepare(
      "INSERT INTO auth_users (id, role, email, google_sub, password_hash, created_at, updated_at) VALUES ('u1', 'ADMIN', 'owner@example.com', NULL, 'stored-hash', ?, ?)",
    ).run(T0, T0);
    db.prepare(
      "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES ('s1', 'u1', 'token-hash', ?, ?, ?)",
    ).run(T0, T0, at(60));
    return db;
  }

  it("adds the column to a real v15 database and leaves the existing admin alone", () => {
    const db = fifteenWithAdmin();
    const before = db.prepare("SELECT * FROM auth_users WHERE id = 'u1'").get() as Record<string, unknown>;

    expect(runMigrations(db, upTo(16))).toEqual([16]);
    expect(columns(db)).toContain("recovery_code_hash");

    const after = db.prepare("SELECT * FROM auth_users WHERE id = 'u1'").get() as Record<string, unknown>;
    // The admin that crossed the boundary keeps every value it had...
    for (const key of Object.keys(before)) expect(after[key]).toEqual(before[key]);
    // ...and gets NO recovery code, because none was ever shown to anyone.
    expect(after["recovery_code_hash"]).toBeNull();
    // The session open across the migration is untouched and unrevoked.
    const session = db.prepare("SELECT revoked_at AS r, token_hash AS t FROM auth_sessions WHERE id = 's1'").get() as {
      r: string | null;
      t: string;
    };
    expect(session.r).toBeNull();
    expect(session.t).toBe("token-hash");
    db.close();
  });

  it("is idempotent when applied straight onto a database that already has the column", () => {
    const db = fifteenWithAdmin();
    runMigrations(db, upTo(16));
    const before = columns(db);

    // Called DIRECTLY, bypassing schema_migrations, so the guard inside the
    // migration is genuinely re-entered rather than skipped by the version ledger.
    expect(() => applyRecoveryCodeSchema(db)).not.toThrow();
    applyRecoveryCodeSchema(db);
    expect(columns(db)).toEqual(before);
    expect(columns(db).filter((c) => c === "recovery_code_hash")).toHaveLength(1);
    db.close();
  });

  it("refuses recovery on a database that crossed v15 to v16 without a code", () => {
    const db = fifteenWithAdmin();
    runMigrations(db, upTo(16));
    db.close();

    // Same situation through the repository: an admin that predates v16 cannot
    // recover until a code is minted, and must not fall back to the email match.
    const repo = new AccountingRepository(":memory:");
    repo.setupAdmin({ password: PW, email: "owner@example.com", nowIso: T0 });
    repo.db.prepare("UPDATE auth_users SET recovery_code_hash = NULL").run();
    expect(() => repo.recoverPassword({ recoveryCode: generateRecoveryCode(), newPassword: "Stolen789" })).toThrow(
      /no recovery code/i,
    );
    repo.close();
  });
});
