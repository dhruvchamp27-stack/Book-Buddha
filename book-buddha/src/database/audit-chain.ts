import { createHash } from "node:crypto";

/**
 * Canonical serialisation + hashing for the tamper-evident audit chain.
 *
 * Pure functions only (no database) so the scheme can be tested in isolation and shared by the
 * writer (appendAuditEvent), the backfill (applyAuditChainSchema) and the verifier.
 */

/** prev_hash of the very first event. Fixed forever; changing it invalidates every chain. */
export const AUDIT_GENESIS_HASH = "BOOK-BUDDHA-AUDIT-GENESIS-v1";

/** The fields that are sealed into an event's hash. `id` is included so renumbering is detected. */
export interface AuditHashFields {
  readonly prevHash: string;
  readonly id: number;
  readonly companyId: string | null;
  readonly actorId: string | null;
  readonly entityType: string | null;
  readonly entityId: string;
  readonly action: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly beforeValues: string | null;
  readonly afterValues: string | null;
}

const VERSION_HEADER = Buffer.from("BBAUDIT1;", "utf8");

/** One field: null -> "N;"   string -> "S" + <utf8 byte length> + ":" + <bytes>. */
function encodeField(value: string | null): Buffer {
  if (value === null) return Buffer.from("N;", "utf8");
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from(`S${bytes.length}:`, "utf8"), bytes]);
}

/**
 * Deterministic bytes for one event. Fixed field order; every field is either the null marker or
 * a length-prefixed byte string, so the encoding is injective (prefix-free): a value that itself
 * contains ";", ":", digits or the text of another field cannot shift a boundary, because a parser
 * always knows exactly how many bytes to take. Null and empty string differ ("N;" vs "S0:").
 */
export function canonicalAuditBytes(f: AuditHashFields): Buffer {
  return Buffer.concat([
    VERSION_HEADER,
    encodeField(f.prevHash),
    encodeField(String(f.id)),
    encodeField(f.companyId),
    encodeField(f.actorId),
    encodeField(f.entityType),
    encodeField(f.entityId),
    encodeField(f.action),
    encodeField(f.occurredAt),
    encodeField(f.reason),
    encodeField(f.beforeValues),
    encodeField(f.afterValues),
  ]);
}

export function computeAuditHash(fields: AuditHashFields): string {
  return createHash("sha256").update(canonicalAuditBytes(fields)).digest("hex");
}

/** JSON with sorted object keys, so equal values always serialise identically. */
export function stableStringify(value: unknown): string {
  const normalise = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalise);
    if (v !== null && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .filter((k) => obj[k] !== undefined)
          .map((k) => [k, normalise(obj[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(normalise(value));
}
