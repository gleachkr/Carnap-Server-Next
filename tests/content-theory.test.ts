import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import { compileTheorySource } from "../src/worker/application/content/mm0";
import type { Env } from "../src/worker/env";
import { isAufbauProofPublicData } from "../src/worker/exercises/aufbau-proof/types";
import {
  hostedTheoryPath,
  hostedTheoryRevisionId,
} from "../src/worker/logic/theories";
import {
  grantTestContentAuthor,
  grantTestCourseCreator,
} from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

/**
 * A theory an instructor might actually host: small, valid, and with a rule to
 * cite. Written out here rather than borrowed from `logic/theories` because
 * what is under test is the *hosting* path, and a fixture that happens to be a
 * built-in would let a resolver that quietly fell back to the built-ins pass.
 */
const HOSTED_THEORY = `delimiter $ ( ) $;
provable sort wff;
term im (a b: wff): wff;
infixr im: $->$ prec 25;
axiom ax_k (a b: wff): $ a -> b -> a $;
`;

/**
 * The same file claiming to be a language as well. The annotation attaches to
 * the statement *after* it, which is what names `wff` as the sort a student's
 * formula is read at.
 */
const HOSTED_LANGUAGE = `delimiter $ ( ) $;
--| @syntax role sentence
provable sort wff;
term im (a b: wff): wff;
infixr im: $->$ prec 25;
axiom ax_k (a b: wff): $ a -> b -> a $;
`;

describe("compiling an MM0 revision", () => {
  test("reads a theory and reports what it declares", () => {
    const compiled = compileTheorySource(HOSTED_THEORY);

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      return;
    }

    // The rule names are the point of the summary: they are what a student
    // types into a proof, so they are what an author needs to see listed.
    expect(compiled.artifact.axioms).toEqual(["ax_k"]);
    expect(compiled.artifact.sorts).toEqual(["wff"]);
    expect(compiled.artifact.terms).toEqual(["im"]);
    expect(compiled.artifact.kind).toBe("mm0");
    // A proof system with no `@syntax role sentence` is not a language, and
    // saying so is how the page tells an author why `system=` will not take it.
    expect(compiled.artifact.sentenceSort).toBeNull();
  });

  test("names the sort a language reads formulas at", () => {
    const compiled = compileTheorySource(HOSTED_LANGUAGE);

    expect(compiled.ok).toBe(true);
    expect(compiled.ok && compiled.artifact.sentenceSort).toBe("wff");
  });

  test("refuses source that is not MM0, on the line it went wrong", () => {
    const compiled = compileTheorySource(`provable sort wff;
this is not a declaration
`);

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.length).toBeGreaterThan(0);
    expect(compiled.diagnostics[0]?.line).toBe(2);
    // The library's own sentence, wrapped: the frame is Carnap's and
    // translated, the reason is the library's and quoted.
    expect(compiled.diagnostics[0]?.message).toBe(
      "This MM0 does not read: {reason}",
    );
  });

  test("refuses a file that declares nothing", () => {
    // `parseSpec` has no complaint about an empty file — it is trivially
    // coherent — so this refusal is ours, and without it an author could save
    // a blank theory and find out from a proof exercise with no rules in it.
    const compiled = compileTheorySource("-- just a comment\n");

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((one) => one.code)).toContain(
      "empty_mm0",
    );
  });
});

describe("the hosted theory path", () => {
  test("round-trips a revision id", () => {
    const path = hostedTheoryPath("rev-1");

    expect(path).toBe("/content/revisions/rev-1/theory.mm0");
    expect(hostedTheoryRevisionId(path)).toBe("rev-1");
  });

  test("is not any other path under /content", () => {
    // The source download and the document page are neighbours of this route,
    // and a resolver that read either as a theory id would be reading another
    // route's parameter.
    expect(
      hostedTheoryRevisionId("/content/revisions/rev-1/source"),
    ).toBeNull();
    expect(
      hostedTheoryRevisionId("/content/revisions/rev-1/document"),
    ).toBeNull();
    expect(hostedTheoryRevisionId("/theories/carnap-prop.mm0")).toBeNull();
    // An empty id, and an id that would let the tail escape its segment.
    expect(
      hostedTheoryRevisionId("/content/revisions//theory.mm0"),
    ).toBeNull();
    expect(
      hostedTheoryRevisionId("/content/revisions/a/b/theory.mm0"),
    ).toBeNull();
  });
});

