import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password.js";

describe("password policy", () => {
  it("accepts 8+ chars with a letter and a number", () => {
    expect(() => validatePasswordPolicy("abcdefg1")).not.toThrow();
  });
  it("rejects short, letter-less and number-less passwords", () => {
    expect(() => validatePasswordPolicy("abc1")).toThrow(/8 characters/);
    expect(() => validatePasswordPolicy("12345678")).toThrow(/letter/);
    expect(() => validatePasswordPolicy("abcdefgh")).toThrow(/number/);
  });
});

describe("password hashing", () => {
  it("round-trips and rejects a wrong password", () => {
    const stored = hashPassword("Correct1pass");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(verifyPassword("Correct1pass", stored)).toBe(true);
    expect(verifyPassword("Wrong1pass", stored)).toBe(false);
  });
  it("uses a random salt", () => {
    expect(hashPassword("Same1password")).not.toBe(hashPassword("Same1password"));
  });
  it("returns false (never throws) on malformed stored values", () => {
    for (const bad of ["", "garbage", "scrypt$1$2$3", "scrypt$x$8$1$aa$bb", "scrypt$16384$8$1$zz$yy", "scrypt$16384$8$1$abc$de", "md5$1$2$3$aa$bb"]) {
      expect(verifyPassword("whatever1", bad)).toBe(false);
    }
  });
});
