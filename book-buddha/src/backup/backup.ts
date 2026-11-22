/**
 * Backup, verify, restore and automatic backup (R11, backend slice).
 *
 * A backup is a FOLDER, `<backupsRoot>/<id>/`:
 *
 *   book-buddha.db     the database, copied with SQLite's online-backup API (never a raw file
 *                      copy of an open database, which can capture a half-written page)
 *   attachments/...    optional: the attachment files, byte-for-byte
 *   manifest.json      what is in the folder, how to check it, and what is NOT in it
 *
 * No zip: Node has no zip writer and no dependency may be added. The folder is built under a
 * `.tmp-` name and renamed into place only when it is complete and verified, so a half-written
 * backup never looks like a real one.
 *
 * WHAT A BACKUP HOLDS. The audit log (`audit_events`, `audit_copy`) lives INSIDE the database, so a
 * database backup carries it. Attachments are files outside the database, so only the EVERYTHING
 * scope carries them. There is no logo in the schema today; if one is added inside the database it
 * is carried automatically, and if it is added as a file this module must be told about it.
 *
 * WHAT RESTORE DOES NOT DO. `restoreBackup` writes a database file at a path that is NOT in use.
 * Swapping the database underneath the running app (close the connection, swap, reopen) belongs to
 * the app shell, not to this module, and there is deliberately NO restore HTTP route: a route would
 * have to replace a file the server itself holds open. The caller must have closed the database it
 * wants replaced; on Windows an open file refuses to be moved, which is what stops a mistake there,
 * but this module cannot detect an open file on other systems.
 *
 * NOTHING IS DESTROYED. The database being replaced is first backed up (a verified PRE_RESTORE
 * backup) and then MOVED ASIDE to `<target>.replaced-<id>`, never deleted. If anything fails after
 * that point the original is moved back.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { z } from "zod";
import { appendAuditEvent } from "../database/audit-log.js";
import { AccountingRepository } from "../database/repository.js";
import { istDateOf } from "../database/ist-date.js";

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_DB_FILE = "book-buddha.db";
export const BACKUP_MANIFEST_FILE = "manifest.json";
export const BACKUP_ATTACHMENTS_DIR = "attachments";

/** The only shape a backup id may have. Letters, digits and one dash pattern: no slash, no dot. */
export const BACKUP_ID_PATTERN = /^bk-\d{8}T\d{9}Z-[0-9a-f]{6}$/;

export type BackupScope = "DATABASE_ONLY" | "EVERYTHING";
/** MANUAL: the owner asked. AUTOMATIC: made by `runAutomaticBackup`, the only kind it prunes. PRE_RESTORE: safety copy taken before a restore. */
export type BackupKind = "MANUAL" | "AUTOMATIC" | "PRE_RESTORE";

export class BackupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export class BackupNotFoundError extends BackupError {
  public constructor(message: string) {
    super(message);
    this.name = "BackupNotFoundError";
  }
}

export interface BackupCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface BackupVerification {
  readonly ok: boolean;
  readonly checks: readonly BackupCheck[];
}

