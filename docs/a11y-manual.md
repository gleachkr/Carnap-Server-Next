# Manual accessibility checklist

Use this checklist with the [automated tests](./a11y.md) to assess WCAG 2.2
AA behavior. Run it before each release and after substantial page or widget
changes. Record results in the sign-off table.

Test with:

- Keyboard only, without a mouse or trackpad.
- At least one screen reader: NVDA with Firefox on Windows, or VoiceOver
  with Safari on macOS.
- A current browser for zoom, spacing, and reflow checks.

Criterion numbers below identify the relevant WCAG success criteria. A
checked item records a test result, not a claim of complete conformance.

## Keyboard operation

Use Tab, Shift-Tab, arrows, Enter, Space, and Escape.

- [ ] **2.1.1 Keyboard:** every navigation link, form control, dialog, and
      exercise can be used without a pointer.
  - [ ] Multiple choice: select radios or checkboxes and reach Submit.
  - [ ] Truth table: the grid is one tab stop. Arrows move between cells;
        Home/End move to row ends; Ctrl+Home/End move to grid ends. Space or
        Enter cycles blank → T → F. Tab reaches Check and counterexample
        controls. Counterexample row radios form a separate tab stop before
        the cells; arrows select rows, and each radio names its row.
  - [ ] Linear and Fitch proofs: focus the CodeMirror editor, type, move the
        cursor, and leave it with the keyboard. Fitch scope lines require no
        interaction.
  - [ ] Proof tree: arrows navigate `treeitem` elements; Enter edits a
        conclusion; `r` edits a rule; Escape returns to navigation. Add a
        premise or hypothesis and delete a subtree using the keyboard.
  - [ ] Prawitz forest: arrows move focus without changing selection. Space
        selects the focused line; selections retain premise order. Premise
        buttons below roots are reachable. Enter/r/l/d edit line fields;
        a/b/p/h/Delete match the toolbar actions. An unselected focused line
        has a focus ring distinct from the selection highlight.
  - [ ] Model: reach and edit the domain, predicates, constants, and function
        values, then Check and Submit.
  - [ ] Translation: edit the formula, check with Enter, and reach Submit.
  - [ ] Free response and short answer: edit the text and reach Submit.
  - [ ] Markdown source: editable and read-only views are each one tab stop,
        and arrows move the cursor in both. Ctrl+Shift+[ and Ctrl+Shift+]
        fold and unfold the current block with an announcement. The folded
        `…` placeholder is independently focusable and can unfold the block.
        The hidden gutter is not required for keyboard operation.
  - [ ] Split view: Write, Split, and Preview expose the correct pressed
        state. Below 70rem, Split is unavailable and the selected button
        matches the visible column. In Split, the boundary is a focusable
        separator: Left/Right resize it, Home/End reach its limits, and
        `aria-valuenow` updates.
- [ ] **2.1.2 No keyboard trap:** Tab can leave editors and contenteditable
      fields. Modal focus stays inside only while the modal is open.
- [ ] **2.4.3 Focus order:** Tab follows reading order, including in dialogs.
- [ ] **2.4.7 Focus visible:** every focused control has a visible indicator.
      In tree-editor fields, also check that the caret remains visible after
      typing. Their editable boxes must not lose the caret in inline layout.
- [ ] **2.4.11 Focus not obscured:** headers and dialog edges do not hide the
      focused control.
- [ ] **2.5.7 Dragging:** dragging has a non-drag alternative. The split-view
      separator supports keyboard resizing as well as dragging; double-click
      restores its initial position. Check the same requirement for any new
      drag interaction.

## Dialogs

- [ ] **2.4.3 / 2.1.2:** opening moves focus inside. Escape and a backdrop
      click close the dialog, and focus returns to the trigger. Drag-selecting
      from a field past the panel edge does not close it.
- [ ] Widget Help opens from `(?)` or `?` on a focused proof line. It appears
      near its trigger without scrolling the page. The heading names the
      dialog, and key tables read as key/action pairs.
- [ ] Test Help in a long embedded lesson, not just fullscreen. The iframe
      spans the whole lesson, so positioning at the frame's center could put
      the dialog outside the visible page area.

## Screen-reader semantics and announcements

- [ ] **1.1.1 Non-text content:** meaningful images and icons have names;
      decoration is hidden. The ⊨ brand and review ✓/✗ marks do not announce
      as unexplained punctuation.
- [ ] **1.3.1 Information and relationships:** headings, lists, tables, and
      field labels are announced correctly. Tree nodes expose their role and
      selection. Sortable table headings become buttons after enhancement;
      exactly one sorted column exposes ascending or descending `aria-sort`.
- [ ] **2.4.6 Headings and labels:** each page has a descriptive main heading
      and a logical outline. Check the project's single-`h1` convention.
- [ ] **3.3.2 Labels and instructions:** input purpose and required state are
      available without relying on visual placement or color.
- [ ] **1.3.1 / 4.1.2 Exercise groups:** entering an exercise announces its
      title, or its kind if untitled. Truth-table cells announce column, row,
      and value in words. Each proof workspace has a name. Enhanced widgets
      do not retain `aria-busy`.
- [ ] **4.1.2 Name, role, value:** custom widgets expose current state,
      including truth-table `aria-pressed`, tree `aria-selected`, Prawitz
      premise-button names and pressed state, and publication toggles.
- [ ] **4.1.3 Status messages:** submission and local-check results are
      announced without moving focus or repeatedly announcing typing updates.

## Forms and errors

- [ ] **3.3.1 Error identification:** errors are announced and identify the
      relevant field in text.
- [ ] **3.3.3 Error suggestion:** messages explain how to fix a problem when
      a correction is known.
- [ ] **1.4.1 Use of color:** required, incorrect, and correct states have a
      text, icon, or accessible-label equivalent.

## Reflow, zoom, and spacing

- [ ] **1.4.10 Reflow:** at 320 CSS px, ordinary content does not require
      horizontal scrolling. Check wide tables and exercise layouts separately
      where a two-dimensional layout is necessary.
- [ ] **1.4.4 Resize text:** at 200% zoom, text remains readable and controls
      are not clipped or overlapping.
- [ ] **1.4.12 Text spacing:** apply line height 1.5 times the font size,
      paragraph spacing 2 times, letter spacing 0.12 times, and word spacing
      0.16 times. No content or functionality is lost.
- [ ] Content iframes reflow and send updated heights to their parent without
      creating a nested scrollbar trap.

## Motion and timing

- [ ] **2.2.1 Timing adjustable:** review time limits, warnings, extensions,
      and any applicable exceptions. A timeout must not unexpectedly trap
      users or discard essential work without an appropriate remedy.
- [ ] **2.3.1 Three flashes:** nothing flashes more than three times per
      second unless it meets the criterion's threshold exception.
- [ ] **2.2.2 Pause, stop, hide:** review persistent animation, including
      checking spinners, for the applicable pause or stop requirements.

## Documents and contrast

- [ ] **3.1.1 Language:** each page and content iframe has the correct
      `<html lang>`.
- [ ] **1.4.3 / 1.4.11 Contrast:** check text, controls, and state indicators
      in both palettes, including glyph-only controls and authored CSS that
      the automated fixtures do not cover.
- [ ] **2.4.2 Page titled:** each page and content document has a meaningful
      `<title>`.

## Sign-off

Record browser and screen-reader versions in Notes, along with failures and
follow-up work.

| Date | Release/change | Tester | Keyboard | Screen reader | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
