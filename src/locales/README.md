# Translating Carnap

Carnap is a platform for teaching and practicing formal logic. This directory
holds its interface translations. Thank you for working on them — a student
following a proof in their own language has a materially easier time than one
translating as they go.

Each language is one file: `<tag>/messages.po`, standard gettext PO. Open it in
Weblate, Poedit, Lokalize, or a text editor.

The `messages.ts` next to it is **generated** — never edit it.

## How the files read

The `msgid` is the English text itself, not a key:

```po
#: src/worker/web/courses.tsx
msgid "Archive course"
msgstr ""
```

An empty `msgstr` means untranslated, and untranslated renders as the English
`msgid`. So a partial translation is a usable translation — nothing breaks, some
of the interface is simply still in English. Feel free to leave entries you are
unsure of.

The `#:` line is the source file the text comes from. It is a useful hint about
where a string appears. The files you will meet most, largest first:

- `assignment-detail.tsx` — what a student sees while doing an assignment, and
  what an instructor sees reviewing it. The biggest single file by far.
- `courses.tsx` — the course pages: roster, staff, enrollment links, archiving.
- `diagnostic-strings.ts` — the compiler's complaints to an *author* writing a
  lesson, not to a student. Technical register, and worth keeping consistent
  with the notation vocabulary below.
- `admin.tsx` and `admin-lti.tsx` — site administration and LMS registration.
- `content.tsx` — the authoring tools.
- `labels.ts` — short shared words (statuses, roles) reused across many pages.
- `application/*.ts` — the error messages. Something the reader tried was refused
  or could not be found, and this is the sentence explaining it. Short and plain
  is right here; they appear beside a form field or on a page of their own, and
  a few of them (`lti.ts`) are what someone sees when a launch from their
  school's LMS fails, which may be their first sight of Carnap.
- `truth-table/`, `aufbau-proof/`, `aufbau-proof-tree/`, `aufbau-proof-fitch/` —
  the individual exercise widgets, the text a student sees while working.
- `resend.ts` — the emails.

Some entries carry a `#.` comment from the developers. **Read those** — they
exist because the `msgid` alone was misleading. There are three kinds:

- *Disambiguating id* comments. A few `msgid`s are not the text shown at all:
  the developers had to make the id unique because the same English word appears
  twice needing two translations. `msgid "Open (assignment availability)"` shows
  only the word *Open*; the parenthetical is there for you and for the catalog,
  and must not appear in your translation.
- Placement notes, such as the two lowercase evaluator fragments (`automatic`,
  `manual`) that land mid-line after a score — something no one could guess from
  the word alone, and which is why they are lowercase.
- Notes on what part of an entry is translatable at all: `person@example.edu` is
  a form placeholder whose *local part* should be translated while the
  `example.edu` domain stays, since that domain is reserved for documentation.

## Placeholders

Text in braces is filled in at runtime. **Copy every placeholder exactly**, name
and all. You may move it wherever your language needs it.

```po
msgid "Correct cells: {count} of {total}"
msgstr "Richtige Felder: {count} von {total}"
```

One placeholder is filled with *another entry from this file*: `{label}` in
`{label} is required.` and its two siblings receives a field name — *Name*,
*Issuer*, *Client ID* — each of which you translate separately. So word those
three so they read correctly with a bare noun dropped in, and check your wording
against the field names you chose.

Anything else in braces is [ICU
MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/).
The one you will meet is plurals, and you should state the categories **your**
language has, not the two English has:

```po
msgid "{count, plural, one {# attempt} other {# attempts}}"
msgstr "{count, plural, one {# Versuch} other {# Versuche}}"
```

`#` prints the number. For a language with `few`/`many` categories, add them.
There is exactly one plural entry in the catalog today; most counts are phrased
so the number is a bare value (*Correct cells: 3 of 8*) rather than inflecting a
noun, because some of that text is assembled in the browser where no plural rules
are available.

### The one trap

An apostrophe directly before `{` turns the braces into literal text. This is ICU
escaping, and it means the placeholder stops working:

```po
msgstr "Attendu '{token}'."     ✗  displays the characters {token}
msgstr "Attendu « {token} »."   ✓
```

The English side already does this — `Could not parse formula “{formula}”:
{detail}` uses typographic quotes for exactly this reason, and the German is
`Die Formel „{formula}“ konnte nicht gelesen werden: {detail}`.

Use your language's own quotation marks around a placeholder — `« »`, `„ “`,
`「 」` — rather than `'…'`. Apostrophes anywhere else (`aujourd'hui`) are fine.

## Names to leave alone

- **Carnap** — the product name.
- **LTI**, **LMS**, **Moodle**, **Canvas** — standards and product names, though
  translate the surrounding words (*LMS connection* → *LMS-Verbindung*).
- **Logical notation** — `/\`, `\/`, `->`, `~`, `|-`, `P`, `Q`, formulas, and rule
  names like `MP` or `∀I`. These are the subject matter, not prose.
- **Placeholder names** — `{count}`, not `{Anzahl}`.

## Consistency

Logic teaching has settled vocabulary, and it differs by country and textbook
tradition. Pick the terms your students' textbooks use and hold to them across
the file: *proof*, *premise*, *assumption*, *goal*, *rule*, *valid*,
*counterexample*, *truth table*, *assignment*, *submission*, *grade*. If your
language has more than one live convention, prefer the one used in the most
common introductory course, and note the choice in your Weblate glossary.

The existing German catalog (`de/messages.po`) is a worked example: *Kurs*,
*Aufgabe* (assignment), *Übung* (exercise), *Abgabe* (submission), *Beweis*
(proof), *Ziel* (goal), *Noten* (grades), *Lehrperson* (staff member).

Two of those pairs are worth flagging, because German got them wrong first and
the mistakes were invisible until two strings met on one screen. *Aufgabe* and
*Übung* are **not** interchangeable: *Aufgabe* is the assignment as a whole,
*Übung* is one exercise inside it, and using *Aufgabe* for an exercise told a
student whose single widget failed to load that the entire assignment was
broken. And *Abgabe* is the one word for a submission — an earlier catalog also
used *Einreichung*, and the two met as a heading and the empty state directly
beneath it. Decide these once for your language and grep the file.

## Adding a language

If your language has no directory yet, open an issue — a translator cannot add
one alone, because the tag also has to be registered in the code. It is a small,
purely mechanical change (four declarations, no logic; `docs/i18n.md` has the
recipe), so it is a quick thing to ask for, but it does have to be done by
someone who can commit code.

## For maintainers

See `docs/i18n.md` for the architecture, the extraction rules, and the tests.
After changing anything under `src/`, run `bun run i18n` and commit both the
`.po` and the generated `.ts`. Extraction runs with `--clean`, so an id no longer
passed to `i18n.t` is removed from every catalog, translation and all — a
reworded string loses its old translation rather than keeping a stale one under a
dead id.
