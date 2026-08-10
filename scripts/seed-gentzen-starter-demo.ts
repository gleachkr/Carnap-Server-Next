/**
 * Seed the *pre-populated* Gentzen-LK tree-proof demo (`GENTZEN_STARTER_DEMO_SOURCE`)
 * onto a running LOCAL dev server (`bun run dev`), publishing it as a practice
 * assignment inside an **existing** course found by title (default the "Truth
 * Tables demo" course) rather than creating a fresh one. Logs in as the local
 * site_admin via the passwordless local flow, authors the lesson as a content
 * revision, and publishes the assignment. Prints the URLs to open.
 *
 *   bun run dev            # in another terminal
 *   bun run scripts/seed-gentzen-starter-demo.ts
 *
 * Flags: --base=URL (default http://localhost:8787), --email=ADDR,
 *        --course=SUBSTRING (default "Truth Tables demo").
 */
import { GENTZEN_STARTER_DEMO_SOURCE } from "../tests/helpers/gentzen-starter-demo";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};
const BASE = opt("--base", "http://localhost:8787").replace(/\/$/, "");
const EMAIL = opt("--email", "claude-agent@example.test");
const COURSE_MATCH = opt("--course", "Truth Tables demo");

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
    body: new URLSearchParams({ email: EMAIL, name: "Demo Seed" }),
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
  const confirmUrl = new URL(match[1].replace(/&amp;/g, "&"), BASE);
  const confirm = await fetch(confirmUrl, {
    headers: { Cookie: cookieHeader() },
    method: "GET",
    redirect: "manual",
  });
  absorb(confirm);
  if (!jar.has("carnap_session")) {
    throw new Error(`Login did not set a session cookie (status ${confirm.status}).`);
  }
}

async function getText(path: string): Promise<string> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookieHeader() },
    method: "GET",
    redirect: "manual",
  });
  absorb(response);
  if (response.status >= 300) {
    throw new Error(`GET ${path} → ${response.status}`);
  }
  return response.text();
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const csrf = jar.get("carnap_csrf") ?? "";
  const response = await fetch(`${BASE}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
      "X-CSRF-Token": csrf,
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

/** Find an existing course whose title contains `COURSE_MATCH`, from GET /courses. */
async function findCourseId(): Promise<{ id: string; title: string }> {
  const html = await getText("/courses");
  const anchor = /<a href="\/courses\/([^"]+)">([^<]*)<\/a>/g;
  const hits: { id: string; title: string }[] = [];
  for (const match of html.matchAll(anchor)) {
    const id = match[1];
    const title = match[2];
    if (id && title && title.includes(COURSE_MATCH)) {
      hits.push({ id, title });
    }
  }
  const first = hits[0];
  if (first === undefined) {
    throw new Error(
      `No course whose title contains '${COURSE_MATCH}'. Pass --course=SUBSTRING.`,
    );
  }
  return first;
}

await login();
console.log(`Logged in as ${EMAIL}.`);

const course = await findCourseId();
console.log(`Course ${course.id} — "${course.title}"`);

const item = await postJson("/content", {
  title: "Gentzen LK — pre-populated sequent trees",
});
const itemId = pick(item, "item", "id");

const revision = await postJson(`/content/${itemId}/revisions`, {
  sourceText: GENTZEN_STARTER_DEMO_SOURCE,
});
const revisionId = pick(revision, "revision", "id");
console.log(`Content ${itemId}, revision ${revisionId}`);

const assignment = await postJson(`/courses/${course.id}/assignments`, {
  assessmentMode: "practice",
  contentRevisionId: revisionId,
  description:
    "Pre-populated tree proofs in Gentzen's LK — worked examples, a scaffold, and a large double-cut proof.",
  title: "Pre-populated sequent proofs (LK)",
});
const assignmentId = pick(assignment, "assignment", "id");
console.log(`Assignment ${assignmentId} (draft)`);

await postJson(
  `/courses/${course.id}/instructor/assignments/${assignmentId}/publish`,
  {},
);
console.log("Published.\n");

console.log("Open (logged in as the local admin):");
console.log(`  Assignment:     ${BASE}/courses/${course.id}/assignments/${assignmentId}`);
console.log(`  Live authoring: ${BASE}/content/${itemId}/revisions/new`);
