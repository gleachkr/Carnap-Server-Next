/**
 * Names for downloaded files.
 *
 * An export lands in a folder alongside every other file the reader has saved
 * this term, and the name is all they have to tell one from another — so a
 * gradebook CSV is named for the course, the assignment, and the moment it was
 * taken rather than for the record ids that identify it to us. The stamp is
 * read in the course's own timezone: an instructor comparing two exports is
 * thinking in the clock the course runs on, not in UTC.
 */

/**
 * Characters a filename cannot carry. The path separators and the Windows
 * reserved set, plus control and formatting codepoints — a right-to-left mark
 * in a title is invisible in the name and turns the extension into part of a
 * reversed run.
 */
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}/\\:*?"<>|]+/gu;

/** Long enough for a real course or assignment title, short of a paragraph. */
const PART_MAX_LENGTH = 60;

/**
 * The parts of a download's name, in the order they are read. Empty and
 * whitespace-only entries drop out, so a caller can pass an optional title
 * without composing the list conditionally.
 */
export interface DownloadName {
  readonly at: Date;
  readonly parts: readonly string[];
  readonly timezone: string;
}

function sanitizePart(text: string): string {
  const collapsed = text
    .replace(UNSAFE_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim();

  // Windows silently drops a trailing dot or space from a saved name, which
  // would leave a truncated title looking like the file was cut off.
  return collapsed.slice(0, PART_MAX_LENGTH).replace(/[.\s]+$/u, "");
}

function stamp(at: Date, timezone: string): string {
  const format = (zone: string): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      // `hour12: false` renders midnight as 24 in some engines; this does not.
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: zone,
      year: "numeric",
    });

  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = format(timezone).formatToParts(at);
  } catch (_error) {
    // A course's timezone is validated on the way in, so this is a row written
    // before that check or by hand. A download is the wrong place to fail over
    // it — name the file in UTC and hand it over.
    parts = format("UTC").formatToParts(at);
  }

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  // A colon is not allowed in a filename; the hyphen is what everything else
  // that stamps a name uses in its place.
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}-${value("minute")}`;
}

/**
 * The name itself, extension included: the parts joined with a dash, then the
 * timestamp.
 */
export function downloadFilename(
  name: DownloadName,
  extension: string,
): string {
  const parts = [...name.parts, stamp(name.at, name.timezone)]
    .map(sanitizePart)
    .filter((part) => part !== "");

  return `${parts.join(" - ")}.${extension}`;
}

/**
 * RFC 5987's `attr-char`. `encodeURIComponent` leaves a few characters bare
 * that the grammar does not admit.
 */
function encodeExtendedValue(text: string): string {
  return encodeURIComponent(text).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/**
 * A `Content-Disposition` carrying the name twice, as RFC 6266 asks: a plain
 * ASCII rendering for anything old enough to need it, and the real UTF-8 name,
 * which every current browser prefers. Without the second one a course titled
 * "Logik für Anfänger" downloads as "Logik f r Anf nger".
 */
export function attachmentDisposition(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/_+/g, "_");

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeExtendedValue(filename)}`;
}

/** Headers for a CSV export: the type, and a name a reader can recognize. */
export function csvDownloadHeaders(
  name: DownloadName,
): Record<string, string> {
  return {
    "Content-Disposition": attachmentDisposition(
      downloadFilename(name, "csv"),
    ),
    "Content-Type": "text/csv; charset=utf-8",
  };
}
