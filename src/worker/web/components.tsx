import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";

import { CSRF_COOKIE_NAME } from "../application/auth";
import type { StoredPointsDrift } from "../domain/assessment";
import type { ExerciseAnswerReview } from "../domain/content";
import type { AppBindings } from "../http";
import { APP_FRAME_PARAM } from "./content-document";
import type { StatusTone } from "./html";
// Straight from the context module rather than the layout's re-export, so that
// the layout can import from here (`LocaleSwitcher` reuses `CsrfInput`) without
// the two forming a cycle.
import { useI18n } from "./i18n-context";

export interface SummaryItem {
  readonly label: string;
  readonly value: Child;
}

/**
 * A machine-readable timestamp. The ISO instant lives in the `datetime`
 * attribute and is the visible fallback; a client script (see the layout)
 * localizes the text on load. Renders `fallback` for a null/empty value.
 */
export const Time: FC<{
  readonly fallback?: string;
  readonly value: string | null | undefined;
}> = ({ fallback = "", value }) =>
  value === null || value === undefined || value === "" ? (
    // biome-ignore lint/complexity/noUselessFragments: `FC` returns an `HtmlEscapedString`, and the fragment is what makes one of a plain string.
    <>{fallback}</>
  ) : (
    <time datetime={value}>{value}</time>
  );

export const StatusBadge: FC<{
  readonly label: string;
  readonly tone?: StatusTone;
}> = ({ label, tone = "neutral" }) => (
  <span class={`status-badge status-badge-${tone}`}>{label}</span>
);

/**
 * A submitted answer as the grader or student sees it: labeled values when
 * the exercise type provides structured details (selected options, response
 * text), otherwise the one-line summary. The rubric rides along for manual
 * graders.
 */
export const AnswerReview: FC<{ readonly review: ExerciseAnswerReview }> = ({
  review,
}) => {
  const i18n = useI18n();

  return (
    <div class="answer-review">
      {review.elementHtml !== undefined ? (
        raw(review.elementHtml)
      ) : review.details === undefined || review.details.length === 0 ? (
        <p>{review.summary}</p>
      ) : (
        <dl>
          {review.details.map((detail) => (
            <>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </>
          ))}
        </dl>
      )}
      {review.rubricHtml === undefined ? null : (
        <section class="exercise-rubric">
          <h4>{i18n.t("Rubric")}</h4>
          <div>{raw(review.rubricHtml)}</div>
        </section>
      )}
    </div>
  );
};

export const Notice: FC<{
  readonly children: Child;
  /** "warn" is gold — worth knowing, not wrong. The default blue is neutral. */
  readonly tone?: "info" | "warn";
}> = ({ children, tone = "info" }) => (
  <div
    class={tone === "warn" ? "notice notice-warn" : "notice"}
    role="status"
  >
    {children}
  </div>
);

/**
 * The words that ride with a points-drift tint: what the assignment counts
 * the exercise at now, since the tinted score keeps saying what it was graded
 * out of. The separator lives inside the span so the review script's
 * textContent reset removes the whole annotation in one stroke.
 */
export const PointsDriftNote: FC<{ readonly drift: StoredPointsDrift }> = ({
  drift,
}) => {
  const i18n = useI18n();

  return (
    <span class="points-drift-note">
      {" · "}
      {drift.kind === "removed"
        ? i18n.t("no longer in the assignment")
        : i18n.t("now worth {points}", { points: drift.nominalPoints })}
    </span>
  );
};

/**
 * A read-only value with a copy-to-clipboard button. Use for secrets shown
 * exactly once — an enrollment URL, an API token — where the value cannot be
 * recovered later and the user needs to capture it reliably. The button is
 * wired to the input by `id`; a script in the layout does the copy.
 */
export const CopyField: FC<{
  readonly id: string;
  readonly value: string;
}> = ({ id, value }) => {
  const i18n = useI18n();

  return (
    <div class="copy-field">
      <input id={id} readonly type="text" value={value} />
      <button class="secondary" data-copy-target={id} type="button">
        {i18n.t("Copy")}
      </button>
    </div>
  );
};

export const ErrorSummary: FC<{ readonly children: Child }> = ({
  children,
}) => (
  <div class="error" role="alert">
    {children}
  </div>
);

export const SummaryStrip: FC<{ readonly items: readonly SummaryItem[] }> = ({
  items,
}) => (
  <dl class="summary-strip">
    {items.map((item) => (
      <div class="summary-item">
        <dt>{item.label}</dt>
        <dd>{item.value}</dd>
      </div>
    ))}
  </dl>
);

export interface StripLink {
  readonly href: string;
  /** A short line under the label describing where the link leads. */
  readonly hint?: string;
  readonly label: string;
}

/**
 * A horizontal band of navigation links, styled to echo the {@link SummaryStrip}
 * (edge-to-edge cells with hairline dividers). Use it in a sheet's `summary`
 * slot to surface a couple of related destinations without the visual weight of
 * the full link-grid card footer.
 */