function lessonNaming(src: string): string {
  return `:::aufbau-mm0{name="hosted" src="${src}"}
:::

::::aufbau-proof{system="hosted" id="k"}
Prove it.

theorem thm_k (a b: wff): $ a -> b -> a $
----
l1: $ a -> b -> a $ by ax_k []
::::`;
}

describe("resolving a hosted theory from a lesson", () => {
  test("compiles the named revision's MM0 into the exercise", async () => {
    const asked: string[] = [];
    const compiled = await compileCarnapMarkdown(
      lessonNaming(hostedTheoryPath("rev-1")),
      {
        resolveTheory: (path) => {
          asked.push(path);

          return Promise.resolve(HOSTED_THEORY);
        },
      },
    );

    expect(compiled.ok).toBe(true);

    if (!compiled.ok) {
      return;
    }

    expect(asked).toEqual(["/content/revisions/rev-1/theory.mm0"]);

    // Frozen, not referenced: the exercise carries the theory text, so a later
    // revision of the theory cannot change what this lesson proves.
    const publicData = compiled.artifact.manifest[0]?.publicData;

    expect(isAufbauProofPublicData(publicData)).toBe(true);
    expect(
      isAufbauProofPublicData(publicData) ? publicData.mm0 : "",
    ).toContain("axiom ax_k");
  });

  test("says nothing is served there when the resolver misses", async () => {
    const compiled = await compileCarnapMarkdown(
      lessonNaming(hostedTheoryPath("rev-1")),
      { resolveTheory: () => Promise.resolve(null) },
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((one) => one.code)).toContain(
      "unknown_theory_src",
    );
  });

  test("never asks about a built-in", async () => {
    // The built-ins answer from the module graph, which is what lets a lesson
    // compile in `bun test`, in the demo scripts, and in a browser with no
    // session — so a resolver being present must not change how they resolve.
    let asked = 0;
    const compiled = await compileCarnapMarkdown(
      lessonNaming("/theories/carnap-prop.mm0").replace(
        /theorem[\s\S]*?----\n.*\n/,
        "theorem thm_k: $ P -> Q -> P $\n----\n",
      ),
      {
        resolveTheory: () => {
          asked += 1;

          return Promise.resolve(null);
        },
      },
    );

    expect(asked).toBe(0);
    expect(compiled.diagnostics.map((one) => one.code)).not.toContain(
      "unknown_theory_src",
    );
  });

  test("reads one path once, however many blocks name it", async () => {
    let reads = 0;
    const source = `${lessonNaming(hostedTheoryPath("rev-1"))}

:::aufbau-mm0{name="again" src="${hostedTheoryPath("rev-1")}"}
:::`;

    await compileCarnapMarkdown(source, {
      resolveTheory: () => {
        reads += 1;

        return Promise.resolve(HOSTED_THEORY);
      },
    });

    expect(reads).toBe(1);
  });

  test("still refuses a theory on somebody else's server", async () => {
    const compiled = await compileCarnapMarkdown(
      lessonNaming("https://example.test/theory.mm0"),
      { resolveTheory: () => Promise.resolve(HOSTED_THEORY) },
    );

    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((one) => one.code)).toContain(
      "remote_theory_src",
    );
  });
});

interface LoginResult {
  readonly actorId: string;
  readonly cookieHeader: string;
  readonly csrfToken: string;
}

interface StartLoginResponse {
  readonly login: { readonly loginToken: string };
}

interface LoginResponse {
  readonly actor: { readonly id: string };
  readonly csrfToken: string;
}

interface ItemResponse {
  readonly item: { readonly id: string };
}

interface RevisionResponse {
  readonly revision: { readonly id: string };
}

interface ErrorEnvelope {
  readonly error: { readonly code: string };
}

async function withStorage(
  run: (storage: TestStorage, env: Env) => Promise<void>,
): Promise<void> {
  const storage = await createTestStorage();

  try {
    await run(storage, { CARNAP_ENV: "local", DB: storage.db });
  } finally {
    await storage.dispose();
  }
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };

  if (headers.getSetCookie !== undefined) {
    return headers.getSetCookie();
  }

  return (headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[^;=]+=)/)
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.length > 0);
}

