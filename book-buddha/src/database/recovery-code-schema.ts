import type Database from "better-sqlite3";

/**
 * Migration v16 — give the admin account a recovery-code secret (S6-3).
 *
 * Before this, `recoverPassword` reset the admin password on nothing but a
 * `google_sub` or `email` that matched the admin row. No secret was fixed at
 * setup, so anyone who knew the owner's email address could take the books over,
 * and the reset revoked every live session on the way through. The endpoint has to
 * stay public to be useful at all, so the hole could not be closed by requiring a
 * session — only by requiring a secret.
 *
 * Purely additive: one nullable column on `auth_users`. No table is rebuilt, so no
 * trigger has to be dropped and replayed, and nothing is backfilled.
 *
 * **The column is deliberately left NULL on an existing admin.** A database that
 * already had an administrator before v16 has no recovery code, and one cannot be
 * invented for it: the whole point is a secret only the owner has seen. Recovery
 * on such a row therefore REFUSES rather than falling back to the old email match
 * — fail closed — and the owner mints a code by signing in and asking for one.
 */
export function applyRecoveryCodeSchema(db: Database.Database): void {
  const hasColumn = (table: string, name: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === name);

  if (!hasColumn("auth_users", "recovery_code_hash")) {
    db.exec("ALTER TABLE auth_users ADD COLUMN recovery_code_hash TEXT");
  }
}
