# Handoff – Fair Accounting App / "Book Buddha" (paused 8 Nov 2026, session 2)

Paste or share this at the start of a new chat in the Billing Project so we can continue without
repeating anything. It replaces every earlier handoff (31 Oct, 1 Nov, 2 Nov, 4 Nov, 5 Nov, 6 Nov,
7 Nov sessions 2 and 3, 8 Nov session 1) where they differ.

---

## 1. Where we stopped

We are in the **superpowers brainstorming** process. Nothing is built until I approve the full
design.

Session 2 on 8 Nov did three things: reviewed rounds 3 and 4 of the Invoice Ninja inspection,
wrote the build phase plan, and built the filter sheet. All three are on disk.

**Nothing is waiting on Claude.** Three things are waiting on me:

1. **Send the round 5 correction request to the other AI.** The full text is in section 6 of this
   handoff, ready to paste. It has not been sent.
2. **Answer the questions.** Two sets: the four magazine accounting questions (section 8), which
   are unchanged and still block App flow sections 4, 5 and 11; and eleven new questions the
   filter sheet surfaced (section 9).
3. Decide whether anything in the filter sheet's Take and Adapt columns should change before the
   design document is restructured from it.

**Decided sequence from here:** answer the questions → restructure the design document → write the
App flow → update the PRD and Features List → only then the implementation plan.

---

## 2. How to work with me (my instructions)

- Keep answers short and give one step at a time; confirm before moving on.
- Always tell the truth, cite real sources for factual claims, and say "I cannot confirm this"
  when something cannot be verified. No guessing.
- I am a finance professional with a no-code background and limited AI knowledge (I am not an
  engineer), so guide accordingly.
- Use the superpowers brainstorming skill for planning. Do not start building until the design
  is approved.
- Put the full content of a section in the message itself. End long drafts with a plain-text
  question, not a tappable question card.
- When I paste another AI's answer, check it against real sources and tell me what is verified
  and what is not. Judge the quality of its evidence, not just its content.
- Ask questions in **sets of 5**, one decision per question, no sub-questions, with lettered
  options (A, B, C). I answer like "1A, 2B, 3C".
- When I ask "what is suggested as per accounting logic?", search for sources, cite them, label
  any opinion as opinion, and say what could not be confirmed.
- When I say "go the Invoice Ninja way", check Invoice Ninja's documentation, tell me what it
  does, and flag any conflict with my earlier decisions.
- When I say "check what the magazine PRD says", read the project file
  `PRD_Magazine_Subscription_Management_v4` and report exactly what it says and what it does not.
- When I say "see how any accounting software does it", check how standard accounting software
  (QBO, Tally, Zoho Books) handles it and cite the pages.
- When I explain an accounting effect, I am describing the accounting only, not asking to change
  how the app works. If unsure, ask me before treating it as a design change.
- **Design principle:** the app must leave me free to manage things my own way and leave room for
  the business to change. Do not bind me to strict built-in rules. The fixed parts stay:
  double-entry, audit log, cancel with reversal.
- Stop raising the Invoice Ninja licence key. Only one note stays: ask a lawyer before giving
  away or selling the app.
- Files for this work live in `C:\Users\Admin\Desktop\Book Buddha`. Save handoffs and prompts
  there, not as project files, unless I say otherwise. Inspection output lives in the
  `invoice-ninja-reports` subfolder.
- **New on 8 Nov — the standing rule.** Spec first, plan second, build third. No implementation
  plan until I confirm the spec. No code until I confirm the plan. This is written at the top of
  the build phase plan and overrides anything that appears to permit otherwise.
- **New on 8 Nov — on moving to Claude Code.** Not yet. The current work is spec writing, which
  gains nothing from a repository. Move at the build phase, once the spec is confirmed and the
  technology is chosen. Note the chat already has direct read and write access to the
  `Book Buddha` folder, so moving would not add file access.

---

## 3. What happened in session 2 (8 Nov)

### 3.1 Rounds 3 and 4 were reviewed

The three concerns I raised in section 5.1 of the previous handoff were all confirmed, one of
them worse than I thought.

