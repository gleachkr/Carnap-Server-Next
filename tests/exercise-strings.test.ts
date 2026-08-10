import { describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { exerciseHydrationForArtifact } from "../src/worker/application/content/renderer";
import { buildAufbauProofStrings } from "../src/worker/exercises/aufbau-proof/strings";
import { AUFBAU_PROOF_COMPONENT_METADATA } from "../src/worker/exercises/aufbau-proof/types";
import {
  buildAufbauProofFitchStrings,
  FITCH_DIAGNOSTIC_MESSAGES,
} from "../src/worker/exercises/aufbau-proof-fitch/strings";
import { AUFBAU_PROOF_FITCH_COMPONENT_METADATA } from "../src/worker/exercises/aufbau-proof-fitch/types";
import { buildAufbauProofPrawitzStrings } from "../src/worker/exercises/aufbau-proof-prawitz/strings";
import { AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA } from "../src/worker/exercises/aufbau-proof-prawitz/types";
import { buildAufbauProofTreeStrings } from "../src/worker/exercises/aufbau-proof-tree/strings";
import { AUFBAU_PROOF_TREE_COMPONENT_METADATA } from "../src/worker/exercises/aufbau-proof-tree/types";
import { buildExerciseHelpStrings } from "../src/worker/exercises/help-strings";
import { exerciseStrings } from "../src/worker/exercises/strings";
import { buildTruthTableStrings } from "../src/worker/exercises/truth-table/strings";
import { TRUTH_TABLE_COMPONENT_METADATA } from "../src/worker/exercises/truth-table/types";
import { DEFAULT_LOCALE, i18nFor } from "../src/worker/i18n";
import { passthroughTranslator } from "../src/worker/i18n/translator";

/**
 * Widget strings cross a boundary no type can check by itself: the server fills
 * a map, the browser looks ids up in it. These tests pin the two properties that
 * make that safe — every id is its own English text (so a miss degrades to
 * English rather than to a key), and the map actually reaches the payload.
 */

const BUILDERS = [
  ["aufbau-proof", buildAufbauProofStrings],
  ["aufbau-proof-fitch", buildAufbauProofFitchStrings],
  ["aufbau-proof-prawitz", buildAufbauProofPrawitzStrings],
  ["aufbau-proof-tree", buildAufbauProofTreeStrings],
  ["truth-table", buildTruthTableStrings],
] as const;

/** The widgets that offer usage instructions behind a `(?)` in their toolbar. */
const HELP_BUILDERS = [
  ["aufbau-proof-prawitz", buildAufbauProofPrawitzStrings],
  ["aufbau-proof-tree", buildAufbauProofTreeStrings],
] as const;

describe("widget string maps", () => {
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
  for (const [name, build] of BUILDERS) {
    for (const i18n of [passthroughTranslator, i18nFor(DEFAULT_LOCALE)]) {
      test(`${name} ids are their own English text`, () => {
        for (const [id, text] of Object.entries(build(i18n))) {
          expect(text).toBe(id);
        }
      });
    }
  }

  // The `(?)` dialog is built from strings the *element* looks up, so a widget
  // that spreads the shared instructions but drops the frame around them would
  // render a panel with an untranslated close button and no heading — and no
  // type error, since the ids would simply be absent from its union.
  for (const [name, build] of HELP_BUILDERS) {
    test(`${name} carries the shared help-dialog frame`, () => {
      const strings = build(passthroughTranslator);

      for (const id of Object.keys(
        buildExerciseHelpStrings(passthroughTranslator),
      )) {
        expect(Object.hasOwn(strings, id), `${name} is missing ${id}`).toBe(
          true,
        );
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
    for (const metadata of [
      AUFBAU_PROOF_COMPONENT_METADATA,
      AUFBAU_PROOF_FITCH_COMPONENT_METADATA,
      AUFBAU_PROOF_PRAWITZ_COMPONENT_METADATA,
      AUFBAU_PROOF_TREE_COMPONENT_METADATA,
      TRUTH_TABLE_COMPONENT_METADATA,
    ]) {
      const strings = exerciseStrings(metadata.assetId, i18nFor("de"));

      expect(
        Object.keys(strings).length,
        `strings for ${metadata.assetId}`,
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
