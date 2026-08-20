import { describe, expect, test } from "bun:test";
import type { CompilerDiagnostic } from "../src/worker/application/content/authoring-toolkit";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { buildDiagnosticStrings } from "../src/worker/application/content/diagnostic-strings";
import { badRequest } from "../src/worker/application/errors";
import { DEFAULT_LOCALE, i18nFor } from "../src/worker/i18n";
import {
  passthroughTranslator,
  resolveMessage,
  stringsResolver,
  translateMessage,
} from "../src/worker/i18n/translator";

/**
 * Compiler diagnostics are worded twice over: by the Worker when it re-renders
 * the editor after a failed save, and by the preview bundle in the author's
 * browser, which has no catalog and reads a map the server resolved. Both go
 * through the same ids, so these tests pin that the ids are complete (every
 * sentence the compiler can emit is one the catalog covers) and that they still
 * read as English when nothing translates them.
 */

/** Sources that are wrong in one specific way each. */
const BROKEN_SOURCES: readonly (readonly [string, string])[] = [
  ["missing attribute", "::::truth-table{points=1}\n- P\n::::"],
  ["bad points", "::::truth-table{#t points=nope}\n- P\n::::"],
  ["unparsable formula", "::::truth-table{#t points=1}\n- (P /\\\n::::"],
  [
    "unknown option",
    "::::truth-table{#t points=1 options=nonsense}\n- P\n::::",
  ],
  ["no formulas", "::::truth-table{#t points=1}\n::::"],
  [
    "too many atoms",
    `::::truth-table{#t points=1}\n- ${Array.from(
      { length: 13 },
      (_unused, index) => `P${String(index)}`,
    ).join(" /\\ ")}\n::::`,
  ],
  ["bad exercise id", '::::truth-table{id="bad id" points=1}\n- P\n::::'],
  [
    "duplicate exercise id",
    "::::truth-table{#t points=1}\n- P\n::::\n\n::::truth-table{#t points=1}\n- Q\n::::",
  ],
  [
    "one multiple-choice option",
    "::::multiple-choice{#m points=1}\nPick one.\n\n- [x] a. Only\n::::",
  ],
  ["unknown directive", "::::carnap-nonexistent{#x}\n::::"],
  ["raw html", "<script>alert(1)</script>\n"],
  ["bad item link", "[a link](item:not valid)\n"],
  [
    "unknown theory",
    "::::aufbau-proof{#p points=1 theory=absent}\ntheorem t: $ P $\n----\n::::",
  ],
  [
    "missing goal header",
    "::::aufbau-proof{#p points=1}\nno header here\n::::",
  ],
];

async function diagnosticsFor(source: string) {
  const compiled = await compileCarnapMarkdown(source);

  return compiled.diagnostics;
}

async function firstDiagnostic(source: string): Promise<CompilerDiagnostic> {
  const [first] = await diagnosticsFor(source);

  if (first === undefined) {
    throw new Error(`expected a diagnostic for: ${source}`);
  }

  return first;
}

