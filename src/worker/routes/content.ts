import { type Context, Hono } from "hono";
import { raw } from "hono/html";

import {
  canAuthorContent,
  requireAuthenticated,
  requireContentAuthor,
} from "../application/authorization";
import { ContentService } from "../application/content";
import { contentArtifactFromRevision } from "../application/content/artifact";
import { compileCarnapMarkdown } from "../application/content/compiler";
import {
  componentAssetsForArtifact,
  exerciseHydrationForArtifact,
  renderCompiledContent,
} from "../application/content/renderer";
import { AppHttpError, badRequest } from "../application/errors";
import type { ContentItem, ContentRevision } from "../domain/content";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { storesForContext } from "../stores";
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
  artifactStyleProps,
  contentDocumentHtml,
} from "../web/content-document";
import {
  fieldValue,
  isFormSubmission,
  redirect,
  wantsHtml,
} from "../web/html";
import { revisionDateText } from "../web/revisions";
import { resolveUsers } from "../web/users";

interface CreateContentBody {
  readonly title?: unknown;
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

function webActorOrLogin(context: Context<AppBindings>): Response | null {
  if (context.get("actor") !== null) {
    return null;
  }

  const next = new URL(context.req.url).pathname;

  return redirect(`/login?next=${encodeURIComponent(next)}`, 302);
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
  });
}

async function createContentFromForm(
  context: Context<AppBindings>,
): Promise<Response> {
  const actor = requireAuthenticated(context);
  const form = await context.req.raw.formData();
  const title = fieldValue(form.get("title"));

  try {
    const item = await contentService(context).createItem(actor, { title });

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
 * The editor page for a given source: initial diagnostics and a
 * server-compiled preview document, after which the preview bundle keeps
 * both current on the client as the author types.
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
  const compiled = await compileCarnapMarkdown(sourceText);
  const i18n = context.get("i18n");

  return renderRevisionEditor(context, {
    details,
    // A `CompilerDiagnostic` already satisfies the view's narrower model, and
    // remapping it field by field is how `params` got dropped on the way out.
    diagnostics: compiled.diagnostics,
    itemId: item.id,
    itemTitle: item.title,
    // The unsaved source has no document URL, so the preview builds the
    // whole content document and embeds it via iframe srcdoc.
    previewDocumentHtml: compiled.ok
      ? contentDocumentHtml({
          body: raw(renderCompiledContent(compiled.artifact, i18n)),
          componentAssets: componentAssetsForArtifact(compiled.artifact),
          exerciseHydration: exerciseHydrationForArtifact(
            compiled.artifact,
            i18n,
          ),
          i18n,
          locale: context.get("language"),
          ...artifactStyleProps(compiled.artifact),
          title: i18n.t("Preview"),
        })
      : null,
    sourceText,
    ...(failure === undefined
      ? {}
      : { error: failure.error, status: failure.status }),
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
    // only for an item with no revisions yet. The list is newest first, so
    // the head of it is where the item left off.
    const latest = (await service.listRevisions(actor, itemId))[0];

    // A fresh editor has no note yet: the field is for what this save changes,
    // not what the previous one did.
    return renderEditor(
      context,
      item,
      latest?.sourceText ?? sampleSource(),
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
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const service = contentService(context);
  const revision = await service.getRevision(
    actor,
    requiredParam(context, "revisionId"),
  );
  const item = await service.getItem(actor, revision.itemId);

  return renderRevision(context, {
    createdAt: revision.createdAt,
    details: revision.details,
    itemId: item.id,
    itemTitle: item.title,
    revisionId: revision.id,
    sourceText: revision.sourceText,
  });
}

async function revisionDocumentPage(
  context: Context<AppBindings>,
): Promise<Response> {
  const loginRedirect = webActorOrLogin(context);

  if (loginRedirect !== null) {
    return loginRedirect;
  }

  const actor = requireAuthenticated(context);
  const service = contentService(context);
  const revision = await service.getRevision(
    actor,
    requiredParam(context, "revisionId"),
  );
  const item = await service.getItem(actor, revision.itemId);
  const artifact = contentArtifactFromRevision(revision);
  const i18n = context.get("i18n");

  return renderRevisionDocument(context, {
    compiledHtml: renderCompiledContent(artifact, i18n),
    componentAssets: componentAssetsForArtifact(artifact),
    exerciseHydration: exerciseHydrationForArtifact(artifact, i18n),
    ...artifactStyleProps(artifact),
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

  const item = await contentService(context).createItem(actor, {
    title: body.title,
  });

  return context.json({ item: publicContentItem(item) }, 201);
});

// The library-side landing for `item:` links: compiled content carries the
// relative `../../go/<id>`, which resolves here from revision documents and
// editor previews. The item page enforces ownership itself.
contentRoutes.get("/go/:itemId", (context) =>
  redirect(`/content/${requiredParam(context, "itemId")}`, 302),
);

contentRoutes.get("/revisions/:revisionId/document", (context) =>
  revisionDocumentPage(context),
);

contentRoutes.get("/revisions/:revisionId", async (context) => {
  if (wantsHtml(context)) {
    return revisionPage(context);
  }

  const actor = requireAuthenticated(context);
  const revision = await contentService(context).getRevision(
    actor,
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
