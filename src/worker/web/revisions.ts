import type { ContentRevision } from "../domain/content";
import type { Translator } from "../i18n/translator";

/**
 * The longest note a picker option carries before it is cut short. A native
 * `<select>` is as wide as its widest option, so a full-length note would
 * stretch the assignment form off the page. Counted in code points, not code
 * units, so the cut never lands inside a surrogate pair.
 */
const OPTION_DETAILS_MAX_LENGTH = 60;

/** What a revision's note reads as, including when the author wrote none. */
export function revisionDetailsText(
  i18n: Translator,
  details: string,
): string {
  return details.length === 0 ? i18n.t("No details given") : details;
}

/**
 * A revision's creation date, for the places a `<time datetime>` element cannot
 * go: `<option>` text and document titles. Everywhere else the layout script
 * localizes that element in the reader's own clock; here the server formats it,
 * in the page's language and in UTC, because no reader's zone is known.
 */
export function revisionDateText(createdAt: string, locale: string): string {
  const instant = new Date(createdAt);

  if (Number.isNaN(instant.getTime())) {
    return createdAt;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(instant);
}

/**
 * The fields a picker option's timestamp is written in. The day alone is enough
 * to *describe* a revision but not always enough to tell two apart: an author
 * who saves twice before lunch and names neither would otherwise get two options
 * reading exactly alike.
 *
 * Spelled out field by field because `dateStyle`/`timeStyle` cannot be combined
 * with `timeZoneName` — and the zone has to be named, because the server writes
 * this text in UTC and the script that rewrites it writes the reader's own zone
 * over the top. The same fields are built in `REVISION_OPTION_SCRIPT`; they are
 * two spellings of one format, and changing one without the other leaves the
 * page saying the same instant two ways.
 */
const REVISION_TIMESTAMP_FIELDS = {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZoneName: "short",
  year: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

/**
 * The same instant to the minute in UTC — what a picker option is rendered
 * with, and what a reader without JavaScript keeps.
 */
function revisionTimestampText(createdAt: string, locale: string): string {
  const instant = new Date(createdAt);

  if (Number.isNaN(instant.getTime())) {
    return createdAt;
  }

  return new Intl.DateTimeFormat(locale, {
    ...REVISION_TIMESTAMP_FIELDS,
    timeZone: "UTC",
  }).format(instant);
}

/**
 * What lets a rendered option be re-read in the reader's clock: the instant
 * itself, and the exact text the label was built with, since that text is what
 * the script has to find inside a label it did not compose.
 */
export function revisionOptionTimeAttributes(
  createdAt: string,
  locale: string,
): Record<string, string> {
  return {
    "data-revision-time": createdAt,
    "data-revision-time-utc": revisionTimestampText(createdAt, locale),
  };
}

function optionDetails(details: string): string {
  const characters = [...details];

  if (characters.length <= OPTION_DETAILS_MAX_LENGTH) {
    return details;
  }

  return `${characters.slice(0, OPTION_DETAILS_MAX_LENGTH).join("")}…`;
}

/**
 * A picker option's text, saying so when the revision cannot be read.
 *
 * `<option disabled>` greys the option out but gives no reason, and "greyed
 * out" is indistinguishable from "already selected elsewhere" or "not yours".
 * The words are what make it actionable — and they are what was missing when a
 * known-unreadable revision sat in the correction picker looking like every
 * other one.
 */
export function revisionPickerLabel(
  i18n: Translator,
  label: string,
  unreadable: boolean,
): string {
  return unreadable ? i18n.t("{label} — cannot be read", { label }) : label;
}

/**
 * How a revision is named in a picker: when it was saved and the author's note.
 * Not the revision number — an ordinal orders revisions without describing any
 * of them, and it is no longer shown anywhere a reader looks. `itemTitle` is for
 * pickers that span several content items.
 */
export function revisionOptionLabel(
  i18n: Translator,
  locale: string,
  revision: Pick<ContentRevision, "createdAt" | "details">,
  itemTitle?: string,
): string {
  const date = revisionTimestampText(revision.createdAt, locale);
  const details = optionDetails(revision.details);

  if (itemTitle === undefined) {
    return details.length === 0
      ? date
      : i18n.t("{date}: {details}", { date, details });
  }

  return details.length === 0
    ? i18n.t("{title}, {date}", { date, title: itemTitle })
    : i18n.t("{title}, {date}: {details}", {
        date,
        details,
        title: itemTitle,
      });
}
