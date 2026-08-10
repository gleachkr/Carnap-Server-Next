import { describe, expect, test } from "bun:test";

import {
  badRequest,
  forbidden,
  unauthorized,
} from "../src/worker/application/errors";
import { i18nFor } from "../src/worker/i18n";
import { deferred } from "../src/worker/i18n/deferred";

/**
 * Every error a reader can be shown has to carry its message as a catalog id, and
 * the only thing that can tell you it does is the source: a plain English literal
 * type-checks, serves the JSON envelope correctly, renders correctly in English,
 * and is invisible to `lingui extract`. There is nothing to observe at runtime —
 * `localize` on an untranslatable error returns exactly what a translated one
 * returns when the reader's locale is `en`.
 *
 * So this reads the files. The rule it enforces is deliberately blunter than
 * "must be translatable": no *string literal* may be an error message, within the
 * scope given per constructor below. A literal there is the one mistake this class
 * of bug is made of; whether the non-literal that replaces it is genuinely a
 * `TranslatableMessage` is tsc's job, not this test's.
 */

/** Which argument of each error constructor is the message. */
const MESSAGE_ARGUMENT: Readonly<Record<string, number>> = {
  // new AppHttpError(status, code, message)
  AppHttpError: 2,
  // badRequest(code, message)
  badRequest: 1,
  // new LtiLaunchError(code, message, logContext)
  LtiLaunchError: 1,
};

/**
 * Where each constructor is checked.
 *
 * `LtiLaunchError` is checked everywhere, not only in the service layer, because
 * the class exists for exactly one purpose: `renderLtiError` puts its words on the
 * launch-failure page. There is no such thing as a `LtiLaunchError` a reader
 * cannot meet, so `src/worker/routes/lti.ts` — which raises eight of them — gets
 * no exemption, unlike the JSON-shape validators in its sibling route files.
 */
const SCOPES: Readonly<Record<string, string>> = {
  AppHttpError: "src/worker/application/**/*.ts",
  badRequest: "src/worker/application/**/*.ts",
  LtiLaunchError: "src/worker/**/*.ts",
};

/** Split a call's argument list at top-level commas. */
function splitArguments(source: string, openParen: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = openParen + 1;
  let quote: string | null = null;

  for (let at = openParen; at < source.length; at += 1) {
    const character = source[at];

    if (quote !== null) {
      if (character === "\\") {
        at += 1;
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;

      if (depth === 0) {
        args.push(source.slice(start, at));

        return args;
      }
    } else if (character === "," && depth === 1) {
      args.push(source.slice(start, at));
      start = at + 1;
    }
  }

  return args;
}

interface Literal {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function literalMessages(
  file: string,
  source: string,
  callees: readonly string[],
): Literal[] {
  const found: Literal[] = [];

  for (const callee of callees) {
    const position = MESSAGE_ARGUMENT[callee] ?? 0;
    const calls = new RegExp(`\\b${callee}\\s*\\(`, "g");

    for (const match of source.matchAll(calls)) {
      const openParen = match.index + match[0].length - 1;
      const argument = splitArguments(source, openParen)[position]?.trim();

      if (argument === undefined) {
        continue;
      }

      if (/^["'`]/.test(argument)) {
        found.push({
          file,
          line: source.slice(0, match.index).split("\n").length,
          text: argument.split("\n")[0] ?? argument,
        });
      }
    }
  }

  return found;
}

describe("error messages a reader can be shown", () => {
  test("none of them is a bare literal", async () => {
    /** Which constructors to check in a given file, by that file's scope. */
    const byFile = new Map<string, string[]>();

    for (const [callee, glob] of Object.entries(SCOPES)) {
      for (const file of new Bun.Glob(glob).scanSync()) {
        byFile.set(file, [...(byFile.get(file) ?? []), callee]);
      }
    }

    const offenders: Literal[] = [];
    let checked = 0;

    for (const file of [...byFile.keys()].sort()) {
      const source = await Bun.file(file).text();
      const callees = byFile.get(file) ?? [];

      for (const callee of callees) {
        checked += (
          source.match(new RegExp(`\\b${callee}\\s*\\(`, "g")) ?? []
        ).length;
      }

      offenders.push(...literalMessages(file, source, callees));
    }

    // The gate has to be able to fail, which means it has to be looking at
    // something: the sweep converted around 170 of these.
    expect(checked).toBeGreaterThan(140);
    expect(offenders).toEqual([]);
  });
});

describe("AppHttpError.localize", () => {
  test("words a deferred message for the viewer", () => {
    const error = badRequest(
      "invalid_course_title",
      deferred.i18n.t("The course was not found."),
    );

    // English is what `Error.message` carries, whatever the reader's locale.
    expect(error.message).toBe("The course was not found.");
    expect(error.localize(i18nFor("de"))).toBe(
      "Der Kurs wurde nicht gefunden.",
    );
  });

  test("fills a deferred message's placeholders", () => {
    const error = badRequest(
      "invalid_kind",
      deferred.i18n.t("Exercise kind {kind} is not supported.", {
        kind: "runes",
      }),
    );

    expect(error.message).toBe("Exercise kind runes is not supported.");
  });

  // The two sentences a reader meets most often, so they are worth pinning
  // rather than trusting to the sweep.
  test("the two shared refusals are translatable", () => {
    expect(forbidden().localize(i18nFor("de"))).not.toBe(
      "You are not allowed to do that.",
    );
    expect(unauthorized().localize(i18nFor("de"))).not.toBe(
      "Authentication is required.",
    );
  });
});
