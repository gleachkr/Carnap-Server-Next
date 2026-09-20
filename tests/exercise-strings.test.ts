import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { createDefaultExerciseRegistry } from "../src/worker/application/content/registry";
import { exerciseHydrationForArtifact } from "../src/worker/application/content/renderer";
import { buildExerciseHelpStrings } from "../src/worker/exercise-kit/help-strings";
import { buildProofEngineStrings } from "../src/worker/exercise-kit/proof/engine-strings";
import {
  buildAufbauProofFitchStrings,
  FITCH_DIAGNOSTIC_MESSAGES,
} from "../src/worker/exercises/aufbau-proof-fitch/strings";
import { TRUTH_TABLE_COMPONENT_METADATA } from "../src/worker/exercises/truth-table/types";
import { DEFAULT_LOCALE, i18nFor } from "../src/worker/i18n";
import {
  passthroughTranslator,
  type Translator,
} from "../src/worker/i18n/translator";

/**
 * Widget strings cross a boundary no type can check by itself: the server fills
 * a map, the browser looks ids up in it. These tests pin the two properties that
 * make that safe — every id is its own English text (so a miss degrades to
 * English rather than to a key), and the map actually reaches the payload.
 */

/**
 * Every type whose element shows text, asked of the registry rather than
 * listed here: a list once named five builders and omitted the two heaviest
 * `placeholders(...)` users, so a missing placeholder in the model or
 * translation widget was exactly the mistake nothing caught.
 */
const WITH_STRINGS = createDefaultExerciseRegistry()
  .types()
  .filter((type) => type.strings !== undefined);

/** The widgets that offer usage instructions behind a `(?)` in their toolbar. */
const HELP_KINDS: readonly string[] = [
  "aufbau-proof-prawitz",
  "aufbau-proof-tree",
];

describe("widget string maps", () => {
  test("every widget with text is covered", () => {
    expect(WITH_STRINGS.map((type) => type.directiveName).sort()).toEqual([
      "aufbau-proof",
      "aufbau-proof-fitch",
      "aufbau-proof-prawitz",
      "aufbau-proof-tree",
      "model",
      "translation",
      "truth-table",
    ]);
  });

  // The client's fallback is `strings[id] ?? id`, which only reads as English if
  // each id *is* the English text it stands for. A disambiguated id
  // ("Delete (proof line)") must therefore be paired with an explicit
  // `message:`, and this is what catches forgetting it.
  //
  // Run against the real English catalog, not only the passthrough: `i18n.t` does
  // not hand back a template, it *formats* one, and an argument it was not given
  // formats as the empty string. A message the browser fills therefore has to
  // pass `placeholders(...)` or it arrives with its `{slots}` already eaten —
  // which the passthrough, having no formatter, cannot show. Comparing against
  // the id catches both mistakes at once.
  for (const type of WITH_STRINGS) {
    for (const i18n of [passthroughTranslator, i18nFor(DEFAULT_LOCALE)]) {
      test(`${type.directiveName} ids are their own English text`, () => {
        for (const [id, text] of Object.entries(type.strings?.(i18n) ?? {})) {
          expect(text, id).toBe(id);
        }
      });
    }
  }

  // The `(?)` dialog is built from strings the *element* looks up, so a widget
  // that spreads the shared instructions but drops the frame around them would
  // render a panel with an untranslated close button and no heading — and no
  // type error, since the ids would simply be absent from its union.
  for (const type of WITH_STRINGS) {
    const name = type.directiveName;
    const offersHelp = HELP_KINDS.includes(name);
    test(`${name} ${offersHelp ? "carries" : "does not carry"} the shared help-dialog frame`, () => {
      const strings = type.strings?.(passthroughTranslator) ?? {};

      for (const id of Object.keys(
        buildExerciseHelpStrings(passthroughTranslator),
      )) {
        expect(Object.hasOwn(strings, id), `${name}: ${id}`).toBe(offersHelp);
      }
    });
  }

  // The client's shared proof pipeline (`components/proof-element.ts`) widens
  // each proof widget's `t` to the engine set, so a proof type's `strings.ts`
  // could drop the spread without a type error — and its widget would then
  // say "Could not load the proof engine." in English in every locale.
  for (const type of WITH_STRINGS) {
    const name = type.directiveName;
    if (!name.startsWith("aufbau-proof")) {
      continue;
    }
    test(`${name} carries the shared proof-engine set`, () => {
      const strings = type.strings?.(passthroughTranslator) ?? {};

      for (const id of Object.keys(
        buildProofEngineStrings(passthroughTranslator),
      )) {
        expect(Object.hasOwn(strings, id), `${name}: ${id}`).toBe(true);
      }
    });
  }

  test("every Fitch diagnostic code resolves to a string the payload carries", () => {
    const strings = buildAufbauProofFitchStrings(passthroughTranslator);

    for (const [code, id] of Object.entries(FITCH_DIAGNOSTIC_MESSAGES)) {
      expect(Object.hasOwn(strings, id)).toBe(true);
      expect(id, `prose for ${code}`).not.toBe("");
    }
  });
});

const exerciseStrings = (
  assetId: string,
  i18n: Translator,
): Readonly<Record<string, string>> =>
  createDefaultExerciseRegistry().strings(assetId, i18n);

describe("exerciseStrings", () => {
  test("resolves a widget's text in the viewer's language", () => {
    const strings = exerciseStrings(
      TRUTH_TABLE_COMPONENT_METADATA.assetId,
      i18nFor("de"),
    );

    expect(strings.Check).toBe("Prüfen");
    expect(strings["All cells correct."]).toBe("Alle Felder richtig.");
  });

  test("covers every widget whose element shows text", () => {
    for (const type of WITH_STRINGS) {
      const strings = exerciseStrings(type.component.assetId, i18nFor("de"));

      expect(
        Object.keys(strings).length,
        `strings for ${type.component.assetId}`,
      ).toBeGreaterThan(0);
    }
  });

  // A type with no interactive text, and an id no widget claims, both resolve to
  // an empty map rather than throwing: the lookup is meant to be total.
  test("is empty for a type with no widget text", () => {
    expect(exerciseStrings("carnap-free-response-v1", i18nFor("de"))).toEqual(
      {},
    );
    expect(exerciseStrings("nothing-claims-this", i18nFor("de"))).toEqual({});
  });
});

describe("hydration payload", () => {
  test("carries the widget's translated strings to the browser", async () => {
    const compiled = await compileCarnapMarkdown(
      "::::truth-table{#tt1 points=1}\n- (P -> P)\n::::",
    );

    if (!compiled.ok) {
      throw new Error(
        `compile failed: ${compiled.diagnostics.map((d) => d.code).join(", ")}`,
      );
    }

    const table = exerciseHydrationForArtifact(
      compiled.artifact,
      i18nFor("de"),
    );

    expect(table.tt1?.strings.Check).toBe("Prüfen");
  });

  test("degrades to English on the preview path, which has no catalog", async () => {
    const compiled = await compileCarnapMarkdown(
      "::::truth-table{#tt1 points=1}\n- (P -> P)\n::::",
    );

    if (!compiled.ok) {
      throw new Error("compile failed");
    }

    const table = exerciseHydrationForArtifact(
      compiled.artifact,
      passthroughTranslator,
    );

    expect(table.tt1?.strings.Check).toBe("Check");
  });
});
