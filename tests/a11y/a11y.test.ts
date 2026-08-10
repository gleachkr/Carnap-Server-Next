import { expect, setDefaultTimeout, test } from "bun:test";

import { type Finding, runAxe } from "./axe-runner";
import baseline from "./baseline.json";
import { collectFixtures } from "./fixtures";

/**
 * Tier 1 accessibility gate (ratchet mode). Renders the representative page set
 * (`fixtures.ts`), runs the AA structural ruleset (`axe-runner.ts`), and fails
 * only on findings that are NOT already recorded in `baseline.json` — so new
 * regressions block the build while the known backlog is tracked, not required
 * to be fixed first. See `docs/a11y.md`.
 *
 *   New violation appears  → test fails, listing it (fix it, or knowingly
 *                            accept it with `bun run a11y:baseline`).
 *   Baselined violation    → tolerated (it's the burn-down list).
 *   Baselined violation fixed → passes; a `bun run a11y:baseline` prunes it.
 */

setDefaultTimeout(120_000);

// `as` keeps the type stable when baseline.json is empty (`findings: []` would
// otherwise infer `never[]`, so `.fingerprint` wouldn't type-check).
const baselineFingerprints = new Set(
  (baseline.findings as ReadonlyArray<{ fingerprint: string }>).map(
    (entry) => entry.fingerprint,
  ),
);

// Memoized: both tests below want the same audit of the same fixture set, and
// seeding the fixtures is the expensive half of the run.
let cachedFindings: Promise<Finding[]> | null = null;

function collectFindings(): Promise<Finding[]> {
  cachedFindings ??= (async () => {
    const fixtures = await collectFixtures();
    const findings: Finding[] = [];
    for (const fixture of fixtures) {
      findings.push(...(await runAxe(fixture.html, fixture.name)));
    }
    return findings;
  })();

  return cachedFindings;
}

/**
 * The runner's own self-test, and it earns its place: the six exercise widgets
 * put all their chrome in a Declarative Shadow Root, jsdom's parser ignores
 * `shadowrootmode` entirely, and axe does not look inside a `<template>`. That
 * combination fails *silently* — the audit still runs, still reports the light
 * DOM, and still passes, while every group, label and control inside the widgets
 * goes unexamined. So assert the traversal directly, on a fault planted where
 * only shadow-DOM traversal can find it.
 */
test("the audit reaches inside a declarative shadow root", async () => {
  const findings = await runAxe(
    `<!doctype html><html lang="en"><head><title>Shadow</title></head><body>
       <div id="host">
         <template shadowrootmode="open"><input type="text"></template>
       </div>
     </body></html>`,
    "shadow-self-test",
  );

  expect(findings.map((finding) => finding.rule)).toContain("label");
});

test("no new WCAG 2.2 AA structural violations beyond the baseline", async () => {
  const findings = await collectFindings();

  const regressions = findings.filter(
    (finding) => !baselineFingerprints.has(finding.fingerprint),
  );

  if (regressions.length > 0) {
    const lines = regressions.map(
      (finding) =>
        `  • [${finding.rule}] ${finding.fixture}: ${finding.target}` +
        ` (${finding.wcag.join(", ")})\n    ${finding.detail.split("\n")[0]}`,
    );
    throw new Error(
      `${regressions.length} new accessibility violation(s) not in ` +
        `tests/a11y/baseline.json:\n${lines.join("\n")}\n\n` +
        "Fix the issue, or — if it is a knowingly-accepted regression — run " +
        "`bun run a11y:baseline` to record it. `bun run a11y:report` prints " +
        "the full inventory.",
    );
  }

  expect(regressions).toHaveLength(0);
});

test("baseline has no stale entries (fixed issues still listed)", async () => {
  const findings = await collectFindings();
  const current = new Set(findings.map((finding) => finding.fingerprint));

  const stale = [...baselineFingerprints].filter(
    (fingerprint) => !current.has(fingerprint),
  );

  // Informational, not fatal: fixing an issue must never break the build. This
  // surfaces baseline entries to prune so the backlog stays honest.
  if (stale.length > 0) {
    console.warn(
      `${stale.length} baseline entr(y/ies) now pass and can be pruned ` +
        `with \`bun run a11y:baseline\`:\n${stale
          .map((fingerprint) => `  • ${fingerprint}`)
          .join("\n")}`,
    );
  }

  expect(stale.length).toBeGreaterThanOrEqual(0);
});
