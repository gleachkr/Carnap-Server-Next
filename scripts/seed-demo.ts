/**
 * Seed one of the demo lessons in `tests/helpers` onto a running LOCAL dev
 * server (`bun run dev`), as a published practice assignment. Logs in as
 * the local site_admin, creates a course, authors the lesson as a content
 * revision, publishes it, and prints the URLs to open.
 *
 *   bun run dev                                  # in another terminal
 *   bun run scripts/seed-demo.ts showcase
 *
 * The demos, by name:
 *
 *   showcase         every exercise type, each beside the source that made it
 *   forallx          forallx: Calgary TFL, as Fitch proofs
 *   prawitz          forallx natural deduction, drawn as Prawitz trees
 *   gentzen          Gentzen's classical sequent calculus (LK), as trees
 *   gentzen-starter  LK with pre-populated trees, published into an existing
 *                    course (default the "Truth Tables demo"; see --course)
 *
 * Flags: --base=URL (default http://localhost:8787), --email=ADDR,
 * --course=SUBSTRING (publish into the existing course whose title contains
 * it, rather than a new one).
 *
 * For a lesson in a file, `seed-lesson.ts --file=…`.
 */
import { FORALLX_DEMO_SOURCE } from "../tests/helpers/forallx-demo";
import { GENTZEN_DEMO_SOURCE } from "../tests/helpers/gentzen-demo";
import { GENTZEN_STARTER_DEMO_SOURCE } from "../tests/helpers/gentzen-starter-demo";
import { PRAWITZ_DEMO_SOURCE } from "../tests/helpers/prawitz-demo";
import { SHOWCASE_DEMO_SOURCE } from "../tests/helpers/showcase-demo";
import {
  flag,
  type LessonSeed,
  LocalClient,
  seedLesson,
} from "./lib/local-client";

const DEMOS: Readonly<Record<string, LessonSeed>> = {
  forallx: {
    assignmentTitle: "Natural deduction practice",
    courseTitle: "Logic demo — forallx natural deduction",
    description: "Fitch-style proofs in the forallx: Calgary TFL system.",
    itemTitle: "forallx TFL — natural deduction",
    sourceText: FORALLX_DEMO_SOURCE,
  },
  gentzen: {
    assignmentTitle: "Sequent calculus practice",
    courseTitle: "Logic demo — Gentzen sequent calculus",
    description:
      "Tree-shaped proofs in Gentzen's classical sequent calculus (LK).",
    itemTitle: "Gentzen LK — sequent-calculus tree proofs",
    sourceText: GENTZEN_DEMO_SOURCE,
  },
  "gentzen-starter": {
    assignmentTitle: "Pre-populated sequent proofs (LK)",
    course: "Truth Tables demo",
    courseTitle: "Logic demo — Gentzen sequent calculus",
    description:
      "Pre-populated tree proofs in Gentzen's LK — worked examples, a scaffold, and a large double-cut proof.",
    itemTitle: "Gentzen LK — pre-populated sequent trees",
    sourceText: GENTZEN_STARTER_DEMO_SOURCE,
  },
  prawitz: {
    assignmentTitle: "Prawitz tree practice",
    courseTitle: "Logic demo — Prawitz trees",
    description:
      "Natural deduction drawn as Prawitz trees, from modus ponens to ∃E.",
    itemTitle: "forallx — Prawitz-style trees",
    sourceText: PRAWITZ_DEMO_SOURCE,
  },
  showcase: {
    assignmentTitle: "A tour of the exercise types",
    courseTitle: "Carnap demo course",
    description:
      "Every exercise type, each shown next to the source that produced it.",
    itemTitle: "A tour of the exercise types",
    sourceText: SHOWCASE_DEMO_SOURCE,
  },
};

const name = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const demo = name === undefined ? undefined : DEMOS[name];

if (demo === undefined) {
  throw new Error(
    `usage: seed-demo.ts <${Object.keys(DEMOS).sort().join("|")}> [--course=SUBSTRING]`,
  );
}

const COURSE = flag("--course", "");

await seedLesson(new LocalClient(), {
  ...demo,
  ...(COURSE.length === 0 ? {} : { course: COURSE }),
});
