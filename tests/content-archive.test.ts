import { describe, expect, setDefaultTimeout, test } from "bun:test";

import type { Env } from "../src/worker/env";
import {
  grantTestContentAuthor,
  grantTestCourseCreator,
} from "./helpers/admin";
import { appRequest, createTestApp } from "./helpers/app";
import { createTestStorage, type TestStorage } from "./helpers/storage";

setDefaultTimeout(30_000);

/**
 * Archiving is a fact about the library and about nothing else: the item
 * folds out of the listing and out of the picker a new assignment is set
 * from, while its revisions go on resolving for everyone who already holds
 * an address to one — a published assignment, a colleague's `src=`, the open
 * web. These tests pin both halves.
 */

const LESSON = `# Lesson

::::multiple-choice{#one title="One" points="1"}
Which?

- [x] yes | Yes
- [ ] no | No
::::`;

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
  readonly item: {
    readonly archivedAt: string | null;
    readonly id: string;
    readonly updatedAt: string;
  };
}

interface ItemListResponse {
  readonly items: readonly ItemResponse["item"][];
}

interface RevisionResponse {
  readonly revision: { readonly id: string };
}

interface CourseResponse {
  readonly course: { readonly id: string };
}

interface AssignmentResponse {
  readonly assignment: { readonly id: string };
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

function asPage(login?: LoginResult): RequestInit {
  return {
    headers: {
      Accept: "text/html",
      ...(login === undefined ? {} : { Cookie: login.cookieHeader }),
    },
  };
}

/** Signed in and allowed to write content. */
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
  title: string,
): Promise<ItemResponse["item"]> {
  const response = await appRequest(
    createTestApp(),
    "/content",
    jsonRequest({ title }, author),
    env,
  );

  expect(response.status).toBe(201);

  return ((await response.json()) as ItemResponse).item;
}

async function saveRevision(
  env: Env,
  author: LoginResult,
  itemId: string,
): Promise<string> {
  const response = await appRequest(
    createTestApp(),
    `/content/${itemId}/revisions`,
    jsonRequest({ sourceText: LESSON }, author),
    env,
  );

  expect(response.status).toBe(201);

  return ((await response.json()) as RevisionResponse).revision.id;
}

async function setArchived(
  env: Env,
  author: LoginResult,
  itemId: string,
  archived: boolean,
): Promise<Response> {
  return appRequest(
    createTestApp(),
    `/content/${itemId}/${archived ? "archive" : "unarchive"}`,
    jsonRequest({}, author),
    env,
  );
}

async function listItems(
  env: Env,
  author: LoginResult,
): Promise<readonly ItemResponse["item"][]> {
  const response = await appRequest(
    createTestApp(),
    "/content",
    { headers: { Cookie: author.cookieHeader } },
    env,
  );

  expect(response.status).toBe(200);

  return ((await response.json()) as ItemListResponse).items;
}

async function createCourse(
  env: Env,
  instructor: LoginResult,
): Promise<string> {
  await grantTestCourseCreator(env, instructor.actorId);

  const response = await appRequest(
    createTestApp(),
    "/courses",
    jsonRequest({ timezone: "UTC", title: "Intro Logic" }, instructor),
    env,
  );

  expect(response.status).toBe(201);

  return ((await response.json()) as CourseResponse).course.id;
}

