# Handoff – Fair Accounting App / "Book Buddha" (paused 9 Nov 2026)

Paste or share this at the start of a new chat in the Billing Project. It carries forward the
8 Nov session 2 handoff and records 9 Nov progress. Full confirmed-decision list lives in
`Handoff - Fair Accounting App paused 8 Nov 2026 session 2.md` section 7 and in
`Decisions - 9 Nov 2026 (the 15 questions).md` — both in this folder.

## 1. Where we stopped

We are in the superpowers brainstorming process. Nothing is built until I approve the full design.

**Only one thing is open before the design document can be restructured:** the subscription piece —
**M4** (challan↔invoice link) **plus how I want subscription revenue and cost handled**. I will
start the NEXT session by giving the subscription-accounting answer, and nothing else first.

## 2. How to work with me (unchanged)

- Short answers, one step at a time, confirm before moving on. I am a finance professional,
  no-code background, not an engineer.
- Always tell the truth, cite real sources, say "I cannot confirm this" when unverifiable. No guessing.
- Superpowers brainstorming for planning. Spec first, plan second, build third. No implementation
  plan until I confirm the spec; no code until I confirm the plan.
- Questions in sets of 5, one decision each, lettered options; I answer "1A, 2B".
- Put full section content in the message. End long drafts with a plain-text question, not a card.
- "What is suggested as per accounting logic?" → search, cite, label opinion, say what is unverified.
- Files live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs/prompts there, not as project files.
- Design principle: the app must leave me free to manage things my own way; no strict built-in rules.
  Fixed parts: double-entry, audit log, cancel with reversal.

## 3. What happened on 9 Nov

### 3.1 Round 5 reviewed and CLOSED (option 2: proceed on text, park the screenshots)
- The two files on disk — `IN-round5-codebase-corrections.md` and `IN-round5-visual-corrections.md`
  — were read. The written/code findings are sound and answer their items.
- **The screenshots were NOT actually delivered.** The visual file claims retakes and new files
  (locked invoice, 11 designs, 4 emails) with fresh MD5s, but on disk the duplicates are unchanged
  (`01=02=03=08`, `06=07=12`, UX `13=14`, `18=19`) and the new files do not exist. Treat any
  `[SEEN ...]` claim in that file as unverified. Details in `Round 5 status note (9 Nov 2026).md`.
- Useful settled findings: delete-modal wording is title "Confirmation" / body "Are you sure?" /
  button "Continue"; a zero-total DRAFT invoice is allowed; status pill radius 4px, colour = 15%
  opacity bg + solid text; invoice font is a single global setting (not per-design); 268 settings
  across 26 tabs enumerated.

### 3.2 The 15 questions — nearly all answered
Full answers in `Decisions - 9 Nov 2026 (the 15 questions).md`. Summary:
- **Magazine: M1, M2, M3 done. M4 PENDING** (with the subscription treatment).
  - M1/M2: no setting needed. Stock in = ordinary data entry; stock out = challan (subscriptions)
    or invoice (everything else). M2 same.
  - M3 = A: credit customers are an ordinary credit sale (normal invoice, payment when received).
- **Block B Q1–Q11: ALL done** (two credit ledgers with one combined display; build customer
  merge; both cash+accrual P&L; 8 reports + report builder; freeze payment amount+customer;
  partial/deposit yes; skip Archive in v1; date tokens yes; tamper-evident hash-chain audit log;
  low-stock alert yes; numbering resets per financial year per business/doc).

### 3.3 Stock side of subscriptions — effectively settled
The "Track stock: Yes/No" switch per item IS the mechanism:
- **Yes (books held for fairs):** stock up on receipt (data entry), down on the handover document
  (challan or invoice per the per-business setting, never both), FIFO, COGS booked when stock leaves.
- **No (magazines, pass-through — nothing held):** no inventory balance; cost is an expense when
  the supplier bill is entered / issue delivered; the challan is only a delivery record.
Open only if I sometimes HOLD magazines in stock (would flip them to the Yes case).

### 3.4 Subscription revenue/cost — research done, my answer pending
Researched the standards (sources in this folder's chat history, not re-saved):
- Advance received = deferred/unearned revenue, a **liability** (Ind AS 115 calls it a "contract
  liability"); revenue recognised as each issue is delivered (point-in-time for goods on transfer
  of control / risks and rewards); cost matched to each delivery.
- **Which standard applies to me is a CA question:** Ind AS 115 is for companies on the MCA
  roadmap; smaller unlisted / non-company entities generally stay on AS 9. For a simple outright
  sale of goods both usually reach the same result.
- **Also for my CA:** as a RESELLER of magazines, do I book the full subscription value as revenue
  or only my margin (principal vs agent)? And GST timing. The app stays generic either way — I
  manage unearned revenue with my own accounts + an optional repeat template.

## 4. Files added on disk on 9 Nov
- `Round 5 status note (9 Nov 2026).md`
- `Decisions - 9 Nov 2026 (the 15 questions).md`
- This handoff.

## 5. Next steps
1. I give the subscription-accounting answer (next session, first thing).
2. Fold in M4 (proposed: invoice first → one or many challans against it; one challan = one invoice
   in v1; stock moves once, on the chosen document).
3. Restructure the design document from the filter sheet + all decisions.
4. Write the App flow (12 sections, one at a time, each approved by me).
5. Update the PRD and Features List.
6. I confirm the spec. Only then the implementation plan. Only then build.
