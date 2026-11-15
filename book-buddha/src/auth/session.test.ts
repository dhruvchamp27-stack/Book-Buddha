import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashToken,
  isLocked,
  isSessionExpired,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  sessionExpiryIso,
} from "./session.js";

describe("session helpers", () => {
  it("generates unique tokens", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
    expect(generateSessionToken().length).toBeGreaterThanOrEqual(43);
  });
  it("hashes deterministically and differently from the token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("expires strictly after one idle hour", () => {
    const seen = "2026-01-01T10:00:00.000Z";
    expect(isSessionExpired(seen, "2026-01-01T10:59:59.999Z")).toBe(false);
    expect(isSessionExpired(seen, "2026-01-01T11:00:00.000Z")).toBe(false);
    expect(isSessionExpired(seen, "2026-01-01T11:00:00.001Z")).toBe(true);
    expect(sessionExpiryIso(seen)).toBe("2026-01-01T11:00:00.000Z");
  });
  it("exposes lockout constants and lock check", () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(LOCKOUT_MS).toBe(900_000);
    expect(isLocked("2026-01-01T10:15:00.000Z", "2026-01-01T10:00:00.000Z")).toBe(true);
    expect(isLocked("2026-01-01T10:15:00.000Z", "2026-01-01T10:15:00.000Z")).toBe(false);
    expect(isLocked(null, "2026-01-01T10:00:00.000Z")).toBe(false);
  });
});