function cookieHeader(response: Response): string {
  return setCookieHeaders(response)
    .map((cookie) => cookie.split(";")[0] ?? "")
    .join("; ");
}

function jsonRequest(body: unknown, login?: LoginResult): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(login === undefined
        ? {}
        : { Cookie: login.cookieHeader, "X-CSRF-Token": login.csrfToken }),
    },
    method: "POST",
  };
}

/** Signed in and allowed to write content, which nobody is by default. */
async function login(env: Env, email: string): Promise<LoginResult> {
  const app = createTestApp();
  const startResponse = await appRequest(
    app,
    "/auth/login/start",
    jsonRequest({ email }),
    env,
  );
  const startBody = (await startResponse.json()) as StartLoginResponse;
  const confirmResponse = await appRequest(
    app,
    "/auth/login/confirm",
    jsonRequest({ loginToken: startBody.login.loginToken }),
    env,
  );
  const body = (await confirmResponse.json()) as LoginResponse;
  const result = {
    actorId: body.actor.id,
    cookieHeader: cookieHeader(confirmResponse),
    csrfToken: body.csrfToken,
  };

  await grantTestContentAuthor(env, result.actorId);

  return result;
}

async function createItem(
  env: Env,
  author: LoginResult,
  sourceFormat: string,
): Promise<string> {
  const response = await appRequest(
    createTestApp(),
    "/content",
    jsonRequest({ sourceFormat, title: "Course logic" }, author),
    env,
  );

  expect(response.status).toBe(201);

  return ((await response.json()) as ItemResponse).item.id;
}

async function saveRevision(
  env: Env,
  author: LoginResult,
  itemId: string,
  sourceText: string,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    `/content/${itemId}/revisions`,
    jsonRequest({ sourceText }, author),
    env,
  );
}

/** An MM0 item with one saved revision: the id a lesson's `src=` will name. */
async function hostTheory(
  env: Env,
  author: LoginResult,
  source = HOSTED_THEORY,
): Promise<string> {
  const itemId = await createItem(env, author, "mm0");
  const response = await saveRevision(env, author, itemId, source);

  expect(response.status).toBe(201);

  return ((await response.json()) as RevisionResponse).revision.id;
}

describe("serving a hosted theory", () => {
  test("answers with the MM0, as text to read rather than a download", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const revisionId = await hostTheory(env, author);
      const response = await appRequest(
        createTestApp(),
        hostedTheoryPath(revisionId),
        { headers: { Cookie: author.cookieHeader } },
        env,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      // The point of the address: what a lesson resolves is what a person
      // opening the URL reads.
      expect(await response.text()).toBe(HOSTED_THEORY);
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(response.headers.get("etag")).not.toBeNull();
    });
  });

  test("is not somebody else's to read", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const revisionId = await hostTheory(env, author);
      const response = await appRequest(
        createTestApp(),
        hostedTheoryPath(revisionId),
        { headers: { Cookie: other.cookieHeader } },
        env,
      );

      expect(response.status).toBe(404);
    });
  });

  test("has nothing to serve for a lesson revision", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const itemId = await createItem(env, author, "markdown");
      const saved = await saveRevision(env, author, itemId, "# A lesson\n");

      expect(saved.status).toBe(201);

      const revisionId = ((await saved.json()) as RevisionResponse).revision
        .id;
      const response = await appRequest(
        createTestApp(),
        hostedTheoryPath(revisionId),
        { headers: { Cookie: author.cookieHeader } },
        env,
      );

      // A miss, not a failure: there is no theory at a lesson's id, the same
      // way there is no document at a theory's.
      expect(response.status).toBe(404);
    });
  });

  test("does not render a theory as a document", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const revisionId = await hostTheory(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}/document`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );

      // Without the format check this is a 500 from the artifact read
      // boundary — a theory's artifact is a summary, not a document.
      expect(response.status).toBe(404);
    });
  });

  test("downloads as a theory, named and typed as one", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const revisionId = await hostTheory(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}/source`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const disposition = response.headers.get("content-disposition") ?? "";

      // The download is for round-tripping — edit the file, upload it back —
      // so it has to arrive as the kind of file it is. `/theory.mm0` above is
      // the address to read one at, not a reason it cannot be saved.
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(disposition).toStartWith("attachment;");
      expect(disposition).toContain('.mm0"');
      expect(await response.text()).toBe(HOSTED_THEORY);
    });
  });
});

