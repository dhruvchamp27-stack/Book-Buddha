import { createHash, randomBytes } from "node:crypto";

/** Idle timeout: a session dies 1 hour after its last activity. */
export const IDLE_TIMEOUT_MS = 3_600_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60_000;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored; the raw token is never persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiryIso(lastSeenAtIso: string, idleMs = IDLE_TIMEOUT_MS): string {
  return new Date(Date.parse(lastSeenAtIso) + idleMs).toISOString();
}

/** Expired when strictly more than idleMs has passed since last activity. */
export function isSessionExpired(lastSeenAtIso: string, nowIso: string, idleMs = IDLE_TIMEOUT_MS): boolean {
  return Date.parse(nowIso) - Date.parse(lastSeenAtIso) > idleMs;
}

export function isLocked(lockedUntilIso: string | null | undefined, nowIso: string): boolean {
  return lockedUntilIso != null && Date.parse(lockedUntilIso) > Date.parse(nowIso);
}