export const LinkStrip: FC<{ readonly links: readonly StripLink[] }> = ({
  links,
}) => (
  <nav class="link-strip">
    {links.map((link) => (
      <a class="link-strip-item" href={link.href}>
        <span class="link-strip-label">
          {link.label}
          <span aria-hidden="true"> →</span>
        </span>
        {link.hint === undefined ? null : (
          <span class="link-strip-hint">{link.hint}</span>
        )}
      </a>
    ))}
  </nav>
);

/**
 * Wraps a `<table>` so it scrolls sideways within its sheet instead of being
 * clipped by the sheet's `overflow: hidden` on narrow viewports. The table
 * keeps `width: 100%` on wide screens; when its content is wider than the
 * available space (many gradebook columns, long URLs, a phone) the wrapper
 * gains a horizontal scrollbar rather than hiding the overflowing columns.
 */
export const TableScroll: FC<{ readonly children?: Child }> = ({
  children,
}) => (
  <div class="table-scroll">
    <table>{children}</table>
  </div>
);

export const Sheet: FC<{
  readonly badge?: Child;
  readonly children?: Child;
  readonly className?: string;
  readonly description?: string;
  readonly footer?: Child;
  readonly summary?: Child;
  readonly title?: string;
}> = ({
  badge,
  children,
  className,
  description,
  footer,
  summary,
  title,
}) => {
  const hasBody =
    children !== undefined &&
    children !== null &&
    children !== false &&
    !(Array.isArray(children) && children.length === 0);

  return (
    <section class={className === undefined ? "sheet" : `sheet ${className}`}>
      {title === undefined ? null : (
        <header class="sheet-header">
          <div>
            <h2>{title}</h2>
            {description === undefined ? null : (
              <p class="small">{description}</p>
            )}
          </div>
          {badge}
        </header>
      )}
      {summary}
      {hasBody ? <div class="sheet-section">{children}</div> : null}
      {footer === undefined ? null : (
        <footer class="sheet-footer">{footer}</footer>
      )}
    </section>
  );
};

/**
 * A sheet-styled host for the isolated content document. The iframe fills
 * the card edge to edge (the document brings its own padding and surface), a
 * layout script sizes it to the height the document reports, and the
 * optional fullscreen glyph opens the same document as a top-level page —
 * the view where author CSS controls the whole presentation. Exactly one of
 * `src` (a content-document URL) or `srcdoc` (an unsaved preview) is passed.
 *
 * `placeholder` is what stands in the frame's place while there is nothing to
 * show. It renders inert, and the CSS reveals it only inside a split marked
 * `preview-empty` — the caller owns the wording, this owns where it sits.
 */
/**
 * The document URL as this frame's body: the same URL the fullscreen link
 * opens, plus the marker that tells the document it is inside our chrome and
 * its links have a frame to escape.
 */
function framedSrc(src: string): string {
  return `${src}${src.includes("?") ? "&" : "?"}${APP_FRAME_PARAM}=1`;
}

export const ContentFrame: FC<{
  readonly fullscreenHref?: string;
  readonly placeholder?: Child;
  readonly src?: string;
  readonly srcdoc?: string;
  readonly title: string;
}> = ({ fullscreenHref, placeholder, src, srcdoc, title }) => {
  const i18n = useI18n();

  return (
    <section class="sheet content-sheet">
      {fullscreenHref === undefined ? null : (
        <a
          aria-label={i18n.t("Open content in its own tab")}
          class="content-fullscreen"
          href={fullscreenHref}
          rel="noopener"
          target="_blank"
        >
          ⛶
        </a>
      )}
      <iframe
        class="content-frame"
        title={title}
        {...(src === undefined ? {} : { src: framedSrc(src) })}
        {...(srcdoc === undefined ? {} : { srcdoc })}
      />
      {placeholder === undefined ? null : (
        <div class="content-frame-empty">{placeholder}</div>
      )}
    </section>
  );
};

/**
 * Pairs a stack of ordinary sheets with a content document. Below the
 * breakpoint everything stacks in DOM order — rail first, content last — and
 * on wide screens the content moves into its own right-hand column, so a
 * long reading sits beside the administrative sheets instead of under them.
 *
 * Passing `view` makes the two columns two *views of one page* instead: below
 * the breakpoint they stop stacking, and the one named shows alone. That is
 * only half a control — {@link splitView} builds both halves, and is what a
 * page should call.
 */
export const ContentSplit: FC<{
  readonly className?: string;
  readonly content: Child;
  readonly rail: Child;
  readonly view?: SplitViewName;
}> = ({ className, content, rail, view }) => (
  <div
    class={
      className === undefined ? "content-split" : `content-split ${className}`
    }
    {...(view === undefined
      ? {}
      : { "data-mode": view, "data-split-view": "" })}
  >
    <div class="content-split-rail">{rail}</div>
    <div class="content-split-doc">{content}</div>
  </div>
);

