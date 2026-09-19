import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import { hostedTheoryPath } from "../src/worker/logic/theories";
import { grantTestContentAuthor } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import {
  jsonRequest,
  type LoginResult,
  login as signIn,
  withStorage,
} from "./helpers/http";

setDefaultTimeout(30_000);

/**
 * A small hosted theory with a rule to cite — the thing an instructor would
 * want a colleague to be able to name. Written out rather than borrowed from
 * `logic/theories` so that a resolver quietly falling back to the built-ins
 * could not make a sharing test pass.
 */
const HOSTED_THEORY = `delimiter $ ( ) $;
provable sort wff;
term im (a b: wff): wff;
infixr im: $->$ prec 25;
axiom ax_k (a b: wff): $ a -> b -> a $;
`;

/**
 * A lesson with something in it that the compiled document deliberately holds
 * back: `answers` lands in the exercise's private data, and the only place a
 * reader could find it is the source.
 */
const LESSON = `# Sharing

::::short-answer{#one title="One" points="1" answers="Frege"}
Who wrote the *Begriffsschrift*?
::::`;

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

interface ItemResponse {
  readonly item: { readonly id: string };
}

interface RevisionResponse {
  readonly revision: {
    readonly id: string;
    readonly shareSource: boolean;
    readonly sharing: string;
  };
}

interface ItemPageResponse {
  readonly revisions: readonly RevisionResponse["revision"][];
}

interface ErrorEnvelope {
  readonly error: { readonly code: string };
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

async function share(
  env: Env,
  author: LoginResult,
  revisionId: string,
  sharing: string,
  shareSource = false,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    `/content/revisions/${revisionId}/sharing`,
    jsonRequest({ shareSource, sharing }, author),
    env,
  );
}

interface Hosted {
  readonly itemId: string;
  readonly revisionId: string;
}

async function hostItem(
  env: Env,
  author: LoginResult,
  sourceFormat: string,
  source: string,
): Promise<Hosted> {
  const itemId = await createItem(env, author, sourceFormat);
  const response = await saveRevision(env, author, itemId, source);

  expect(response.status).toBe(201);

  return {
    itemId,
    revisionId: ((await response.json()) as RevisionResponse).revision.id,
  };
}

function asPage(login?: LoginResult): RequestInit {
  return {
    headers: {
      Accept: "text/html",
      ...(login === undefined ? {} : { Cookie: login.cookieHeader }),
    },
  };
}

/**
 * The revision id nothing was ever saved under — what a stranger guessing ids
 * would be holding. Shaped like the real thing so a route cannot answer it
 * differently by parsing it differently.
 */
const NO_SUCH_REVISION = "01JD0000000000000000000000";

/** Signed in and allowed to write content, which nobody is by default. */
async function login(env: Env, email: string): Promise<LoginResult> {
  const result = await signIn(env, email);

  await grantTestContentAuthor(env, result.actorId);

  return result;
}

describe("setting a sharing scope", () => {
  test("is private until the owner says otherwise", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);
      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const body = (await response.json()) as RevisionResponse;

      expect(body.revision.sharing).toBe("private");
      expect(body.revision.shareSource).toBe(false);
    });
  });

  test("stores the scope and the source setting together", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);
      const response = await share(env, author, revisionId, "authors", true);
      const body = (await response.json()) as RevisionResponse;

      expect(response.status).toBe(200);
      expect(body.revision.sharing).toBe("authors");
      expect(body.revision.shareSource).toBe(true);
    });
  });

  test("reaches the revision it names and no other", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { itemId, revisionId } = await hostItem(
        env,
        author,
        "markdown",
        LESSON,
      );
      const second = await saveRevision(
        env,
        author,
        itemId,
        `${LESSON}\n\nA second draft.\n`,
      );

      expect(second.status).toBe(201);

      await share(env, author, revisionId, "public");

      const page = await appRequest(
        createTestApp(),
        `/content/${itemId}`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );
      const body = (await page.json()) as ItemPageResponse;
      const scopes = Object.fromEntries(
        body.revisions.map((revision) => [revision.id, revision.sharing]),
      );

      // The whole reason the scope sits on the revision: what was handed over
      // is one immutable address, not the drafts behind it.
      expect(scopes[revisionId]).toBe("public");
      expect(
        Object.values(scopes).filter((scope) => scope === "private"),
      ).toHaveLength(1);
    });
  });

  test("refuses a scope nobody has, rather than reading it as private", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);
      const response = await share(env, author, revisionId, "everyone");
      const body = (await response.json()) as ErrorEnvelope;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("invalid_content_sharing");
    });
  });

  test("keeps a private revision's source setting off, so re-sharing cannot surprise", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);

      await share(env, author, revisionId, "public", true);

      const response = await share(env, author, revisionId, "private", true);
      const body = (await response.json()) as RevisionResponse;

      expect(body.revision.shareSource).toBe(false);
    });
  });

  test("is not somebody else's to set", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { revisionId } = await hostItem(
        env,
        author,
        "mm0",
        HOSTED_THEORY,
      );
      const response = await share(env, other, revisionId, "public");
      const body = (await response.json()) as ErrorEnvelope;

      // The same miss a stranger gets for an id that names nothing: sharing is
      // a reading permission, and it never confers a write.
      expect(response.status).toBe(404);
      expect(body.error.code).toBe("content_revision_not_found");
    });
  });

  test("does not let a reader it was shared with save a revision", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { itemId, revisionId } = await hostItem(
        env,
        author,
        "markdown",
        LESSON,
      );

      await share(env, author, revisionId, "public", true);

      const response = await saveRevision(
        env,
        other,
        itemId,
        "# Not yours\n",
      );

      expect(response.status).toBe(404);
    });
  });
});