**Duplicate screenshots — confirmed byte-for-byte by MD5, not merely the same size.** In
`IN-ui-screenshots`, one single image is saved under four names: `01-pass1-light-mode`,
`02-pass1-dark-mode`, `03-pass2-shell-desktop`, `08-pass3-status-pills`. Claude opened it: it is
the Invoices list in **light** mode, so there is no dark-mode screenshot at all. A second image is
saved under three names: `06-pass3-button-variants`, `07-pass3-form-inputs-states`,
`12-pass4-form-validation-visual`. It is a New Invoice form with the client dropdown open — no
validation errors, no button gallery, no input states. In `IN-ux-screenshots`,
`13-pass2-search-by-line-item` = `14-pass2-filter-dropdowns` (a search for "Periodical" with the
filters **closed**), and `18-pass3-client-created` = `19-pass3-client-overview`.

**Pass 0 written after Pass 1 — confirmed, but less damaging than it looked.** `IN-ux-1` was
written 94 seconds before `IN-ux-0`. But the Pass 0 screenshots were captured about 8 minutes
*before* the Pass 1 screenshots, so it appears to have looked at the product in the right order
and only written Pass 0 up last. Pass 0 also tags every first-impressions item `[RECALLED]` and
heads the section "First Impressions, **Recovered**", which is honest. Usable, with that in mind.

**Round 4's file names do not match the prompt — true, but the gap is narrower than feared.** The
renumbering absorbed two passes into one rather than dropping them. Forms and money is present
inside `IN-ui-4` §3. Accessibility is present inside `IN-ui-6` §2, with a WCAG audit and a
200%-zoom section, and the zoom screenshot is genuine. What is genuinely missing: **motion and
animation** (the words appear nowhere in round 4), and **the Pass 7 catch-all**. In their place
is an eighth deliverable nobody asked for, `IN-ui-7`, a "what to copy, what to reject" opinion
piece that Prompt 4 forbade twice and that is headed "Design Token Sheet for **Magazine Manager
App**" — the wrong product name. Treat `IN-ui-7` as opinion, not evidence.

### 3.2 Other findings from the review

- **The contrast audit is genuine.** Claude recomputed three of the ten pairs with the WCAG
  relative-luminance formula and got 12.0:1, 2.33:1 and 18.7:1 against their 11.9, 2.37 and 18.4.
  Within about 2%. The table-header contrast failure at roughly 2.3:1 is real.
- **The browser measurements look real** — sidebar 216px, row height 54px, cell padding 8px 16px,
  input 37.33px, button 38.4px, header 64px, and they agree across three files.
- **The code citations are not checkable.** Nearly all point at a minified bundle at line 1.
- **`IN-ui-1` does not enumerate what it claims.** It says the theme map runs `$0` to `$25`, lists
  eighteen, and closes with a completeness check of 24 reached by counting six semantic rows as
  tokens. Tokens `$0, $7, $10, $11, $12, $18, $19, $22` are never given.
- **`IN-ui-5` contradicts itself.** It quotes the Plain design's CSS showing `font-family:
  $font_name` — one user-set variable — then gives a table assigning each of eleven designs a
  different font. It also supplied one design screenshot where the prompt asked for eleven, and
  none of the four email templates.
- **Contradictions inside round 4:** status pill radius is `9999px` in `IN-ui-1` and `4px` in
  `IN-ui-3`, both claimed as browser-inspected; the pill colours differ too; body text is 14px in
  one table and 16px in the same file's closing list; the form sub-tab list differs from round 3's.
- **Contradictions inside round 3:** the bulk-delete confirmation is quoted character-for-character
  two different ways (Pass 2 and Pass 7); Pass 5 and Pass 8 quote dollar amounts on an INR
  instance; the settings tab count is 23, 25 and 26 across three sources.
- **Two claims Claude checked against the screenshots and found wrong.** Pass 0 says twice that
  the "New Invoice" button is "bright blue `#117DC0`" and Pass 2 repeats it — the screenshot they
  cite shows it is **black**; the blue button is "Purchase White Label". `IN-ui-3` has it right at
  `#121212`. And Pass 7 test 3 says the form disallows a zero-total invoice, but the invoice list
  screenshot shows five saved Draft invoices at ₹0.00.
