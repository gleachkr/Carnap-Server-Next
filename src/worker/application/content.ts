import type {
  CompiledContentArtifact,
  ContentItem,
  ContentRevision,
  ContentSourceFormat,
} from "../domain/content";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import type { JsonValue } from "../domain/json";
import { timestampNow } from "../domain/time";
import { keyedArtifact } from "../exercises/systems";
import { deferred } from "../i18n/deferred";
import type { TheoryResolver } from "../logic/theories";
import { hostedTheoryRevisionId } from "../logic/theories";
import type { AuthenticatedActor } from "./auth";
import { requireContentAuthor } from "./authorization";
import { compileCarnapMarkdown } from "./content/compiler";
import { sha256Id } from "./content/hash";
import { compileTheorySource } from "./content/mm0";
import { AppHttpError, badRequest, forbidden } from "./errors";
import type { AppStores } from "./stores";

export interface ContentServiceOptions {
  readonly now?: () => Date;
  readonly stores: AppStores;
}

export interface CreateContentItemCommand {
  /**
   * What the item will hold, as the request said it — validated here rather
   * than narrowed at the route, beside the other asserts, so the form path and
   * the JSON path refuse the same values with the same words.
   *
   * Optional, and absent means a lesson: every caller that predates MM0 items
   * meant one, and a form that does not offer the choice should not have to
   * send it.
   */
  readonly sourceFormat?: string;
  readonly title: string;
}

export interface CreateContentRevisionCommand {
  /**
   * Why this revision exists, in the author's words. Optional because a note
   * cannot be demanded of somebody uploading a file, and because every revision
   * saved before the field existed has none.
   */
  readonly details?: string;
  readonly sourceText: string;
}

const CONTENT_TITLE_MAX_LENGTH = 200;
const CONTENT_SOURCE_MAX_LENGTH = 200_000;
const CONTENT_DETAILS_MAX_LENGTH = 500;

function normalizeTitle(title: string): string {
  return title.trim();
}

function assertTitle(title: string): void {
  if (title.length === 0 || title.length > CONTENT_TITLE_MAX_LENGTH) {
    throw badRequest(
      "invalid_content_title",
      deferred.i18n.t("Content title must be between 1 and 200 characters."),
    );
  }
}

function assertSourceText(sourceText: string): void {
  if (
    sourceText.length === 0 ||
    sourceText.length > CONTENT_SOURCE_MAX_LENGTH
  ) {
    throw badRequest(
      "invalid_content_source",
      deferred.i18n.t(
        "Content source must be between 1 and 200000 characters.",
      ),
    );
  }
}

function assertDetails(details: string): void {
  if (details.length > CONTENT_DETAILS_MAX_LENGTH) {
    throw badRequest(
      "invalid_content_details",
      deferred.i18n.t("Revision details must be 500 characters or fewer."),
    );
  }
}

/**
 * The format a create request asked for. Absent and empty both mean a lesson;
 * anything else that is not a format we have is refused rather than quietly
 * read as one, because the only way to send one is to have bypassed the form.
 */
function resolveSourceFormat(asked: string | undefined): ContentSourceFormat {
  if (asked === undefined || asked.length === 0 || asked === "markdown") {
    return "markdown";
  }

  if (asked === "mm0") {
    return asked;
  }

  throw badRequest(
    "invalid_content_source_format",
    deferred.i18n.t("That is not a kind of content this site stores."),
  );
}

function contentNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "content_item_not_found",
    deferred.i18n.t("The content item was not found."),
  );
}

function revisionNotFound(): AppHttpError {
  return new AppHttpError(
    404,
    "content_revision_not_found",
    deferred.i18n.t("The content revision was not found."),
  );
}

export class ContentService {
  constructor(private readonly options: ContentServiceOptions) {}

  async createItem(
    actor: AuthenticatedActor,
    command: CreateContentItemCommand,
  ): Promise<ContentItem> {
    requireContentAuthor(actor);

    const title = normalizeTitle(command.title);
    const sourceFormat = resolveSourceFormat(command.sourceFormat);

    assertTitle(title);

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    return this.options.stores.content.createItem({
      createdAt: now,
      id: createAppId(nowDate.getTime()),
      ownerUserId: actor.user.id,
      sourceFormat,
      title,
    });
  }

  async listItems(actor: AuthenticatedActor): Promise<ContentItem[]> {
    return this.options.stores.content.listItemsForOwner(actor.user.id);
  }

  async getItem(
    actor: AuthenticatedActor,
    itemId: AppId,
  ): Promise<ContentItem> {
    const item = await this.options.stores.content.getItem(itemId);

    if (item === null) {
      throw contentNotFound();
    }

    if (item.ownerUserId !== actor.user.id) {
      throw forbidden("content_owner_required");
    }

    return item;
  }

