import {
  LAYOUT_UI_STRINGS_ATTRIBUTE,
  readStringsPrelude,
} from "./ui-strings";

/**
 * The app shell's progressive-enhancement scripts.
 *
 * They live here rather than beside the markup they enhance because
 * {@link ./script-assets} has to import them to build the served file, and the
 * layout has to import that file's URL — which through `layout.tsx` would be a
 * cycle. The same split `styles.ts` and `style-assets.ts` already make, and for
 * the same reason.
 *
 * Every one is an IIFE, which is what lets them be concatenated: each keeps its
 * own `S` binding from {@link readStringsPrelude}, so two scripts reading two
 * different payloads do not collide.
 *
 * None of them may assume they run during parse. They are loaded `defer`, so
 * the document — including the JSON payloads at the end of the body — is
 * complete before the first line executes.
 */

const DIALOG_SCRIPT = `
(() => {
  // Click-outside-to-dismiss is not native to <dialog>. A modal paints its own
  // backdrop, so a click there targets the dialog element itself while a click
  // on the panel targets something inside it. The press has to have landed on
  // the backdrop too: a drag-select that starts in a field and ends past the
  // panel's edge reports the dialog as well, and closing on that would throw
  // away whatever had been typed into the form.
  let pressedOnBackdrop = false;

  document.addEventListener("pointerdown", (event) => {
    pressedOnBackdrop = event.target instanceof HTMLDialogElement;
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (event.target instanceof HTMLDialogElement) {
      if (pressedOnBackdrop) {
        event.target.close();
      }

      return;
    }

    const trigger = event.target.closest("[data-dialog-target]");

    if (!(trigger instanceof HTMLElement)) {
      return;
    }

    const targetId = trigger.dataset.dialogTarget;

    if (targetId === undefined) {
      return;
    }

    const dialog = document.getElementById(targetId);

    if (dialog instanceof HTMLDialogElement) {
      dialog.showModal();
    }
  });
})();`;

const CONTENT_FRAME_SCRIPT = `
(() => {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const data = event.data;

    if (
      data === null ||
      typeof data !== "object" ||
      data.type !== "carnap:content-height"
    ) {
      return;
    }

    const height = Number(data.height);

    if (!Number.isFinite(height) || height <= 0 || height > 100000) {
      return;
    }

    // Matching event.source to the frame's window pins the message to the
    // frame that sent it: it disambiguates multiple content frames on one
    // page and ignores same-origin windows that are not ours.
    for (const frame of document.querySelectorAll("iframe.content-frame")) {
      if (
        frame instanceof HTMLIFrameElement &&
        frame.contentWindow === event.source
      ) {
        frame.style.height = Math.ceil(height) + "px";

        // The frame is now as tall as its document, so nothing inside it is
        // meant to scroll — but "as tall as" is an integer against a layout
        // that is not, and a sliver of scroll range is enough for the frame to
        // swallow a touch gesture that was meant for the page: on a phone the
        // first swipe in each direction spends itself inside the lesson and
        // the page under it does not move. Saying outright that the document
        // does not scroll costs nothing here, because this line only ever runs
        // on a frame that has just been sized to fit — there is never content
        // behind the edge it hides. It is also why this is done from script
        // rather than in the document's stylesheet: without JavaScript the
        // frame keeps its fallback height, and then scrolling inside it is the
        // only way to read past the first screen.
        const framed = frame.contentDocument;

        if (framed !== null) {
          framed.documentElement.style.overflow = "hidden";
        }
      }
    }
  });
})();`;