- **One claim verified correct:** `IN-ui-2`'s 17 sidebar items, counted in the screenshot.
- **The keyboard shortcut question from the last handoff is still open.** Pass 1 tested only
  `Ctrl+S` (triggers the browser's own dialog) and Pass 9 tested `/` and `Ctrl+K` (neither focuses
  search). The two disputed shortcut sets from Batch 1 and Batch 12 were never enumerated.

**Net: the written content of rounds 3 and 4 is largely sound; the screenshot evidence is not.**
Any claim resting only on `[SEEN ...]` is unverified.

### 3.3 The build phase plan was written

Saved as `Build phase plan - Book Buddha (8 Nov 2026).md`. Written with the superpowers
writing-plans skill, which surfaced the reason it could not be a real implementation plan: that
skill argues from a spec, and there is no spec yet.

- **Section 1, the documentation phase, in full.** Six stages — filter sheet, the four accounting
  questions, restructured design document, App flow, PRD and Features List, spec confirmed — each
  with an output and a definition of done.
- **Section 2, the coding phase, as a skeleton only.** Nine build stages in order, engine first,
  with what correct output looks like at each. Five acceptance conditions that apply to every
  stage, including the one that matters most: a passing technical test is not acceptance, my
  hand-worked figures are.
- **Section 2.0 names four gaps rather than guessing them:** the technology is not decided; who
  builds it is not decided; how it installs and starts on my PC is not decided; what the tests run
  against is not decided.
- **Section 2.4** is the gate: section 2 gets rewritten as a real implementation plan only after
  the spec is confirmed and those four gaps are closed.

### 3.4 The filter sheet was built

Saved as `Filter sheet - Book Buddha (8 Nov 2026).md`. Claude read all thirteen round-2 batches in
full to build it, not the summary.

**260 rows.** Take 100 · Adapt 72 · Skip 52 · Conflict 20 · Ours 9 · 7 parked without a verdict.
Evidence: Strong 247 · Weak 10 · Unverified 3. Counts recounted from the table itself after Claude
caught itself writing an estimated figure into the header.

Thirteen areas, then three closing sections: the conflicts in full, the parked rows, and the new
questions.

**The headline: 19 of the 20 conflicts are confirmations, not decisions.** Invoice Ninja does the
opposite of what I settled, and in each case my rule is the better one — cancel returning stock,
never reusing a number, keeping the prior version of an edited invoice, blocking short stock,
per-item stock tracking, logging settings changes, custom fields without a cap, real `.xlsx`
import, attachments in the backup, a challan that is a real document.

**Two of those are worth a second look even though my rule stands:**

- **The annual counter reset fires on 1 January** in their engine. Mine is `INV-001/26-27`, an
  Indian financial year. Copying their engine as-is would be a silent bug every April.
- **Editing a finalised invoice with the old version kept** is my rule and the right one. It is
  also the single most expensive thing to build in the invoice area, because theirs keeps nothing.

**Only one conflict is a genuinely open question:** whether unapplied overpayment money and
credit-note money sit in one pool or two. See section 9, question 1.

---

## 4. Files on disk