  /**
   * How a lesson's `src=` reaches a theory this site serves from the database.
   *
   * The compiler resolves the built-in `/theories/…` paths from the module
   * graph and asks this about everything else that is not somebody else's
   * origin. Ownership is the whole of the policy: a hosted theory is its
   * author's, there is no sharing layer yet, and so a path naming one of
   * *your* revisions resolves and any other path does not.
   *
   * All three ways of missing — no such revision, not yours, not a theory —
   * answer `null` alike. Distinguishing them would let an author probe for the
   * existence of other people's revision ids one `src=` at a time, which is a
   * worse thing to have built than a slightly vaguer diagnostic.
   *
   * A method rather than a free function because the resolver is per actor,
   * and both compiling callers — saving a revision, and the editor's
   * server-rendered preview — have to build the same one.
   */
  theoryResolver(actor: AuthenticatedActor): TheoryResolver {
    return async (path) => {
      const revisionId = hostedTheoryRevisionId(path);

      if (revisionId === null) {
        return null;
      }

      const revision =
        await this.options.stores.content.getRevision(revisionId);

      if (revision === null || revision.sourceFormat !== "mm0") {
        return null;
      }

      const item = await this.options.stores.content.getItem(revision.itemId);

      return item !== null && item.ownerUserId === actor.user.id
        ? revision.sourceText
        : null;
    };
  }

  async createRevision(
    actor: AuthenticatedActor,
    itemId: AppId,
    command: CreateContentRevisionCommand,
  ): Promise<ContentRevision> {
    // Checked again here rather than trusted from item creation: an item
    // outlives the permission that made it, and this is the path a file arrives
    // by. Ownership is checked below, and neither check implies the other.
    requireContentAuthor(actor);

    const details = (command.details ?? "").trim();

    assertSourceText(command.sourceText);
    assertDetails(details);

    const item = await this.getItem(actor, itemId);
    // What "compile" means depends on what the item holds: a lesson becomes a
    // document, a theory becomes a verdict and a summary. Both results carry
    // `ok` and `diagnostics`, so everything past this line — the failed-save
    // error, the editor's list, the gutter markers — is one path.
    const compiled =
      item.sourceFormat === "mm0"
        ? compileTheorySource(command.sourceText)
        : await compileCarnapMarkdown(command.sourceText, {
            resolveTheory: this.theoryResolver(actor),
          });

    if (!compiled.ok) {
      const first = compiled.diagnostics[0];

      if (first === undefined) {
        throw badRequest(
          "content_compile_failed",
          deferred.i18n.t("The content source could not be compiled."),
        );
      }

      // A diagnostic already *is* a translatable message, so it can be thrown as
      // one: the JSON envelope gets the English sentence, and the editor page
      // words the same complaint in the author's language.
      throw badRequest(first.code, first);
    }

    const revisions =
      await this.options.stores.content.listRevisionsForItem(itemId);
    const nextRevisionNumber = revisions.length + 1;
    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    // Namespaced by format, so that two items holding byte-identical text are
    // not claimed to hold the same thing. Markdown's prefix is the one it has
    // always had: it is stored on every revision ever saved, and rewriting it
    // would make an existing revision's text look new when it was saved again.
    const contentHash = await sha256Id(
      `${item.sourceFormat === "mm0" ? "mm0-v1" : "carnap-markdown-v1"}\n${command.sourceText}`,
    );

    // (item_id, content_hash) is unique, so the same source cannot be saved
    // twice under one item. Saying so in words matters now that a revision
    // carries a note: "same text, new note" is a thing an author will try, and
    // the bare constraint violation reaches them as a 500. The index is still
    // the backstop for two saves racing each other.
    if (revisions.some((revision) => revision.contentHash === contentHash)) {
      throw badRequest(
        "duplicate_content_revision",
        deferred.i18n.t(
          "That source is identical to an existing revision of this item.",
        ),
      );
    }

    return this.options.stores.content.createRevision({
      // The key rather than the text: one copy of each system per document
      // instead of one per exercise. `parseContentArtifact` joins them back on
      // every read, so nothing downstream sees the difference.
      compiled: keyedArtifact(
        compiled.artifact as CompiledContentArtifact,
      ) as unknown as JsonValue,
      contentHash,
      createdAt: now,
      createdById: actor.user.id,
      details,
      id: createAppId(nowDate.getTime()),
      itemId,
      revisionNumber: nextRevisionNumber,
      // The item's, not the caller's: nothing on the way in gets to say what
      // kind of thing this revision is, so the two cannot come apart.
      sourceFormat: item.sourceFormat,
      sourceText: command.sourceText,
    });
  }

  async getRevision(
    actor: AuthenticatedActor,
    revisionId: AppId,
  ): Promise<ContentRevision> {
    const revision =
      await this.options.stores.content.getRevision(revisionId);

    if (revision === null) {
      throw revisionNotFound();
    }

    await this.getItem(actor, revision.itemId);

    return revision;
  }

  async listRevisions(
    actor: AuthenticatedActor,
    itemId: AppId,
  ): Promise<ContentRevision[]> {
    await this.getItem(actor, itemId);

    return this.options.stores.content.listRevisionsForItem(itemId);
  }

  /**
   * Which revision each of `items` would be downloaded at — the newest one, or
   * no entry at all for an item nobody has written a revision of yet.
   *
   * Items rather than ids: the caller has already read them, so the ownership
   * check here is a restatement rather than a second round of reads, and this
   * method hands back nothing the caller could not have had by listing each
   * item's revisions itself.
   */
  async latestRevisionIds(
    actor: AuthenticatedActor,
    items: readonly ContentItem[],
  ): Promise<Map<AppId, AppId>> {
    for (const item of items) {
      if (item.ownerUserId !== actor.user.id) {
        throw forbidden("content_owner_required");
      }
    }

    return this.options.stores.content.latestRevisionIdsForItems(
      items.map((item) => item.id),
    );
  }
}
