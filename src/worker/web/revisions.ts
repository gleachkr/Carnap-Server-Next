import type {
  AssignmentOutdatedTheory,
  OutdatedTheory,
} from "../application/content";
import type { ContentRevision } from "../domain/content";
import type { Translator } from "../i18n/translator";
import { utcTimestampText } from "./timestamp-formats";

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
    "data-revision-time-utc": utcTimestampText(createdAt, locale),
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
  const date = utcTimestampText(revision.createdAt, locale);
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

/**
 * Why a content item's latest revision is built on an outdated theory, and
 * what to do about it. A built-in changed in place, so the same lesson saved
 * again takes the change up; a hosted theory's newer text is at another
 * address, so the lesson's `src=` has to be pointed there first.
 */
export function outdatedTheoryText(
  i18n: Translator,
  theory: OutdatedTheory,
): string {
  return theory.current === theory.src
    ? i18n.t(
        "The latest revision was built on an older version of {src}. Save a new revision to build it on the current one.",
        { src: theory.src },
      )
    : i18n.t(
        "The latest revision was built on {src}, and that theory has a newer revision at {current}. To use it, change the src to the new address and save a new revision.",
        { current: theory.current, src: theory.src },
      );
}

/**
 * The same for the revision an assignment publishes, with the remedy this
 * reader has: the lesson may already have a revision on the current theory,
 * which a save would be refused as a duplicate of, and only the lesson's
 * owner can save it or point an assignment at it.
 */
export function assignmentOutdatedTheoryText(
  i18n: Translator,
  theory: AssignmentOutdatedTheory,
): string {
  const params = { current: theory.current, src: theory.src };

  if (theory.current === theory.src) {
    switch (theory.remedy) {
      case "repoint":
        return i18n.t(
          "This assignment's revision was built on an older version of {src}. The lesson's latest revision is built on the current one: point this assignment at it.",
          params,
        );
      case "resave":
        return i18n.t(
          "This assignment's revision was built on an older version of {src}. To use the current one, save the lesson again and point this assignment at the new revision.",
          params,
        );
      case "author":
        return i18n.t(
          "This assignment's revision was built on an older version of {src}. Only the lesson's author can move it onto the current one.",
          params,
        );
    }
  }

  switch (theory.remedy) {
    case "repoint":
      return i18n.t(
        "This assignment's revision was built on {src}, and that theory has a newer revision at {current}. The lesson's latest revision no longer uses {src}: point this assignment at it.",
        params,
      );
    case "resave":
      return i18n.t(
        "This assignment's revision was built on {src}, and that theory has a newer revision at {current}. To use it, change the lesson's src to the new address, save the lesson, and point this assignment at the new revision.",
        params,
      );
    case "author":
      return i18n.t(
        "This assignment's revision was built on {src}, and that theory has a newer revision at {current}. Only the lesson's author can move it onto the new one.",
        params,
      );
  }
}
