import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
export const MIN_PASSWORD_LENGTH = 8;

/** Returns a plain-English problem, or null when the password meets policy. */
export function passwordPolicyProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password)) return "Password must contain at least one letter.";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
  return null;
}

/** Throws an Error with a plain message when the password breaks policy. */
export function validatePasswordPolicy(password: string): void {
  const problem = passwordPolicyProblem(password);
  if (problem !== null) throw new Error(problem);
}

/** Format: scrypt$N$r$p$saltHex$hashHex (self-describing so params can change later). */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Never throws: any malformed stored value simply fails verification. */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, nText, rText, pText, saltHex, hashHex] = parts as [string, string, string, string, string, string];
    const n = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
    if (saltHex.length % 2 !== 0 || hashHex.length % 2 !== 0 || hashHex.length === 0) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