describe("reading a shared revision", () => {
  test("a private one is a miss for another author", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);

      for (const path of [
        `/content/revisions/${revisionId}`,
        `/content/revisions/${revisionId}/document`,
        `/content/revisions/${revisionId}/source`,
      ]) {
        const response = await appRequest(
          createTestApp(),
          path,
          { headers: { Cookie: other.cookieHeader } },
          env,
        );

        expect(`${path}: ${response.status}`).toBe(`${path}: 404`);
      }
    });
  });

  test("one shared to authors is readable by an author, page and document", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);

      await share(env, author, revisionId, "authors");

      for (const path of [
        `/content/revisions/${revisionId}`,
        `/content/revisions/${revisionId}/document`,
      ]) {
        const response = await appRequest(
          createTestApp(),
          path,
          asPage(other),
          env,
        );

        expect(`${path}: ${response.status}`).toBe(`${path}: 200`);
      }
    });
  });

  test("does not open the item page it belongs to", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { itemId, revisionId } = await hostItem(
        env,
        author,
        "markdown",
        LESSON,
      );

      await share(env, author, revisionId, "public", true);

      const response = await appRequest(
        createTestApp(),
        `/content/${itemId}`,
        asPage(other),
        env,
      );
      const page = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}`,
        asPage(other),
        env,
      );

      // An item — its history, its editor, its share controls — stays its
      // author's. What a scope opens is the revision at its own address, and
      // the page says so by naming the lesson without linking to it.
      expect(response.status).toBe(404);
      expect(page.status).toBe(200);
      expect(await page.text()).not.toContain(`href="/content/${itemId}"`);
    });
  });

  test("a signed-in reader who writes nothing is not one of the authors", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const student = await signIn(env, "student@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);

      await share(env, author, revisionId, "authors");

      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}`,
        asPage(student),
        env,
      );

      expect(response.status).toBe(404);
    });
  });

  test("the reading and the source are two permissions", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);
      const sourcePath = `/content/revisions/${revisionId}/source`;

      await share(env, author, revisionId, "authors");

      // The lesson reads; the Markdown behind it does not, because that is
      // where the accepted answer is written.
      const withheld = await appRequest(
        createTestApp(),
        sourcePath,
        { headers: { Cookie: other.cookieHeader } },
        env,
      );

      expect(withheld.status).toBe(404);

      await share(env, author, revisionId, "authors", true);

      const offered = await appRequest(
        createTestApp(),
        sourcePath,
        { headers: { Cookie: other.cookieHeader } },
        env,
      );

      expect(offered.status).toBe(200);
      expect(await offered.text()).toBe(LESSON);
    });
  });

  test("the page offers only what the reader may have", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);
      const page = async (): Promise<string> => {
        const response = await appRequest(
          createTestApp(),
          `/content/revisions/${revisionId}`,
          asPage(other),
          env,
        );

        expect(response.status).toBe(200);

        return response.text();
      };

      await share(env, author, revisionId, "authors");

      // The accepted answer is written in the source and held out of the
      // compiled document, so a reader given the lesson and not the source
      // must not meet it on the page that would have shown it.
      expect(await page()).not.toContain("Frege");

      await share(env, author, revisionId, "authors", true);

      expect(await page()).toContain("Frege");
    });
  });

  test("the owner reads their own source whatever the setting says", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);

      await share(env, author, revisionId, "public");

      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}/source`,
        { headers: { Cookie: author.cookieHeader } },
        env,
      );

      expect(response.status).toBe(200);
    });
  });
});

describe("reading a shared revision without signing in", () => {
  test("a public one is readable from the open web", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(env, author, "markdown", LESSON);

      await share(env, author, revisionId, "public");

      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}/document`,
        asPage(),
        env,
      );

      expect(response.status).toBe(200);
    });
  });

  test("everything else answers the way a nonexistent id does", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(
        env,
        author,
        "mm0",
        HOSTED_THEORY,
      );
      const answers = await Promise.all(
        [revisionId, NO_SUCH_REVISION].map(async (id) => {
          const response = await appRequest(
            createTestApp(),
            hostedTheoryPath(id),
            asPage(),
            env,
          );

          // The id is back in the `next`, as it has to be for the redirect to
          // lead anywhere; what must not differ is everything else.
          return `${response.status} ${(response.headers.get("location") ?? "").replace(encodeURIComponent(id), "<id>")}`;
        }),
      );

      // The whole point: a stranger cannot tell "private" from "no such
      // revision", because both are the same redirect to the same place.
      expect(answers[0]).toBe(answers[1] ?? "");
      expect(answers[0]).toBe(
        "302 /login?next=%2Fcontent%2Frevisions%2F<id>%2Ftheory.mm0",
      );
    });
  });

  test("an anonymous reader is not one of the authors", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(
        env,
        author,
        "mm0",
        HOSTED_THEORY,
      );

      await share(env, author, revisionId, "authors");

      const response = await appRequest(
        createTestApp(),
        hostedTheoryPath(revisionId),
        asPage(),
        env,
      );

      expect(response.status).toBe(302);
    });
  });
});

