/**
 * Re-author the LTI acceptance fixture's content on a running LOCAL dev server
 * (`bun run dev`), through the product's own endpoints.
 *
 * The fixture this repairs was originally inserted as hand-written SQL, which
 * is how it came to hold `{"blocks":[],"exercises":[]}` — an artifact shape the
 * compiler stopped emitting long before anyone noticed, because nothing reads a
 * revision's artifact until a student has an attempt open. The 500 it caused
 * was therefore invisible to every acceptance run that stopped at the
 * "Before you start" page.
 *
 * The point of this script is less the repair than the mechanism: the source
 * below is compiled by the running server, so the artifact is whatever the
 * current compiler emits and cannot drift from the current schema. Nothing here
 * writes a row directly. Re-running it after a schema change is what keeps the
 * fixture honest.
 *
 *   bun run dev                                        # in another terminal
 *   bun run scripts/seed-lti-fixture.ts --course=<id> --assignment=<id>
 *
 * Flags: --course=ID and --assignment=ID (both required — the acceptance course
 * is created by the first teacher launch, so its id is only knowable at the
 * time you run this), --fixture=homework1|ags, --item=ID, --base=URL (default
 * http://localhost:8787), --email=ADDR.
 *
 * `--fixture` picks which lesson to author, and the only thing separating the
 * two is what they are worth. A Carnap assignment's nominal total is the
 * denominator every AGS score is scaled against, so it has to equal the points
 * on the Moodle activity the launch names: `homework1` totals 3 for cmid 2, and
 * `ags` totals 2 for cmid 3. Pointing the AGS activity at the homework1 lesson
 * would make the column 3 and every passed score wrong by a third, which is why
 * there are two sources here rather than one shared one.
 *
 * `--item` is normally discovered from the assignment, and is a flag only
 * because of the bind this script exists to undo: reading an assignment reads
 * its artifact, so an assignment whose artifact is the broken one cannot be
 * read at all — the repair path runs through the defect. When that happens the
 * script says so and asks for the content item by name instead.
 *
 * `--email` defaults to the rig's teacher rather than the local site admin,
 * because authoring an assignment's content is a course-role operation and a
 * site admin is not a member of a course a launch created. One side effect
 * worth knowing about: the local passwordless flow gives that account a
 * `native` identity alongside its LTI one, so afterwards the teacher can also
 * sign in without Moodle. Harmless for the rig, and not what any of the
 * checklist items exercise, but it is a change to the fixture's shape.
 *
 * It is idempotent: a revision whose source already matches is reused rather
 * than rejected as a duplicate, and an assignment already pointing at it is
 * left alone.
 */

/**
 * A graded lesson with points on every exercise, which the fixture needs to be
 * worth anything: an assignment totalling zero omits the `lineItem` from a deep
 * link, so a fixture without scored exercises silently exercises the wrong half
 * of the AGS path. Two exercises rather than one so a partial score is
 * expressible — a passback carrying 1 of 3 proves more than one carrying 0 or
 * everything.
 */
const HOMEWORK1_SOURCE = `# Homework 1

A short graded set, used by the LTI acceptance runs in \`design/LTI_TESTING.md\`.
Its shape matters more than its content: every exercise carries points, so the
assignment has a nominal total for the LMS gradebook column to be created from.

::::multiple-choice{id="modus_ponens" title="Modus ponens" points="2"}
From P and "if P then Q", which follows?

- [ ] p | P
- [x] q | Q
- [ ] neither | Neither
::::

::::multiple-choice{id="valid_forms" title="Valid forms" points="1" mode="multiple"}
Which of these are valid? Select every one that applies.

- [x] mt | Modus tollens
- [x] ds | Disjunctive syllogism
- [ ] ac | Affirming the consequent
::::
`;

/**
 * The AGS activity's lesson: two exercises, one point each, totalling the two
 * points on Moodle's cmid 3 column.
 *
 * This one is why task #182 grew a fourth failure mode. Its artifact was
 * hand-seeded and carried no component manifest, so the content document
 * emitted no component-assets payload, `carnap-multiple-choice` never upgraded,
 * and its radios stayed disabled — a student could read the questions and could
 * not answer them, with nothing failing anywhere. The AGS checklist passed only
 * because those submissions went in through the API rather than a browser.
 * Compiling it through the server is the fix, and re-running this is what keeps
 * it fixed.
 */
const AGS_SOURCE = `# AGS Homework

The lesson behind the graded LMS activity in \`design/LTI_TESTING.md\`: two
points, matching the Moodle column, so a passed-back score can be checked
against a denominator that is not a guess.

::::multiple-choice{id="ags_contradiction" title="Contradiction" points="1"}
Which sentence can never be true?

- [ ] tautology | P or not P
- [x] contradiction | P and not P
- [ ] contingent | P and Q
::::

::::multiple-choice{id="ags_entailment" title="Entailment" points="1" mode="multiple"}
Which of these does "P and Q" entail? Select every one that applies.

- [x] p | P
- [x] q | Q
- [ ] r | P or R only
::::
`;

/** The lessons this script knows how to author, by `--fixture` name. */
const FIXTURES: Record<string, { readonly source: string }> = {
  ags: { source: AGS_SOURCE },
  homework1: { source: HOMEWORK1_SOURCE },
};

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};
const COURSE = opt("--course", "");
const ASSIGNMENT = opt("--assignment", "");
const ITEM = opt("--item", "");
const BASE = opt("--base", "http://localhost:8787").replace(/\/$/, "");
const EMAIL = opt("--email", "teacher1@example.test");
const FIXTURE = opt("--fixture", "homework1");

