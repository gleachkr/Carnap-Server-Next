import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { ContentService } from "../src/worker/application/content";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  mm0TextHash,
  sha256Id,
} from "../src/worker/application/content/hash";
import type { AppStores } from "../src/worker/application/stores";
import type { CompiledSystemOrigins } from "../src/worker/domain/content";
import type { Env } from "../src/worker/env";
import { hostedTheoryPath, theoryByPath } from "../src/worker/logic/theories";
import { grantTestContentAuthor } from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import {
  createCourse,
  jsonRequest,
  type LoginResult,
  login as signIn,
  withStorage,
} from "./helpers/http";

setDefaultTimeout(30_000);

const CALGARY = "/theories/forallx-calgary.mm0";

/**
 * A small hosted theory, and a second version of it: the same rules with one
 * more, which is what an author fixing or extending their theory saves.
 */
const THEORY_V1 = `delimiter $ ( ) $;
provable sort wff;
term im (a b: wff): wff;
infixr im: $->$ prec 25;
axiom ax_k (a b: wff): $ a -> b -> a $;
`;

const THEORY_V2 = `${THEORY_V1}axiom ax_i (a: wff): $ a -> a $;
`;

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

const CALGARY_LESSON = `::::model{id="m" system="forallx-calgary"}
Make it true.

- ExF(x)
::::`;

interface RevisionResponse {
  readonly revision: { readonly contentHash: string; readonly id: string };
}

async function login(env: Env, email: string): Promise<LoginResult> {
  const result = await signIn(env, email);

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

  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function save(
  env: Env,
  author: LoginResult,
  itemId: string,
  sourceText: string,
): Promise<RevisionResponse["revision"]> {
  const response = await appRequest(
    createTestApp(),
    `/content/${itemId}/revisions`,
    jsonRequest({ sourceText }, author),
    env,
  );

  expect(response.status).toBe(201);

  return ((await response.json()) as RevisionResponse).revision;
}

async function share(
  env: Env,
  author: LoginResult,
  revisionId: string,
  sharing: string,
): Promise<void> {
  const response = await appRequest(
    createTestApp(),
    `/content/revisions/${revisionId}/sharing`,
    jsonRequest({ shareSource: false, sharing }, author),
    env,
  );

  expect(response.status).toBe(200);
}

async function page(
  env: Env,
  path: string,
  as: LoginResult,
): Promise<string> {
  const response = await appRequest(
    createTestApp(),
    path,
    { headers: { Accept: "text/html", Cookie: as.cookieHeader } },
    env,
  );

  expect(response.status).toBe(200);

  return response.text();
}

/** What a save of this source would record, compiled with no server. */
async function originsOf(source: string): Promise<CompiledSystemOrigins> {
  const result = await compileCarnapMarkdown(source);

  if (!result.ok) {
    throw new Error(result.diagnostics.map((one) => one.code).join(", "));
  }

  return result.systemOrigins;
}

/** A service that answers built-ins only, which never touch a store. */
const builtInsOnly = new ContentService({ stores: {} as AppStores });

describe("what a lesson records about its theories", () => {
  test("a built-in named by id records its address and the hash of its file", async () => {
    expect(await originsOf(CALGARY_LESSON)).toEqual({
      "forallx-calgary": {
        hash: await mm0TextHash(theoryByPath(CALGARY) ?? ""),
        src: CALGARY,
      },
    });
  });

  test("a src with a body records the address's text, not the extension", async () => {
    const origins =
      await originsOf(`:::aufbau-mm0{name="mine" src="${CALGARY}"}
--| @syntax delimiter $ Cube $
term Cube (x: name): wff;
:::

${CALGARY_LESSON.replace("forallx-calgary", "mine")}`);

    expect(origins.mine).toEqual({
      hash: await mm0TextHash(theoryByPath(CALGARY) ?? ""),
      src: CALGARY,
    });
  });

  test("a theory written in the lesson has no origin", async () => {
    expect(
      await originsOf(
        lessonNaming(CALGARY)
          .replace(` src="${CALGARY}"`, "")
          .replace(
            ":::\n\n::::aufbau-proof",
            `${THEORY_V1}:::\n\n::::aufbau-proof`,
          ),
      ),
    ).toEqual({});
  });

  test("the artifact does not carry them", async () => {
    const result = await compileCarnapMarkdown(CALGARY_LESSON);

    expect(result.ok && "systemOrigins" in result.artifact).toBe(false);
  });

  test("a hosted theory's recorded hash is that revision's content hash", async () => {
    await withStorage(async (storage, env) => {
      const author = await login(env, "author@example.test");
      const theory = await save(
        env,
        author,
        await createItem(env, author, "mm0"),
        THEORY_V1,
      );
      const lesson = await save(
        env,
        author,
        await createItem(env, author, "markdown"),
        lessonNaming(hostedTheoryPath(theory.id)),
      );

      expect(
        (await storage.stores.content.getRevision(lesson.id))?.systemOrigins,
      ).toEqual({
        hosted: {
          hash: theory.contentHash,
          src: hostedTheoryPath(theory.id),
        },
      });
    });
  });

  test("a lesson's content hash covers the theories it read", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const lesson = await save(
        env,
        author,
        await createItem(env, author, "markdown"),
        CALGARY_LESSON,
      );

      // Not the source alone: the same source over a changed built-in must
      // save as a new revision rather than be refused as a duplicate.
      expect(lesson.contentHash).not.toBe(
        await sha256Id(`carnap-markdown-v1\n${CALGARY_LESSON}`),
      );
    });
  });
});

