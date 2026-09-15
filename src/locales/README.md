# Translating Carnap

This directory contains Carnap's interface translations. Each language has a
standard gettext PO file at `<tag>/messages.po`. Edit it with Weblate,
Poedit, Lokalize, or a text editor. Do not edit the generated `messages.ts`
next to it.

## Reading entries

The `msgid` is normally the English text:

```po
#: src/worker/web/courses.tsx
msgid "Archive course"
msgstr ""
```

An empty `msgstr` falls back to English, so partial translations are usable.
Leave an entry untranslated if you are unsure of its meaning.

Source comments (`#:`) identify where a message is used. Common sources:

- `assignment-detail.tsx`: student assignments and instructor review.
- `courses.tsx`: courses, rosters, staff, enrollment, and archiving.
- `diagnostic-strings.ts`: compiler errors shown to lesson authors.
- `admin.tsx` and `admin-lti.tsx`: administration and LMS registration.
- `content.tsx`: authoring tools.
- `labels.ts`: shared statuses, roles, and other short labels.
- `application/*.ts`: errors shown beside forms or on error pages, including
  failures when launching from an LMS.
- Exercise directories: instructions and feedback shown while working.
- `resend.ts`: email messages.

Read developer comments (`#.`) before translating. They can explain:

- **Disambiguating IDs.** `Open (assignment availability)` displays only
  `Open`. The parenthetical distinguishes it from another use of the word
  and must not appear in the translation.
- **Placement.** A fragment such as `automatic` or `manual` may follow a score
  mid-line. Choose capitalization and grammar for that position.
- **Partly translatable examples.** In `person@example.edu`, translate the
  local part if appropriate, but retain the documentation domain.

## Placeholders

Preserve every placeholder exactly, including its name. Move it as required
by your language's word order:

```po
msgid "Correct cells: {count} of {total}"
msgstr "Richtige Felder: {count} von {total}"
```

Some placeholders contain translated field labels. For example, `{label}` in
`{label} is required.` receives a label such as Name, Issuer, or Client ID.
Check that the sentence works with the separately translated labels.

Messages can also contain [ICU MessageFormat][icu] expressions. For plurals,
use your language's categories rather than copying English's categories:

```po
msgid "{count, plural, one {# attempt} other {# attempts}}"
msgstr "{count, plural, one {# Versuch} other {# Versuche}}"
```

`#` prints the number. Add categories such as `few` and `many` where needed.
Many counts use a bare value, as in "Correct cells: 3 of 8", because browser
messages do not have ICU plural selection available.

### Apostrophes and quoting

An ASCII apostrophe immediately before a brace starts an ICU escape and can
prevent substitution. This translation displays literal `{token}`:

```po
msgstr "Attendu '{token}'."
```

Use your language's quotation marks instead:

```po
msgstr "Attendu « {token} »."
```

Typographic quotes such as `« »`, `„ “`, and `「 」` are safe around
placeholders. Ordinary apostrophes in words such as `aujourd'hui` are safe.

## Names and notation to preserve

- Carnap, LTI, LMS, Moodle, and Canvas. Translate surrounding text, not
  standard or product names.
- Logical notation, formulas, and rule names, such as `∧`, `→`, `P`, `MP`,
  and `∀I`.
- Placeholder names: keep `{count}`, not `{Anzahl}`.

## Terminology

Use the terminology of the course's textbooks consistently. Important terms
include proof, premise, assumption, goal, rule, valid, counterexample, truth
table, assignment, submission, and grade. If several conventions are common,
record the chosen one in the translation glossary.

The German catalog uses:

- `Kurs`: course;
- `Aufgabe`: an assignment as a whole;
- `Übung`: an exercise within an assignment;
- `Abgabe`: submission;
- `Beweis`: proof;
- `Ziel`: goal;
- `Noten`: grades;
- `Lehrperson`: staff member.

Keep assignment and exercise distinct: an exercise-load error must not imply
that the entire assignment failed. Use one term for submission throughout
headings, messages, and empty states. Search the catalog to check consistency.

## Adding a language

A new language also needs registration in code. Ask a maintainer or follow
[the developer guide][developer-guide] if you are making that change yourself.
Creating a PO directory alone does not make the language selectable.

## For maintainers

See [the developer guide][developer-guide] for extraction and tests. After
changing translatable source text or PO translations, run `bun run i18n`
inside `nix develop` and include both the PO and generated TypeScript files.

Extraction uses `--clean`: removing or changing a source ID removes its old
catalog entry and translation. Review that diff rather than assuming a
reworded message will retain its translation.

[icu]: https://unicode-org.github.io/icu/userguide/format_parse/messages/
[developer-guide]: ../../docs/i18n.md