if (!COURSE || !ASSIGNMENT) {
  throw new Error(
    "usage: seed-lti-fixture.ts --course=<courseId> --assignment=<assignmentId>",
  );
}

const FIXTURE_SOURCE = FIXTURES[FIXTURE]?.source;

if (FIXTURE_SOURCE === undefined) {
  throw new Error(
    `unknown --fixture=${FIXTURE}; expected one of ${Object.keys(FIXTURES).join(", ")}`,
  );
}

/** Accumulated cookies (name → value) across the session. */
const jar = new Map<string, string>();

function absorb(response: Response): void {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const eq = pair?.indexOf("=") ?? -1;
    if (pair && eq > 0) {
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(): Promise<void> {
  const start = await fetch(`${BASE}/login`, {
    body: new URLSearchParams({ email: EMAIL, name: "LTI Fixture Seed" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    redirect: "manual",
  });
  absorb(start);
  const html = await start.text();
  const match = html.match(/href="([^"]*\/login\/confirm[^"]+)"/);

  if (!match?.[1]) {
    throw new Error(
      `No local login-confirm link for ${EMAIL} (status ${start.status}). ` +
        "Is the dev server running in local mode?",
    );
  }

  const confirm = await fetch(new URL(match[1].replace(/&amp;/g, "&"), BASE), {
    headers: { Cookie: cookieHeader() },
    method: "GET",
    redirect: "manual",
  });
  absorb(confirm);

  if (!jar.has("carnap_session")) {
    throw new Error(
      `Login did not set a session cookie (status ${confirm.status}).`,
    );
  }
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", Cookie: cookieHeader() },
    redirect: "manual",
  });
  absorb(response);
  const text = await response.text();

  if (response.status >= 300) {
    throw new Error(`GET ${path} → ${response.status}: ${text.slice(0, 400)}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}

async function postJson(
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
      "X-CSRF-Token": jar.get("carnap_csrf") ?? "",
    },
    method: "POST",
    redirect: "manual",
  });
  absorb(response);
  const text = await response.text();

  if (response.status >= 300) {
    throw new Error(`POST ${path} → ${response.status}: ${text.slice(0, 400)}`);
  }

  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function pick(object: Record<string, unknown>, ...keys: string[]): string {
  let current: unknown = object;

  for (const key of keys) {
    current = (current as Record<string, unknown> | undefined)?.[key];
  }

  if (typeof current !== "string") {
    throw new Error(`missing ${keys.join(".")} in ${JSON.stringify(object)}`);
  }

  return current;
}

await login();
console.log(`Logged in as ${EMAIL}.`);

// Reading the assignment renders its artifact, so a broken artifact takes this
// endpoint down with it — the ordinary case for this script is the one where
// its first step fails. That failure is diagnosis rather than an obstacle: it
// confirms the assignment needs repairing, and `--item` supplies what could not
// be read.
let itemId = ITEM;
let currentRevisionId = "";

try {
  const detail = await getJson(
    `/courses/${COURSE}/instructor/assignments/${ASSIGNMENT}`,
  );
  itemId = pick(detail, "contentItem", "id");
  currentRevisionId = pick(detail, "contentRevision", "id");
  console.log(
    `Assignment ${ASSIGNMENT} → item ${itemId}, revision ${currentRevisionId}.`,
  );
} catch (error) {
  if (itemId.length === 0) {
    throw new Error(
      `Could not read assignment ${ASSIGNMENT}, and no --item was given to ` +
        `fall back on. If the failure below is the artifact, pass ` +
        `--item=<contentItemId>.\n  ${String(error)}`,
    );
  }

  console.log(
    `Could not read assignment ${ASSIGNMENT} — expected when its artifact is ` +
      `the broken one. Continuing with item ${itemId}.`,
  );
}

// (item_id, content_hash) is unique, so a second run with the same source is
// refused rather than duplicated. Look before leaping: reusing the matching
// revision is what makes this safe to run twice.
const listing = await getJson(`/content/${itemId}`);
const revisions = Array.isArray(listing.revisions) ? listing.revisions : [];
const existing = revisions.find(
  (revision) =>
    (revision as Record<string, unknown>).sourceText === FIXTURE_SOURCE,
) as Record<string, unknown> | undefined;

let revisionId: string;

if (existing === undefined) {
  const created = await postJson(`/content/${itemId}/revisions`, {
    details: "Recompiled for the LTI acceptance fixture.",
    sourceText: FIXTURE_SOURCE,
  });
  revisionId = pick(created, "revision", "id");
  console.log(`Compiled a new revision ${revisionId}.`);
} else {
  revisionId = pick(existing, "id");
  console.log(`Revision ${revisionId} already carries this source; reusing.`);
}

if (revisionId === currentRevisionId) {
  console.log("The assignment already points at it. Nothing to do.");
} else {
  await postJson(
    `/courses/${COURSE}/instructor/assignments/${ASSIGNMENT}/content-revision`,
    {
      contentRevisionId: revisionId,
      note: "Recompiled: the seeded artifact predated the exercise manifest.",
    },
  );
  console.log(`Repointed the assignment at ${revisionId}.`);
}

console.log("\nOpen (as the local admin):");
console.log(
  `  Instructor: ${BASE}/courses/${COURSE}/instructor/assignments/${ASSIGNMENT}`,
);
console.log(`  Student:    ${BASE}/courses/${COURSE}/assignments/${ASSIGNMENT}`);
