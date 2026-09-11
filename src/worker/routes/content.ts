import { type Context, Hono } from "hono";
import { raw } from "hono/html";

import type { AuthenticatedActor } from "../application/auth";
import {
  canAuthorContent,
  requireAuthenticated,
  requireContentAuthor,
} from "../application/authorization";
import { ContentService, canReadSource } from "../application/content";
import {
  contentArtifactFromRevision,
  theoryArtifactFromRevision,
} from "../application/content/artifact";
import { compileCarnapMarkdown } from "../application/content/compiler";
import { compileTheorySource } from "../application/content/mm0";
import {
  componentAssetsForArtifact,
  exerciseHydrationForArtifact,
  renderCompiledContent,
} from "../application/content/renderer";
import { AppHttpError, badRequest } from "../application/errors";
import type {
  ContentItem,
  ContentRevision,
  ContentSourceFormat,
} from "../domain/content";
import type { AppBindings } from "../http";
import { deferred } from "../i18n/deferred";
import type { Translator } from "../i18n/translator";
import { HOSTED_THEORY_SUFFIX, hostedTheoryPath } from "../logic/theories";
import { storesForContext } from "../stores";
import { hashAssetText } from "../web/asset-hash";
import {
  renderContentCreateError,
  renderContentError,
  renderContentItem,
  renderContentLibrary,
  renderRevision,
  renderRevisionCreateError,
  renderRevisionDocument,
  renderRevisionEditor,
  sampleSource,
} from "../web/content";
import {
  artifactDocumentProps,
  contentDocumentHtml,
} from "../web/content-document";
import { sourceDownloadHeaders } from "../web/download";
import {
  fieldValue,
  isFormSubmission,
  redirect,
  wantsHtml,
} from "../web/html";
import { revisionDateText } from "../web/revisions";
import { resolveUsers } from "../web/users";

/**
 * A day, then revalidate. Longer than the built-in theories' hour because a
 * revision's bytes cannot change at all — only a deploy can change theirs —
 * and the ETag makes the asking cheap either way.
 *
 * Whether a shared cache may keep a copy is the revision's scope, decided per
 * response rather than once for the route: a public theory is the same bytes
 * for everyone who can ask, and anything narrower is answered per reader. That
 * is a deliberate decision about CDNs, not a side effect of one — get it wrong
 * in the generous direction and a cache hands an author's private theory to
 * the next person who asks for the URL.
 */
function theorySourceCacheControl(revision: ContentRevision): string {
  return `${revision.sharing === "public" ? "public" : "private"}, max-age=86400, must-revalidate`;
}

interface CreateContentBody {
  readonly sourceFormat?: unknown;
  readonly title?: unknown;
}

interface SetSharingBody {
  readonly shareSource?: unknown;
  readonly sharing?: unknown;
}

interface CreateRevisionBody {
  readonly details?: unknown;
  readonly sourceText?: unknown;
}

function contentService(context: Context<AppBindings>): ContentService {
  return new ContentService({ stores: storesForContext(context) });
}

async function readJsonObject(
  context: Context<AppBindings>,
): Promise<Record<string, unknown>> {
  try {
    const body = await context.req.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw badRequest("invalid_json", "A JSON object is required.");
    }

    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppHttpError) {
      throw error;
    }

    throw badRequest("invalid_json", "A JSON object is required.");
  }
}

function requiredParam(context: Context<AppBindings>, name: string): string {
  const value = context.req.param(name);

  if (value === undefined) {
    throw badRequest(
      "missing_route_parameter",
      "A route parameter is missing.",
    );
  }

  return value;
}

/**
 * The login redirect an anonymous request gets, or `null` for a signed-in one.
 *
 * Called on the *miss* path now rather than before anything is read: a public
 * item is readable from the open web, so a read has to happen before it is
 * known whether signing in is the answer. What has not changed is that a
 * stranger gets one answer for "no such item" and "not shared with you" —
 * both are this redirect — because a 404 for one and a redirect for the other
 * would be the existence oracle every 404 in `ContentService` was written to
 * close, rebuilt out of status codes.
 */
function webActorOrLogin(context: Context<AppBindings>): Response | null {
  if (context.get("actor") !== null) {
    return null;
  }

  const next = new URL(context.req.url).pathname;

  return redirect(`/login?next=${encodeURIComponent(next)}`, 302);
}

