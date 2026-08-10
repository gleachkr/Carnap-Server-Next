import type { ContentItem, ContentRevision } from "../domain/content";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import type { JsonValue } from "../domain/json";
import { timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import type { AuthenticatedActor } from "./auth";
import { requireContentAuthor } from "./authorization";
import { compileCarnapMarkdown } from "./content/compiler";
import { sha256Id } from "./content/hash";
import { AppHttpError, badRequest, forbidden } from "./errors";
import type { AppStores } from "./stores";

export interface ContentServiceOptions {
  readonly now?: () => Date;
  readonly stores: AppStores;
}

export interface CreateContentItemCommand {
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

    assertTitle(title);

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);

    return this.options.stores.content.createItem({
      createdAt: now,
      id: createAppId(nowDate.getTime()),
      ownerUserId: actor.user.id,
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
    await this.getItem(actor, itemId);

    const compiled = await compileCarnapMarkdown(command.sourceText);

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
    const contentHash = await sha256Id(
      `carnap-markdown-v1\n${command.sourceText}`,
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
      compiled: compiled.artifact as unknown as JsonValue,
      contentHash,
      createdAt: now,
      createdById: actor.user.id,
      details,
      id: createAppId(nowDate.getTime()),
      itemId,
      revisionNumber: nextRevisionNumber,
      sourceFormat: "markdown",
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
}