In `C:\Users\Admin\Desktop\Book Buddha\`:

- **`Filter sheet - Book Buddha (8 Nov 2026).md`** — new, 260 rows. The bridge from the inspection
  to the design document.
- **`Build phase plan - Book Buddha (8 Nov 2026).md`** — new. Process plan, documentation phase in
  full, coding phase as a skeleton.
- **`Inspection summary - what we have and how to use it.md`** — the round 1 and 2 briefing. Still
  accurate; its "rounds 3 and 4 written, not yet run" line is now out of date.
- This handoff, plus the handoffs of 7 Nov sessions 2 and 3 and 8 Nov session 1.
- The four prompt files, plus `Prompt output.MD` (round 1).
- Stray duplicates of batches 1, 2 and 3 at the top level. The subfolder copies are the ones to use.

In `invoice-ninja-reports\`:
- `IN-batch-0` to `IN-batch-12` (13 files, round 2, reviewed).
- `IN-ux-0` to `IN-ux-9` (10 files, round 3, **now reviewed**).
- `IN-ui-1` to `IN-ui-7` (7 files, round 4, **now reviewed**).
- `IN-ux-screenshots\` (39 files, 4 of them duplicates of 2 images).
- `IN-ui-screenshots\` (16 files, 7 of them duplicates of 2 images).

---

## 5. Known errors across all four rounds (settled; carry forward)

1. **Stock column name.** Batch 1 says `products.quantity`. Batch 0 and Batch 5 say
   `in_stock_quantity`. **Batch 5 is right**; `quantity` is the default line quantity.
2. **Does cancel restore stock?** Batch 1 says yes once. Batch 2, Batch 5 and Batch 0's live test
   all say no. **Batch 1 is wrong.**
3. **Activity-log type numbers.** Batch 11 tested it live: **created is 4, updated is 5, mark-sent
   is 53.** Batch 1's numbers are wrong.
4. **Batch 9's P&L expense figures are corrupt** — roughly 4.6 quintillion rupees, unflagged. That
   run's expense numbers are meaningless. Its revenue figures and the accrual-versus-cash finding
   still stand.
5. **Keyboard shortcuts** remain unresolved after round 3. Round 5 item 8.
6. **Batches 5 and 6 claimed "Could not verify: none"**, and **Batch 8 added an "Architectural
   Insights" section the prompt forbade**. Standard drift late in round 2.
7. **New: the "New Invoice" button colour.** Pass 0 and Pass 2 call it bright blue `#117DC0`. It is
   black `#121212`, as `IN-ui-3` says. Verified against the screenshot they cite.
8. **New: zero-total invoices.** Pass 7 says they are blocked. The invoice list shows five.
9. **New: `IN-ui-7` is an opinion piece for a differently named app.** Not evidence.

---

## 6. The round 5 request — ready to paste, not yet sent

