# Invoice Ninja, round 4: the visual and front-end layer

Round 2 mapped the data and the side effects. Round 3 maps how the product feels to use.
This round maps the third thing neither of those touches: **what it is made of visually, and
how it is built.**

I am designing my own accounting app and will have an AI build its front end. To brief that
work properly I need the actual numbers behind the screens - the exact colours, the type
sizes, the spacing, the component states, the breakpoints - not an impression of them. Read
Part 0 to Part 2 fully before you start.

---

## Part 0 - What this round is, and what it is not

**It is:** colour values, font families and sizes, spacing, border radii, shadows, the layout
grid, the navigation structure, every reusable component and every state it can be in, the icon
set, the printable document templates, the theming mechanism, and the front-end stack as it
actually is.

**It is not:** how the product feels to use (round 3), what the fields mean (round 2), or your
opinion of the design. Do not tell me whether it looks good, and do not tell me what my app
should look like. Describe what is there, exactly.

**On method:** this round is the one place where reading the built front-end files is the right
approach, not a shortcut. Measure from the stylesheets, the compiled bundles and the template
files, and confirm against the running screens with a screenshot and a browser inspector. Where
the two disagree, give both and say which you trust.

**One warning from round 2.** Batch 10 claimed "268 configurable properties" and then listed
sample fields per tab instead of enumerating them. Do not do that here. A count without the
list is not an answer in this round, and colour and size claims without values are worthless to
me.

---

## Part 1 - Hard rules

**Evidence.** Every claim carries exactly one label:

- `[CSS path:Lstart-Lend]` plus the quoted declaration, for anything taken from a stylesheet,
  a Tailwind config, a theme file or a compiled bundle. Repository-relative paths.
- `[INSPECT route | selector]` plus the computed value you read in the browser inspector, for
  anything measured on a live screen.
- `[SEEN route | screenshot-filename.png]` for what a screen looks like.
- `[TEMPLATE path]` for the PDF and email document templates.
- `[INFERRED]` for your reasoning, labelled as yours. Never for a value.

**Values, not adjectives.** Never "a light grey border". Always `#E5E7EB, 1px solid`. Never
"rounded corners". Always `border-radius: 6px`. Never "a large heading". Always
`font-size: 20px; font-weight: 600; line-height: 28px`. A description without a number is not
an answer.

**Colours in hex, always**, converted if the source uses `rgb()`, `hsl()` or an OKLCH value,
with the original form given alongside.

**No summarising.** If there are 32 greys in the palette, list 32. If a button has 7 states,
list 7.

**Completeness check.** End every list with: *"Completeness check: N items, enumerated by
<method>"*.

**One pass per run.** Deliver one pass, then stop and wait for me to say "next".

**Output.** Write each pass to its own file, `IN-ui-<number>-<name>.md`, and give me the path.
Screenshots go in `IN-ui-screenshots/`. Paste the text of the pass into the message too.

---

## Part 2 - The stack question, answered first

Before any pass, settle this in a short preamble, with evidence:

1. What the front end is actually built with, as shipped. Round 2's Batch 0 found a Flutter Web
   SPA as the default, a React SPA also compiled, and Blade templates serving only public
   flows. Confirm which one a self-hosted admin sees by default, and **which one you are
   measuring in this round.** Everything that follows depends on that answer.
2. Whether the styling is Tailwind, plain CSS, CSS-in-JS, a component library (and which), or
   Flutter widget theming - and where the source of truth for the theme lives.
3. Whether a design-token file, theme object or variable sheet exists at all, and its path. If
   there is none and the values are scattered, say so plainly - that is an important finding,
   not a failure.
4. Whether the Flutter and React front ends look the same or differ visibly. If they differ,
   say which you are documenting and screenshot one screen in both.

---

## Part 3 - The passes

### Pass 1 - Colour, type and the raw tokens

**Colour.** Every colour the interface uses, as a table: token or variable name if one exists,
hex value, where it is used, and whether it is themeable. Group them: text colours, background
and surface colours, borders and dividers, the primary and accent colours, and the semantic
colours (success, warning, error, info). Then: the two accent colours the user can set in
Settings - what exactly do they repaint, and what do they not touch?

**Dark mode.** Whether it exists, how it is switched, where the dark palette is defined, and
the full dark palette beside the light one. Screenshot one screen in both.

**Typography.** The font families, in order of fallback, and whether the fonts are bundled or
fetched from a CDN (name the CDN - this matters for an offline app). Then the complete type
scale: every distinct size in use, each with its weight, line height, letter spacing and what
it is used for. Include the data table, the form labels, the input text, the buttons, the
headings and the small print.

**Spacing, radii, shadows, borders.** The spacing scale as actual pixel values. Border radii
per component type. Every shadow, as its full CSS value. Border widths and colours. Whether
these come from a scale or are ad hoc - and if ad hoc, say so.

### Pass 2 - Layout, navigation and density

- The page shell: sidebar or top bar, its width, whether it collapses, what is pinned, how the
  content area is bounded, and the maximum content width.