describe("compiler diagnostic strings", () => {
  // The same gate the widget strings have, for the same two reasons: an id that
  // does not equal its own English text degrades to something other than
  // English, and `i18n.t` eats any placeholder it was not handed a value for —
  // which only shows against the real English catalog, not the passthrough.
  for (const i18n of [passthroughTranslator, i18nFor(DEFAULT_LOCALE)]) {
    test("every id is its own English text", () => {
      for (const [id, text] of Object.entries(buildDiagnosticStrings(i18n))) {
        expect(text).toBe(id);
      }
    });
  }

  test("the map covers every sentence the compiler actually emits", async () => {
    const strings = buildDiagnosticStrings(passthroughTranslator);
    let seen = 0;

    for (const [name, source] of BROKEN_SOURCES) {
      const diagnostics = await diagnosticsFor(source);

      expect(
        diagnostics.length,
        `${name} should not compile`,
      ).toBeGreaterThan(0);

      for (const diagnostic of diagnostics) {
        seen += 1;
        expect(
          Object.hasOwn(strings, diagnostic.message),
          `${name}: unlisted message ${JSON.stringify(diagnostic.message)}`,
        ).toBe(true);
      }
    }

    expect(seen).toBeGreaterThan(BROKEN_SOURCES.length - 1);
  });

  test("no resolved diagnostic leaves a placeholder unfilled", async () => {
    for (const [name, source] of BROKEN_SOURCES) {
      for (const diagnostic of await diagnosticsFor(source)) {
        const english = resolveMessage(diagnostic);

        expect(english, `${name}: ${diagnostic.code}`).not.toContain("{");
        expect(english.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("wording a diagnostic", () => {
  test("English is the sentence the compiler used to build itself", async () => {
    const diagnostic = await firstDiagnostic(
      "::::truth-table{points=1}\n- P\n::::",
    );

    expect(diagnostic.code).toBe("missing_id");
    expect(resolveMessage(diagnostic)).toBe("The id attribute is required.");
  });

  test("the viewer's catalog words it, placeholders and all", async () => {
    const diagnostic = await firstDiagnostic(
      "::::truth-table{#t points=1 options=nonsense}\n- P\n::::",
    );

    expect(diagnostic.code).toBe("unknown_truth_table_option");
    expect(translateMessage(diagnostic, i18nFor("de"))).toBe(
      "Unbekannte Wahrheitstafel-Option „nonsense“.",
    );
  });

  // The formula parser's own complaint is nested inside the compiler's, so both
  // layers have to come out translated — an English island inside a German
  // sentence is the failure this guards.
  test("a nested sub-parser message is translated too", async () => {
    const diagnostic = await firstDiagnostic(
      "::::truth-table{#t points=1}\n- (P /\\\n::::",
    );

    expect(diagnostic.code).toBe("invalid_formula");

    const german = translateMessage(diagnostic, i18nFor("de"));

    expect(german).toContain("Die Formel");
    expect(german).toContain("Formel erwartet.");
    expect(german).not.toContain("Could not parse");
    expect(german).not.toContain("Expected");
  });

  test("the browser resolves the same ids from a strings map", async () => {
    const diagnostic = await firstDiagnostic(
      "::::truth-table{#t points=1 options=nonsense}\n- P\n::::",
    );
    const strings = buildDiagnosticStrings(i18nFor("de"));

    expect(resolveMessage(diagnostic, stringsResolver(strings))).toBe(
      "Unbekannte Wahrheitstafel-Option „nonsense“.",
    );
  });

  test("a map with no entry for the id falls back to English", async () => {
    const diagnostic = await firstDiagnostic(
      "::::truth-table{#t points=1 options=nonsense}\n- P\n::::",
    );

    expect(resolveMessage(diagnostic, stringsResolver({}))).toBe(
      "Unknown truth-table option “nonsense”.",
    );
  });
});

describe("AppHttpError.localize", () => {
  test("words a translatable message for the viewer", async () => {
    const diagnostic = await firstDiagnostic(
      "::::truth-table{#t points=1 options=nonsense}\n- P\n::::",
    );
    const error = badRequest(diagnostic.code, diagnostic);

    // Thrown as a message, but `Error.message` is still the English sentence:
    // that is what keeps the JSON envelope and the logs indifferent to this.
    expect(error.message).toBe("Unknown truth-table option “nonsense”.");
    expect(error.localize(i18nFor("de"))).toBe(
      "Unbekannte Wahrheitstafel-Option „nonsense“.",
    );
  });

  // The seam is opt-in: the several hundred validator messages that are still
  // plain English literals must keep rendering exactly as they do now.
  test("leaves an error with no translatable message alone", () => {
    const error = badRequest("invalid_json", "A JSON object is required.");

    expect(error.localize(i18nFor("de"))).toBe("A JSON object is required.");
  });
});
