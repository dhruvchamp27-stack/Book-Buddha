# Decisions – 9 Nov 2026 (the 15 questions)

Answers to the 4 magazine-accounting questions and the 11 filter-sheet questions.
Feeds the design-document restructure.

## Magazine block

- **M1 (cost of books, Track stock = Yes):** no setting needed. Stock ARRIVES → the user enters it
  as ordinary data entry. Stock LEAVES → for subscriptions via a CHALLAN (delivery note); for
  everything else at the INVOICE (no challan involved). Cost follows the stock out.
- **M2 (cost of magazines, no stock):** handled the same way as M1. Treated under subscription
  accounting (see pending item).
- **M3 (credit customers): A** — an ordinary credit sale: normal sales invoice, payment recorded
  when received. No challan-first flow.
- **M4 (challan ↔ invoice link): PENDING.** Held together with the subscription-accounting
  treatment; the user will answer soon. Proposed (not yet confirmed): invoice first (full-year;
  receivable + unearned revenue), each delivery = one challan against that invoice; one invoice →
  many challans; a challan spanning several invoices is a v2 item.

## Block B (filter-sheet questions) — all decided

| # | Question | Decision |
|---|----------|----------|
| Q1 | Customer credit: one pool or two | TWO separate ledgers — (1) Customer Advances / Excess Payments (cash liability), (2) Credit Notes / Sales Returns & Allowances. ONE combined credit balance shown per customer; underlying ledgers kept separate. |
| Q2 | Customer merge tool | YES. Select primary + duplicate → preview both → transfer all invoices, payments, credit notes, advances, quotations, attachments, notes, history → user resolves contact/custom-field conflicts → never create or alter accounting entries (keep original IDs, dates, numbers) → recalc combined balance → full audit trail → old ID kept as alias/redirect → permission checks, confirmation, concurrency safeguards → undo when safe. Merge identities, not transactions. |
| Q3 | P&L basis | C — support BOTH cash and accrual. |
| Q4 | Reports | B — the 8 fixed reports PLUS a generic report builder (QBO / AppFolio style). |
| Q5 | Payment immutability | YES — freeze amount + customer once saved. Editable: date, invoice allocation, method, reference, notes. Corrections via reverse-and-re-enter. Original payment + all changes preserved. |
| Q6 | Partial / deposit on invoice | A — YES, with its own due date. |
| Q7 | Archive as a third state | Skip in v1. |
| Q8 | Line-item date tokens (:MONTH/:QUARTER/:YEAR) | A — YES. |
| Q9 | Tamper-evident audit log | A — YES. Each entry stores a hash of the previous one; any change/deletion breaks the chain. Read-only in the app; restrict direct DB access; periodically back up / externally anchor log hashes. Both app read-only + hash-chain. |
| Q10 | Low-stock threshold and alert | A — YES, per item with a business-level fallback. |
| Q11 | Number reset follows financial year | Confirmed. Financial year configurable per business in Settings; numbering resets every financial year, per document type. |

## Still open before the design document can be restructured
- M4 + how subscription revenue and cost should be handled (user to answer).
  Research done 9 Nov (US/general sources): advance = deferred/unearned revenue (liability);
  revenue recognised as each issue is delivered; cost matched to delivery; nothing held in stock.
  CA to confirm the Indian treatment and whether a reseller books the full sale or only the margin.