/**
 * Who is asking, allowing for nobody. `requireAuthenticated` is still what the
 * authoring routes call: they have nothing to offer an anonymous request, and
 * a 401 that does not depend on which id was named tells a stranger nothing.
 */
function readingActor(
  context: Context<AppBindings>,
): AuthenticatedActor | null {
  return context.get("actor");
}

/**
 * How a content *page* answers a read that found nothing: the service's own
 * words to somebody signed in, and the login redirect to somebody who is not.
 * Anything that is not an `AppHttpError` is a fault rather than an answer, and
 * is rethrown.
 */
function contentReadFailure(
  context: Context<AppBindings>,
  error: unknown,
): Response {
  if (!(error instanceof AppHttpError)) {
    throw error;
  }

  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const i18n = context.get("i18n");

  return renderContentError(context, {
    message: error.localize(i18n),
    status: error.status,
    title: i18n.t("Content unavailable"),
  });
}

function publicContentItem(item: ContentItem) {
  return {
    createdAt: item.createdAt,
    id: item.id,
    ownerUserId: item.ownerUserId,
    title: item.title,
    updatedAt: item.updatedAt,
  };
}

function publicRevision(revision: ContentRevision) {
  return {
    compiled: revision.compiled,
    contentHash: revision.contentHash,
    createdAt: revision.createdAt,
    createdById: revision.createdById,
    details: revision.details,
    id: revision.id,
    itemId: revision.itemId,
    revisionNumber: revision.revisionNumber,
    shareSource: revision.shareSource,
    sharing: revision.sharing,
    sourceFormat: revision.sourceFormat,
    sourceText: revision.sourceText,
  };
}

function formFile(form: FormData, name: string): File | null {
  const value = form.get(name);

  if (!(value instanceof File) || value.size === 0) {
    return null;
  }

  return value;
}

async function revisionSourceTextFromForm(form: FormData): Promise<string> {
  const file = formFile(form, "sourceFile");

  if (file !== null) {
    return file.text();
  }

  return fieldValue(form.get("sourceText"));
}

/**
 * The flash notices this page can show, keyed by the query parameter that asks
 * for one — a redirect names a *reason*, so no sentence travels in a URL. A
 * function rather than a table because a reason is only a sentence once a
 * language is known.
 */
function itemNotices(
  i18n: Translator,
): readonly { readonly message: string; readonly param: string }[] {
  return [
    { message: i18n.t("Content item created."), param: "created" },
    { message: i18n.t("Revision created."), param: "revisionCreated" },
    { message: i18n.t("Sharing updated."), param: "sharingUpdated" },
  ];
}

function collectItemNotices(url: URL, i18n: Translator): readonly string[] {
  return itemNotices(i18n)
    .filter((entry) => url.searchParams.has(entry.param))
    .map((entry) => entry.message);
}

async function libraryPage(context: Context<AppBindings>): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const service = contentService(context);
  const items = await service.listItems(actor);

  return renderContentLibrary(context, {
    canAuthor: canAuthorContent(actor),
    items,
    // What each row's download would hand over. An item created a minute ago
    // and never written to has no revision and no entry here, and the listing
    // draws no download for it.
    latestRevisionIds: await service.latestRevisionIds(actor, items),
  });
}

async function createContentFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const form = await context.req.raw.formData();
  const title = fieldValue(form.get("title"));

  try {
    const item = await contentService(context).createItem(actor, {
      sourceFormat: fieldValue(form.get("sourceFormat")),
      title,
    });

    return redirect(`/content/${item.id}?created=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      return renderContentCreateError(context, {
        message: error.localize(context.get("i18n")),
        status: error.status,
      });
    }

    throw error;
  }
}

/**
 * The item page, which is the owner's: its history, its editor, and the share
 * control for each revision in it. A scope opens a *revision*, at the address
 * that names it — so a colleague who was sent one reads it there and has no
 * business on this page, and `getItem` still answers them with a miss.
 */
async function itemPage(context: Context<AppBindings>): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const service = contentService(context);
  const itemId = requiredParam(context, "itemId");
  const url = new URL(context.req.url);

  try {
    const item = await service.getItem(actor, itemId);
    const revisions = await service.listRevisions(actor, itemId);
    const directory = await resolveUsers(context, [item.ownerUserId]);

    return renderContentItem(context, {
      canAuthor: canAuthorContent(actor),
      item,
      notices: collectItemNotices(url, context.get("i18n")),
      owner: directory.get(item.ownerUserId) ?? null,
      revisions,
    });
  } catch (error) {
    return contentReadFailure(context, error);
  }
}

async function createRevisionFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const itemId = requiredParam(context, "itemId");
  const form = await context.req.raw.formData();
  const sourceText = await revisionSourceTextFromForm(form);

  try {
    await contentService(context).createRevision(actor, itemId, {
      details: fieldValue(form.get("details")),
      sourceText,
    });

    return redirect(`/content/${itemId}?revisionCreated=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      return renderRevisionCreateError(context, {
        itemId,
        message: error.localize(context.get("i18n")),
        status: error.status,
      });
    }

    throw error;
  }
}

