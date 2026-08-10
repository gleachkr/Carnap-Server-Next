import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Finding, runAxe } from "../tests/a11y/axe-runner";
import { collectFixtures } from "../tests/a11y/fixtures";

/**
 * Tier 1 accessibility inventory + baseline generator (see `docs/a11y.md`).
 *
 *   bun run a11y:report      → print the full current backlog, grouped by rule
 *   bun run a11y:baseline    → same, then rewrite tests/a11y/baseline.json
 *
 * The baseline is the ratchet the `bun test` gate diffs against: it records the
 * *known* violations as accepted-for-now so the gate fails only on NEW ones.
 * The file is meant to be read in diffs — a shrinking baseline is progress.
 */

export const BASELINE_PATH = join(
  import.meta.dir,
  "..",
  "tests",
  "a11y",
  "baseline.json",
);

export interface Baseline {
  readonly note: string;
  readonly findings: ReadonlyArray<{
    readonly fingerprint: string;
    readonly rule: string;
    readonly wcag: readonly string[];
    readonly fixture: string;
    readonly target: string;
  }>;
}

export async function collectFindings(): Promise<Finding[]> {
  const fixtures = await collectFixtures();
  const all: Finding[] = [];
  for (const fixture of fixtures) {
    all.push(...(await runAxe(fixture.html, fixture.name)));
  }
  all.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return all;
}

function printReport(findings: readonly Finding[]): void {
  const byRule = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = byRule.get(finding.rule) ?? [];
    bucket.push(finding);
    byRule.set(finding.rule, bucket);
  }

  console.log(`\nTier 1 a11y inventory — ${findings.length} finding(s)\n`);
  const rules = [...byRule.keys()].sort();
  for (const rule of rules) {
    const bucket = byRule.get(rule) ?? [];
    const wcag = [...new Set(bucket.flatMap((f) => f.wcag))].sort().join(", ");
    console.log(`■ ${rule}  (${bucket.length})  [${wcag}]`);
    for (const finding of bucket) {
      console.log(`    ${finding.fixture}: ${finding.target}`);
    }
  }
  console.log("");
}

function toBaseline(findings: readonly Finding[]): Baseline {
  return {
    findings: findings.map((f) => ({
      fingerprint: f.fingerprint,
      fixture: f.fixture,
      rule: f.rule,
      target: f.target,
      wcag: f.wcag,
    })),
    note:
      "Known Tier 1 accessibility violations, accepted-for-now. The bun test " +
      "gate fails on any finding whose fingerprint is absent here. Regenerate " +
      "with `bun run a11y:baseline`; a shrinking list is progress.",
  };
}

if (import.meta.main) {
  const update = process.argv.includes("--update");
  const findings = await collectFindings();
  printReport(findings);
  if (update) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(toBaseline(findings), null, 2)}\n`,
    );
    console.log(`Wrote ${findings.length} finding(s) to ${BASELINE_PATH}`);
  }
  // The shared Miniflare instance keeps the event loop alive, so exit
  // explicitly rather than hang after the report is printed.
  process.exit(0);
}