describe("a built-in that has changed", () => {
  test("is outdated when its file no longer hashes as recorded", async () => {
    expect(
      await builtInsOnly.outdatedTheories(null, {
        "forallx-calgary": { hash: "sha256:older", src: CALGARY },
      }),
    ).toEqual([{ current: CALGARY, src: CALGARY }]);
  });

  test("is not outdated when it still hashes as recorded", async () => {
    expect(
      await builtInsOnly.outdatedTheories(
        null,
        await originsOf(CALGARY_LESSON),
      ),
    ).toEqual([]);
  });

  test("two names for one address are one warning", async () => {
    const stale = { hash: "sha256:older", src: CALGARY };

    expect(
      await builtInsOnly.outdatedTheories(null, { a: stale, b: stale }),
    ).toHaveLength(1);
  });

  test("a revision saved before origins were recorded says nothing", async () => {
    expect(await builtInsOnly.outdatedTheories(null, {})).toEqual([]);
  });

  test("one this site no longer serves says nothing", async () => {
    expect(
      await builtInsOnly.outdatedTheories(null, {
        gone: { hash: "sha256:older", src: "/theories/gone.mm0" },
      }),
    ).toEqual([]);
  });

  test("a batch answers each revision on its own", async () => {
    const stale = { hash: "sha256:older", src: CALGARY };

    expect(
      await builtInsOnly.outdatedTheoriesOf(null, [
        { a: stale },
        await originsOf(CALGARY_LESSON),
        {},
      ]),
    ).toEqual([[{ current: CALGARY, src: CALGARY }], [], []]);
  });
});

