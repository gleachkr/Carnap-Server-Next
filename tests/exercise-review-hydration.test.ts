import { beforeAll, describe, expect, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { createDefaultExerciseRegistry } from "../src/worker/application/content/registry";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import type { ExerciseHydration } from "../src/worker/exercise-kit/hydration";
import { EXERCISE_HYDRATION_VERSION } from "../src/worker/exercise-kit/hydration";
import { i18nFor } from "../src/worker/i18n";
import { SHOWCASE_DEMO_SOURCE } from "./helpers/showcase-demo";

/**
 * A read-only review is a *rendered widget*, not a picture of one: the Fitch
 * review really does upgrade and run client code, and the others may. So the
 * review markup has to carry the same hydration payload the answering path
 * carries — including `strings`, resolved for the viewer's locale.
 *
 * Nothing on the review path calls `t()` yet, which is exactly why this is
 * tested rather than observed: the first review-mode message would otherwise
 * render in English inside an otherwise translated page, silently.
 *
 * Which widgets are checked is the registry's answer, not a list here: every
 * type that declares `strings` is reviewed, over the showcase lesson (the one
 * document with an exercise of every kind), with a submitted answer from
 * `ANSWERS` below. A list once named four of them and left out the Prawitz
 * widget, whose review embeds a payload like the rest; a type this file has
 * no answer for now fails by name rather than going unlooked-at.
 *
 * Two reviews are drawn whole on the server and embed no payload at all —
 * the model's fields and the translation's formula are text, and their
 * elements do nothing in review mode. `SERVER_DRAWN` names them, so that a
 * new type is either checked here or declared inert, never merely missed.
 */

const REVIEW_LOCALE = "de";

const i18n = i18nFor(REVIEW_LOCALE);

const registry = createDefaultExerciseRegistry();

/** The widgets whose review carries strings: every type that declares them. */
const WITH_STRINGS = registry
  .types()
  .filter((type) => type.strings !== undefined);

/**
 * One submitted answer per kind — the least that renders. What is reviewed is
 * the payload around the answer, not the answer, so a proof of `ax` and an
 * empty table are enough.
 */
const ANSWERS: Readonly<Record<string, JsonValue>> = {
  "aufbau-proof@1": { proofText: "goal\n----\nax\n" },
  "aufbau-proof-fitch@1": { fitchText: "  P :ax\n", proofText: "" },
  "aufbau-proof-prawitz@1": {
    proofText: "",
    tree: { formula: "P", id: "n1", premises: [], rule: "AS" },
  },
  "aufbau-proof-tree@1": {
    proofText: "",
    tree: { formula: "P", hyp: 1, id: "n1", premises: [], rule: "" },
  },
  "model@1": { domain: "1", fields: {} },
  "translation@1": { text: "F(a)" },
  "truth-table@1": { cells: [], reference: [] },
};

/** The reviews that carry no payload because nothing in them runs. */
const SERVER_DRAWN: ReadonlySet<string> = new Set([
  "model@1",
  "translation@1",
]);

/** The one payload the review markup embeds for its element. */
function hydrationPayload(html: string): ExerciseHydration {
  const match =
    /<script type="application\/json" data-exercise-hydration>(.*?)<\/script>/s.exec(
      html,
    );

  if (match?.[1] === undefined) {
    throw new Error(`no hydration script in review markup: ${html}`);
  }

  return JSON.parse(match[1]) as ExerciseHydration;
}

let manifest: readonly ExerciseManifestItem[] = [];

beforeAll(async () => {
  const compiled = await compileCarnapMarkdown(SHOWCASE_DEMO_SOURCE);

  if (!compiled.ok) {
    throw new Error(
      `showcase failed to compile: ${compiled.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  manifest = compiled.artifact.manifest;
});

/** The review markup of `kind`'s first showcase exercise, over `ANSWERS`. */
function reviewOf(kind: string): string {
  const type = registry.typeFor(kind as ExerciseManifestItem["kind"]);
  const declaration = manifest.find((item) => item.kind === kind);
  const data = ANSWERS[kind];

  if (declaration === undefined) {
    throw new Error(`the showcase lesson has no ${kind} exercise`);
  }

  if (data === undefined) {
    throw new Error(`no answer fixture for ${kind}; add one to ANSWERS`);
  }

  const review = registry.reviewAnswer(
    declaration,
    { data, kind: type.answerKind, schemaVersion: type.schemaVersion },
    { audience: "instructor", i18n },
  );

  if (review.elementHtml === undefined) {
    throw new Error(`${kind} review renders no element`);
  }

  return review.elementHtml;
}

describe("review-mode hydration", () => {
  test("every widget with text is reviewed", () => {
    expect(WITH_STRINGS.map((type) => type.kind).sort()).toEqual(
      Object.keys(ANSWERS).sort(),
    );
  });

  for (const type of WITH_STRINGS) {
    const name = type.directiveName;

    if (SERVER_DRAWN.has(type.kind)) {
      test(`${name} review is drawn whole on the server`, () => {
        expect(reviewOf(type.kind)).not.toContain("data-exercise-hydration");
      });
      continue;
    }

    test(`${name} review carries a review-mode payload`, () => {
      const payload = hydrationPayload(reviewOf(type.kind));

      expect(payload.mode).toBe("review");
      expect(payload.version).toBe(EXERCISE_HYDRATION_VERSION);
      expect(payload.priorAnswer).toBeNull();
    });

    test(`${name} review carries its strings in the viewer's language`, () => {
      const payload = hydrationPayload(reviewOf(type.kind));
      const expected = type.strings?.(i18n) ?? {};

      expect(payload.strings).toEqual(expected);
      // The payload would also "match" if the locale silently fell back to
      // English, which is the failure this whole channel exists to prevent.
      expect(
        Object.entries(expected).filter(([id, text]) => text !== id).length,
      ).toBeGreaterThan(0);
    });
  }
});
