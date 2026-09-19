/**
 * Seed *any* carnap-markdown file onto a running LOCAL dev server (`bun run
 * dev`): the quickest way to put a hand-written lesson in front of the real
 * editors and check an authoring change end to end. Logs in as the local
 * site_admin, creates a course (or finds one), authors the file as a content
 * revision, and publishes it as a practice assignment.
 *
 *   bun run dev                                        # in another terminal
 *   bun run scripts/seed-lesson.ts --file=path/to/lesson.md
 *
 * Flags: --file=PATH (required), --title=TEXT, --course=SUBSTRING (publish
 * into the existing course whose title contains it), --base=URL (default
 * http://localhost:8787), --email=ADDR.
 *
 * The lessons that live in `tests/helpers` are seeded by `seed-demo.ts`.
 */
import { flag, LocalClient, seedLesson } from "./lib/local-client";

const FILE = flag("--file", "");

if (FILE.length === 0) {
  throw new Error(
    "usage: seed-lesson.ts --file=path/to/lesson.md [--title=…]",
  );
}

const TITLE = flag("--title", FILE.split("/").at(-1) ?? FILE);
const COURSE = flag("--course", "");

await seedLesson(new LocalClient(), {
  assignmentTitle: TITLE,
  ...(COURSE.length === 0 ? {} : { course: COURSE }),
  courseTitle: `Demo — ${TITLE}`,
  description: `Seeded from ${FILE}.`,
  itemTitle: TITLE,
  sourceText: await Bun.file(FILE).text(),
});