describe("saving an MM0 revision", () => {
  test("refuses source that does not read, in the editor's own words", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const itemId = await createItem(env, author, "mm0");
      const response = await saveRevision(
        env,
        author,
        itemId,
        "this is not mm0\n",
      );

      expect(response.status).toBe(400);
      expect(
        ((await response.json()) as ErrorEnvelope).error.code,
      ).toStartWith("mm0_");
    });
  });

  test("refuses an unknown kind of item outright", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const response = await appRequest(
        createTestApp(),
        "/content",
        jsonRequest({ sourceFormat: "latex", title: "Course logic" }, author),
        env,
      );

      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorEnvelope).error.code).toBe(
        "invalid_content_source_format",
      );
    });
  });
});

describe("a lesson naming a hosted theory", () => {
  test("compiles, and freezes the theory into the exercise", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const revisionId = await hostTheory(env, author);
      const itemId = await createItem(env, author, "markdown");
      const response = await saveRevision(
        env,
        author,
        itemId,
        lessonNaming(hostedTheoryPath(revisionId)),
      );

      expect(response.status).toBe(201);
    });
  });

  test("cannot name somebody else's", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const revisionId = await hostTheory(env, author);
      const itemId = await createItem(env, other, "markdown");
      const response = await saveRevision(
        env,
        other,
        itemId,
        lessonNaming(hostedTheoryPath(revisionId)),
      );

      // The same refusal a made-up id gets, deliberately: telling the two
      // apart would answer "does this revision exist" for anybody who asked.
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorEnvelope).error.code).toBe(
        "unknown_theory_src",
      );
    });
  });
});

describe("assignments", () => {
  test("cannot be set on a theory", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");

      await grantTestCourseCreator(env, instructor.actorId);

      const courseResponse = await appRequest(
        createTestApp(),
        "/courses",
        jsonRequest({ timezone: "UTC", title: "Intro Logic" }, instructor),
        env,
      );

      expect(courseResponse.status).toBe(201);

      const courseId = (
        (await courseResponse.json()) as {
          readonly course: { readonly id: string };
        }
      ).course.id;
      const revisionId = await hostTheory(env, instructor);
      const response = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments`,
        jsonRequest(
          { contentRevisionId: revisionId, title: "Homework 1" },
          instructor,
        ),
        env,
      );

      // The pickers do not offer one; this is the API saying so too, because
      // an assignment over a theory has no document, no manifest, and a
      // denominator of zero.
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorEnvelope).error.code).toBe(
        "assignment_content_not_a_lesson",
      );
    });
  });
});

describe("the pages an MM0 item gets", () => {
  test("the editor is the source and its diagnostics, with no preview", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const itemId = await createItem(env, author, "mm0");
      const response = await appRequest(
        createTestApp(),
        `/content/${itemId}/revisions/new`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("MM0 source");
      // No second column, and so no Write/Preview switch for one.
      expect(html).not.toContain("data-editor-split");
      expect(html).not.toContain("data-editor-mode-switch");
    });
  });

  test("the revision page shows the address and what the file declares", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const revisionId = await hostTheory(env, author);
      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}`,
        { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
        env,
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      // The address is the whole reason an author comes back to this page.
      expect(html).toContain(hostedTheoryPath(revisionId));
      expect(html).toContain("ax_k");
    });
  });

  test("the upload picker offers the file each kind of item downloads as", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const page = async (itemId: string): Promise<string> => {
        const response = await appRequest(
          createTestApp(),
          `/content/${itemId}`,
          { headers: { Accept: "text/html", Cookie: author.cookieHeader } },
          env,
        );

        expect(response.status).toBe(200);

        return response.text();
      };
      const theory = await page(await createItem(env, author, "mm0"));
      const lesson = await page(await createItem(env, author, "markdown"));

      // The other half of the round trip: an author saves the source, edits
      // it, and comes back to upload it. A picker filtered to Markdown would
      // hide the `.mm0` file they had just been handed — and one filtered to
      // MM0 would do the same to a lesson.
      expect(theory).toContain('accept=".mm0,.txt,text/plain"');
      expect(theory).not.toContain(".markdown");
      expect(lesson).toContain(
        'accept=".md,.markdown,.txt,text/markdown,text/plain"',
      );
    });
  });
});