- Every breakpoint, as its pixel value, and what changes at each one.
- The navigation tree as it appears on screen, with the exact labels, in order, including what
  is nested and what is hidden behind a "more".
- Density: the row height of a data table, the padding inside a cell, the gap between form
  fields, the height of an input, the height of a button. Measured, in pixels.
- How a long form is divided: cards, sections, tabs, accordions, or a drawer. Which and where.
- Screenshot the shell, and the same screen at each breakpoint.

### Pass 3 - The component inventory

The heart of this round. For every reusable component in the interface, give: what it is, where
it appears, its variants, its sizes, and **every state it can be in** - default, hover, focus,
focus-visible, active, selected, disabled, read-only, loading, error, and empty where that
applies - each with its actual colour, border and shadow values, and a screenshot of any state
that is not obvious.

Cover at least: buttons (every variant and size), text inputs, number and currency inputs,
date pickers, selects and typeaheads, checkboxes, radios, switches, textareas, the line-item
grid, data tables (including header, sort indicator, selected row, hover row, and the sticky
parts), pagination, tabs, badges and status pills, cards, modals, the right-hand drawer,
tooltips, toasts and inline alerts, the loading skeletons or spinners, the empty states, and
the command palette.

For the status pills specifically: the exact colour of every document status, for invoices,
quotes, credits, payments, purchase orders and expenses. Round 2 gave me the status names; I
want the colours, and whether status is ever shown by colour alone with no text or shape.

### Pass 4 - Forms and data entry, visually

- How a required field is marked, and whether it is marked at all.
- Where a validation error appears relative to its field, in pixels, and its exact styling.
- How a disabled or locked field looks, specifically on a locked invoice.
- How money is rendered in an input while typing versus after blur: the thousands separator,
  the decimal places, the currency symbol and its position, and whether the alignment is right
  or left.
- How dates are rendered in an input and in a table cell.
- The line-item grid in detail: column widths and how they are decided, what happens to a long
  description, whether the row grows, how the drag handle and delete control are presented,
  and what the grid looks like with twenty rows.
- Screenshot a full invoice form, a form with errors, and a locked invoice.

### Pass 5 - Icons, imagery and motion

- The icon set in use, by name, and its source (library, path, or custom). Whether icons are
  SVG, a font, or images.
- Every icon in the main navigation and the row-action menus, listed with the action it
  represents and the exact icon name.
- Icon sizes and colours, per context.
- The logo: where it appears in the interface, its size constraints, and what happens when none
  is uploaded.
- Any animation or transition: what moves, how long it takes (in ms), and its easing. Include
  the drawer, the modals, the toasts, and any row or tab transition. If there is essentially no
  motion, say so.

### Pass 6 - The printable documents

This matters to me as much as the screens, because my users will send these.

- Every bundled invoice design template, by name, with a screenshot of each rendered on the
  same invoice.
- For the default design: the page size, the margins, the fonts and sizes, where the logo sits,
  the address block layout, the exact line-item table columns and their widths, how the totals
  block is arranged, and where notes, terms and the footer land.
- How the user's accent colours affect the PDF.
- Which template language or engine renders these, and where the template files live.
- What the delivery-note rendering changes visually, beside stripping the prices.
- Whether the templates are editable by the user, and if so, in what form and how far.
- The email templates: their visual structure and the four style options Round 2 named
  (`plain`, `light`, `dark`, `custom`), with a screenshot of each.

### Pass 7 - Accessibility and the leftovers

- Contrast: measure the actual ratio of body text on its background, the muted or secondary
  text, the primary button text, and each status pill's text on its fill. Report the numbers
  and say which fail WCAG AA. Do not estimate - measure.
- Focus indicators: whether every interactive element has a visible one, and its exact styling.
- Whether the interface is usable at 200% browser zoom. Screenshot it.
- Whether anything relies on colour alone to convey meaning.
- Form labels: real labels, or placeholders used as labels?
- Then the catch-all: **every visual pattern, component, style decision or front-end behaviour
  you encountered that none of the passes above asked about.** Small things count. This is the
  one Batch 12 under-delivered on last round, so do not filter by importance.

---

## Part 4 - Template for every component

```
### Component: <name as the code or UI calls it>
- Where it appears:
- Variants:
- Sizes (with pixel values):
- States, each with full values:
  - default:    bg / text / border / radius / shadow
  - hover:      ...
  - focus:      ...
  - active:     ...
  - disabled:   ...
  - error:      ...
  - loading:    ...
- Typography inside it:
- Spacing and padding:
- Screenshot:
- Evidence:
```

---

## Part 5 - End of every pass

Close each pass with four lists:

1. **Measured from code** - with paths and quoted declarations.
2. **Measured in the browser** - with routes and selectors.
3. **Screenshotted** - with filenames.
4. **Could not verify** - what, and what you tried. An empty list here is not a pass mark; if
   you reached everything, say what you had to work around.

Add no opinions about what my app should look like, and no judgements about this product's
design. I need the measurements. The design decisions are mine.