> **Invoice Ninja, round 5: corrections and gaps.**
>
> Rounds 3 and 4 have been reviewed. Several things failed verification. Same evidence rules as
> Prompt 4: every claim carries exactly one label, values not adjectives, colours in hex, no
> summarising, and each list ends with *"Completeness check: N items, enumerated by \<method\>"*.
> Split across as many messages as it takes. Do not re-send anything already delivered and not
> listed below.
>
> **1. Screenshots that are duplicates.** Seven of the sixteen files in `IN-ui-screenshots/` are in
> fact two images saved under different names, confirmed by MD5. `01-pass1-light-mode.png`,
> `02-pass1-dark-mode.png`, `03-pass2-shell-desktop.png` and `08-pass3-status-pills.png` are one
> identical file; `06-pass3-button-variants.png`, `07-pass3-form-inputs-states.png` and
> `12-pass4-form-validation-visual.png` are another. In `IN-ux-screenshots/`,
> `13-pass2-search-by-line-item.png` = `14-pass2-filter-dropdowns.png`, and
> `18-pass3-client-created.png` = `19-pass3-client-overview.png`. Retake each as a genuinely
> distinct capture: a real dark-mode screen with `.dark` applied, the filter dropdown actually
> open, a button gallery, input focus/hover/disabled/error states, a form showing validation
> errors, and the client overview with non-zero balances. If a state cannot be produced, say so and
> say what you tried rather than reusing another image.
>
> **2. A locked invoice.** Prompt 4 Pass 4 asked for a screenshot of a locked invoice and there is
> none. Set `lock_invoices`, open a locked invoice, screenshot it, and give the exact computed
> styling of a locked field.
>
> **3. The eleven invoice designs.** `IN-ui-5` lists eleven designs with a different font for each,
> while quoting the Plain design's own CSS showing `font-family: $font_name` — a single user-set
> variable. Those cannot both be true. Paste the actual output of `SELECT id, name FROM designs`,
> then render **the same invoice in every one of the eleven designs** and attach one screenshot
> each. State plainly whether font is per-design or a single global setting.
>
> **4. The four email templates.** Prompt 4 asked for a screenshot of each of `plain`, `light`,
> `dark` and `custom`. None were supplied. Supply them.
>
> **5. The motion pass, which is missing entirely.** The words "motion" and "animation" appear
> nowhere in round 4. Give what moves, its duration in ms and its easing, for the right-hand
> drawer, modals, toasts, tab changes and row transitions. If there is essentially no motion, say
> so explicitly.
>
> **6. The theme tokens you skipped.** `IN-ui-1` says the theme map runs `$0` to `$25`, then lists
> eighteen and closes with a completeness check of 24 that counts six semantic rows as tokens. Give
> `$0, $7, $10, $11, $12, $18, $19, $22` with light and dark values and usage.
>
> **7. A contradiction to settle, with inspector output pasted.** Status pill radius: `IN-ui-1`
> says `border-radius: 9999px` citing `[INSPECT span.rounded-full]`; `IN-ui-3` says `4px` citing
> `[INSPECT span.rounded]`. Status pill colours: `IN-ui-1` gives Draft `#4B5563` on `#F3F4F6` and
> Paid `#047857` on `#ECFDF5`; `IN-ui-3` gives Draft `#A1A1AA` and Paid `#22C55E` at 15% opacity.
> Settle both and paste the computed styles.
>
> **8. Keyboard shortcuts, settled by pressing the keys.** Batch 1 and Batch 12 gave two different
> and unevidenced shortcut sets, and Prompt 3 Pass 1 was supposed to resolve this. It only tested
> `Ctrl+S`, `Ctrl+K` and `/`. Enumerate every keyboard shortcut the running app actually responds
> to, each with the key pressed and the observed result.
>
> **9. Bulk-delete wording.** Pass 2 quotes `"Are you sure you want to delete these records?"` and
> Pass 7 quotes `"Are you sure you want to delete the selected items?"`, both as
> character-for-character quotes. Give the actual string and where it comes from.
>
> **10. Zero-total invoices.** Pass 7 test 3 states the form disallows committing a zero-total
> invoice, but the invoice list contains five saved Draft invoices with Amount `₹ 0.00`. Re-test
> and correct.
>
> **11. The Pass 7 catch-all that was never delivered.** Prompt 4's Pass 7 asked for every visual
> pattern, component, style decision or front-end behaviour that none of the passes asked about,
> explicitly including the ones that seem too minor. `IN-ui-7` was a "what to copy, what to reject"
> opinion piece instead, which Prompt 4 forbade twice. Deliver the catch-all.
>
> **12. Batch 10 part 2.** The settings enumeration, to the original rule: every setting in every
> one of the 26 tabs, with its options and its default, listed individually. You claimed 268
> properties in `CompanySettings` and listed roughly 90. Enumerate all 268, grouped by the tab they
> appear in, and name any that exist in the data mapper but appear in no tab.

Two notes for me, not for it. Item 12 is the largest and will take longest, so send the whole
message at once. And nothing in this list blocks the design document — the affected rows in the
filter sheet are already marked Unverified and parked in its section 15.

---

## 7. Confirmed decisions (carried forward, still current)

### 7.1 Direction and build

- The app is a **general accounting app**. It starts blank with no built-in business types. The
  user creates Business 1, Business 2 and so on, and names them. The user sets fields, document
  layouts, numbering, chart of accounts and tags.
- I call it an accounting "SaaS" and refer to it as **"Book Buddha"**. "SaaS" is only my word. The
  confirmed build is a **local web app on one PC**: one program, one database file, screens in a
  browser, mostly one user, offline use preferred. Write "local web app on one PC" in the design
  documents.
- Invoice Ninja is a **reference only** for screens, fields and ideas.
- Book Fair is a tag (class, location or project-like) attached to any entry in any business.
  Reports can be viewed fair by fair.
- No hardcoded special rules. The school incentive and the subscription year-end settlement are not
  built in; the user enters them as ordinary expenses and stock adjustments.
- Debit and credit are filled in automatically. The user never enters them. Books must always
  balance.
- Users are non-accountants. Ease of use is the main goal. English only, currency INR, a financial
  year setting.
- A company holds one or more businesses. One database file per company, every entry tagged with
  its business. One company per install in v1. One shared chart of accounts per company. One backup
  covers the whole company.
- Phase 1: Admin only, and Admin is the only full-access role. Only Admin can delete records.
  Phase 2 (design later): invoicing-only users on other devices on the same network; they can never
  delete an invoice, only cancel it.