const TIMESTAMP_DISPLAY_SCRIPT = `
(() => {
${readStringsPrelude(LAYOUT_UI_STRINGS_ATTRIBUTE)}

  // The page's language, not the browser's: once a reader has chosen a
  // language, the dates in front of them should be written in it. Undefined
  // falls back to the browser's own locale, which is the previous behaviour and
  // the right answer when no payload is present.
  const locale = S.locale || undefined;

  // Most timestamps read best as a full "Jul 6, 2026, 3:19 PM". The exceptions
  // are cells with a constrained width: a stat cell in a summary strip (the
  // display serif is large, so the full form wraps and stretches the row) and a
  // date column in a narrow table (on a phone the full form wraps to several
  // lines). For those we keep the font uniform but measure the cell and drop to
  // the longest form that fits on one line — the ladder runs from fullest to a
  // bare numeric date.
  const full = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const ladder = [
    full,
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "2-digit",
    }),
    new Intl.DateTimeFormat(locale, { dateStyle: "short" }),
  ];

  const entries = [];

  for (const element of document.querySelectorAll("time[datetime]")) {
    const date = new Date(element.getAttribute("datetime"));

    if (Number.isNaN(date.getTime())) {
      continue;
    }

    // Localize immediately so no ISO string flashes; a cell that needs to fit
    // is refined once web fonts settle and measurement matches the paint.
    element.textContent = full.format(date);
    entries.push({
      cell: element.closest(".summary-item dd, td"),
      date,
      element,
    });
  }

  const fit = () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (context === null) {
      return;
    }

    for (const entry of entries) {
      if (entry.cell === null) {
        continue;
      }

      const style = getComputedStyle(entry.element);
      context.font =
        style.fontStyle +
        " " +
        style.fontWeight +
        " " +
        style.fontSize +
        " " +
        style.fontFamily;

      const cellStyle = getComputedStyle(entry.cell);
      const available =
        entry.cell.clientWidth -
        parseFloat(cellStyle.paddingLeft) -
        parseFloat(cellStyle.paddingRight);

      let text = ladder[ladder.length - 1].format(entry.date);

      for (const formatter of ladder) {
        const candidate = formatter.format(entry.date);

        if (context.measureText(candidate).width <= available) {
          text = candidate;
          break;
        }
      }

      entry.element.textContent = text;

      // When the shown form dropped detail (the time, or part of the date),
      // keep the full "Jul 6, 2026, 3:19 PM" reachable as a hover tooltip.
      const fullText = full.format(entry.date);

      if (text === fullText) {
        entry.element.removeAttribute("title");
      } else {
        entry.element.title = fullText;
      }

      // In a table the fitted form must not wrap back onto two lines: it was
      // chosen to fit the column's current width, so pinning it to one line
      // only ever lets the column shrink, never overflow.
      if (entry.cell.tagName === "TD") {
        entry.element.style.whiteSpace = "nowrap";
      }
    }
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit);
  } else {
    fit();
  }
})();`;

/**
 * The one timestamp the shell cannot localize as a `<time>` element: a
 * `<select>` option's own text, which admits no child elements at all.
 *
 * So the server writes the label in UTC, tags the option with the instant it
 * came from and with the exact date text it used, and this rewrites that
 * substring in the reader's zone — the rest of the label, an author's note that
 * may say anything, is left untouched. A reader with no script keeps the UTC
 * form, which is why the server names the zone there. The formatter's fields
 * mirror `REVISION_TIMESTAMP_FIELDS` in `web/revisions.ts`.
 */
const REVISION_OPTION_SCRIPT = `
(() => {
${readStringsPrelude(LAYOUT_UI_STRINGS_ATTRIBUTE)}

  const locale = S.locale || undefined;
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric",
  });

  for (const option of document.querySelectorAll("option[data-revision-time]")) {
    const date = new Date(option.dataset.revisionTime);
    const written = option.dataset.revisionTimeUtc;

    if (Number.isNaN(date.getTime()) || !written) {
      continue;
    }

    // Replaced through a function so a "$" in the formatted date could never be
    // read as a substitution pattern.
    option.textContent = option.textContent.replace(written, () =>
      format.format(date),
    );
  }
})();`;

const TIMESTAMP_INPUT_SCRIPT = `
(() => {
  const selector = "[data-timestamp-local]";

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  // To the minute, matching the control's default step. A seconds component
  // here would not merely be shown: it would be a step mismatch, and the
  // browser would refuse to submit a form whose date the reader never touched.
  function localDateTimeValue(date) {
    return date.getFullYear() +
      "-" + pad(date.getMonth() + 1) +
      "-" + pad(date.getDate()) +
      "T" + pad(date.getHours()) +
      ":" + pad(date.getMinutes());
  }

  function hiddenInputFor(control) {
    const name = control.dataset.timestampLocal;

    if (!name || control.form === null) {
      return null;
    }

    for (const candidate of control.form.querySelectorAll(
      "[data-timestamp-hidden]",
    )) {
      if (candidate.dataset.timestampHidden === name) {
        return candidate;
      }
    }

    return null;
  }

  function syncHidden(control) {
    const hidden = hiddenInputFor(control);

    if (hidden === null) {
      return;
    }

    if (control.value === "") {
      hidden.value = "";
      return;
    }

    const date = new Date(control.value);

    if (!Number.isNaN(date.getTime())) {
      hidden.value = date.toISOString();
    }
  }

  function initializeControl(control) {
    const hidden = hiddenInputFor(control);

    if (hidden !== null && hidden.value !== "") {
      const date = new Date(hidden.value);

      if (!Number.isNaN(date.getTime())) {
        control.value = localDateTimeValue(date);
      }
    }

    control.addEventListener("input", () => syncHidden(control));
  }

  for (const control of document.querySelectorAll(selector)) {
    initializeControl(control);
  }

  document.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }

    for (const control of event.target.querySelectorAll(selector)) {
      syncHidden(control);
    }
  }, true);
})();`;

