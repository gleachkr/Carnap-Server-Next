/**
 * The HTTP client the seed scripts drive a running local server with, and
 * the create-course → item → revision → assignment → publish sequence most
 * of them exist to run.
 *
 * Every seed script used to carry its own copy of this — a cookie jar, the
 * passwordless login, a JSON POST — and the five demo seeds differed from
 * one another in nothing but a header, one import and four titles. This is
 * that copy, once; the scripts are what differs.
 *
 * Talks to the product's own endpoints and never to the database, so what a
 * seed produces is what the current compiler emits, whatever the schema has
 * become since the script was written.
 */

/** `--name=value` from the command line, or `fallback`. */
export function flag(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`));

  return hit === undefined ? fallback : hit.slice(name.length + 1);
}

/** The base URL a script targets, from `--base`; a trailing slash is dropped. */
export function baseFlag(): string {
  return flag("--base", "http://localhost:8787").replace(/\/$/, "");
}

/** `keys` followed into `object`, which must end at a string. */
export function pick(
  object: Record<string, unknown>,
  ...keys: string[]
): string {
  let current: unknown = object;

  for (const key of keys) {
    current = (current as Record<string, unknown> | undefined)?.[key];
  }

  if (typeof current !== "string") {
    throw new Error(`missing ${keys.join(".")} in ${JSON.stringify(object)}`);
  }

  return current;
}

/**
 * A signed-in session against one server: the cookies it accumulates, and
 * requests that carry them. `login` goes through the local passwordless
 * flow, which prints its own confirmation link into the page under
 * `CARNAP_ENV=local` — no mail is involved.
 */
export class LocalClient {
  /** Accumulated cookies (name → value) across the session. */
  private readonly jar = new Map<string, string>();

  constructor(
    readonly base: string = baseFlag(),
    readonly email: string = flag("--email", "claude-agent@example.test"),
  ) {}

  /**
   * The path of the confirmation link `/login` printed for `email`. Exposed
   * on its own for a driver that wants a *browser* signed in, which has to
   * follow the link itself so that the cookies land in the browser's jar.
   */
  async loginConfirmPath(): Promise<string> {
    const response = await fetch(`${this.base}/login`, {
      body: new URLSearchParams({ email: this.email }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      redirect: "manual",
    });
    this.absorb(response);
    const html = await response.text();
    const match = html.match(/href="([^"]*\/login\/confirm[^"]+)"/);

    if (match?.[1] === undefined) {
      throw new Error(
        `No local login-confirm link for ${this.email} (status ${response.status}). ` +
          "Is the dev server running in local mode?",
      );
    }

    const url = new URL(match[1].replace(/&amp;/g, "&"), this.base);

    return `${url.pathname}${url.search}`;
  }

  async login(): Promise<void> {
    const confirm = await fetch(
      `${this.base}${await this.loginConfirmPath()}`,
      { headers: { Cookie: this.cookieHeader() }, redirect: "manual" },
    );
    this.absorb(confirm);

    if (!this.jar.has("carnap_session")) {
      throw new Error(
        `Login did not set a session cookie (status ${confirm.status}).`,
      );
    }
  }

  async getText(path: string): Promise<string> {
    const response = await fetch(`${this.base}${path}`, {
      headers: { Cookie: this.cookieHeader() },
      redirect: "manual",
    });
    this.absorb(response);
    const text = await response.text();

    if (response.status >= 300) {
      throw new Error(
        `GET ${path} → ${response.status}: ${text.slice(0, 400)}`,
      );
    }

    return text;
  }

  async getJson(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.base}${path}`, {
      headers: { Accept: "application/json", Cookie: this.cookieHeader() },
      redirect: "manual",
    });
    this.absorb(response);
    const text = await response.text();

    if (response.status >= 300) {
      throw new Error(
        `GET ${path} → ${response.status}: ${text.slice(0, 400)}`,
      );
    }

    return JSON.parse(text) as Record<string, unknown>;
  }

  async postJson(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.base}${path}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: this.cookieHeader(),
        "X-CSRF-Token": this.jar.get("carnap_csrf") ?? "",
      },
      method: "POST",
      redirect: "manual",
    });
    this.absorb(response);
    const text = await response.text();

    if (response.status >= 300) {
      throw new Error(
        `POST ${path} → ${response.status}: ${text.slice(0, 400)}`,
      );
    }

    return text.length === 0
      ? {}
      : (JSON.parse(text) as Record<string, unknown>);
  }

  /**
   * The id of an existing course whose title contains `match`, read off the
   * course list. For a seed that adds to a course rather than making one.
   */
  async findCourse(match: string): Promise<{ id: string; title: string }> {
    const html = await this.getText("/courses");
    const anchor = /<a href="\/courses\/([^"]+)">([^<]*)<\/a>/g;

    for (const [, id, title] of html.matchAll(anchor)) {
      if (id !== undefined && title?.includes(match) === true) {
        return { id, title };
      }
    }

    throw new Error(
      `No course whose title contains '${match}'. Pass --course=SUBSTRING.`,
    );
  }

  private absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair?.indexOf("=") ?? -1;

      if (pair !== undefined && eq > 0) {
        this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface LessonSeed {
  /** Publish into the course whose title contains this, rather than a new one. */
  readonly course?: string;
  readonly courseTitle: string;
  readonly description: string;
  readonly itemTitle: string;
  readonly sourceText: string;
  readonly assignmentTitle: string;
}

/**
 * Author `seed.sourceText` as a content revision and publish it as a practice
 * assignment, in a fresh course or (`seed.course`) an existing one. Logs
 * each step and, at the end, the URLs to open.
 */
export async function seedLesson(
  client: LocalClient,
  seed: LessonSeed,
): Promise<void> {
  await client.login();
  console.log(`Logged in as ${client.email}.`);

  let courseId: string;

  if (seed.course === undefined) {
    const course = await client.postJson("/courses", {
      timezone: "UTC",
      title: seed.courseTitle,
    });
    courseId = pick(course, "course", "id");
    console.log(`Course ${courseId}`);
  } else {
    const course = await client.findCourse(seed.course);
    courseId = course.id;
    console.log(`Course ${courseId} — "${course.title}"`);
  }

  const item = await client.postJson("/content", { title: seed.itemTitle });
  const itemId = pick(item, "item", "id");
  const revision = await client.postJson(`/content/${itemId}/revisions`, {
    sourceText: seed.sourceText,
  });
  const revisionId = pick(revision, "revision", "id");
  console.log(`Content ${itemId}, revision ${revisionId}`);

  const assignment = await client.postJson(
    `/courses/${courseId}/assignments`,
    {
      assessmentMode: "practice",
      contentRevisionId: revisionId,
      description: seed.description,
      title: seed.assignmentTitle,
    },
  );
  const assignmentId = pick(assignment, "assignment", "id");
  console.log(`Assignment ${assignmentId} (draft)`);

  await client.postJson(
    `/courses/${courseId}/instructor/assignments/${assignmentId}/publish`,
    {},
  );
  console.log("Published.\n");

  console.log("Open (logged in as the local admin):");
  console.log(
    `  Assignment:     ${client.base}/courses/${courseId}/assignments/${assignmentId}`,
  );
  console.log(
    `  Live authoring: ${client.base}/content/${itemId}/revisions/new`,
  );
}