describe("a hosted theory's cache", () => {
  test("is shared only when the theory is public", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const { revisionId } = await hostItem(
        env,
        author,
        "mm0",
        HOSTED_THEORY,
      );
      const control = async (): Promise<string> => {
        const response = await appRequest(
          createTestApp(),
          hostedTheoryPath(revisionId),
          { headers: { Cookie: author.cookieHeader } },
          env,
        );

        expect(response.status).toBe(200);

        return response.headers.get("cache-control") ?? "";
      };

      // A shared cache holding a copy of a revision that is not public would
      // hand it to the next person who asked for the URL.
      expect(await control()).toStartWith("private,");

      await share(env, author, revisionId, "authors");

      expect(await control()).toStartWith("private,");

      await share(env, author, revisionId, "public");

      expect(await control()).toStartWith("public,");
    });
  });

  test("a theory shares its source with its reading, having no other", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { revisionId } = await hostItem(
        env,
        author,
        "mm0",
        HOSTED_THEORY,
      );

      // `shareSource` is not asked of an MM0 revision and is stored as false;
      // the download still works, because the theory route already serves the
      // same bytes to the same people.
      const shared = await share(env, author, revisionId, "authors", true);

      expect(
        ((await shared.json()) as RevisionResponse).revision.shareSource,
      ).toBe(false);

      const response = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}/source`,
        { headers: { Cookie: other.cookieHeader } },
        env,
      );

      expect(response.status).toBe(200);
    });
  });
});

describe("naming somebody else's theory from a lesson", () => {
  test("compiles once it is shared, and not before", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const { revisionId } = await hostItem(
        env,
        author,
        "mm0",
        HOSTED_THEORY,
      );
      const lessonId = await createItem(env, other, "markdown");
      const lesson = lessonNaming(hostedTheoryPath(revisionId));

      const refused = await saveRevision(env, other, lessonId, lesson);

      expect(refused.status).toBe(400);
      expect(((await refused.json()) as ErrorEnvelope).error.code).toBe(
        "unknown_theory_src",
      );

      await share(env, author, revisionId, "authors");

      const saved = await saveRevision(env, other, lessonId, lesson);

      expect(saved.status).toBe(201);
    });
  });
});