- Every action is logged in a read-only audit log.
- A fair is linked to a host customer. Each fair invoice belongs to one fair. Fair buyers pay
  instantly by UPI or Cash. Buyer details: name and one contact (email or WhatsApp number),
  optional, stored on that invoice only.

### 7.2 Decided 5 Nov

- Optional due date, filled in automatically as 30 days from the invoice date; the user can change
  or clear it. A space for terms or notes on every invoice, quotation and similar document.
- Stock reduces only when an invoice is finalised, and a draft shows its quantity as blocked.
  **Refined by the 7 Nov stock setting below.**
- If an invoice asks for more than the available stock, the app **blocks** it, with a quick
  "Add stock" step.
- Cancelling an invoice reverses the sale and the stock comes back automatically.
- Stock valuation: **FIFO only**.
- Invoice numbers include the financial year and restart at 001 each year (for example
  `INV-001/26-27`). Each business has its own sequence and its own prefix, set by the user.
- Cancelled invoice numbers are never reused; the cancelled invoice stays visible, marked Cancelled.
- Invoice totals are **not rounded**; exact paise are kept.
- Amount grouping (Indian `10,00,000.00` or international `1,000,000.00`) is chosen in Settings.
- Each item has a unit from a list the user maintains.

### 7.3 Decided 6 Nov

- **Customers:** duplicate names warned but allowed. Up to 2 contacts by default, more can be
  added. Separate Billing and Shipping addresses with a copy button. App-given customer number with
  a user-defined prefix (for example SCH-0001). Files can be attached to a customer (PDF, JPG/PNG,
  Word, Excel, CSV, up to 20 MB each). Customer statements: yes.
- **Payments:** an editable list of methods, starting with Cash, Bank Transfer, UPI, Cheque, Other.
  One payment can be split across several invoices of the same customer. Overpayment is kept as
  customer credit, which the user can adjust. Refunds, sales returns and bad-debt write-off are all
  in v1.
- **Documents:** credit notes (separate document with proper accounting effects and a note),
  quotations (convertible to an invoice), recurring invoices, and challans (delivery notes,
  available in any business): all yes.
- **Invoices:** editing a finalised invoice is allowed with the old version kept in history. The
  next number appears when a new invoice screen is opened and is used up when the invoice is saved,
  even as a draft (a deleted draft leaves a gap). Quotations and payments each have their own
  number sequence per financial year. Financial year lock: yes (once finalised, only Admin can
  correct entries). Autosave of drafts: yes. Extra charges, lump-sum discount, price history by
  date, PO number with a reuse warning, internal staff-only notes: all yes. Bulk actions on the
  invoice list: yes, plus Excel export of the list; delete stays Admin-only; bulk "Mark paid" asks
  once for date and method.
- **Tax:** optional, the Invoice Ninja way adapted for India: the user creates tax names and rates,
  applies them per item line, chooses inclusive or exclusive, with a tax-exempt option and an
  optional GSTIN on customers. This replaces "no tax fields for now".
- **Reminders:** the full reminder functionality Invoice Ninja offers, with the A/R aging report.
  Email sending is optional (needs internet and an email account in Settings).
- **Import:** both real Excel (.xlsx) and CSV. **Opening balances:** Excel import plus a simple
  screen to type them, and the user can create an account with its opening balance.
- **Backup:** the user chooses what to include (everything, or database only).

### 7.4 Decided 7 Nov

**Login**
- Google sign-in only at first-time setup and password recovery; daily login uses a password set in
  the app (works offline).
- Password: at least 8 characters, with letters and numbers.
- Lock for 15 minutes after 5 wrong tries.
- Forgotten password: sign in with the same Google account, then set a new password (needs
  internet).
- Automatic sign-out fixed at 1 hour of no use, with a 1-minute warning and a "Stay signed in"
  button. Autosaved drafts stay saved.
- Step 1 of the first-time setup flow still needs updating for this when we write the App flow.

**Small design details**
- Customer classification: a fixed, optional dropdown: Individual, Business, Company, Partnership,
  Trust, Charity, Government, Other.
- Leaving an unfinalised autosaved draft shows a warning every time: the draft is saved, its number
  is used, and you can continue from the Drafts list.