const manifestSchema = z.object({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  id: z.string(),
  createdAt: z.string(),
  istDate: z.string(),
  kind: z.enum(["MANUAL", "AUTOMATIC", "PRE_RESTORE"]),
  scope: z.enum(["DATABASE_ONLY", "EVERYTHING"]),
  label: z.string().nullable(),
  schemaVersion: z.number().nullable(),
  appVersion: z.string(),
  rowCounts: z.record(z.string(), z.number()),
  files: z.array(z.object({ path: z.string(), sizeBytes: z.number(), sha256: z.string() })),
  included: z.array(z.string()),
  notIncluded: z.array(z.string()),
  status: z.enum(["OK", "FAILED"]),
  verification: z
    .object({
      verifiedAt: z.string(),
      ok: z.boolean(),
      checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
    })
    .nullable(),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

/** Thrown by `createBackup` when the finished copy fails its own check. The folder is kept, marked FAILED. */
export class BackupVerificationError extends BackupError {
  public readonly manifest: BackupManifest;
  public constructor(message: string, manifest: BackupManifest) {
    super(message);
    this.name = "BackupVerificationError";
    this.manifest = manifest;
  }
}

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

const sha256OfFile = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const KEY_TABLES = [
  "companies", "businesses", "customers", "suppliers", "items", "invoices", "credit_notes", "payments",
  "purchase_bills", "journal_entries", "journal_lines", "stock_movements", "audit_events", "attachments",
  "auth_users",
] as const;

const FRIENDLY: Record<string, string> = {
  invoices: "invoice(s)", credit_notes: "credit note(s)", payments: "payment(s)", purchase_bills: "purchase bill(s)",
  journal_entries: "journal entr(ies)", stock_movements: "stock movement(s)", customers: "customer(s)",
  suppliers: "supplier(s)", items: "item(s)", attachments: "attachment record(s)", audit_events: "audit-log entr(ies)",
};

function readAppVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function describeDatabase(dbPath: string): { schemaVersion: number | null; rowCounts: Record<string, number> } {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    let schemaVersion: number | null = null;
    if (tableExists(db, "schema_migrations")) {
      const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
      schemaVersion = row.v;
    }
    const rowCounts: Record<string, number> = {};
    for (const table of KEY_TABLES) {
      if (!tableExists(db, table)) continue;
      rowCounts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    }
    return { schemaVersion, rowCounts };
  } finally {
    db.close();
  }
}

/** Every regular file under `root`, as forward-slash relative paths. Symlinks and the like are skipped. */
function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  if (fs.existsSync(root) && fs.statSync(root).isDirectory()) walk(root, "");
  return out.sort();
}

function copyTree(srcRoot: string, destRoot: string): string[] {
  const rels = listFilesRecursive(srcRoot);
  for (const rel of rels) {
    const dest = path.join(destRoot, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(srcRoot, ...rel.split("/")), dest);
  }
  return rels;
}