/**
 * A field only one answer to another question uses: required under that answer,
 * switched off under the others.
 *
 * The gate names the field it governs and the value that wants it
 * (`data-gates-field`, `data-gates-value`); the field is found by the same
 * `data-timestamp-local` name the mirroring above uses, so the pair needs no id
 * of its own. Grade visibility is the one case today — the date matters only for
 * "at the time below" — and the mechanism is worth its handful of lines because
 * the alternative is a label that calls a field optional when it is sometimes
 * required.
 *
 * The server renders the field plain: enabled, not required. Whoever has no
 * script keeps a field they can fill and a server that still refuses a schedule
 * with nothing to schedule, so this only ever adds the affordance. The typed
 * value is left alone when the field switches off, so flipping between answers
 * does not throw away a date the reader already chose.
 *
 * Exported for `tests/dom` — it is the only shell script whose behaviour is a
 * state machine rather than a formatting pass.
 */
export const GATED_FIELD_SCRIPT = `
(() => {
  for (const gate of document.querySelectorAll("[data-gates-field]")) {
    const name = gate.dataset.gatesField;
    const wanted = gate.dataset.gatesValue;

    if (!name || !gate.form) {
      continue;
    }

    const field = gate.form.querySelector(
      '[data-timestamp-local="' + name + '"]',
    );

    if (field === null) {
      continue;
    }

    const apply = () => {
      const wants = gate.value === wanted;
      field.disabled = !wants;
      field.required = wants;
    };

    gate.addEventListener("change", apply);
    apply();
  }
})();`;

const TIMEZONE_INPUT_SCRIPT = `
(() => {
  // A course's timezone, read off the clock the reader is looking at instead of
  // asked for. Whoever creates a course is all but always in the zone it runs
  // in, and the one who is not can set it on the course record afterwards — so
  // a four-hundred-entry picker was a question with a known answer standing in
  // front of the one field that matters. With no script (or no Intl) the field
  // posts empty and the server falls back to UTC, which is what the picker
  // offered as its default anyway.
  let zone = "";

  try {
    zone = new Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return;
  }

  if (zone === "") {
    return;
  }

  for (const field of document.querySelectorAll("input[data-timezone-local]")) {
    field.value = zone;
  }
})();`;

const CLIPBOARD_SCRIPT = `
(() => {
${readStringsPrelude(LAYOUT_UI_STRINGS_ATTRIBUTE)}

  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const trigger = event.target.closest("[data-copy-target]");

    if (!(trigger instanceof HTMLButtonElement)) {
      return;
    }

    const targetId = trigger.dataset.copyTarget;

    if (targetId === undefined) {
      return;
    }

    const source = document.getElementById(targetId);

    if (!(source instanceof HTMLInputElement)) {
      return;
    }

    const done = (ok) => {
      const original = trigger.dataset.copyLabel ?? trigger.textContent;
      trigger.dataset.copyLabel = original;
      trigger.textContent = ok
        ? S.copied || "Copied"
        : S.copyFailed || "Copy failed";
      window.setTimeout(() => {
        trigger.textContent = trigger.dataset.copyLabel ?? original;
      }, 1500);
    };

    try {
      await navigator.clipboard.writeText(source.value);
      done(true);
    } catch {
      source.select();
      done(document.execCommand("copy"));
    }
  });
})();`;

/**
 * The deep-link return page posts itself to the LMS the moment it renders.
 *
 * Folded in here rather than left inline on that one page: the shell is on
 * every page anyway, so guarding on the form's presence costs nothing and this
 * was the last inline script in the app.
 */
const LTI_DEEP_LINK_SCRIPT = `
(() => {
  const form = document.getElementById("lti-deep-link-return");

  if (form instanceof HTMLFormElement) {
    form.submit();
  }
})();`;

/** Every shell script, in the order they were emitted when they were inline. */
export const SHELL_SCRIPT = [
  DIALOG_SCRIPT,
  CONTENT_FRAME_SCRIPT,
  TIMESTAMP_DISPLAY_SCRIPT,
  REVISION_OPTION_SCRIPT,
  TIMESTAMP_INPUT_SCRIPT,
  GATED_FIELD_SCRIPT,
  TIMEZONE_INPUT_SCRIPT,
  CLIPBOARD_SCRIPT,
  LTI_DEEP_LINK_SCRIPT,
].join("\n");
