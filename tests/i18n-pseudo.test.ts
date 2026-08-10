import { expect, setDefaultTimeout, test } from "bun:test";

import { messages as enMessages } from "../src/locales/en/messages";
import { collectFixtures } from "./a11y/fixtures";
import { visibleText } from "./i18n/visible-text";

/**
 * The i18n coverage gate. Renders every page template under the pseudolocale —
 * where each catalog message comes back accented and lengthened — and fails if
 * any message's plain English still shows up verbatim.
 *
 * What this actually catches, and why it is the check worth having: a *second,
 * hard-coded copy* of a string that is already translated somewhere else. That
 * is the dominant regression during a translation sweep, and it is invisible
 * both to `lingui extract` (which sees the wrapped call and is satisfied) and to
 * reading the diff (the duplicate is in a file nobody touched). Under the
 * pseudolocale the wrapped copy is mangled and the hard-coded one is not, so the
 * survivor names itself.
 *
 * It deliberately does NOT try to find text that was never wrapped at all —
 * "is this ASCII English?" cannot be answered without an allowlist for logic
 * formulas, course titles, ids, and the product name. That inventory is
 * `scripts/i18n-pseudo-report.ts`, which is advisory and ratcheted.
 */

setDefaultTimeout(60_000);

const PSEUDO_LOCALE = "en-XA";

/**
 * Which catalog ids are safe to search for.
 *
 * Short ids collide with ordinary page content — "Email" is a table heading
 * *and* a form label, "Content" is a nav item *and* a word, and a one-letter id
 * would match a propositional atom. Ids carrying ICU placeholders never appear
 * verbatim anyway, since the placeholder is substituted before render. So the
 * search is restricted to prose long enough that an accidental match is not
 * plausible.
 */
const MIN_SEARCHABLE_LENGTH = 12;

/**
 * …with one exception, because the length floor was excluding exactly the ids
 * most worth watching: the short button and nav labels ("Add staff", "Export
 * CSV", "Hide grades", "Join course") that are the likeliest to be written out
 * a second time by hand.
 *
 * A *phrase* does not collide the way a word does. What produces a false
 * positive here is a single English word turning up as data — and it really
 * does happen: "Score" is a catalog id and also the middle of the timezone
 * `America/Scoresbysund`, "Prove" is a catalog id and also the first word of a
 * lesson the fixtures seed. Measured over the whole fixture set, every short id
 * that matches something on a page is one word long; not one of the 28
 * multi-word short ids matches anything. So a space is the discriminator, and
 * it needs no allowlist to maintain.
 *
 * The caveat worth knowing: a phrase can still be a *substring* of a longer
 * sentence that was never wrapped at all — `AppHttpError` messages are English
 * literals by design — in which case this reports a leak that is real but is
 * not the duplicated-label bug the gate is named for. That is a true positive
 * with a misleading explanation, not a false one; see the note on
 * `error-course-create` in `tests/a11y/fixtures.ts`.
 */
function isSearchable(id: string): boolean {
  if (id.includes("{")) {
    return false;
  }

  return id.length >= MIN_SEARCHABLE_LENGTH || id.includes(" ");
}

function searchableIds(): string[] {
  return Object.keys(enMessages).filter(isSearchable);
}

// Memoized: three tests want the same rendering of the same fixture set, and
// seeding it is by far the expensive part.
let cachedFixtures: ReturnType<typeof collectFixtures> | null = null;

function pseudoFixtures(): ReturnType<typeof collectFixtures> {
  cachedFixtures ??= collectFixtures({
    headers: { "Accept-Language": PSEUDO_LOCALE },
  });

  return cachedFixtures;
}

test("no page leaks untranslated English under the pseudolocale", async () => {
  const ids = searchableIds();

  // A guard on the guard: if extraction silently stopped finding messages, this
  // test would pass by having nothing to look for.
  expect(ids.length).toBeGreaterThan(0);

  const fixtures = await pseudoFixtures();

  expect(fixtures.length).toBeGreaterThan(0);

  const leaks: string[] = [];

  for (const fixture of fixtures) {
    const { all } = visibleText(fixture.html);

    for (const id of ids) {
      if (all.includes(id)) {
        leaks.push(`  • ${fixture.name}: "${id}"`);
      }
    }
  }

  if (leaks.length > 0) {
    throw new Error(
      `${leaks.length} message(s) rendered as plain English under the ` +
        `${PSEUDO_LOCALE} pseudolocale, so they are not going through ` +
        `i18n:\n${leaks.join("\n")}\n\n` +
        "Each is almost certainly a second, hard-coded copy of a string that " +
        "is translated elsewhere. Find the literal and route it through " +
        "`i18n.t(...)` — remembering the receiver must be spelled `i18n` for " +
        "`lingui extract` to see it.",
    );
  }
});

test("the pseudolocale actually reaches the page", async () => {
  // Without this, the test above would pass trivially the moment locale
  // resolution broke: no pseudolocalization means no mangling, but also no
  // English *catalog* text to find, since every id would resolve to itself.
  const [fixture] = await pseudoFixtures();

  expect(fixture).toBeDefined();
  expect(fixture?.html).toContain(`lang="${PSEUDO_LOCALE}"`);
  // A pseudolocalized page carries accented glyphs no English page would.
  expect(visibleText(fixture?.html ?? "").all).toMatch(/[āēīōū ĀĒĪŌŨ àóŕţ]/u);
});

test("every fixture is rendered in the pseudolocale, not just the first", async () => {
  // The same guard, applied per fixture — because the failure it catches is
  // silent and *local*. A fixture that reaches the page by some route the
  // harness forgot to pass `Accept-Language` on (a form POST, an LTI launch,
  // anything that is not a plain GET) renders in English, and the gate above
  // then reports every catalog message on it as a leak — or, if the page is
  // new, reports a clean run over a page it never actually inspected. Naming
  // the offending fixture here beats debugging fifty spurious leaks there.
  const wrongLocale = (await pseudoFixtures())
    .filter((fixture) => !fixture.html.includes(`lang="${PSEUDO_LOCALE}"`))
    .map((fixture) => fixture.name);

  expect(wrongLocale).toEqual([]);
});