function readManifestFile(folder: string): BackupManifest | null {
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(fs.readFileSync(path.join(folder, BACKUP_MANIFEST_FILE), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Resolve a backup id to its folder, refusing anything that is not exactly an id. */
export function resolveBackupFolder(backupsRoot: string, id: string): string {
  if (!BACKUP_ID_PATTERN.test(id)) throw new BackupError(`"${id.slice(0, 60)}" is not a valid backup id.`);
  const root = path.resolve(backupsRoot);
  const folder = path.resolve(root, id);
  if (path.dirname(folder) !== root) throw new BackupError("Backup id does not point inside the backups folder.");
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new BackupNotFoundError(`Backup ${id} was not found.`);
  return folder;
}

// ---------------------------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------------------------

/**
 * Checks one database file, opened READ-ONLY: SQLite's own integrity check, foreign keys, and that
 * the books balance (in total, and entry by entry).
 */
export function verifyDatabaseFile(dbPath: string): BackupCheck[] {
  const checks: BackupCheck[] = [];
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    return [{ name: "open", ok: false, detail: `Could not open the database: ${error instanceof Error ? error.message : String(error)}` }];
  }
  try {
    const run = (name: string, fn: () => { ok: boolean; detail: string }): void => {
      try {
        checks.push({ name, ...fn() });
      } catch (error) {
        checks.push({ name, ok: false, detail: `Check could not run: ${error instanceof Error ? error.message : String(error)}` });
      }
    };
    run("integrity_check", () => {
      const rows = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
      const ok = rows.length === 1 && rows[0]?.integrity_check === "ok";
      return { ok, detail: ok ? "SQLite integrity check passed." : rows.slice(0, 5).map((r) => r.integrity_check).join("; ") };
    });
    run("foreign_key_check", () => {
      const rows = db.pragma("foreign_key_check") as unknown[];
      return { ok: rows.length === 0, detail: rows.length === 0 ? "No broken links between records." : `${rows.length} record(s) point at something that does not exist.` };
    });
    run("journal_balances", () => {
      const r = db.prepare("SELECT COALESCE(SUM(debit_paise),0) AS d, COALESCE(SUM(credit_paise),0) AS c FROM journal_lines").get() as { d: number; c: number };
      return { ok: r.d === r.c, detail: r.d === r.c ? `Total debits equal total credits (${r.d} paise).` : `Total debits ${r.d} paise but credits ${r.c} paise.` };
    });
    run("journal_entries_balance", () => {
      const bad = db
        .prepare("SELECT journal_entry_id AS id FROM journal_lines GROUP BY journal_entry_id HAVING SUM(debit_paise) <> SUM(credit_paise) LIMIT 5")
        .all() as Array<{ id: string }>;
      return { ok: bad.length === 0, detail: bad.length === 0 ? "Every journal entry balances on its own." : `Unbalanced entries, e.g. ${bad.map((b) => b.id).join(", ")}.` };
    });
  } finally {
    db.close();
  }
  return checks;
}

/** Checks a backup folder: manifest, every SHA-256, no stray files, then the database itself. */
export function verifyBackup(folder: string): BackupVerification {
  const checks: BackupCheck[] = [];
  const finish = (): BackupVerification => ({ ok: checks.every((c) => c.ok), checks });
  const manifest = fs.existsSync(folder) ? readManifestFile(folder) : null;
  if (manifest === null) {
    checks.push({ name: "manifest", ok: false, detail: "manifest.json is missing or unreadable, so this backup cannot be trusted." });
    return finish();
  }
  checks.push({ name: "manifest", ok: true, detail: "manifest.json is readable." });

  const root = path.resolve(folder);
  const listed = new Set<string>();
  for (const file of manifest.files) {
    const abs = path.resolve(root, ...file.path.split("/"));
    if (file.path.includes("..") || path.isAbsolute(file.path) || !abs.startsWith(root + path.sep)) {
      checks.push({ name: `sha256:${file.path}`, ok: false, detail: "The manifest names a file outside the backup folder." });
      continue;
    }
    listed.add(file.path);
    if (!fs.existsSync(abs)) {
      checks.push({ name: `sha256:${file.path}`, ok: false, detail: "The file is missing." });
      continue;
    }
    const actual = sha256OfFile(abs);
    checks.push({ name: `sha256:${file.path}`, ok: actual === file.sha256, detail: actual === file.sha256 ? "Fingerprint matches." : "The file has changed since the backup was made." });
  }
  const stray = listFilesRecursive(root).filter((rel) => rel !== BACKUP_MANIFEST_FILE && !listed.has(rel));
  checks.push({ name: "no_unlisted_files", ok: stray.length === 0, detail: stray.length === 0 ? "No files beyond those in the manifest." : `Files not in the manifest: ${stray.slice(0, 5).join(", ")}.` });

  const dbFile = path.join(root, BACKUP_DB_FILE);
  if (!fs.existsSync(dbFile)) {
    checks.push({ name: "database_present", ok: false, detail: `${BACKUP_DB_FILE} is missing.` });
  } else {
    checks.push(...verifyDatabaseFile(dbFile));
  }
  return finish();
}

// ---------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------

export interface CreateBackupOptions {
  readonly backupsRoot: string;
  /** Where attachment files live. Required for scope EVERYTHING; ignored for DATABASE_ONLY. */
  readonly attachmentsRoot?: string;
  readonly scope: BackupScope;
  readonly label?: string;
  readonly kind?: BackupKind;
  readonly now?: Date;
}

function includedLists(scope: BackupScope, attachmentFiles: number): { included: string[]; notIncluded: string[] } {
  const included = [
    "All accounting records: customers, suppliers, items, invoices, credit notes, payments, purchase bills, expenses, stock and the journal.",
    "The chart of accounts, financial years and opening balances.",
    "The audit log (it is stored inside the database).",
    "Login accounts and their settings (stored inside the database).",
    "Records of which files are attached to which document (the attachment list, not the files).",
  ];
  const notIncluded = ["Anything entered after this backup was made."];
  if (scope === "EVERYTHING") {
    included.push(`The attached files themselves (${attachmentFiles} file(s)), exactly as stored.`);
  } else {
    notIncluded.push("The attached files themselves (scanned bills, receipts and so on). Only the list of attachments is saved, so after a restore those documents would show as attached but the files would be missing unless the attachments folder is still intact.");
  }
  return { included, notIncluded };
}

export async function createBackup(db: Database.Database, options: CreateBackupOptions): Promise<BackupManifest> {
  const now = options.now ?? new Date();
  const kind = options.kind ?? "MANUAL";
  if (options.scope === "EVERYTHING" && options.attachmentsRoot === undefined) {
    throw new BackupError("A backup of everything needs to know where the attachments folder is.");
  }
  const id = `bk-${now.toISOString().replace(/[-:.]/g, "")}-${randomBytes(3).toString("hex")}`;
  const backupsRoot = path.resolve(options.backupsRoot);
  const tmp = path.join(backupsRoot, `.tmp-${id}`);
  const final = path.join(backupsRoot, id);
  fs.mkdirSync(backupsRoot, { recursive: true });
  fs.mkdirSync(tmp);
  try {
    const dbCopy = path.join(tmp, BACKUP_DB_FILE);
    await db.backup(dbCopy);
    const { schemaVersion, rowCounts } = describeDatabase(dbCopy);

    const files: Array<{ path: string; sizeBytes: number; sha256: string }> = [];
    let attachmentCount = 0;
    if (options.scope === "EVERYTHING" && options.attachmentsRoot !== undefined) {
      const rels = copyTree(path.resolve(options.attachmentsRoot), path.join(tmp, BACKUP_ATTACHMENTS_DIR));
      attachmentCount = rels.length;
    }
    for (const rel of [BACKUP_DB_FILE, ...listFilesRecursive(path.join(tmp, BACKUP_ATTACHMENTS_DIR)).map((r) => `${BACKUP_ATTACHMENTS_DIR}/${r}`)]) {
      const abs = path.join(tmp, ...rel.split("/"));
      files.push({ path: rel, sizeBytes: fs.statSync(abs).size, sha256: sha256OfFile(abs) });
    }

    const lists = includedLists(options.scope, attachmentCount);
    const base: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      id,
      createdAt: now.toISOString(),
      istDate: istDateOf(now),
      kind,
      scope: options.scope,
      label: options.label ?? null,
      schemaVersion,
      appVersion: readAppVersion(),
      rowCounts,
      files,
      included: lists.included,
      notIncluded: lists.notIncluded,
      status: "OK",
      verification: null,
    };
    fs.writeFileSync(path.join(tmp, BACKUP_MANIFEST_FILE), JSON.stringify(base, null, 2));

    const result = verifyBackup(tmp);
    const manifest: BackupManifest = {
      ...base,
      status: result.ok ? "OK" : "FAILED",
      verification: { verifiedAt: new Date().toISOString(), ok: result.ok, checks: [...result.checks] },
    };
    fs.writeFileSync(path.join(tmp, BACKUP_MANIFEST_FILE), JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, final);
    if (!result.ok) {
      const failed = result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ");
      throw new BackupVerificationError(`Backup ${id} was written but FAILED its own check (${failed}). It is kept and marked FAILED; do not rely on it.`, manifest);
    }
    return manifest;
  } catch (error) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------------------------

export interface BackupListEntry {
  /** The folder name. */
  readonly id: string;
  readonly manifest: BackupManifest | null;
  /** Null when complete; otherwise why this folder is not a usable backup. */
  readonly problem: string | null;
}

/** Newest first. A folder with no valid manifest is returned as incomplete, never skipped. */
export function listBackups(backupsRoot: string): BackupListEntry[] {
  const root = path.resolve(backupsRoot);
  if (!fs.existsSync(root)) return [];
  const entries: BackupListEntry[] = [];
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const manifest = readManifestFile(path.join(root, dirent.name));
    if (manifest === null) {
      entries.push({ id: dirent.name, manifest: null, problem: dirent.name.startsWith(".tmp-") ? "Unfinished backup (the process stopped part-way)." : "manifest.json is missing or unreadable." });
    } else if (manifest.id !== dirent.name) {
      entries.push({ id: dirent.name, manifest: null, problem: `Folder name does not match the id inside its manifest (${manifest.id}).` });
    } else {
      entries.push({ id: dirent.name, manifest, problem: manifest.status === "FAILED" ? "This backup failed its own check." : null });
    }
  }
  return entries.sort((a, b) => {
    if (a.manifest !== null && b.manifest !== null) return a.manifest.createdAt < b.manifest.createdAt ? 1 : a.manifest.createdAt > b.manifest.createdAt ? -1 : 0;
    if (a.manifest !== null) return -1;
    if (b.manifest !== null) return 1;
    return a.id < b.id ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------------------------

export interface RestoreOptions {
  /** Take the users (login accounts and sessions) from the database being replaced. */
  readonly preserveUsers?: boolean;
  /** Keep the numbering counters of the database being replaced (never moving a counter backwards). */
  readonly preserveCounters?: boolean;
  readonly now?: Date;
}

export interface RestoreBackupInput {
  readonly folder: string;
  /** Where the restored database is written. If a file is already there it is backed up and moved aside. */
  readonly targetDbPath: string;
  readonly targetAttachmentsRoot?: string;
  /** Database to take users/counters from. Defaults to the database being replaced. */
  readonly preserveFrom?: string;
  /** Needed whenever something already exists at the target: where the pre-restore backup goes. */
  readonly preRestoreBackupsRoot?: string;
  readonly options?: RestoreOptions;
}

export interface RestoreResult {
  readonly dbPath: string;
  readonly restoredFromBackup: string;
  readonly schemaVersionInBackup: number | null;
  readonly schemaVersionNow: number | null;
  readonly preRestoreBackup: BackupManifest | null;
  /** Everything that was moved aside, not deleted. */
  readonly movedAside: readonly string[];
  readonly verification: readonly BackupCheck[];
  /** Plain English: what the owner is losing or should know. */
  readonly warnings: readonly string[];
}

const SIDECARS = ["-wal", "-shm", "-journal"];

function copyRows(from: Database.Database, to: Database.Database, table: string): number {
  if (!tableExists(from, table) || !tableExists(to, table)) return 0;
  const fromCols = (from.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
  const toCols = new Set((to.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name));
  const cols = fromCols.filter((c) => toCols.has(c));
  const rows = from.prepare(`SELECT ${cols.join(", ")} FROM ${table}`).all() as Array<Record<string, unknown>>;
  const insert = to.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`);
  for (const row of rows) insert.run(row);
  return rows.length;
}

export async function restoreBackup(input: RestoreBackupInput): Promise<RestoreResult> {
  const options = input.options ?? {};
  const now = options.now ?? new Date();
  const target = path.resolve(input.targetDbPath);
  const warnings: string[] = [];

  const verification = verifyBackup(input.folder);
  if (!verification.ok) {
    throw new BackupError(`This backup failed its check and was NOT restored: ${verification.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ")}`);
  }
  const manifest = readManifestFile(input.folder);
  if (manifest === null) throw new BackupError("manifest.json is unreadable.");
  const backupDb = path.join(path.resolve(input.folder), BACKUP_DB_FILE);

  const targetExists = fs.existsSync(target);
  const attachmentsRoot = input.targetAttachmentsRoot === undefined ? null : path.resolve(input.targetAttachmentsRoot);
  const attachmentsNonEmpty = attachmentsRoot !== null && listFilesRecursive(attachmentsRoot).length > 0;
  const backupHasAttachments = manifest.files.some((f) => f.path.startsWith(`${BACKUP_ATTACHMENTS_DIR}/`));
  const replaceAttachments = backupHasAttachments && attachmentsRoot !== null;

  if (!targetExists && replaceAttachments && attachmentsNonEmpty) {
    throw new BackupError("The attachments folder already has files but there is no database to back them up with. Restore into an empty attachments folder instead.");
  }
  if (targetExists && input.preRestoreBackupsRoot === undefined) {
    throw new BackupError("A database already exists at the restore target, so a place for the pre-restore backup is required.");
  }
  const wantsPreserve = options.preserveUsers === true || options.preserveCounters === true;
  const preserveSource = input.preserveFrom !== undefined ? path.resolve(input.preserveFrom) : targetExists ? target : null;
  if (wantsPreserve && (preserveSource === null || !fs.existsSync(preserveSource))) {
    throw new BackupError("There is no existing database to keep users or counters from.");
  }

  // 1. Safety copy of what is about to be replaced. Failure here aborts before anything is touched.
  let preRestore: BackupManifest | null = null;
  const movedAside: string[] = [];
  const asideStamp = `${now.toISOString().replace(/[-:.]/g, "")}-${randomBytes(2).toString("hex")}`;
  if (targetExists && input.preRestoreBackupsRoot !== undefined) {
    const current = new Database(target, { readonly: true, fileMustExist: true });
    try {
      const scope: BackupScope = attachmentsRoot !== null && fs.existsSync(attachmentsRoot) ? "EVERYTHING" : "DATABASE_ONLY";
      preRestore = await createBackup(current, {
        backupsRoot: input.preRestoreBackupsRoot,
        ...(attachmentsRoot === null ? {} : { attachmentsRoot }),
        scope,
        kind: "PRE_RESTORE",
        label: `Automatic safety copy before restoring ${manifest.id}`,
        now,
      });
    } finally {
      current.close();
    }
  }

  // 2. Move the old database aside (never delete). Sidecar files go with it so a stale journal can never meet the new file.
  const asideDb = `${target}.replaced-${asideStamp}`;
  const moved: Array<[string, string]> = [];
  const moveAside = (from: string, to: string): void => {
    fs.renameSync(from, to);
    moved.push([from, to]);
    movedAside.push(to);
  };
  const undoMoves = (): void => {
    for (const [from, to] of moved.reverse()) if (fs.existsSync(to)) fs.renameSync(to, from);
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (targetExists) {
    moveAside(target, asideDb);
    for (const suffix of SIDECARS) if (fs.existsSync(target + suffix)) moveAside(target + suffix, asideDb + suffix);
  }

  // 3. Write the backup into place, open it through the repository (which MIGRATES), keep what was asked, re-check.
  let schemaVersionNow: number | null = null;
  let finalChecks: BackupCheck[] = [];
  try {
    const staging = `${target}.restoring`;
    fs.copyFileSync(backupDb, staging);
    fs.renameSync(staging, target);

    const repo = new AccountingRepository(target);
    try {
      const sourcePath = preserveSource === target ? asideDb : preserveSource;
      const old = wantsPreserve && sourcePath !== null ? new Database(sourcePath, { readonly: true, fileMustExist: true }) : null;
      try {
        repo.db.transaction(() => {
          // Ruling S16-1(c): the restore itself is recorded INSIDE the restored database (the old one is
          // moved aside; this is the only audit log that survives).
          appendAuditEvent(repo.db, {
            action: "backup.restored",
            entityId: manifest.id,
            entityType: "backup",
            occurredAt: now.toISOString(),
            ...(manifest.label === undefined || manifest.label === null || manifest.label === "" ? {} : { reason: String(manifest.label) }),
            afterValues: { manifestId: manifest.id, backupFolder: path.basename(path.resolve(input.folder)), backupDate: manifest.istDate },
          });
          if (options.preserveUsers === true && old !== null) {
            repo.db.prepare("DELETE FROM auth_sessions").run();
            repo.db.prepare("DELETE FROM auth_users").run();
            const users = copyRows(old, repo.db, "auth_users");
            copyRows(old, repo.db, "auth_sessions");
            warnings.push(`Login accounts were kept from the books you replaced (${users} account(s)); the ones inside the backup were discarded.`);
          } else if (tableExists(repo.db, "auth_sessions")) {
            // Sanitising: a backup carries the sign-in sessions that were live when it was taken. Restoring must not resurrect them.
            repo.db.prepare("DELETE FROM auth_sessions").run();
            warnings.push("Everyone will need to sign in again: sign-in sessions saved inside a backup are discarded on restore.");
          }
          if (options.preserveCounters === true && old !== null && tableExists(old, "customer_number_counters")) {
            const rows = old.prepare("SELECT company_id, category, next_seq FROM customer_number_counters").all() as Array<{ company_id: string; category: string; next_seq: number }>;
            const upsert = repo.db.prepare(
              "INSERT INTO customer_number_counters (company_id, category, next_seq) VALUES (?, ?, ?) ON CONFLICT(company_id, category) DO UPDATE SET next_seq = MAX(next_seq, excluded.next_seq)",
            );
            for (const r of rows) upsert.run(r.company_id, r.category, r.next_seq);
            warnings.push(`Numbering counters were kept from the books you replaced (${rows.length} counter(s)), so numbers already handed out are not reused.`);
          }
        })();
      } finally {
        old?.close();
      }
      const v = repo.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
      schemaVersionNow = v.v;
    } finally {
      repo.close();
    }
    finalChecks = verifyDatabaseFile(target);
    if (finalChecks.some((c) => !c.ok)) {
      throw new BackupError(`The restored database failed its check: ${finalChecks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}`);
    }
  } catch (error) {
    // Roll back: remove whatever we wrote and put the original back.
    for (const leftover of [target, `${target}.restoring`, ...SIDECARS.map((s) => target + s)]) fs.rmSync(leftover, { force: true });
    undoMoves();
    throw error instanceof BackupError ? error : new BackupError(`Restore failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 4. Attachment files.
  if (replaceAttachments && attachmentsRoot !== null) {
    if (attachmentsNonEmpty) {
      const aside = `${attachmentsRoot}.replaced-${asideStamp}`;
      fs.renameSync(attachmentsRoot, aside);
      movedAside.push(aside);
    }
    fs.mkdirSync(attachmentsRoot, { recursive: true });
    copyTree(path.join(path.resolve(input.folder), BACKUP_ATTACHMENTS_DIR), attachmentsRoot);
  } else if (backupHasAttachments) {
    warnings.push("This backup contains attachment files but no attachments folder was given, so the files were NOT restored.");
  } else if (attachmentsRoot !== null && fs.existsSync(attachmentsRoot)) {
    warnings.push("This was a database-only backup: the attachments folder was left as it is and may not match the restored records.");
  }

  // 5. Say plainly what is lost.
  warnings.unshift(`Anything entered after ${manifest.istDate} (when this backup was made) is no longer in the books.`);
  if (preRestore !== null) {
    for (const [table, then] of Object.entries(manifest.rowCounts)) {
      const nowCount = preRestore.rowCounts[table];
      const label = FRIENDLY[table];
      if (label !== undefined && nowCount !== undefined && nowCount > then) {
        warnings.push(`${nowCount - then} ${label} entered after the backup are not in the restored books (${nowCount} before, ${then} after). They remain in the pre-restore backup ${preRestore.id}.`);
      }
    }
  }
  if (manifest.schemaVersion !== null && schemaVersionNow !== null && manifest.schemaVersion < schemaVersionNow) {
    warnings.push(`The backup was from an older version of the books (v${manifest.schemaVersion}); it was updated to v${schemaVersionNow}.`);
  }

  return {
    dbPath: target,
    restoredFromBackup: manifest.id,
    schemaVersionInBackup: manifest.schemaVersion,
    schemaVersionNow,
    preRestoreBackup: preRestore,
    movedAside,
    verification: finalChecks,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// automatic
// ---------------------------------------------------------------------------------------------

export interface AutomaticBackupOptions {
  readonly backupsRoot: string;
  /** How many AUTOMATIC backups to keep. Default 7. */
  readonly keep?: number;
  readonly now?: Date;
}

export const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Makes a database-only AUTOMATIC backup if the newest good one is 24 hours old or more, then prunes
 * automatic backups beyond `keep`. Manual and pre-restore backups are never touched. No timer here.
 */
export async function runAutomaticBackup(
  db: Database.Database,
  options: AutomaticBackupOptions,
): Promise<{ created: BackupManifest | null; pruned: string[] }> {
  const keep = options.keep ?? 7;
  if (!Number.isInteger(keep) || keep < 1) throw new BackupError("keep must be a whole number of at least 1.");
  const now = options.now ?? new Date();
  const automatic = (): BackupManifest[] =>
    listBackups(options.backupsRoot).flatMap((e) => (e.manifest !== null && e.manifest.kind === "AUTOMATIC" ? [e.manifest] : []));

  const newestGood = automatic().find((m) => m.status === "OK");
  let created: BackupManifest | null = null;
  if (newestGood === undefined || now.getTime() - Date.parse(newestGood.createdAt) >= AUTOMATIC_BACKUP_INTERVAL_MS) {
    created = await createBackup(db, { backupsRoot: options.backupsRoot, scope: "DATABASE_ONLY", kind: "AUTOMATIC", label: "Automatic daily backup", now });
  }
  const pruned: string[] = [];
  for (const m of automatic().slice(keep)) {
    fs.rmSync(resolveBackupFolder(options.backupsRoot, m.id), { recursive: true, force: true });
    pruned.push(m.id);
  }
  return { created, pruned };
}
