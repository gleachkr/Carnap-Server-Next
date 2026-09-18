import type {
  CompiledContentArtifact,
  ContentItem,
  ContentRevision,
  ContentRevisionSummary,
  ContentSharing,
  ContentSourceFormat,
} from "../domain/content";
import { isContentSharing } from "../domain/content";
import type { AppId } from "../domain/ids";
import { createAppId } from "../domain/ids";
import type { JsonValue } from "../domain/json";
import { timestampNow } from "../domain/time";
import { keyedArtifact } from "../exercise-kit/systems/join";
import { deferred } from "../i18n/deferred";
import type { TheoryResolver } from "../logic/theories";
import { hostedTheoryRevisionId } from "../logic/theories";
import type { AuthenticatedActor } from "./auth";
import { canAuthorContent, requireContentAuthor } from "./authorization";
import { compileCarnapMarkdown } from "./content/compiler";
import { sha256Id } from "./content/hash";
import { compileTheorySource } from "./content/mm0";
import { AppHttpError, badRequest } from "./errors";
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

export interface SetRevisionSharingCommand {
  /** One of `ContentSharing`, as the request said it; validated here. */
  readonly sharing: string;
  readonly shareSource: boolean;
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

/**
 * The scope an item asked for, as the request spelled it. Anything that is not
 * one of the three is refused rather than read as `private`, because the only
 * way to send one is to have bypassed the form, and a silent fallback would
 * make a typo look like a policy.
 */
function resolveSharing(asked: string): ContentSharing {
  if (!isContentSharing(asked)) {
    throw badRequest(
      "invalid_content_sharing",
      deferred.i18n.t("That is not a sharing setting this site has."),
    );
  }

  return asked;
}

/** Whose item this is. Ownership is the authoring permission, and it is also
 * the reason an owner is never asked about a scope: an author who has shared
 * nothing still reads their own drafts. */
function ownsItem(
  item: ContentItem,
  actor: AuthenticatedActor | null,
): boolean {
  return actor !== null && item.ownerUserId === actor.user.id;
}

/**
 * Whether this actor may read this revision — the one place the scope is
 * interpreted, so that the revision page, the document, the source download,
 * the theory route and the compiler's resolver cannot come to disagree about
 * who a thing is shared with.
 *
 * `null` is an anonymous request, which only `public` admits — the login wall
 * is exactly what `authors` means, and `canAuthorContent` is what it means by
 * an author, so a student signed in to the same site is no closer to a
 * colleague's lesson than a stranger is.
 *
 * The item comes in alongside the revision because ownership lives there.
 * Nothing else about the item is consulted: what is shared is this revision,
 * not the history behind it.
 */
function canReadRevision(
  revision: ContentRevision,
  item: ContentItem,
  actor: AuthenticatedActor | null,
): boolean {
  if (ownsItem(item, actor)) {
    return true;
  }

  if (revision.sharing === "public") {
    return true;
  }

  return (
    revision.sharing === "authors" &&
    actor !== null &&
    canAuthorContent(actor)
  );
}

/**
 * Whether this actor may read the revision's *source*, which is a second
 * question: a `short-answer` directive's accepted answers and a
 * `free-response` directive's rubric are held out of the compiled artifact on
 * purpose and are written in the Markdown, so handing over the source hands
 * over both.
 *
 * An MM0 revision is exempt because its source is the whole of it. There is no
 * rendering of a theory to share instead — the theory route already serves the
 * file to anyone the scope admits — so a second toggle there would only be a
 * way to make one address contradict another.
 *
 * Exported because the pages have to draw what it decides: a source panel a
 * reader was not meant to see would be this rule enforced in one place and
 * contradicted in another.
 */
export function canReadSource(
  revision: ContentRevision,
  item: ContentItem,
  actor: AuthenticatedActor | null,
): boolean {
  if (!canReadRevision(revision, item, actor)) {
    return false;
  }

  return (
    ownsItem(item, actor) ||
    revision.shareSource ||
    revision.sourceFormat === "mm0"
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

  /**
   * An item, if it is yours — the read every *authoring* path makes.
   *
   * **Somebody else's is a miss, not a refusal.** An id is not a capability
   * here — there is nothing an author could do holding a 403 that they could
   * not do holding a 404 — so answering "forbidden" would only confirm that
   * the id names something, one guess at a time. `theoryResolver` below
   * already refuses to make that admission, since a lesson's `src=` would
   * otherwise be an oracle for other people's revision ids; this is the same
   * rule for every other way of asking. A capability refusal is different and
   * stays a 403: `content_author_required` does not depend on which id was
   * named, so it tells a stranger nothing about what exists.
   *
   * Sharing does not widen this. An item — its title, its history, its editor
   * — is its author's; what a scope opens is a *revision*, at the address that
   * names it, and `readRevision` is where that is asked. So a colleague who
   * was sent revision 7 reads revision 7, and does not thereby get the drafts
   * behind it or a page to write from.
   */
  async getItem(
    actor: AuthenticatedActor,
    itemId: AppId,
  ): Promise<ContentItem> {
    const item = await this.options.stores.content.getItem(itemId);

    if (item === null || item.ownerUserId !== actor.user.id) {
      throw contentNotFound();
    }

    return item;
  }

  /**
   * Retire an item from the library, or return it to use.
   *
   * Yours to do, and — as `createRevision` and `setRevisionSharing` reason —
   * an author's thing to do rather than an owner's, since an item outlives the
   * permission that created it. Somebody else's item answers as `getItem`
   * does, so this is not a second way to tell an id that exists from one that
   * does not.
   *
   * Idempotent: archiving an archived item restamps the time and unarchiving
   * an active one is a no-op, since the form that asks cannot know what
   * happened between the page being drawn and the button being pressed.
   */
  async setItemArchived(
    actor: AuthenticatedActor,
    itemId: AppId,
    archived: boolean,
  ): Promise<ContentItem> {
    requireContentAuthor(actor);

    const item = await this.getItem(actor, itemId);
    const updated = await this.options.stores.content.setItemArchived({
      archivedAt: archived
        ? timestampNow(this.options.now?.() ?? new Date())
        : null,
      id: item.id,
    });

    if (updated === null) {
      throw contentNotFound();
    }

    return updated;
  }

  /**
   * Who may read this revision, as its owner has decided.
   *
   * Both fields at once, because they are one decision on one form. Two
   * normalizations, so that what is stored is what is meant: a private
   * revision carries no source permission to be surprised by when it is shared
   * later, and an MM0 revision carries none at all — its source is the whole
   * of it, and `canReadSource` says so rather than asking a column that could
   * disagree with the theory route.
   *
   * The capability is checked as well as the ownership, for the reason
   * `createRevision` gives: a revision outlives the permission that made it,
   * and publishing is a thing to do with content rather than a thing to do
   * with one's own row.
   *
   * A stranger's revision id answers as `readRevision` does, so this cannot be
   * used to tell an id that exists from one that does not.
   */
  async setRevisionSharing(
    actor: AuthenticatedActor,
    revisionId: AppId,
    command: SetRevisionSharingCommand,
  ): Promise<ContentRevision> {
    requireContentAuthor(actor);

    const revision =
      await this.options.stores.content.getRevision(revisionId);

    if (revision === null) {
      throw revisionNotFound();
    }

    const item = await this.options.stores.content.getItem(revision.itemId);

    if (item === null || !ownsItem(item, actor)) {
      throw revisionNotFound();
    }

    const sharing = resolveSharing(command.sharing);

    return this.options.stores.content.updateRevisionSharing({
      id: revision.id,
      shareSource:
        sharing !== "private" &&
        revision.sourceFormat !== "mm0" &&
        command.shareSource,
      sharing,
    });
  }

  /**
   * What is hosted at a theory address, for whoever is asking: the MM0 and the
   * item it belongs to, or `null` for every way of there being nothing there.
   *
   * The scope is the whole of the policy, and it is the *revision's*. Yours
   * resolves; somebody else's resolves when they have shared that revision
   * wide enough to include you, which for a signed-in author means `authors`
   * and for nobody at all means `public`. A later revision of the same theory
   * is a different address and its own decision.
   *
   * All four ways of missing — no such revision, not shared with you, not a
   * theory, not an address of ours — answer `null` alike. Distinguishing them
   * would let an author probe for the existence of other people's revision ids
   * one `src=` at a time, which is a worse thing to have built than a slightly
   * vaguer diagnostic.
   *
   * The revision comes back with the text because the route serving this
   * address has to decide whether a shared cache may hold it, and asking a
   * second time would be a second question that could answer differently.
   */
  async hostedTheory(
    actor: AuthenticatedActor | null,
    path: string,
  ): Promise<{ revision: ContentRevision; source: string } | null> {
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

    return item !== null && canReadRevision(revision, item, actor)
      ? { revision, source: revision.sourceText }
      : null;
  }

  /**
   * How a lesson's `src=` reaches a theory this site serves from the database.
   *
   * The compiler resolves the built-in `/theories/…` paths from the module
   * graph and asks this about everything else that is not somebody else's
   * origin.
   *
   * A method rather than a free function because the resolver is per actor,
   * and both compiling callers — saving a revision, and the editor's
   * server-rendered preview — have to build the same one. It is the same
   * question `hostedTheory` answers for the route, asked through the same
   * code, so what a lesson may resolve and what a person may open at the
   * address cannot drift apart.
   *
   * **Resolving is stronger than reading.** Since the systems join, a resolved
   * theory's text is frozen into the borrowing document and shipped to *that*
   * author's students in the `data-carnap-systems` script — so "an author may
   * name my theory" already entails "their students may read my MM0". That is
   * what the share control has to say in words, and why there is no scope that
   * permits the naming and withholds the text.
   */
  theoryResolver(actor: AuthenticatedActor | null): TheoryResolver {
    return async (path) =>
      (await this.hostedTheory(actor, path))?.source ?? null;
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

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    // Namespaced by format, so that two items holding byte-identical text are
    // not claimed to hold the same thing. Markdown's prefix is the one it has
    // always had: it is stored on every revision ever saved, and rewriting it
    // would make an existing revision's text look new when it was saved again.
    const contentHash = await sha256Id(
      `${item.sourceFormat === "mm0" ? "mm0-v1" : "carnap-markdown-v1"}\n${command.sourceText}`,
    );

    // The next number and the hash check come as one aggregate, not as the
    // item's revisions: a save used to read every one of them, artifacts and
    // all, and an item that has been edited a few hundred times has a history
    // far larger than anything a save needs to know about it.
    const slot = await this.options.stores.content.nextRevisionSlot(
      itemId,
      contentHash,
    );

    // (item_id, content_hash) is unique, so the same source cannot be saved
    // twice under one item. Saying so in words matters now that a revision
    // carries a note: "same text, new note" is a thing an author will try, and
    // the bare constraint violation reaches them as a 500. The index is still
    // the backstop for two saves racing each other.
    if (slot.sourceAlreadySaved) {
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
      revisionNumber: slot.revisionNumber,
      // The item's, not the caller's: nothing on the way in gets to say what
      // kind of thing this revision is, so the two cannot come apart.
      sourceFormat: item.sourceFormat,
      sourceText: command.sourceText,
    });
  }

  /**
   * A revision and the item it belongs to, if you may read it.
   *
   * The scope check is written out rather than delegated to `readItem` so that
   * **both** ways of missing answer in the same words. Both are already 404s,
   * but a stranger's id would say `content_item_not_found` where a made up one
   * says `content_revision_not_found`, and a caller who can tell those apart
   * has the oracle back — quieter, and in the error code instead of the
   * status. One question, one answer, as `hostedTheory` does it.
   *
   * The item comes back too because every caller wants it — for the title, the
   * download's file name, the breadcrumb — and because fetching it again would
   * be a second question that could answer differently.
   */
  async readRevision(
    actor: AuthenticatedActor | null,
    revisionId: AppId,
  ): Promise<{ item: ContentItem; revision: ContentRevision }> {
    const revision =
      await this.options.stores.content.getRevision(revisionId);

    if (revision === null) {
      throw revisionNotFound();
    }

    const item = await this.options.stores.content.getItem(revision.itemId);

    if (item === null || !canReadRevision(revision, item, actor)) {
      throw revisionNotFound();
    }

    return { item, revision };
  }

  /**
   * The same, for the download of the source itself — which is a narrower
   * permission than reading the lesson, for the reason `canReadSource` gives.
   *
   * A revision whose item is readable but whose source is not answers as a
   * miss rather than a refusal, like everything else here: the reader can see
   * the item, so nothing is being hidden from them by the wording, and it
   * keeps one shape for every no on this surface.
   */
  async readRevisionSource(
    actor: AuthenticatedActor | null,
    revisionId: AppId,
  ): Promise<{ item: ContentItem; revision: ContentRevision }> {
    const found = await this.readRevision(actor, revisionId);

    if (!canReadSource(found.revision, found.item, actor)) {
      throw revisionNotFound();
    }

    return found;
  }

  async listRevisions(
    actor: AuthenticatedActor,
    itemId: AppId,
  ): Promise<ContentRevisionSummary[]> {
    await this.getItem(actor, itemId);

    return this.options.stores.content.listRevisionsForItem(itemId);
  }
}