/**
 * Who may read this revision, set from the dialog on its row of the item page.
 *
 * A form of its own rather than a field on the revision editor: a revision is
 * finished when it is saved, and sharing it is a decision about a finished
 * thing — one an author makes about last term's lesson without opening an
 * editor or writing anything new.
 *
 * It redirects back to the item page, which is where the row is.
 */
async function setSharingFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const revisionId = requiredParam(context, "revisionId");
  const form = await context.req.raw.formData();

  try {
    const revision = await contentService(context).setRevisionSharing(
      actor,
      revisionId,
      {
        // A checkbox that is off sends nothing at all, which is the same shape
        // as a form that has no checkbox — an MM0 revision's, where the
        // setting is meaningless and the service normalizes it away anyway.
        shareSource: fieldValue(form.get("shareSource")) === "1",
        sharing: fieldValue(form.get("sharing")),
      },
    );

    return redirect(`/content/${revision.itemId}?sharingUpdated=1`);
  } catch (error) {
    return contentReadFailure(context, error);
  }
}

/**
 * The editor page for a given source: initial diagnostics and a
 * server-compiled preview document, after which the preview bundle keeps
 * both current on the client as the author types.
 *
 * An MM0 item gets the diagnostics and no preview. There is no document to
 * build from a theory, and the summary of what one declares belongs on the
 * revision page beside the address a lesson names it by — which is where it is
 * useful and where there is something saved to describe.
 */
async function renderEditor(
  context: Context<AppBindings>,
  item: ContentItem,
  sourceText: string,
  details: string,
  failure?: {
    readonly error: string;
    readonly status: AppHttpError["status"];
  },
): Promise<Response> {
  const i18n = context.get("i18n");
  const shared = {
    details,
    itemId: item.id,
    itemTitle: item.title,
    sourceFormat: item.sourceFormat,
    sourceText,
    ...(failure === undefined
      ? {}
      : { error: failure.error, status: failure.status }),
  };

  if (item.sourceFormat === "mm0") {
    const compiled = compileTheorySource(sourceText);

    return renderRevisionEditor(context, {
      ...shared,
      diagnostics: compiled.diagnostics,
      previewDocumentHtml: null,
    });
  }

  const compiled = await compileCarnapMarkdown(sourceText, {
    // The same theories the save will resolve, resolved the same way, so the
    // preview cannot say a lesson compiles when the save will refuse it — or
    // the reverse.
    resolveTheory: contentService(context).theoryResolver(
      requireAuthenticated(context),
    ),
  });
  const artifact = compiled.ok ? compiled.artifact : null;

  return renderRevisionEditor(context, {
    ...shared,
    // A `CompilerDiagnostic` already satisfies the view's narrower model, and
    // remapping it field by field is how `params` got dropped on the way out.
    diagnostics: compiled.diagnostics,
    // The unsaved source has no document URL, so the preview builds the
    // whole content document and embeds it via iframe srcdoc.
    previewDocumentHtml:
      artifact === null
        ? null
        : contentDocumentHtml({
            body: raw(renderCompiledContent(artifact, i18n)),
            componentAssets: componentAssetsForArtifact(artifact),
            exerciseHydration: exerciseHydrationForArtifact(artifact, i18n),
            i18n,
            locale: context.get("language"),
            ...artifactDocumentProps(artifact),
            title: i18n.t("Preview"),
          }),
  });
}

