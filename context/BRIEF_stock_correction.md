# Build brief — stock-entry correction (ruling S10-4), migration v22

Repo root `C:\Users\Admin\Desktop\Book Buddha`; commands run from `book-buddha/`.
**Another agent is building backup/restore in parallel in `src/backup/` (new folder) and
`src/api/backup-routes.ts`. Do not touch those.** You own: `src/database/stock-adjustment-schema.ts`
(already drafted, untracked), `src/database/migrations.ts` (register v22 only),
`src/database/stock-layers.ts`, `src/database/repository.ts`, `src/api/server.ts`, and new test
files you create.

## The owner's ruling (context/decisions.md S10-4 — read it)
"Yes, before R9." `addStockMovement` accepts only a POSITIVE quantity and there is no reversal or
delete, so shrinkage/breakage have no way in, and a mistyped opening quantity is wrong in the stock
reports AND in `OPENING_BALANCE_EQUITY` with no correction path — against cancel-with-reversal, a
fixed rule. Accepted scope: **a negative adjustment plus a reversal for an existing movement,
posting `Dr STOCK_ADJUSTMENT / Cr INVENTORY`; refusing to remove more than the FIFO layers actually
hold; refusing a locked financial year.** A reversal is NOT a back-dated layer (S10-2).
Also read S11-3 (cancellations recorded in the period they happen, respecting closed periods).

## Read first
1. `src/database/stock-adjustment-schema.ts` — the v22 draft and its header. It is careful; keep it.
   Verify its claims instead of trusting them: grep the whole schema for any trigger whose BODY
   mentions `stock_movements` (not only `tbl_name`) — the house trap is that a rebuild must replay
   every trigger that mentions the table. Check the index names match the live ones.
2. `src/database/migrations.ts` — how a version is registered (v21 is the last). v22 is yours.
3. `src/database/stock-layers.ts` — `datedStockLayers`, the FIFO replay (`ORDER BY occurred_at,
   rowid`), how `PURCHASE_REVERSAL` is matched to its lot (by `source_id` AND unit cost — the
   ENGINEERING TRAP in `context/RESUME_PROMPT.md`: session 9 stamped the wrong id, removed no
   stock, and the ledger credited INVENTORY anyway).
4. `src/database/repository.ts` — `addStockMovement` (≈ 1328), `consumeInvoiceStock` (≈ 3949, the
   FIFO-consuming pattern to copy), `insertStockMovement` (≈ 4044), the `je-stock-movement-<id>`
   posting (≈ 1375) and its offset accounts (≈ 693-695), `cancelInvoice` (how a reversal is
   dated: `istDateOf()`), and how the financial-year lock refuses a posting.
5. `context/RESUME_PROMPT.md` sections "ENGINEERING TRAPS" and "HOW TO WORK".

## What to build
1. **Register v22** (`applyStockAdjustmentSchema`). No new account, no new frozen seed list.
2. **Write-down: `ADJUSTMENT_OUT`.** A public repository method (name it to match the house, e.g.
   `writeDownStock({ itemId, quantity, occurredOn?, reason? })`) and a route.
   - Consumes the FIFO queue exactly as a sale does: one `ADJUSTMENT_OUT` row per layer eaten, each
     at THAT layer's unit cost, negative delta. Group the rows under one id you mint for the
     write-down (put it in `source_id`) so the write-down can be reversed as a unit.
   - **Refuse** a quantity greater than on hand (plain message naming on-hand quantity); refuse
     zero/negative/non-integer; refuse a non-stock-tracked item.
   - Posts ONE entry: `Dr STOCK_ADJUSTMENT / Cr INVENTORY` for the summed layer cost, dated
     `occurredOn` (default `istDateOf()`); the financial-year lock refuses it if that year is locked.
     Movement rows keep `occurred_at` = insertion instant (date the ENTRY, never the layer).