- Bulk email of invoices: in v1, optional, needs internet and an email account in Settings.

**Items and stock**
- Each item has a "Track stock: Yes/No" setting. Books: Yes. Magazines: No. It is on the item's own
  page and also when creating an item. The user can change it later.
- Switching an item to No is blocked while it still has stock; reduce stock to 0 first with a stock
  adjustment.
- **Who reduces stock is a user choice.** One setting per business (Settings, Stock): either
  "Challan reduces stock when issued" (a draft challan does not) or "Invoice reduces stock when
  finalised". A linked challan and invoice never reduce stock twice.

**Unearned revenue (magazine subscriptions)**
- The accounting effect (explanation only, not an app rule): an invoice issued at the start of the
  subscription period and paid in advance sits as unearned revenue on the liability side; revenue
  is released as deliveries happen.
- In the app the user manages this himself: he creates his own accounts including a liability
  account for unearned revenue; items can be linked to the account they post to; a simple entry
  screen moves amounts between accounts; and an optional repeat template (amount, start and end
  dates, like QBO's recurring journal entry) posts on its own schedule once he creates one. Nothing
  is automatic until he does.

### 7.5 Transactions, features and reports

- Invoices, bills, payments received, bill payments, day-to-day expenses, stock purchases and
  adjustments. Basic inventory.
- Custom fields (user-named, no limit), notes, customer details. Export to Excel, CSV and PDF.
- Reports in v1: Profit and Loss, Balance Sheet, A/R and A/P aging, Inventory Valuation Summary,
  Sales by item, General Ledger and Trial Balance, Cash Flow Statement. Each viewable per business,
  combined, and fair by fair.

### 7.6 How the magazine business works (my explanation, 6 Nov)

- The vendor issues a quote first, converted to an invoice when accepted. For subscription
  customers the invoice is for the full year.
- Magazines and journals are received from the supplier as each issue arrives and handed to the
  customer as they arrive. Nothing is held in stock.
- Details are in the project file `PRD_Magazine_Subscription_Management_v4` (v4.2, 30 Sep 2026):
  four billing models (Subscription prepaid, Credit, Retail, Order-based), two users, one PC.
  Verified earlier: one invoice for the period, a challan for each supply, and a settlement
  statement at period end; challans apply only to subscription customers; credit customers are
  invoiced weekly or monthly after supply; the words "stock" and "inventory" do not appear in it.

---

## 8. The four magazine accounting questions (unchanged, still pending)

1. **Cost of the books sold (items with Track stock: Yes). Waiting since 7 Nov.**
   - A. Book the cost at the same moment the stock leaves, so it follows the Settings, Stock
     choice: at the challan with the challan way, at invoice finalisation with the invoice way.
     (Claude's opinion, no source searched for it.)
   - B. Always book it when the invoice is finalised, as decided on 5 Nov. With the challan way,
     stock would leave at the challan and the cost would be booked later.
2. **Cost of magazines (no stock):** booked when the supplier's bill arrives, or when the magazine
   is delivered to the customer? The PRD (section 4.10) takes cost as quantity delivered times
   purchase cost.
3. **Credit customers:** the PRD bills them weekly or monthly based on what was supplied, so the
   amounts change each cycle. How should that cycle invoice be built, and how does it relate to the
   recurring invoices feature? (Partly informed: Invoice Ninja's recurring engine has an interlock
   that skips generation when an earlier child invoice is still unpaid — Batch 6.)
4. **Linking a challan and an invoice:** can one invoice be created from one or several challans,
   and what happens when only part of a challan is invoiced? (The no-double-counting rule is
   already decided; this is about how the link works.)

**Questions 1 and 4 block App flow sections 4, 5 and 11.**

---

## 9. New questions the filter sheet surfaced (none asked yet)

These are in section 16 of the filter sheet, plus the one real conflict. Claude suggested putting
the first four as a set of 5 with the credit-pool question first.

1. **One credit pool or two?** Invoice Ninja keeps unapplied overpayment money in
   `payment_balance` and credit-note money in `credit_balance`, and they never mix. My 6 Nov
   decision says "overpayment is kept as customer credit, which the user can adjust", which does
   not settle it. Two pools is more correct in accounting terms; one pool is simpler for a
   non-accountant.
2. **Customer merge.** I allow duplicate names, so duplicates will happen. Do we build a merge
   tool, and what happens to the history of the merged-away customer? Theirs re-parents 15 child
   tables, reconciles duplicate contacts, recalculates balances and writes a ledger note.
3. **Cash or accrual P&L.** Theirs toggles between the two with a flag, defaulting to accrual.
   Should ours?
4. **A generic report builder** — pick an entity, pick columns, group, export — instead of, or
   alongside, the eight fixed reports. Theirs covers 20 entities and 200+ columns and would give
   far more reporting for not much more work.
5. **Payment immutability.** Should the amount and the customer be frozen once a payment is saved,
   with only date, allocation, method and reference editable? That is their rule.
6. **Partial / deposit on an invoice**, with its own due date. Relevant to magazine prepayments.
7. **Archive as a third state** between active and cancelled.
8. **Line-item date tokens** (`:MONTH`, `:QUARTER`, `:YEAR`) that write themselves into the line
   text — a strong fit for subscription lines.
9. **Tamper-evident audit log** — each entry carrying a hash of the previous one, as Spain's
   Veri*factu does.
10. **Low-stock threshold and alert**, per item with a business-level fallback. Useful before a
    fair.
11. **The annual counter reset must follow the financial year**, not 1 January. Confirm.

---

## 10. Other open items (not mine to settle alone)

- Ask my CA how revenue and cost apply to me as a reseller of magazines (full sale, or only my
  margin). The sources found describe a publisher selling its own magazine.
- Buyers' personal data: Claude cannot confirm which rules apply. India's DPDP Rules 2025 start in
  stages and sources differ on the date (13 or 14 May 2027). Check with a lawyer before giving the
  app to others.
- Ask a lawyer before giving away or selling the app.
- GST: my magazine PRD records "GST: Exempt" as my stated scope. Claude cannot confirm my GST
  position.

---

## 11. App flow document (still not created)

**Format (approved):** numbered steps, a simple diagram for each flow, and what happens on every
tap. Each section written one at a time and approved by me before the next is started.

**Section list**

1. First-time setup (approved 1 Nov; step 1 needs updating for the login decision)
2. Daily login (settled: password, 15-minute lock, 1-hour sign-out with warning)
3. Home screen (draft awaiting approval)
4. Normal invoice, outside a fair (draft awaiting approval; needs: number shown on open and used on
   save, autosave and exit warning every time, 30-day due date, terms and notes, internal notes,
   extra charges, lump-sum discount, price by date, PO number, optional tax, stock rules and the
   per-business stock setting, bulk actions)
5. Everyday books: customers, items (with Track stock), bills, payments, expenses, stock (also:
   quotations, credit notes, challans, recurring invoices, refunds, returns, bad-debt write-off,
   customer statements, reminders, the entry screen for moving amounts between accounts, repeat
   templates)
6. Import from Excel
7. Reports
8. Backup and restore
9. Create a fair
10. Invoice at a fair
11. Cancel an invoice (stock comes back automatically)
12. End of fair (the incentive is entered by the user)

All existing drafts were written before the generic-core direction and need rechecking against the
filter sheet.

**Documents still to restructure** (all outdated for the generic-core direction):

- Design document, Draft 1 (approved 1 Nov): https://claude.ai/artifact/GMKkJ1j4ChRB3igrAbj9yH
- PRD v0.1: https://claude.ai/artifact/JAYjDq7GtqA7yuSMTThjin
- Features List v0.1: https://claude.ai/artifact/Ds8fKdPmsVpt2Rg8gQ5osU

---

## 12. Next steps

1. Send the round 5 request (section 6). Nothing downstream waits on it.
2. Answer the four magazine accounting questions (section 8), in sets of 5 with lettered options.
3. Answer the eleven new questions (section 9), same format.
4. Restructure the design document for the generic core and every decision, working from the filter
   sheet.
5. Write the App flow sections one at a time, each approved by me.
6. Update the PRD and Features List.
7. I confirm the spec. **Only then** write the implementation plan.
8. Only after I confirm the plan, build anything.