async function revisionEditorPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const itemId = requiredParam(context, "itemId");
  const service = contentService(context);

  try {
    // Refused here rather than at the save: an editor that cannot save is a
    // worse answer than a page saying so, and it invites work that gets thrown
    // away on submit.
    requireContentAuthor(actor);

    const item = await service.getItem(actor, itemId);
    // A new revision starts from where the item left off; the sample is
    // only for an item with no revisions yet, and is in the item's format.
    // The list is newest first, so the head of it is where the item left off.
    const latest = (await service.listRevisions(actor, itemId))[0];

    // A fresh editor has no note yet: the field is for what this save changes,
    // not what the previous one did.
    return renderEditor(
      context,
      item,
      latest?.sourceText ?? sampleSource(item.sourceFormat),
      "",
    );
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderContentError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Content unavailable"),
      });
    }

    throw error;
  }
}

async function revisionEditorSubmit(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const itemId = requiredParam(context, "itemId");
  const service = contentService(context);

  let item: ContentItem;

  try {
    requireContentAuthor(actor);

    item = await service.getItem(actor, itemId);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderContentError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Content unavailable"),
      });
    }

    throw error;
  }

  const form = await context.req.raw.formData();
  const sourceText = fieldValue(form.get("sourceText"));
  const details = fieldValue(form.get("details"));

  // Previewing is client-side now; the only thing this form does is save.
  try {
    await service.createRevision(actor, itemId, { details, sourceText });

    return redirect(`/content/${itemId}?revisionCreated=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      // The re-rendered editor compiles the rejected source, so the page
      // carries the diagnostics even before the preview bundle loads.
      return renderEditor(context, item, sourceText, details, {
        error: error.localize(context.get("i18n")),
        status: error.status,
      });
    }

    throw error;
  }
}

async function revisionPage(
  context: Context<AppBindings>,
): Promise<Response> {
  let item: ContentItem;
  let revision: ContentRevision;

  try {
    ({ item, revision } = await contentService(context).readRevision(
      readingActor(context),
      requiredParam(context, "revisionId"),
    ));
  } catch (error) {
    return contentReadFailure(context, error);
  }

  return renderRevision(context, {
    details: revision.details,
    itemId: item.id,
    itemTitle: item.title,
    revisionId: revision.id,
    // Whether the item page the crumb would lead to is theirs to open. A
    // colleague reading a shared revision has no page there, so the crumb
    // names the lesson without linking it rather than offering a 404.
    owned: item.ownerUserId === readingActor(context)?.user.id,
    // The page reads; the source is a second permission, and the panel is
    // simply absent for a reader who does not have it.
    sourceText: canReadSource(revision, item, readingActor(context))
      ? revision.sourceText
      : null,
    // A lesson's compiled form is a document the page frames; a theory's is a
    // summary, and it is read here rather than rendered anywhere else.
    ...(revision.sourceFormat === "mm0"
      ? { theory: theoryArtifactFromRevision(revision) }
      : {}),
  });
}

/**
 * A revision's source as a file, for an author who would rather work on it in
 * their own editor and upload the result. The source is what a revision is
 * made of, so this is a download of the record itself rather than an export of
 * it — no rendering, no compiled artifact, nothing that would not compile back
 * to the same revision.
 *
 * Both formats, named as themselves: a theory is a file an author edits and
 * uploads back like any other, and `/theory.mm0` is the address to read one
 * at, not a reason a theory cannot be saved. The one route serves either
 * because the record is the same record — only its name and type differ.
 */
async function revisionSourceDownload(
  context: Context<AppBindings>,
): Promise<Response> {
  let item: ContentItem;
  let revision: ContentRevision;

  try {
    // The source, which is a narrower permission than the reading of it: a
    // lesson's Markdown carries the accepted answers and the rubric that the
    // compiled document deliberately withholds.
    ({ item, revision } = await contentService(context).readRevisionSource(
      readingActor(context),
      requiredParam(context, "revisionId"),
    ));
  } catch (error) {
    // A stranger is sent to sign in, as everywhere else; a signed-in reader
    // gets the error itself rather than a rendered page, because this address
    // is a file and its caller is a download.
    const loginRedirect = webActorOrLogin(context);

    if (loginRedirect !== null) {
      return loginRedirect;
    }

    throw error;
  }

  return new Response(revision.sourceText, {
    headers: sourceDownloadHeaders(revision.sourceFormat, {
      // When the revision was saved, not when it was downloaded: the file is a
      // copy of a fixed thing, and two downloads of it should land on the same
      // name rather than accumulate in a folder. A content item belongs to no
      // course, so there is no clock to prefer over UTC.
      at: new Date(revision.createdAt),
      // The item names the file; the author's note, where there is one,
      // distinguishes revisions of it the way it does everywhere else a
      // revision is named to a reader.
      parts: [item.title, revision.details],
      timezone: "UTC",
    }),
  });
}

/**
 * A hosted theory at the address a lesson names it by.
 *
 * The second backing of the theory URL namespace: `/theories/…` is answered
 * from the module graph, this is answered from the database, and an
 * `aufbau-mm0` block's `src=` does not care which. Served rather than only
 * resolved for the reason the built-ins are — an author who writes a path
 * should be able to open it and read the rules their students will cite.
 *
 * Inline text, deliberately not the download `/source` is: a download saves a
 * file with a generated name instead of showing anything, which is the
 * opposite of what an address is for here.
 *
 * **It serves exactly what a lesson can resolve, by asking the same question.**
 * The resolver is the one place the rule lives — yours, and a theory — so the
 * route cannot come to disagree with the compiler about what is at an address.
 * That also gives every miss one answer: no such revision, not yours, and not
 * a theory are all 404, where reading the revision through the service would
 * have said 403 to the second and told a stranger it exists.
 *
 * A revision never changes, so its bytes can be cached hard. `private` because
 * a hosted theory is its owner's alone — there is no sharing layer yet, and a
 * shared cache holding one keyed by URL would be the beginnings of one nobody
 * designed.
 */
async function revisionTheorySource(
  context: Context<AppBindings>,
): Promise<Response> {
  const found = await contentService(context).hostedTheory(
    readingActor(context),
    hostedTheoryPath(requiredParam(context, "revisionId")),
  );

  if (found === null) {
    // The same answer to "there is nothing there" and "not shared with you",
    // and to a stranger the same answer as either: sign in, and we will see.
    return webActorOrLogin(context) ?? context.notFound();
  }

  const { revision, source } = found;

  return new Response(source, {
    headers: {
      "Cache-Control": theorySourceCacheControl(revision),
      // Plain text, not a download, and not a media type invented for MM0:
      // the point is to be readable in a tab, and a type no browser knows
      // only invites it to guess.
      "Content-Type": "text/plain; charset=utf-8",
      ETag: `"${hashAssetText(source)}"`,
    },
  });
}

/**
 * Refuse a revision of the wrong kind, as a miss rather than a failure.
 *
 * A route is written for one format — a document page renders a lesson, the
 * MM0 route serves a theory — and handing it the other is not a broken
 * artifact but an address that does not name anything: there is no document at
 * a theory's id, and no theory at a lesson's. Saying 404 rather than letting
 * the artifact read boundary throw keeps a 500 for what it is for, a row that
 * really is unreadable.
 */
function requireFormat(
  revision: ContentRevision,
  format: ContentSourceFormat,
): void {
  if (revision.sourceFormat !== format) {
    throw new AppHttpError(
      404,
      "content_revision_not_found",
      deferred.i18n.t("The content revision was not found."),
    );
  }
}

async function revisionDocumentPage(
  context: Context<AppBindings>,
): Promise<Response> {
  let item: ContentItem;
  let revision: ContentRevision;

  try {
    ({ item, revision } = await contentService(context).readRevision(
      readingActor(context),
      requiredParam(context, "revisionId"),
    ));
    requireFormat(revision, "markdown");
  } catch (error) {
    return contentReadFailure(context, error);
  }

  const artifact = contentArtifactFromRevision(revision);
  const i18n = context.get("i18n");

  return renderRevisionDocument(context, {
    compiledHtml: renderCompiledContent(artifact, i18n),
    componentAssets: componentAssetsForArtifact(artifact),
    exerciseHydration: exerciseHydrationForArtifact(artifact, i18n),
    ...artifactDocumentProps(artifact),
    // The day rather than the ordinal, matching every other place a revision is
    // named to a reader. A `<time>` element cannot live in a document title, so
    // this date is formatted here rather than by the layout's client script.
    title: i18n.t("{title}, {date}", {
      date: revisionDateText(revision.createdAt, context.get("language")),
      title: item.title,
    }),
  });
}

export const contentRoutes = new Hono<AppBindings>();

contentRoutes.get("/", async (context) => {
  if (wantsHtml(context)) {
    return libraryPage(context);
  }

  const actor = requireAuthenticated(context);
  const items = await contentService(context).listItems(actor);

  return context.json({ items: items.map(publicContentItem) });
});

contentRoutes.post("/", async (context) => {
  if (isFormSubmission(context)) {
    return createContentFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as CreateContentBody;

  if (typeof body.title !== "string") {
    throw badRequest(
      "invalid_content_title",
      "Content title must be a string.",
    );
  }

  // Present-but-not-a-string is a caller mistake worth naming; absent is the
  // ordinary case, and the service reads it as a lesson.
  if (
    body.sourceFormat !== undefined &&
    typeof body.sourceFormat !== "string"
  ) {
    throw badRequest(
      "invalid_content_source_format",
      "Content source format must be a string.",
    );
  }

  const item = await contentService(context).createItem(actor, {
    ...(body.sourceFormat === undefined
      ? {}
      : { sourceFormat: body.sourceFormat }),
    title: body.title,
  });

  return context.json({ item: publicContentItem(item) }, 201);
});

// The library-side landing for `item:` links: compiled content carries the
// relative `../../go/<id>`, which resolves here from revision documents and
// editor previews. The item page decides who may read what it lands on.
contentRoutes.get("/go/:itemId", (context) =>
  redirect(`/content/${requiredParam(context, "itemId")}`, 302),
);

contentRoutes.post("/revisions/:revisionId/sharing", async (context) => {
  if (isFormSubmission(context)) {
    return setSharingFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as SetSharingBody;

  if (typeof body.sharing !== "string") {
    throw badRequest(
      "invalid_content_sharing",
      "Content sharing must be a string.",
    );
  }

  if (
    body.shareSource !== undefined &&
    typeof body.shareSource !== "boolean"
  ) {
    throw badRequest(
      "invalid_content_share_source",
      "Content source sharing must be a boolean.",
    );
  }

  const revision = await contentService(context).setRevisionSharing(
    actor,
    requiredParam(context, "revisionId"),
    { shareSource: body.shareSource === true, sharing: body.sharing },
  );

  return context.json({ revision: publicRevision(revision) });
});

contentRoutes.get("/revisions/:revisionId/document", (context) =>
  revisionDocumentPage(context),
);

contentRoutes.get("/revisions/:revisionId/source", (context) =>
  revisionSourceDownload(context),
);

contentRoutes.get(
  `/revisions/:revisionId${HOSTED_THEORY_SUFFIX}`,
  (context) => revisionTheorySource(context),
);

contentRoutes.get("/revisions/:revisionId", async (context) => {
  if (wantsHtml(context)) {
    return revisionPage(context);
  }

  // The same scope the page reads by, minus the redirect: a JSON caller is
  // asking a question, not navigating, and the 404 is the answer to every
  // form of no.
  const { revision } = await contentService(context).readRevision(
    readingActor(context),
    requiredParam(context, "revisionId"),
  );

  return context.json({ revision: publicRevision(revision) });
});

contentRoutes.get("/:itemId", async (context) => {
  if (wantsHtml(context)) {
    return itemPage(context);
  }

  const actor = requireAuthenticated(context);
  const service = contentService(context);
  const item = await service.getItem(actor, requiredParam(context, "itemId"));
  const revisions = await service.listRevisions(actor, item.id);

  return context.json({
    item: publicContentItem(item),
    revisions: revisions.map(publicRevision),
  });
});

contentRoutes.get("/:itemId/revisions/new", revisionEditorPage);

contentRoutes.post("/:itemId/revisions/new", revisionEditorSubmit);

contentRoutes.post("/:itemId/revisions", async (context) => {
  if (isFormSubmission(context)) {
    return createRevisionFromForm(context);
  }

  const actor = requireAuthenticated(context);
  const body = (await readJsonObject(context)) as CreateRevisionBody;

  if (typeof body.sourceText !== "string") {
    throw badRequest(
      "invalid_content_source",
      "Content source must be a string.",
    );
  }

  // Absent is fine — the note is optional everywhere. Present-but-not-a-string
  // is a caller mistake, and silently storing "undefined" would be worse than
  // saying so.
  if (body.details !== undefined && typeof body.details !== "string") {
    throw badRequest(
      "invalid_content_details",
      "Revision details must be a string.",
    );
  }

  const revision = await contentService(context).createRevision(
    actor,
    requiredParam(context, "itemId"),
    {
      ...(body.details === undefined ? {} : { details: body.details }),
      sourceText: body.sourceText,
    },
  );

  return context.json({ revision: publicRevision(revision) }, 201);
});
