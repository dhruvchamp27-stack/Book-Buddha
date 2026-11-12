# Invoice Ninja, round 3: the UX and daily-use pass

You have mapped this product's fields, tables and side effects. That is the engineer's
view and it is now largely done. This round asks a different question, and reading code
will not answer it:

**What is it actually like to use this thing, every day, for hours?**

I am designing my own accounting app for a non-accountant who will live in it daily. I need
to know where Invoice Ninja is pleasant, where it is clumsy, and exactly what it says to the
user. Read Part 0 to Part 2 fully before you start.

---

## Part 0 - How this round differs from round 2

1. **Do not read code for this.** Code tells me what is stored. It does not tell me that a
   field is three scrolls below where it is needed, or that an error message is useless.
   Open the product, use it, and report what you experienced. Code is allowed only to answer
   a direct "why did it do that?" and must be labelled as such.
2. **Screenshots are the evidence now.** Not paths. See Part 1.
3. **Exact wording matters more than anything else in this round.** Every label, button,
   placeholder, help text, tooltip, error, warning, confirmation and empty-state line is to be
   quoted **character for character**, including capitalisation and punctuation. Do not
   paraphrase a single one. If a label is ambiguous or oddly worded, quote it and say so.
4. **Counts and timings matter.** "It takes a few clicks" is not an answer. Count them.
5. **You now know this product well, and that is a loss.** A daily-use pass is sharpest when
   the product is unfamiliar, and your first-impression view is already spent. Part 3, Pass 0
   recovers what can be recovered. Everywhere else, deliberately ask yourself: would a person
   who has never seen this screen know what to do? Answer that question, not "can I do this".

None of this is a complaint about round 2. It did its job. This is a different job.

---

## Part 1 - Hard rules

**Evidence.** Every claim carries exactly one label:

- `[SEEN route | screenshot-filename.png]` - you opened it and looked at it. Save the
  screenshot, name it after the screen, and give me the filename. One screenshot per screen
  minimum; more for anything you describe as cramped, confusing or hidden.
- `[QUOTED]` - exact on-screen text, character for character, in quotation marks.
- `[MEASURED]` - a count or a timing you actually performed: clicks, keystrokes, seconds,
  scroll depth, number of fields visible without scrolling.
- `[CODE path:Lstart-Lend]` - allowed only to explain a behaviour you observed and could not
  otherwise account for. Never as the primary evidence for a UX claim.
- `[INFERRED]` - your reasoning, labelled as yours.
- `[RECALLED]` - something you remember from an earlier round but did not re-observe now. Weak
  evidence. Allowed in Pass 0 only, and flagged there as weak.

**No guessing.** "not found" with your search path is a good answer. A confident wrong answer
costs me more than a blank.

**No softening.** Where the product is annoying, say so plainly and say what the annoyance
costs in clicks, keystrokes or re-reading. I am looking for the things a daily user would
resent, and politeness hides exactly those.

**No praise without a reason.** "Clean interface" tells me nothing. "The client picker filters
after 2 characters and the first match is pre-selected, so a client takes 3 keystrokes and
Enter" tells me everything.

**Measure before you describe.** Standard browser window, 1366x768, default zoom, stated at
the top of every pass. If you deviate, say so.

**One pass per run.** Deliver one pass, then stop and wait for me to say "next". Do not
compress two passes into one message. If a pass is too long, split it and say "part 1 of N".

**Output.** Write each pass to its own file, `IN-ux-<number>-<name>.md`, and give me the path.
Save screenshots in a `IN-ux-screenshots/` folder beside it. Paste the text of the pass into
the message too.

---

## Part 2 - The two questions behind every pass

Every screen you report on must answer these two, explicitly, in its own words:

1. **Could a person who has never seen this screen complete the task without help?** If no,
   name the exact step where they would stop.
2. **Would a person doing this task thirty times a day resent anything here?** If yes, name it
   and count what it costs.

A pass that describes a screen accurately but does not answer these two has not done its job.

---

## Part 3 - The passes

### Pass 0 - First impressions, recovered

Before anything else, write down what you remember being confusing, surprising or hard to find
when you first opened this product, before you learned it. Label everything here `[RECALLED]`.
I know this is weak evidence. It is the only chance to recover it, so do it now and do not
dress it up as more than it is.