3. **Reversal: `ADJUSTMENT_REVERSAL`.** `reverseStockMovement(movementId)` (or house-style name) and
   a route. Reversible: a hand-entered `OPENING` or `ADJUSTMENT`, and a whole write-down.
   - Reversing an `OPENING`/`ADJUSTMENT`: removes THAT movement's own lot (never the oldest lot) —
     one negative `ADJUSTMENT_REVERSAL` row, `source_id` = the reversed movement id, at its unit
     cost; teach `datedStockLayers` to match it to the lot by movement id. **Refuse if any of that
     lot has already been consumed** (the goods are gone; say so plainly — the user should write
     down instead). Posts the mirror of the original `je-stock-movement-<id>` entry (OPENING:
     `Dr OPENING_BALANCE_EQUITY / Cr INVENTORY`; ADJUSTMENT: `Dr STOCK_ADJUSTMENT / Cr INVENTORY`),
     as a reversal, dated `istDateOf()` (S11-3: in the period it happens), lock-checked.
   - Reversing a write-down: puts the goods back — positive `ADJUSTMENT_REVERSAL` rows, one per
     write-down row, each at that row's unit cost, `source_id` = the write-down id. They open new
     lots at the END of the queue (the v19 corollary — restoring stock never jumps the queue);
     give such a lot a sensible `receivedOn`/`dateBasis` in `datedStockLayers` (its journal entry
     date, `JOURNAL`). Posts `Dr INVENTORY / Cr STOCK_ADJUSTMENT`, dated today, lock-checked.
   - **Refuse**: reversing twice; reversing a reversal; a `SALE`/`SALE_REVERSAL`/
     `PURCHASE_REVERSAL`; a `PURCHASE` with a bill (the bill has its own cancel); a bare
     source-less `PURCHASE` (it posted nothing — the S7-1(d) hole — so reversing it would unbalance
     INVENTORY vs valuation further; refuse with a message saying why).
4. **Every consumer of `movement_type`**: grep the whole `src/` for it and for `'SALE'`,
   `'ADJUSTMENT'`, `StockMovementType`; make sure ageing, valuation, low-stock, item profitability
   (`reports-profitability.ts` must NOT count write-downs as COGS — check), the stock-journal
   backfill planner and any type unions handle the two new types correctly. List what you checked.
5. Routes in `server.ts` next to the existing stock-movement routes (find them), strict schemas.

## Tests (new file(s); do not edit existing tests)
- **Migration, done properly** (house trap: a whole-chain run on an empty DB tests NOTHING): build
  to v21 with `migrations.filter(m => m.version <= 21)`, insert rows by raw SQL including a
  `fair_id` and rowids out of id order, call `applyStockAdjustmentSchema(db)` DIRECTLY, then assert
  every row survives with the same rowid, `fair_id` and values; the indexes exist; the CHECK
  accepts the new types and still refuses junk; a second run is a no-op; a table with an extra
  column makes it throw. `PRAGMA foreign_key_check` empty.
- Write-down eating two layers at different costs: rows and the posted amount worked by hand in a
  comment; on-hand and valuation after.
- **INVENTORY ledger == `getInventoryValuation` total** after every scenario (the assertion that
  caught session 9's bug). And the whole ledger balances.
- Over-quantity refused; locked year refused (write-down dated in it, and a reversal when today's
  year is locked — use the house's way of faking today); reversal of a consumed lot refused; every
  refuse-list case above refused.
- Reversing an OPENING whose lot is NOT the oldest removes exactly that lot (later FIFO
  consumption then takes the other lot's cost — assert the COGS).
- Reverse a write-down: stock and valuation restored; new lots at the end of the queue.
- Over HTTP via `app.inject` with `buildApi(repository, { __unsafeDisableAuthForTests: true })` —
  TWO positional args: each new route once, success and a 400.
- **Mutation-prove** the two that matter and say so in your report: (a) stamp the reversal row
  with the wrong `source_id` → the ledger==valuation test must go red; (b) drop `rowid` from the
  v22 copy → the migration test must go red. Back up to the scratchpad, restore and prove
  byte-identical (never `git checkout`).

## Hard constraints
No dependency. No git. Never open a file database except throwaway ones in `os.tmpdir()`; never
read or set `BOOK_BUDDHA_DATABASE`. Do not edit existing tests; if one goes red, triage it: if it
pins something this slice legitimately changes (e.g. a test asserting the old CHECK list or a
migration count), STOP and report it with the exact assertion — I decide. **An `ACCEPTANCE` test
going red: STOP immediately.** Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`erasableSyntaxOnly`). Edit with the Edit tool, never perl/sed.

## Gates (PowerShell, from `book-buddha/`)
`.\node_modules\.bin\tsc.cmd; $LASTEXITCODE` FIRST, then `.\node_modules\.bin\vitest.cmd run --root .`
Never pipe. Known flake: `allocateProportionally … fuzz` (engine.test.ts) — re-run alone. The
other agent adds tests concurrently; report which files are yours.

## Report back
tsc exit; vitest lines verbatim; files changed with one line why; the movement_type consumer
audit; the two mutation results; the trigger check result; anything in S10-4 that turned out
impossible or ambiguous.
