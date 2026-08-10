# Manual accessibility checklist (WCAG 2.2 AA)

Automated tiers (see [`a11y.md`](./a11y.md)) cover roughly a third of AA. This is
the rest — the criteria that need a human at a keyboard and a screen reader. Run
it per release (or when a page/widget changes materially) and record the date +
result. Each item cites the WCAG success criterion so it complements, not
duplicates, the axe tiers.

Test matrix: **keyboard only** (no mouse/trackpad) and **one screen reader**
(NVDA + Firefox on Windows, or VoiceOver + Safari on macOS). Zoom tests in any
current browser.

## Keyboard operability — every interactive surface

Tab/Shift-Tab, arrows, Enter/Space, Esc only.

- [ ] **2.1.1 Keyboard** — every control is reachable and operable: nav, forms,
      buttons, dialogs, and each exercise widget:
  - [ ] Multiple choice — radios/checkboxes selectable, submit reachable.
  - [ ] Truth table — the grid is **one** tab stop; arrows move between cells
        (Home/End for the row ends, Ctrl+Home/End for the grid's), Space or
        Enter cycles blank→T→F, and the focused cell shows a ring. Check and
        counterexample are reachable by Tab from the grid.
  - [ ] Proof (linear) — CodeMirror editor takes focus, types, and is escapable.
  - [ ] Proof (Fitch) — CodeMirror editor takes focus, types, and is escapable;
        the subproof scope-lines are decorative (no keyboard interaction).
  - [ ] Proof tree — roving `treeitem` nav (Up/Down/Left/Right), Enter to edit
        the conclusion / r to edit the rule, Esc back to nav,
        add-premise/hypothesis/delete via keyboard.
  - [ ] Prawitz forest — roving `treeitem` nav; arrows move focus **without
        changing the ticked selection**, Space ticks the focused line (ticks
        accumulate in premise order), and the premise dots under the roots are
        reachable buttons. Enter/r/l/d enter a line's fields, a/b/p/h/Delete
        mirror the toolbar, and a focused-but-unticked line still shows a
        visible focus ring distinct from the selection tint.
  - [ ] Markdown source (revision editor and a revision's read-only source) —
        the source is one Tab stop, arrows move the cursor in both (the
        read-only view included), Ctrl-Shift-[ / ] fold and unfold the block at
        the cursor and the fold is announced, and the `…` standing in for a
        folded block is a Tab stop of its own that unfolds it. The gutter's fold
        arrow is a mouse affordance only — the gutter is `aria-hidden`, so the
        keyboard path must not depend on it.
- [ ] **2.1.2 No keyboard trap** — focus never gets stuck (esp. CodeMirror and
      the contenteditable proof-tree fields — Tab must escape them).
- [ ] **2.4.3 Focus order** — Tab order follows reading/visual order on each
      page and within dialogs.
- [ ] **2.4.7 Focus visible** — the focused element always shows a visible ring
      (the `:focus-visible` outline); check custom controls and tree nodes. In
      the two tree editors' contenteditable fields the *text caret* counts too:
      it must stay visible after typing, not just in the empty box. Chromium
      paints no caret in an editable inline box whose ancestry up to the block
      container is all inline, which is why those fields are `inline-block`.
- [ ] **2.4.11 Focus not obscured** — the focused element isn't hidden behind the
      sticky header or a dialog edge.
- [ ] **2.5.7 Dragging** — any drag affordance (e.g. future tree reparent) has a
      single-pointer / keyboard alternative.

## Dialogs / modals

- [ ] **2.4.3 / 2.1.2** — opening a dialog moves focus into it; focus is trapped
      while open; Esc and a click on the backdrop both close it; on close focus
      returns to the trigger. A drag-select that starts in a field and ends past
      the panel's edge is not a click out and must leave the dialog open.
- [ ] **Widget help** — the `(?)` at the head of the tree and Prawitz action
      bars (and `?` on a
      focused proof line) opens the usage dialog *beside its trigger*, not at the
      middle of the lesson, and without scrolling the page. Its heading is its
      accessible name; the key table reads as pairs; Esc and the backdrop both
      close it; focus lands back on the control that opened it. Check inside a
      **long** lesson, and **embedded in a page** rather than only fullscreen: a
      content iframe is sized to the whole document, so it never scrolls — the
      page around it does, and neither a centred dialog nor a scroll the frame
      cannot undo is visible from inside. Opening it must move nothing.

## Screen reader — semantics and announcements

- [ ] **1.1.1 Non-text content** — images/icons are described or marked
      decorative (`aria-hidden`); the ⊨ brand mark and review ✓/✗ glyphs read
      sensibly (not as stray punctuation).
- [ ] **1.3.1 Info & relationships** — headings, lists, and tables are announced
      as such; form fields announce their label; the proof tree announces node
      role/selection.
- [ ] **2.4.6 Headings & labels** — each page has one descriptive `<h1>` and a
      sensible heading outline (no skipped levels).
- [ ] **3.3.2 Labels/instructions** — every input's purpose is clear from its
      label; required fields are indicated non-visually.
- [ ] **1.3.1 / 4.1.2 (exercises)** — entering any exercise announces the group
      and its name (the author's title, or the kind for an untitled one); a
      truth-table cell announces its column, row number, and value in words; the
      three proof editors and both tree workspaces announce their own names; no
      widget still claims `aria-busy` after it has upgraded.
- [ ] **4.1.2 Name/role/value** — custom widgets expose correct name+role+state
      (truth-table `aria-pressed`, tree `aria-selected`, the Prawitz premise
      dots `aria-pressed` with a name that switches to "Premise n" once ticked,
      publish toggles).
- [ ] **4.1.3 Status messages** — submit results and the truth-table check
      outcome are announced via the live regions without moving focus.

## Forms & errors

- [ ] **3.3.1 Error identification** — validation errors are announced and
      identify the field in text (not colour alone).
- [ ] **3.3.3 Error suggestion** — where possible the message says how to fix it.
- [ ] **1.4.1 Use of colour** — required/error/correct states are conveyed by
      more than colour (text, icon, or `.visually-hidden` label).

## Reflow, zoom, and spacing

- [ ] **1.4.10 Reflow** — at 320 CSS px wide there is no horizontal scroll for
      content (watch the wide tables and the proof-tree/truth-table iframes).
- [ ] **1.4.4 Resize text** — at 200% zoom nothing is clipped or overlapping.
- [ ] **1.4.12 Text spacing** — bumping line/letter/word spacing doesn't clip
      text.
- [ ] **1.4.10 (iframe)** — exercise content reflows and the parent resizes to
      it (the content-height postMessage) without a nested scrollbar trap.

## Motion, timing, media

- [ ] **2.2.1 Timing** — timed assignments warn and don't trap; no essential
      content is lost to a timeout without recourse.
- [ ] **2.3.1 Three flashes** — nothing flashes more than 3×/s (spinners are
      smooth).
- [ ] **2.2.2 Pause/stop/hide** — the compile/checking spinners don't spin
      indefinitely in a way that distracts; they resolve or can be ignored.

## Global

- [ ] **3.1.1 Language** — every document (page **and** each content iframe) has
      the right `<html lang>`.
- [ ] **1.4.3 Contrast** — spot-check that Tier 2's contrast findings are the
      only ones (new colours in authored exercise CSS aren't checked by tooling).
- [ ] **2.4.2 Page titled** — each page and content document has a meaningful
      `<title>`.

---

### Sign-off

| Date | Release / change | Tester | Keyboard | Screen reader | Notes |
|------|------------------|--------|----------|---------------|-------|
|      |                  |        |          |               |       |