Then, to replace what memory cannot give: log out, clear the browser, and open the product as a
stranger would. Report what the very first screen after login offers, what it assumes you
already know, and what you would have to go hunting for. Count the clicks from first login to a
finished invoice **without using any knowledge you have of this product** - follow only what
the screens tell you. If you cannot genuinely do that, say so rather than pretending.

### Pass 1 - Creating an invoice, as a daily user

The single most important pass. This is the screen my user lives in.

Create five real invoices, varying: one line, many lines, a new client, a new product typed
inline, a line with a discount and a tax.

Report:

- **Layout.** What sits where. Draw it as a simple text sketch. How many fields are visible
  before any scrolling, and what is below the fold. Where the total appears and whether it is
  visible while you type line items. Where the save button is and whether it stays visible as
  the form grows.
- **The typing experience, field by field, in tab order.** What has focus when the screen
  opens. What the tab order actually is, including whether tab moves across the line-item grid
  or jumps out of it. What autocompletes, after how many characters, and whether the first
  match is pre-selected. What reformats itself after you leave it (dates, amounts). What does
  not accept a paste.
- **Keyboard only.** Attempt the whole invoice with no mouse at all. Report exactly where you
  are forced to reach for it.
- **The counts.** Clicks and keystrokes for the simplest possible one-line invoice to a
  pre-existing client, counted. Then the same for a five-line invoice. Then seconds, timed.
- **Line items.** Adding a row, deleting a row, reordering a row. Whether a new blank row
  appears on its own. What a half-filled row does on save.
- **Inline creation.** Creating a client and creating a product from inside the invoice: what
  the modal asks for, whether it loses your invoice, whether it returns you to the right place.
- **Every piece of text on the screen**, quoted: labels, placeholders, the hint text, the
  buttons, the status badge, the drawer. Include the ones you think are obvious.
- **What happens on save.** What moves, what flashes, what message appears, where you land, how
  you get back to a blank new invoice.

### Pass 2 - Finding things: the invoice list

Round 2 gave me the 44 columns. This pass is about whether the screen is usable.

- The list as it arrives before any customisation: is it informative or does it need work first?
- Finding one invoice: by number, by client, by amount, by a word in a line item. Count the
  clicks for each and report what the search does not find.
- Scanning for what is overdue or unpaid without reading every row: is status obvious at a
  glance, by colour, by shape, by position? Describe what a colour-blind user would see.
- The filters: how discoverable, how many clicks to apply, whether they survive a page refresh,
  whether they survive leaving and coming back.
- Changing columns: how many clicks, whether it is obvious that it is possible at all.
- Selecting rows and running a bulk action: what confirms, what reports back, what happens to a
  row that the action could not be applied to.
- Row density, pagination, and what it is like to work through 200 invoices.
- Every piece of text, quoted, including the empty state before any invoice exists.

### Pass 3 - Clients and items

For each of the client screens and the product/item screens:

- Creating one from scratch: fields in tab order, which are genuinely required, how the screen
  is divided, what is hidden behind a tab or an accordion.
- How long the form is, and how much of it a user must read to understand what is optional.
- Finding an existing one, and editing it.
- The record overview: what it tells you at a glance about a customer's standing, and what you
  have to click to learn.
- Every piece of text, quoted, including the empty states.

### Pass 4 - Taking money

- Recording a payment: every route into it, and the fastest one, counted.
- Allocating one payment across several invoices: what the screen looks like, what it does
  arithmetically as you type, what it refuses.
- An overpayment, a partial payment, and a refund: what the user sees at each step, what
  warning or confirmation appears, and what is quoted on screen afterwards.
- Whether a user can tell, from the screens alone, where an overpayment went.
- Every piece of text, quoted.

### Pass 5 - The other documents

Quote, credit note, recurring invoice, purchase order, delivery note.

For each: what differs from the invoice screen in **feel**, not in fields. Then, for the whole
set: is it obvious which document you are looking at once you are inside it? Is it obvious how
to get from one to another? Converting a quote to an invoice: what the user sees before, during
and after, and whether anything tells them what just happened to the quote.

### Pass 6 - Reports, exports and settings findability

Reports and exports:

- Running a report from a cold start: how you discover which report you want, counted.
- Reading the result on screen: is it legible, or is it a grid you must export to use?
- Changing a date range or a filter: counted, and whether the setting survives.
- Exporting: how many clicks, what formats are offered at the point of use, what the file is
  named, and whether the screen says the export has started or finished.

Settings:

- Do **not** inventory the settings; round 2 has that. Instead: pick these and time how long it
  takes to find each, starting from the dashboard, with no prior knowledge used:
  the invoice number format, the invoice lock setting, the default payment terms, adding a
  custom field, the tax rate list, the email reminder schedule, the date format.
- Report, per item, the clicks and the seconds, and whether you had to use the settings search.
- Then say plainly which settings are in a place a user would never think to look.

### Pass 7 - Mistakes, warnings and rescue

The pass I care about most after Pass 1, because my user is not an accountant and will make
mistakes.

- Deliberately do each of these wrong and report, quoted exactly, what the product says:
  save an invoice with no client; no line items; a zero quantity; a letter in an amount field;
  an impossible date; a due date before the invoice date; a duplicate invoice number; a
  duplicate client name.
- For each: is the message in plain language, does it name the field, does it appear next to the
  field or somewhere else on the screen, and does it survive scrolling.
- Does anything prevent a mistake rather than reporting it afterwards?
- Every destructive action: what confirms it, what the confirmation says, whether the
  confirmation tells the user what will happen or merely asks "are you sure", and whether there
  is any undo afterwards. Cancel, reverse, archive, delete, and bulk delete.
- Navigating away mid-entry: what appears, what is kept, what is lost.
- Closing the tab mid-entry: the same.
- Losing the network mid-save: what the user sees, and whether they can tell whether it saved.

### Pass 8 - Narrow screens and phones

- Open the invoice screen, the invoice list and the payment screen at phone width. Screenshot
  each.
- What collapses, what becomes unreachable, what turns into horizontal scrolling.
- Could a person create an invoice on a phone? Count the taps and say where it breaks.
- Is any of it touch-usable, or is it a desktop app squeezed down?

### Pass 9 - The annoyance ledger, and everything left over

Two lists to close the round.

**First, the annoyance ledger.** Every single thing in this product that a daily user would
resent. Rank them by how much they cost, worst first. For each: what it is, where it is, what
it costs per occurrence in clicks, keystrokes or seconds, and roughly how often a daily user
would hit it. Do not filter by how small it seems; a two-click annoyance hit forty times a day
matters more than a ten-click one hit monthly. Aim for at least twenty entries. If you cannot
find twenty, say what you did instead of padding.

**Then the good-ideas list.** Every small kindness this product does that I would not have
thought of: a default that saves a step, a shortcut, a thing that is remembered for you, an
inline action that avoids a page change. Same rule: do not filter by size.

---

## Part 4 - Template for every screen

```
### Screen: <name exactly as the app labels it>
- Reached by: <clicks from the dashboard, counted>
- Screenshot: <filename>
- Layout sketch: <plain text sketch of what sits where>
- Visible without scrolling: <N fields / which sections>
- Below the fold: <what>
- Tab order: <field by field, as observed>
- Focus on open: <which field, or none>
- Autocomplete and auto-format: <what, after how many characters>
- Keyboard-only: <possible / breaks at X>
- Clicks and keystrokes for the routine task: <counted>
- Seconds for the routine task: <timed>
- Every piece of on-screen text, quoted:
  - Labels: "..."
  - Placeholders: "..."
  - Buttons: "..."
  - Help and hint text: "..."
  - Errors seen: "..."
  - Empty state: "..."
- Could a first-timer finish here? <yes / no, and the exact step they would stop at>
- Would a thirty-times-a-day user resent anything? <what, and what it costs>
- Evidence:
```

---

## Part 5 - End of every pass

Close each pass with four lists:

1. **Seen and screenshotted** - screens, with filenames.
2. **Measured** - every count and timing, collected in one place.
3. **Quoted** - any wording you captured that did not fit naturally into the body.
4. **Could not verify** - what, and what you tried.

Add no opinions about what I should build, and do not suggest features for my app. Describe
this product as a daily user experiences it, completely and quotably. The judgement is mine.