describe("a hosted theory with a newer revision", () => {
  test("warns on the lesson's page once the theory moves on", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const theoryId = await createItem(env, author, "mm0");
      const v1 = await save(env, author, theoryId, THEORY_V1);
      const lessonId = await createItem(env, author, "markdown");

      await save(
        env,
        author,
        lessonId,
        lessonNaming(hostedTheoryPath(v1.id)),
      );

      expect(await page(env, `/content/${lessonId}`, author)).not.toContain(
        "has a newer revision",
      );

      const v2 = await save(env, author, theoryId, THEORY_V2);
      const html = await page(env, `/content/${lessonId}`, author);

      expect(html).toContain("has a newer revision");
      expect(html).toContain(hostedTheoryPath(v2.id));
    });
  });

  test("warns on an assignment publishing the lesson", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const theoryId = await createItem(env, author, "mm0");
      const v1 = await save(env, author, theoryId, THEORY_V1);
      const lesson = await save(
        env,
        author,
        await createItem(env, author, "markdown"),
        lessonNaming(hostedTheoryPath(v1.id)),
      );
      const courseId = await createCourse(env, author);
      const created = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments`,
        jsonRequest(
          { contentRevisionId: lesson.id, title: "Homework 1" },
          author,
        ),
        env,
      );

      expect(created.status).toBe(201);

      const assignmentId = (
        (await created.json()) as { assignment: { id: string } }
      ).assignment.id;
      const path = `/courses/${courseId}/instructor/assignments/${assignmentId}`;

      expect(await page(env, path, author)).not.toContain(
        "has a newer revision",
      );

      const v2 = await save(env, author, theoryId, THEORY_V2);
      const html = await page(env, path, author);

      expect(html).toContain("has a newer revision");
      expect(html).toContain(hostedTheoryPath(v2.id));
    });
  });

  test("names only a revision the reader may read", async () => {
    await withStorage(async (_storage, env) => {
      const owner = await login(env, "owner@example.test");
      const borrower = await login(env, "borrower@example.test");
      const theoryId = await createItem(env, owner, "mm0");
      const v1 = await save(env, owner, theoryId, THEORY_V1);

      await share(env, owner, v1.id, "authors");

      const lessonId = await createItem(env, borrower, "markdown");

      await save(
        env,
        borrower,
        lessonId,
        lessonNaming(hostedTheoryPath(v1.id)),
      );

      // A draft the owner has not shared is no news to anyone else.
      const v2 = await save(env, owner, theoryId, THEORY_V2);

      expect(await page(env, `/content/${lessonId}`, borrower)).not.toContain(
        "has a newer revision",
      );

      await share(env, owner, v2.id, "authors");

      const html = await page(env, `/content/${lessonId}`, borrower);

      expect(html).toContain("has a newer revision");
      expect(html).toContain(hostedTheoryPath(v2.id));
    });
  });

  test("checks only the latest revision of the lesson", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const theoryId = await createItem(env, author, "mm0");
      const v1 = await save(env, author, theoryId, THEORY_V1);
      const lessonId = await createItem(env, author, "markdown");

      await save(
        env,
        author,
        lessonId,
        lessonNaming(hostedTheoryPath(v1.id)),
      );

      const v2 = await save(env, author, theoryId, THEORY_V2);

      // Taking the change up is what the warning asks for, and it goes.
      await save(
        env,
        author,
        lessonId,
        lessonNaming(hostedTheoryPath(v2.id)),
      );

      expect(await page(env, `/content/${lessonId}`, author)).not.toContain(
        "has a newer revision",
      );
    });
  });
});

describe("the content library", () => {
  const MARK = 'class="outdated-mark"';

  test("marks a lesson whose latest revision is built on an outdated theory", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const theoryId = await createItem(env, author, "mm0");
      const v1 = await save(env, author, theoryId, THEORY_V1);
      const lessonId = await createItem(env, author, "markdown");

      await save(
        env,
        author,
        lessonId,
        lessonNaming(hostedTheoryPath(v1.id)),
      );

      expect(await page(env, "/content", author)).not.toContain(MARK);

      await save(env, author, theoryId, THEORY_V2);

      const html = await page(env, "/content", author);
      const row = html.slice(
        html.indexOf(`/content/${lessonId}"`),
        html.indexOf("</tr>", html.indexOf(`/content/${lessonId}"`)),
      );

      // On the lesson's row, and only there: the theory item has no origins.
      expect(row).toContain(MARK);
      expect(html.split(MARK)).toHaveLength(2);
    });
  });

  test("does not mark a lesson whose newer theory revision is not shared with its author", async () => {
    await withStorage(async (_storage, env) => {
      const owner = await login(env, "owner@example.test");
      const borrower = await login(env, "borrower@example.test");
      const theoryId = await createItem(env, owner, "mm0");
      const v1 = await save(env, owner, theoryId, THEORY_V1);

      await share(env, owner, v1.id, "authors");

      const lessonId = await createItem(env, borrower, "markdown");

      await save(
        env,
        borrower,
        lessonId,
        lessonNaming(hostedTheoryPath(v1.id)),
      );

      const v2 = await save(env, owner, theoryId, THEORY_V2);

      expect(await page(env, "/content", borrower)).not.toContain(MARK);

      await share(env, owner, v2.id, "authors");

      expect(await page(env, "/content", borrower)).toContain(MARK);
    });
  });
});