/** Which of a split's two columns is being looked at. */
export type SplitViewName = "content" | "rail";

/** The two pieces {@link splitView} hands back: one for the page, one for its shell. */
export interface SplitViewParts {
  /** The split itself, for the page body. */
  readonly split: Child;
  /** The switch between the two views, for the shell's `headerAside`. */
  readonly viewSwitch: Child;
}

/**
 * A split whose columns become two views of one page where there is no room
 * for two columns, with a switch between them.
 *
 * The switch comes back separately rather than inside the split, and that is
 * the whole reason this is a function and not a component: below the
 * breakpoint the split hides whichever column is not showing, so a switch
 * living in either column would take itself off screen the moment it was
 * used. It belongs to the page — the shell's header row, opposite the
 * breadcrumb — and not to either column.
 *
 * Both halves come from here so they cannot drift: the pressed half of the
 * switch is the column the split starts on, in one place.
 *
 * The switch is drawn as one control divided in two rather than as two
 * buttons: these are two views of the same thing, and a pair of peer buttons
 * reads as a pair of actions. A fieldset with a hidden legend is what says
 * "one control" to a screen reader, the same way the segmented track says it
 * on screen. Real ARIA tabs would be a lie — above the breakpoint both panels
 * are on screen at once.
 */
export function splitView(options: {
  readonly className?: string;
  readonly content: Child;
  /** What the switch calls the document column. */
  readonly contentLabel: string;
  /** Names the whole control, for a reader who meets its halves one at a time. */
  readonly legend: string;
  readonly rail: Child;
  /** What the switch calls the rail. */
  readonly railLabel: string;
  /** The column shown first where only one shows. */
  readonly start: SplitViewName;
}): SplitViewParts {
  const { contentLabel, legend, railLabel, start, ...split } = options;

  return {
    split: <ContentSplit {...split} view={start} />,
    viewSwitch: (
      <fieldset class="split-switch" data-split-switch>
        <legend class="visually-hidden">{legend}</legend>
        <button
          aria-pressed={String(start === "rail")}
          data-view-target="rail"
          type="button"
        >
          {railLabel}
        </button>
        <button
          aria-pressed={String(start === "content")}
          data-view-target="content"
          type="button"
        >
          {contentLabel}
        </button>
      </fieldset>
    ),
  };
}

/**
 * An inline "add a new record" form for a sheet footer. Replaces the older
 * pattern of embedding a create control as the last row of a table (which
 * forced the submit button into an arbitrary column). Fields are passed as
 * children; each should carry its own `aria-label`.
 */
export const CreateBar: FC<{
  readonly action: string;
  readonly children: Child;
  readonly context: Context<AppBindings>;
  readonly submitLabel: string;
}> = ({ action, children, context, submitLabel }) => (
  <form action={action} class="create-bar" method="post">
    <CsrfInput context={context} />
    {children}
    <button class="secondary" type="submit">
      {submitLabel}
    </button>
  </form>
);

export const CsrfInput: FC<{ readonly context: Context<AppBindings> }> = ({
  context,
}) => {
  const csrfToken = getCookie(context, CSRF_COOKIE_NAME);

  if (csrfToken === undefined) {
    return null;
  }

  return <input name="csrfToken" type="hidden" value={csrfToken} />;
};

/**
 * The browser's own timezone, posted without asking for it: the layout's
 * timezone script fills this field from `Intl` (see `TIMEZONE_INPUT_SCRIPT`).
 * Empty is a legitimate value — a reader with no script posts nothing and the
 * server's own default stands.
 */
export const BrowserTimezoneInput: FC<{ readonly name: string }> = ({
  name,
}) => <input data-timezone-local="" name={name} type="hidden" value="" />;

/**
 * An instant, edited in the reader's own clock: the visible control is the
 * browser's date/time picker showing local time, and a hidden sibling carries
 * the UTC string the form actually posts (see the layout's timestamp script).
 *
 * No `step`, so the control is minute-granular. Seconds are noise in a deadline
 * — nobody schedules 11:59:37 — and the seconds box costs real width in a
 * control that does not shrink its text to fit, which pushed the AM/PM marker
 * out of sight in the grid. A stored instant carrying seconds is truncated to
 * the minute when the form is next saved.
 */
export const TimestampInput: FC<{
  readonly label: string;
  /** Attach the label to the field itself, for a bar with no room for text. */
  readonly labelHidden?: boolean;
  readonly name: string;
  readonly value?: string | null | undefined;
}> = ({ label, labelHidden = false, name, value }) => {
  const hidden = (
    <input
      data-timestamp-hidden={name}
      name={name}
      type="hidden"
      value={value ?? ""}
    />
  );

  if (labelHidden) {
    return (
      <>
        <input
          aria-label={label}
          data-timestamp-local={name}
          type="datetime-local"
        />
        {hidden}
      </>
    );
  }

  return (
    <label>
      {label}
      <br />
      <input data-timestamp-local={name} type="datetime-local" />
      {hidden}
    </label>
  );
};