describe("archiving a content item", () => {
  test("sets archivedAt, and unarchiving clears it, without touching updatedAt", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const item = await createItem(env, author, "Old lesson");

      expect(item.archivedAt).toBeNull();

      const archived = await setArchived(env, author, item.id, true);
      const archivedBody = (await archived.json()) as ItemResponse;

      expect(archived.status).toBe(200);
      expect(typeof archivedBody.item.archivedAt).toBe("string");
      // Folding an item away is not writing to it: the column that orders
      // the library says when the content last changed, and it did not.
      expect(archivedBody.item.updatedAt).toBe(item.updatedAt);

      const listed = await listItems(env, author);

      expect(listed.map((entry) => entry.archivedAt)).toEqual([
        archivedBody.item.archivedAt,
      ]);

      const unarchived = await setArchived(env, author, item.id, false);
      const unarchivedBody = (await unarchived.json()) as ItemResponse;

      expect(unarchived.status).toBe(200);
      expect(unarchivedBody.item.archivedAt).toBeNull();
      expect(unarchivedBody.item.updatedAt).toBe(item.updatedAt);
    });
  });

  test("is not somebody else's to do", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const other = await login(env, "other@example.test");
      const item = await createItem(env, author, "Mine");
      const response = await setArchived(env, other, item.id, true);
      const body = (await response.json()) as ErrorEnvelope;

      // The same miss a stranger gets for an id that names nothing, so this
      // is not a second way to tell an id that exists from one that does not.
      expect(response.status).toBe(404);
      expect(body.error.code).toBe("content_item_not_found");

      const [listed] = await listItems(env, author);

      expect(listed?.archivedAt).toBeNull();
    });
  });

  test("the library folds it into a drawer, and the row's form comes back to the library", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const kept = await createItem(env, author, "This term");
      const retired = await createItem(env, author, "Last term");

      // The archive control is the row's form, so archive the way it does.
      const form = new URLSearchParams({ csrfToken: author.csrfToken });
      const submitted = await appRequest(
        createTestApp(),
        `/content/${retired.id}/archive`,
        {
          body: form,
          headers: { Cookie: author.cookieHeader },
          method: "POST",
        },
        env,
      );

      expect(submitted.status).toBe(303);
      expect(submitted.headers.get("location")).toBe("/content?archived=1");

      const library = await appRequest(
        createTestApp(),
        "/content?archived=1",
        asPage(author),
        env,
      );
      const libraryHtml = await library.text();

      expect(library.status).toBe(200);
      expect(libraryHtml).toContain("Content item archived.");
      expect(libraryHtml).toContain("Archived content (1)");
      // Each row carries the way across: the kept item an archive form, the
      // retired one an unarchive form, and neither the other.
      expect(libraryHtml).toContain(`/content/${kept.id}/archive"`);
      expect(libraryHtml).toContain(`/content/${retired.id}/unarchive"`);
      expect(libraryHtml).not.toContain(`/content/${kept.id}/unarchive"`);
      expect(libraryHtml).not.toContain(`/content/${retired.id}/archive"`);
      // The retired title appears once, inside the drawer.
      expect(libraryHtml.split(`/content/${retired.id}"`).length).toBe(2);
      expect(libraryHtml.indexOf(`/content/${retired.id}"`)).toBeGreaterThan(
        libraryHtml.indexOf("Archived content (1)"),
      );
    });
  });

  test("a shared revision stays readable at its address", async () => {
    await withStorage(async (_storage, env) => {
      const author = await login(env, "author@example.test");
      const item = await createItem(env, author, "Shared lesson");
      const revisionId = await saveRevision(env, author, item.id);
      const shared = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}/sharing`,
        jsonRequest({ shareSource: false, sharing: "public" }, author),
        env,
      );

      expect(shared.status).toBe(200);

      await setArchived(env, author, item.id, true);

      // Archiving is a library-view concern, not a sharing or existence
      // change: the open web still reads what it was given the address of.
      const document = await appRequest(
        createTestApp(),
        `/content/revisions/${revisionId}/document`,
        asPage(),
        env,
      );

      expect(document.status).toBe(200);
    });
  });

  test("a new assignment is not offered it, but one already set on it keeps it", async () => {
    await withStorage(async (_storage, env) => {
      const instructor = await login(env, "instructor@example.test");
      const courseId = await createCourse(env, instructor);
      const kept = await createItem(env, instructor, "This term");
      const keptRevision = await saveRevision(env, instructor, kept.id);
      const retired = await createItem(env, instructor, "Last term");
      const retiredRevision = await saveRevision(env, instructor, retired.id);

      // Set while the item was still in use, as any existing assignment was.
      const draft = await appRequest(
        createTestApp(),
        `/courses/${courseId}/assignments`,
        jsonRequest(
          {
            contentRevisionId: retiredRevision,
            description: "",
            title: "Homework 1",
          },
          instructor,
        ),
        env,
      );

      expect(draft.status).toBe(201);

      const assignmentId = ((await draft.json()) as AssignmentResponse)
        .assignment.id;

      await setArchived(env, instructor, retired.id, true);

      const newPage = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/new`,
        asPage(instructor),
        env,
      );
      const newHtml = await newPage.text();

      expect(newPage.status).toBe(200);
      expect(newHtml).toContain(`value="${keptRevision}"`);
      expect(newHtml).not.toContain(`value="${retiredRevision}"`);

      // The draft's own editor keeps the item it points at: without it the
      // select would silently preselect some other lesson.
      const editPage = await appRequest(
        createTestApp(),
        `/courses/${courseId}/instructor/assignments/${assignmentId}/edit`,
        asPage(instructor),
        env,
      );
      const editHtml = await editPage.text();

      expect(editPage.status).toBe(200);
      expect(editHtml).toContain(`value="${keptRevision}"`);
      expect(editHtml).toContain(`selected="" value="${retiredRevision}"`);
    });
  });
});
