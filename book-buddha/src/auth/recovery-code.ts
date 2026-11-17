import { randomBytes } from "node:crypto";

/**
 * The recovery code: the secret fixed when the workspace is set up, and the only
 * thing that can reset a forgotten admin password (S6-3).
 *
 * The alphabet leaves out 0, O, 1 and I, because this code gets written on paper
 * and typed back in months later, and those four are the pairs people confuse.
 * Thirty characters over a 32-letter alphabet is 150 bits of entropy, comfortably
 * past the 128 bits at which guessing stops being a consideration — which is why
 * the recovery endpoint needs no attempt limit of its own and the login lockout is
 * left alone.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 30;
const GROUP_SIZE = 5;

/**
 * A fresh code, grouped for transcription: `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`.
 *
 * Bytes outside the largest whole multiple of the alphabet are discarded rather
 * than taken modulo 32, so every letter stays equally likely. 256 is a multiple of
 * 32, so in practice nothing is ever rejected — the guard is there so the code
 * stays correct if the alphabet is ever changed.
 */
export function generateRecoveryCode(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += GROUP_SIZE) groups.push(code.slice(i, i + GROUP_SIZE));
  return groups.join("-");
}

/**
 * What gets hashed, so that the grouping dashes, stray spaces and the case someone
 * happens to type in never decide whether a correct code is accepted.
 *
 * Only separators are removed. Characters outside the alphabet are deliberately
 * LEFT IN, so a genuine typo still fails rather than being quietly massaged into a
 * different code.
 */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}
