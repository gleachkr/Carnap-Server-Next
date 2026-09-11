import type { Context } from "hono";
import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { DiagnosticMessageId } from "../application/content/diagnostic-strings";
import type { CompiledTheoryArtifact } from "../application/content/mm0";
import type {
  ContentItem,
  ContentRevision,
  ContentSharing,
  ContentSourceFormat,
} from "../domain/content";
import { CONTENT_SHARING_VALUES } from "../domain/content";
import type { User } from "../domain/users";
import type { AppBindings } from "../http";
import {
  splitAtValue,
  type TranslatableMessage,
  type Translator,
  translateMessage,
  VALUE,
} from "../i18n/translator";
import { hostedTheoryPath } from "../logic/theories";
import { contentCrumb, contentItemCrumb } from "./breadcrumbs";
import {
  ContentFrame,
  CopyField,
  CreateBar,
  CsrfInput,
  ErrorSummary,
  Notice,
  Sheet,
  StatusBadge,
  SummaryStrip,
  splitView,
  TableScroll,
  Time,
} from "./components";
import type { ContentDocumentModel } from "./content-document";
import { renderContentDocument } from "./content-document";
import {
  ArchiveIcon,
  DownloadIcon,
  PeopleIcon,
  UnarchiveIcon,
} from "./icons";
import { renderShell, useI18n } from "./layout";
import { revisionDetailsText } from "./revisions";
import { SortHeader } from "./table-sort";
import {
  EDITOR_UI_STRINGS_ATTRIBUTE,
  editorUiStrings,
  markdownFoldStrings,
  uiStringsScript,
} from "./ui-strings";
import { userDisplayName } from "./users";

type Status = 200 | 400 | 401 | 403 | 404 | 429 | 500;

/**
 * What a fresh item's editor opens with, in the item's own format. A theory
 * item used to open on the Markdown lesson, which its editor cannot save: the
 * first thing its author saw was a compile error in a format they had not
 * chosen.
 *
 * The MM0 starter is a language and a proof system both — a sentence role,
 * two connectives with roles, one rule — because that is the file an
 * instructor most often wants: something `system=` will take *and* a proof can
 * cite. Each annotation carries a line saying what it buys, since the shipped
 * theories under /theories are the only other examples and they are long.
 */
export function sampleSource(format: ContentSourceFormat): string {
  if (format === "mm0") {
    return `-- A small propositional language with one rule, to start from.
-- The shipped systems are longer examples of the same shape:
-- /theories/carnap-prop.mm0 is this language in full.

-- Where one token of a student's formula ends and the next begins.
-- Every operator spelling goes here, so that \`P->Q\` reads without spaces.
--| @syntax delimiter $ ( ) ~ -> $
delimiter $ ( ) $;

-- The sort a student's formula is read at. Without this role the file is
-- a proof system only, and \`system=\` will not take it as a language.
--| @syntax role sentence
provable sort wff;

term P: wff;
term Q: wff;
term R: wff;

-- A role tells the exercise types what a connective means; the spelling
-- between the dollars is what a student types.
--| @syntax role negation
term not (p: wff): wff;
prefix not: $~$ prec 50;

--| @syntax role conditional
term imp (p q: wff): wff;
infixr imp: $->$ prec 30;

-- A rule a proof can cite, by this name.
axiom ax_k (p q: wff): $ p -> q -> p $;
`;
  }

  return `# Sample exercise

Read the prompt and choose an answer.

::::multiple-choice{#sample title="Sample" points="1"}
Which option is correct?

- [ ] first | The first option
- [x] second | The second option
::::`;
}

/**
 * The download beside a listed piece of content: its Markdown source, as a
 * file, for an author who would rather edit it in their own editor and upload
 * the result. A link rather than a form because it takes nothing and changes
 * nothing; the server sends it as an attachment, and the `download` attribute
 * says so in the markup too.
 *
 * The label names what is being downloaded, because a column of identical
 * "Download" links tells a reader listening to the page which row they are on
 * and nothing else.
 */
const SourceDownload: FC<{
  readonly href: string;
  readonly label: string;
}> = ({ href, label }) => (
  <a
    aria-label={label}
    class="icon-button"
    download
    href={href}
    title={label}
  >
    <DownloadIcon />
  </a>
);

/**
 * The archive or unarchive control on a library row: an icon in a form,
 * because it changes something and so has to POST. Named for the row the
 * way the download is, since a column of identical icons tells a reader
 * listening to the page nothing about which item they are on.
 */
const ArchiveToggle: FC<{
  readonly context: Context<AppBindings>;
  readonly item: ContentItem;
}> = ({ context, item }) => {
  const i18n = useI18n();
  const archived = item.archivedAt !== null;
  const label = archived
    ? i18n.t("Unarchive {name}", { name: item.title })
    : i18n.t("Archive {name}", { name: item.title });

  return (
    <form
      action={`/content/${item.id}/${archived ? "unarchive" : "archive"}`}
      class="icon-form"
      method="post"
    >
      <CsrfInput context={context} />
      <button
        aria-label={label}
        class="icon-button"
        title={label}
        type="submit"
      >
        {archived ? <UnarchiveIcon /> : <ArchiveIcon />}
      </button>
    </form>
  );
};

/**
 * The library's rows, active or archived: the same table either way, with
 * the date column saying when the item was last written or when it was put
 * away, and the actions column offering the download and the way across.
 */
const ItemsTable: FC<{
  /** Whether this is the archived drawer's table, or the active one. */
  readonly archived: boolean;
  readonly canAuthor: boolean;
  readonly context: Context<AppBindings>;
  /** Whether the drawer below holds anything: "none" and "all archived" are
   * different facts, and the first sentence would be a lie under the second. */
  readonly hasArchived: boolean;
  readonly items: readonly ContentItem[];
  readonly latestRevisionIds: ReadonlyMap<string, string>;
}> = ({
  archived,
  canAuthor,
  context,
  hasArchived,
  items,
  latestRevisionIds,
}) => {
  const i18n = useI18n();

  if (items.length === 0) {
    // "You have not written any yet" is an invitation, and reads as a taunt to
    // somebody who cannot. The sheet's description says why; this says what.
    return (
      <p class="small">
        {hasArchived
          ? i18n.t("All of your content items are archived.")
          : canAuthor
            ? i18n.t("You have not created any content items yet.")
            : i18n.t("You do not own any content items.")}
      </p>
    );
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <SortHeader label={i18n.t("Title")} />
          {/* Sortable, because the reason to look is usually "where are my
              theories" — an author has many lessons and a few of these. */}
          <SortHeader label={i18n.t("Kind")} />
          <SortHeader
            label={archived ? i18n.t("Archived") : i18n.t("Updated")}
          />
          <th scope="col">{i18n.t("Actions")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          // The source an author would want is the current one, which is the
          // newest revision. An item with none is a title and nothing else.
          const revisionId = latestRevisionIds.get(item.id);
          const when = archived ? (item.archivedAt ?? "") : item.updatedAt;

          return (
            <tr>
              <td>
                <a href={`/content/${item.id}`}>{item.title}</a>
              </td>
              <td>{sourceFormatLabel(i18n, item.sourceFormat)}</td>
              {/* The instant behind the localized date, which does not sort. */}
              <td data-sort-value={when}>
                {when.length === 0 ? null : <Time value={when} />}
              </td>
              <td>
                {revisionId === undefined ? null : (
                  <SourceDownload
                    href={`/content/revisions/${revisionId}/source`}
                    label={i18n.t("Download the source of {name}", {
                      name: item.title,
                    })}
                  />
                )}
                {/* Archiving needs the permission that made the item, as
                    sharing does; an author who has lost it is not offered
                    a control the server would refuse. */}
                {canAuthor ? (
                  <ArchiveToggle context={context} item={item} />
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableScroll>
  );
};

/** The library's word for what an item holds. */
function sourceFormatLabel(
  i18n: Translator,
  sourceFormat: ContentSourceFormat,
): string {
  return sourceFormat === "mm0"
    ? i18n.t("Theory or language")
    : i18n.t("Lesson");
}

/**
 * The item page's archive control: one sentence and the button. Archiving
 * keeps the record, every revision, and every address a revision is shared
 * under; it folds the item out of the library and out of the picker a new
 * assignment is set from, and nothing else.
 */
const ArchiveItemForm: FC<{
  readonly context: Context<AppBindings>;
  readonly item: ContentItem;
}> = ({ context, item }) => {
  const i18n = useI18n();
  const archived = item.archivedAt !== null;

  return (
    <form
      action={`/content/${item.id}/${archived ? "unarchive" : "archive"}`}
      class="footer-row archive-form"
      method="post"
    >
      <CsrfInput context={context} />
      <p class="small">
        {archived
          ? i18n.t("Hidden from your library and from new assignments.")
          : i18n.t(
              "Hides this item from your library and from new assignments. Nothing is deleted.",
            )}
      </p>
      <button class={archived ? "secondary" : "danger"} type="submit">
        {archived ? i18n.t("Unarchive item") : i18n.t("Archive item")}
      </button>
    </form>
  );
};

const ContentItemCreateBar: FC<{
  readonly context: Context<AppBindings>;
}> = ({ context }) => {
  const i18n = useI18n();

  return (
    <CreateBar
      action="/content"
      context={context}
      submitLabel={i18n.t("Create content item")}
    >
      <input
        aria-label={i18n.t("Content item title")}
        name="title"
        placeholder={i18n.t("New content item")}
        required
      />
      <SourceFormatSelect />
    </CreateBar>
  );
};

/**
 * What kind of source the new item will hold — the one thing about an item
 * that cannot be changed afterwards, which is why it is asked here and nowhere
 * else. Both creation surfaces use it so the two cannot drift.
 *
 * The labels avoid "markdown" and "MM0": an author choosing between them is
 * choosing between writing a lesson and writing the logic a lesson is set in,
 * and the file formats follow from that rather than the other way round.
 */
const SOURCE_FORMAT_FIELD_ID = "content-source-format";

const SourceFormatSelect: FC<{ readonly labelled?: boolean }> = ({
  labelled,
}) => {
  const i18n = useI18n();
  const label = i18n.t("Kind");
  const options = (
    <>
      <option value="markdown">{i18n.t("Lesson")}</option>
      <option value="mm0">{i18n.t("Theory or language")}</option>
    </>
  );

  // The create bar is a row of controls with no room for headings, so its
  // label is the accessible name and nothing more; the standalone form has the
  // space to show one.
  if (labelled !== true) {
    return (
      <select aria-label={label} name="sourceFormat">
        {options}
      </select>
    );
  }

  return (
    <label for={SOURCE_FORMAT_FIELD_ID}>
      {label}
      <br />
      <select id={SOURCE_FORMAT_FIELD_ID} name="sourceFormat">
        {options}
      </select>
    </label>
  );
};

const ContentItemForm: FC<{
  readonly context: Context<AppBindings>;
  readonly title?: string;
}> = ({ context, title }) => {
  const i18n = useI18n();

  return (
    <form action="/content" method="post">
      <CsrfInput context={context} />
      <label>
        {i18n.t("Title")}
        <br />
        <input name="title" required value={title ?? ""} />
      </label>
      <SourceFormatSelect labelled />
      <button type="submit">{i18n.t("Create content item")}</button>
    </form>
  );
};

/**
 * One compiler complaint, as the editor page receives it: a code, a line, and
 * the message still unworded (see {@link TranslatableMessage}). Wording it is
 * this view's job, because the compiler that produced it — which also runs in
 * the author's browser — has no translator.
 */
export interface Diagnostic extends TranslatableMessage {
  readonly code: string;
  readonly line: number;
  readonly message: DiagnosticMessageId;
}

const DiagnosticsList: FC<{
  readonly diagnostics: readonly Diagnostic[];
}> = ({ diagnostics }) => {
  const i18n = useI18n();

  if (diagnostics.length === 0) {
    return null;
  }

  return (
    <ul class="diagnostics">
      {diagnostics.map((item) => {
        // The code is a <code> element, so the sentence is split around it
        // rather than assembled from fragments in English order.
        const [before, after] = splitAtValue(
          i18n.t("{code} line {line}: {message}", {
            code: VALUE,
            line: item.line,
            message: translateMessage(item, i18n),
          }),
        );

        return (
          <li>
            {before}
            <code>{item.code}</code>
            {after}
          </li>
        );
      })}
    </ul>
  );
};

const SOURCE_FIELD_ID = "revision-source";
const SOURCE_LABEL_ID = "revision-source-label";

/**
 * The revision authoring sheet: a Markdown source field whose compiled preview
 * lives in the split's other column. The preview bundle recompiles on typing
 * pauses (with the same compiler the server runs) and rewrites the frame's
 * srcdoc and the diagnostics under the field; the form itself only ever saves.
 *
 * The field is a textarea here and stays one in the DOM — it is what carries
 * `sourceText` to the server. The bundle hides it behind a CodeMirror view and
 * writes the edited document back through it, so the save path is the same
 * whether or not the enhancement ran, and without JS the page still shows the
 * server-compiled preview of the initial source.
 */
const RevisionEditor: FC<{
  readonly context: Context<AppBindings>;
  readonly details: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly itemId: string;
  readonly sourceFormat: ContentSourceFormat;
  readonly sourceText: string;
}> = ({
  context,
  details,
  diagnostics,
  itemId,
  sourceFormat,
  sourceText,
}) => {
  const i18n = useI18n();
  const theory = sourceFormat === "mm0";

  /*
   * No heading on the sheet. The breadcrumb already ends in "New revision"
   * and the view switch says "Write" over this column, so a card titled the
   * same thing under them was the page's name a third time — and its blurb,
   * on a phone, was the first screenful of an editor. The sheet's frame now
   * starts at the source; the field's name lives in the hidden label below.
   */
  return (
    <form action={`/content/${itemId}/revisions/new`} method="post">
      <Sheet
        className="source-sheet"
        footer={
          <div class="sheet-actions">
            {/* The note travels with the save, in the footer beside it, because
                it describes the act rather than the document: it is not part of
                the source and never reaches a student. Prefilled rather than
                hinted, since the only source of a value here is a submission the
                compiler just rejected — the author should not retype it. */}
            <input
              aria-label={i18n.t("Revision details")}
              class="details-field"
              name="details"
              placeholder={i18n.t("What changed, optional")}
              value={details}
            />
            <div class="action-pair">
              {/* The way out that does not save — the same place the breadcrumb
                  goes, said again where the decision is being made. A revision
                  is immutable once created, so leaving is a real choice and not
                  just the absence of one. Unsaved source still gets its warning
                  on the way out; this link is what the reader answers it from. */}
              <a class="button ghost" href={`/content/${itemId}`}>
                {i18n.t("Cancel")}
              </a>
              <button type="submit">{i18n.t("Create revision")}</button>
            </div>
          </div>
        }
      >
        <CsrfInput context={context} />
        {/* Off-screen, not absent. The sheet's own heading and description
            already say what this field is, and the editor fills the card, so a
            second visible label was noise — but it is still the accessible name
            for the textarea and, through `aria-labelledby`, for the CodeMirror
            view the preview bundle puts in front of it. That view's editable
            surface is a div, which `for` cannot bind to, so the name has to come
            from an element with an id. */}
        <label
          class="visually-hidden"
          for={SOURCE_FIELD_ID}
          id={SOURCE_LABEL_ID}
        >
          {theory ? i18n.t("MM0 source") : i18n.t("Carnap Markdown")}
        </label>
        <textarea
          data-editor-source
          // What the preview bundle compiles this with. Said outright rather
          // than left to be inferred from the page's shape: an MM0 item used
          // to be recognized as "the editor with no preview column beside
          // it", which meant a bundle that no longer recognized the column
          // read a Markdown lesson as a theory and listed every line of it as
          // an error.
          data-source-format={sourceFormat}
          id={SOURCE_FIELD_ID}
          name="sourceText"
          required
          rows={18}
          // Carnap Markdown is mostly directive names, attribute keys, and
          // logical operators; a spellchecker marks nearly all of it, which
          // buries the words an author would actually want flagged. (CodeMirror
          // turns it off itself, so this is the no-JS path.) MM0 is the same
          // argument with nothing but machinery in it.
          spellcheck={false}
        >
          {sourceText}
        </textarea>
        <div data-editor-diagnostics>
          <DiagnosticsList diagnostics={diagnostics} />
        </div>
      </Sheet>
    </form>
  );
};

/**
 * The Revisions sheet footer: a link to the manual editor (the rich authoring
 * flow, which gets its own route) plus a compact inline upload bar for creating
 * a revision straight from a file.
 *
 * The picker is filtered by the item's format, and names the same extension
 * the download hands out for it. That closes the round trip an author takes a
 * revision out on: a theory saved as `.mm0` has to be offerable back, and a
 * picker that only lists Markdown would hide the file they had just saved.
 * The server reads whatever arrives either way — this is a hint about what to
 * look for, not a check.
 */
const RevisionFooterActions: FC<{
  readonly context: Context<AppBindings>;
  readonly itemId: string;
  readonly sourceFormat: ContentSourceFormat;
}> = ({ context, itemId, sourceFormat }) => {
  const i18n = useI18n();
  const theory = sourceFormat === "mm0";

  return (
    <div class="revision-actions">
      <form
        action={`/content/${itemId}/revisions`}
        class="create-bar"
        enctype="multipart/form-data"
        method="post"
      >
        <CsrfInput context={context} />
        <input
          accept={
            theory
              ? ".mm0,.txt,text/plain"
              : ".md,.markdown,.txt,text/markdown,text/plain"
          }
          aria-label={
            theory ? i18n.t("MM0 file") : i18n.t("Carnap Markdown file")
          }
          name="sourceFile"
          required
          type="file"
        />
        <input
          aria-label={i18n.t("Revision details")}
          name="details"
          placeholder={i18n.t("What changed, optional")}
        />
        <button class="secondary" type="submit">
          {i18n.t("Upload revision")}
        </button>
      </form>
      <a class="button" href={`/content/${itemId}/revisions/new`}>
        {i18n.t("Create revision")}
      </a>
    </div>
  );
};

/**
 * What each scope is called to the author choosing it. Named by who it lets
 * in rather than by the word stored, because "authors" is a word about this
 * site's permissions and the question being asked is about people.
 *
 * Kept to two or three words because the same phrase labels the row's badge.
 * What the choice actually permits is said in full underneath it, by
 * {@link sharingHint}, rather than crammed into the option.
 */
function sharingLabel(i18n: Translator, sharing: ContentSharing): string {
  switch (sharing) {
    case "public":
      return i18n.t("Anyone with the link");
    case "authors":
      return i18n.t("Content authors");
    default:
      return i18n.t("Only you");
  }
}

/**
 * The same choice as a sentence: who, exactly, may open this revision.
 *
 * One line per scope, all three rendered, and the script in the shell shows
 * the one the select is on. Each says "with the link", because none of the
 * three lists a revision anywhere a stranger could browse — sharing widens who
 * an address answers to, and nothing else.
 */
function sharingHint(i18n: Translator, sharing: ContentSharing): string {
  switch (sharing) {
    case "public":
      return i18n.t("Anyone with the link can view this revision");
    case "authors":
      return i18n.t(
        "Anyone on the site who can author content and has the link can view this revision",
      );
    default:
      return i18n.t("Only you may view this revision");
  }
}

/**
 * Who may read one revision, as a dialog on that revision's row.
 *
 * A revision is what has an address — sharing means handing somebody the URL
 * of one — so this is per row rather than a panel on the item, and the
 * badge beside the row's name is what says which ones are out.
 *
 * The only prose left is the line under the select, which says the chosen
 * scope back as a sentence, and — for a theory alone — the one consequence an
 * author cannot see from here: what a colleague names from a lesson is frozen
 * into it and read by their own students, so there is no scope that permits
 * the naming and withholds the text.
 */
const RevisionSharingDialog: FC<{
  readonly context: Context<AppBindings>;
  readonly dialogId: string;
  readonly revision: ContentRevision;
}> = ({ context, dialogId, revision }) => {
  const i18n = useI18n();
  const theory = revision.sourceFormat === "mm0";
  const { origin } = new URL(context.req.url);

  return (
    <dialog class="modal-dialog" id={dialogId}>
      <form
        action={`/content/revisions/${revision.id}/sharing`}
        method="post"
      >
        <CsrfInput context={context} />
        <header class="modal-dialog-header">
          <h3>
            {i18n.t("Sharing for {name}", {
              name: revisionDetailsText(i18n, revision.details),
            })}
          </h3>
          <button
            aria-label={i18n.t("Close")}
            formmethod="dialog"
            formnovalidate
            type="submit"
          >
            ×
          </button>
        </header>
        <label>
          {i18n.t("Shared with:")}
          <br />
          <select data-choice-notes="sharing" name="sharing">
            {CONTENT_SHARING_VALUES.map((sharing) => (
              <option selected={sharing === revision.sharing} value={sharing}>
                {sharingLabel(i18n, sharing)}
              </option>
            ))}
          </select>
        </label>
        {CONTENT_SHARING_VALUES.map((sharing) => (
          <p
            class="small"
            data-choice-note="sharing"
            data-choice-value={sharing}
            hidden={sharing !== revision.sharing}
          >
            {sharingHint(i18n, sharing)}
          </p>
        ))}
        {/* A theory has no reading apart from its source, so there is nothing
            for this to withhold; for a lesson it is the difference between the
            compiled document and the Markdown behind it, answers and all. */}
        {theory ? null : (
          <label>
            <input
              checked={revision.shareSource}
              name="shareSource"
              type="checkbox"
              value="1"
            />
            {i18n.t("Share Markdown source")}
          </label>
        )}
        {theory ? (
          <p class="small">
            {i18n.t(
              "Whoever names this from a lesson freezes its text into that lesson, and their students read it there. Sharing a theory to be named is sharing what it says.",
            )}
          </p>
        ) : null}
        {/* What to hand somebody, once the scope is set. A revision's
            address is the whole of sharing here — it is immutable, and there
            is no other spelling of "this one" — so the dialog that opens the
            door gives out the key as well, rather than leaving a reader to
            assemble the URL from an address bar. Absolute, because the point
            is to paste it somewhere that is not this site. */}
        <div class="field-grid wide-fields">
          <label for={`${dialogId}-reading`}>
            {i18n.t("Link to this revision")}
            <CopyField
              id={`${dialogId}-reading`}
              value={`${origin}/content/revisions/${revision.id}`}
            />
          </label>
          <label for={`${dialogId}-source`}>
            {theory
              ? i18n.t("Address to name in an aufbau-mm0 src")
              : i18n.t("Link to the source")}
            <CopyField
              id={`${dialogId}-source`}
              value={
                theory
                  ? `${origin}${hostedTheoryPath(revision.id)}`
                  : `${origin}/content/revisions/${revision.id}/source`
              }
            />
          </label>
        </div>
        <button class="secondary" type="submit">
          {i18n.t("Save sharing")}
        </button>
      </form>
    </dialog>
  );
};

/**
 * The sharing control for one revision: the icon that opens the dialog, and a
 * badge saying who it is out to. The badge appears only on a shared revision,
 * the way the accommodations badge flags a member off the default — a column
 * of "Only me" would be noise on the ordinary case, which is every row until
 * an author does something.
 */
const RevisionSharing: FC<{
  readonly context: Context<AppBindings>;
  readonly revision: ContentRevision;
}> = ({ context, revision }) => {
  const i18n = useI18n();
  const dialogId = `sharing-${revision.id}`;
  const label = i18n.t("Set who may read {name}", {
    name: revisionDetailsText(i18n, revision.details),
  });

  return (
    <>
      <button
        aria-label={label}
        class="icon-button"
        data-dialog-target={dialogId}
        title={label}
        type="button"
      >
        <PeopleIcon />
      </button>
      <RevisionSharingDialog
        context={context}
        dialogId={dialogId}
        revision={revision}
      />
    </>
  );
};

const RevisionsTable: FC<{
  /** Whether to draw the per-row sharing control: this is the owner's page,
   * but saving a scope needs the content-author permission the item was made
   * under, and an author who has lost it should not be offered the dialog. */
  readonly canAuthor: boolean;
  readonly context: Context<AppBindings>;
  readonly revisions: readonly ContentRevision[];
}> = ({ canAuthor, context, revisions }) => {
  const i18n = useI18n();

  if (revisions.length === 0) {
    return (
      <p class="small">{i18n.t("No revisions have been created yet.")}</p>
    );
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Details")}</th>
          <th>{i18n.t("Created")}</th>
          <th scope="col">{i18n.t("Actions")}</th>
        </tr>
      </thead>
      <tbody>
        {revisions.map((revision) => (
          <tr>
            {/* The author's note is what names a revision here. The ordinal it
                used to show is real, but it says only how many revisions came
                before — which is no help at all in finding the one you want.
                A note nobody wrote still has to be clickable, so the fallback
                is worded rather than blank. */}
            <td>
              <a href={`/content/revisions/${revision.id}`}>
                {revision.details.length === 0 ? (
                  <span class="muted">
                    {revisionDetailsText(i18n, revision.details)}
                  </span>
                ) : (
                  revision.details
                )}
              </a>{" "}
              {revision.sharing === "private" ? null : (
                <StatusBadge
                  label={sharingLabel(i18n, revision.sharing)}
                  tone="ok"
                />
              )}
            </td>
            <td>
              <Time value={revision.createdAt} />
            </td>
            {/* Named by the same note the row is named by, so a reader who
                cannot see which row a link is in still hears which revision
                they are about to save. */}
            <td>
              {canAuthor ? (
                <RevisionSharing context={context} revision={revision} />
              ) : null}
              <SourceDownload
                href={`/content/revisions/${revision.id}/source`}
                label={i18n.t("Download the source of {name}", {
                  name: revisionDetailsText(i18n, revision.details),
                })}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

export function renderContentLibrary(
  context: Context<AppBindings>,
  model: {
    readonly canAuthor: boolean;
    readonly items: readonly ContentItem[];
    /** Item id → the revision a download of that item would hand over. */
    readonly latestRevisionIds: ReadonlyMap<string, string>;
  },
): Response {
  const i18n = context.get("i18n");
  // Whole sentences per branch rather than a sentence with a clause spliced
  // into it, as on the courses list: the second half changes the first half's
  // grammar in some languages, and a translator cannot see the seam from
  // inside a fragment.
  const description = model.canAuthor
    ? i18n.t("Reusable content records owned by your account.")
    : i18n.t(
        "Reusable content records owned by your account. You do not have permission to write content.",
      );

  const activeItems = model.items.filter((item) => item.archivedAt === null);
  const archivedItems = model.items.filter(
    (item) => item.archivedAt !== null,
  );

  return renderShell(
    context,
    { title: i18n.t("Content library") },
    <>
      <Sheet
        description={description}
        footer={
          model.canAuthor ? (
            <ContentItemCreateBar context={context} />
          ) : undefined
        }
        title={i18n.t("Your content")}
      >
        <ItemsTable
          archived={false}
          canAuthor={model.canAuthor}
          context={context}
          hasArchived={archivedItems.length > 0}
          items={activeItems}
          latestRevisionIds={model.latestRevisionIds}
        />
      </Sheet>
      {archivedItems.length > 0 ? (
        // The courses list's drawer, for the same reason: an archived item is
        // reference material, opened to find or unarchive something and
        // otherwise in the way. Closed, the count on the summary is the
        // answer to "where did that lesson go?".
        <details class="sheet archived-sheet">
          <summary class="sheet-header">
            <h2>
              {i18n.t("Archived content ({count})", {
                count: archivedItems.length,
              })}
            </h2>
          </summary>
          <div class="sheet-section">
            <p class="small">
              {i18n.t(
                "Hidden from the list above and from new assignments; everything set on them still works.",
              )}
            </p>
            <ItemsTable
              archived
              canAuthor={model.canAuthor}
              context={context}
              hasArchived
              items={archivedItems}
              latestRevisionIds={model.latestRevisionIds}
            />
          </div>
        </details>
      ) : null}
    </>,
  );
}

export function renderContentCreateError(
  context: Context<AppBindings>,
  options: { readonly message: string; readonly status: Status },
): Response {
  // Hoisted, not `context.get("i18n").t(...)`: the extractor matches the
  // receiver by name, so a call expression there extracts nothing at all.
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { status: options.status, title: i18n.t("Content library") },
    <>
      <ErrorSummary>{options.message}</ErrorSummary>
      <ContentItemForm context={context} />
    </>,
  );
}

export function renderContentItem(
  context: Context<AppBindings>,
  model: {
    readonly canAuthor: boolean;
    readonly item: ContentItem;
    readonly notices: readonly string[];
    readonly owner: User | null;
    readonly revisions: readonly ContentRevision[];
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { breadcrumb: [contentCrumb(i18n)], title: model.item.title },
    <>
      {model.notices.map((message) => (
        <Notice>{message}</Notice>
      ))}
      <Sheet
        description={i18n.t(
          "Ownership and revision counts for this content item.",
        )}
        footer={
          model.canAuthor ? (
            <ArchiveItemForm context={context} item={model.item} />
          ) : undefined
        }
        summary={
          <SummaryStrip
            items={[
              {
                label: i18n.t("Owner"),
                value: userDisplayName(
                  i18n,
                  model.owner,
                  model.item.ownerUserId,
                ),
              },
              {
                label: i18n.t("Revisions"),
                value: model.revisions.length.toString(),
              },
              // In both states, as on the course page: it is what an author
              // checks after pressing the button in the footer, and a cell
              // that appeared only once the item was archived would leave one
              // who saw no change with nothing to read.
              {
                label: i18n.t("Status"),
                value:
                  model.item.archivedAt === null
                    ? i18n.t("Active")
                    : i18n.t("Archived"),
              },
            ]}
          />
        }
        title={i18n.t("Content record")}
      />
      <Sheet
        description={i18n.t(
          "Immutable snapshots that published assignments point to. Each is shared, or not, on its own.",
        )}
        footer={
          model.canAuthor ? (
            <RevisionFooterActions
              context={context}
              itemId={model.item.id}
              sourceFormat={model.item.sourceFormat}
            />
          ) : undefined
        }
        title={i18n.t("Revisions")}
      >
        <RevisionsTable
          canAuthor={model.canAuthor}
          context={context}
          revisions={model.revisions}
        />
      </Sheet>
    </>,
  );
}

export function renderRevisionCreateError(
  context: Context<AppBindings>,
  options: {
    readonly itemId: string;
    readonly message: string;
    readonly status: Status;
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    {
      breadcrumb: [contentCrumb(i18n)],
      status: options.status,
      title: i18n.t("Revision not created"),
    },
    <>
      <ErrorSummary>{options.message}</ErrorSummary>
      <p>
        <a class="button" href={`/content/${options.itemId}`}>
          {i18n.t("Back to the content item")}
        </a>
      </p>
    </>,
  );
}

export function renderRevisionEditor(
  context: Context<AppBindings>,
  model: {
    /** Carried back verbatim when a save is rejected, so a typed note survives. */
    readonly details: string;
    readonly diagnostics: readonly Diagnostic[];
    readonly error?: string;
    readonly itemId: string;
    readonly itemTitle: string;
    /** The server-compiled preview of the initial source, or null when it
     * doesn't compile; the client bundle takes over from the first edit. */
    readonly previewDocumentHtml: string | null;
    /**
     * What the item holds. A theory gets the editor and its diagnostics with
     * no second column: there is no document to preview, and inventing one —
     * a rendering of the MM0 the author is looking at already — would be a
     * column that repeats the one beside it.
     */
    readonly sourceFormat: ContentSourceFormat;
    readonly sourceText: string;
    readonly status?: Status;
  },
): Response {
  const i18n = context.get("i18n");
  const editor = (
    <RevisionEditor
      context={context}
      details={model.details}
      diagnostics={model.diagnostics}
      itemId={model.itemId}
      sourceFormat={model.sourceFormat}
      sourceText={model.sourceText}
    />
  );
  /*
   * A theory has neither a preview nor a second column: the editor is the
   * whole page, and there is nothing to switch to.
   */
  const views =
    model.sourceFormat === "mm0"
      ? undefined
      : splitView({
          // Nothing has compiled yet, so there is no earlier preview to dim
          // as stale — the column would just be an empty box. The preview
          // bundle drops the class for good the first time a document lands.
          ...(model.previewDocumentHtml === null
            ? { className: "preview-empty" }
            : {}),
          content: (
            // srcdoc rather than a URL: the source is unsaved, so there is no
            // document route to point at (and no fullscreen link).
            <ContentFrame
              placeholder={
                <>
                  <p class="content-frame-empty-title">
                    {i18n.t("Nothing to preview yet")}
                  </p>
                  <p>{i18n.t("The source doesn't compile.")}</p>
                </>
              }
              srcdoc={model.previewDocumentHtml ?? ""}
              title={i18n.t("Preview")}
            />
          ),
          contentLabel: i18n.t("Preview"),
          legend: i18n.t("Editor view"),
          rail: editor,
          railLabel: i18n.t("Write"),
          resizeLabel: i18n.t("Resize the editor and preview columns"),
          splitLabel: i18n.t("Split"),
          // Writing is what this page is for; the preview is the second look.
          start: "rail",
        });

  return renderShell(
    context,
    {
      breadcrumb: [
        contentCrumb(i18n),
        contentItemCrumb(model.itemId, model.itemTitle),
      ],
      ...(views === undefined ? {} : { headerAside: views.viewSwitch }),
      ...(model.status === undefined ? {} : { status: model.status }),
      title: i18n.t("New revision"),
    },
    <>
      {model.error === undefined ? null : (
        <ErrorSummary>{model.error}</ErrorSummary>
      )}
      {views === undefined ? editor : views.split}
      {raw(
        uiStringsScript(
          EDITOR_UI_STRINGS_ATTRIBUTE,
          // The same language this page's server-rendered preview was built in,
          // so the bundle's rebuild of it cannot land in a different one.
          editorUiStrings(i18n, context.get("language")),
        ),
      )}
      <script src="/assets/editor-preview.js" type="module" />
    </>,
  );
}

/**
 * What a saved theory declares, and the address a lesson names it by.
 *
 * The address is the reason this panel exists. A hosted theory is only useful
 * once it is quoted in an `aufbau-mm0` block, and the thing to quote is a
 * *revision's* URL — so it is shown where a revision is being looked at, and
 * shown as text to copy rather than only as a link to follow.
 */
const TheorySummary: FC<{
  readonly artifact: CompiledTheoryArtifact;
  readonly path: string;
}> = ({ artifact, path }) => {
  const i18n = useI18n();

  return (
    <Sheet
      description={i18n.t(
        "Quote this address in an aufbau-mm0 block's src to build proofs on this theory. It names this revision, so later revisions leave existing lessons alone.",
      )}
      summary={
        <SummaryStrip
          items={[
            { label: i18n.t("Rules"), value: artifact.axioms.length },
            { label: i18n.t("Sorts"), value: artifact.sorts.length },
            { label: i18n.t("Terms"), value: artifact.terms.length },
          ]}
        />
      }
      title={i18n.t("Theory")}
    >
      <p>
        <a href={path}>
          <code>{path}</code>
        </a>
      </p>
      <p>
        {artifact.sentenceSort === null
          ? i18n.t(
              "This file is a proof system only. To set model or translation exercises in it as well, give its sentence sort a @syntax role.",
            )
          : i18n.t(
              "Also a language: formulas are read at the sort {sort}, so exercises can be set in it too.",
              { sort: artifact.sentenceSort },
            )}
      </p>
      {artifact.axioms.length === 0 ? null : (
        <p class="small">
          {i18n.t("Rules a proof can cite: {names}.", {
            names: artifact.axioms.join(", "),
          })}
        </p>
      )}
    </Sheet>
  );
};

export function renderRevision(
  context: Context<AppBindings>,
  model: {
    readonly details: string;
    readonly itemId: string;
    readonly itemTitle: string;
    /**
     * Whether the item behind this revision is the reader's. A colleague
     * reading a shared revision has no page there, so the trail names the
     * lesson without linking it — a crumb that answers 404 is worse than a
     * crumb that only orients.
     */
    readonly owned: boolean;
    readonly revisionId: string;
    /**
     * The source, when this reader may have it — which is not the same as
     * being able to read the revision. A lesson's Markdown carries the
     * accepted answers and the rubrics that the compiled document holds back,
     * so a shared item whose author did not also share the source shows the
     * compiled thing and nothing else. `null` drops the sheet rather than
     * drawing an empty one: there is nothing to say about a source somebody
     * cannot see.
     */
    readonly sourceText: string | null;
    /** Present exactly when this is a revision of an MM0 item. */
    readonly theory?: CompiledTheoryArtifact;
  },
): Response {
  const i18n = context.get("i18n");
  const documentUrl = `/content/revisions/${model.revisionId}/document`;
  const foldStrings = markdownFoldStrings(i18n);
  const compiled =
    model.theory === undefined ? (
      <ContentFrame
        fullscreenHref={documentUrl}
        src={documentUrl}
        title={i18n.t("Compiled content")}
      />
    ) : (
      <TheorySummary
        artifact={model.theory}
        path={hostedTheoryPath(model.revisionId)}
      />
    );
  /*
   * The source, when this reader has it — and the whole of the second column
   * when they do. A revision used to be introduced by a record card carrying
   * its note and the date it was saved; the note names the page in the
   * breadcrumb now, and the date is on the item's revision list, one click
   * away, which leaves this page holding the two things a revision is.
   *
   * No heading on the sheet: the view switch in the header row already says
   * "Source" over this column, and a sheet titled the same thing under it
   * said it twice. The `data-source-label` below is what names the source
   * view to a screen reader.
   */
  const source =
    model.sourceText === null ? null : (
      <>
        <Sheet className="source-sheet">
          {/* The `<pre>` is the whole rendering without JS; the
              source-view bundle swaps it for the read-only CodeMirror the
              editor uses, so a directive reads as a directive here too.
              The names travel as attributes because that bundle has no
              catalog of its own. */}
          <div
            class="markdown-source"
            data-fold-label={foldStrings.fold}
            data-source-label={i18n.t("Revision source")}
            data-source-view
            data-unfold-label={foldStrings.unfold}
          >
            <pre>
              <code>{model.sourceText}</code>
            </pre>
          </div>
        </Sheet>
        <script src="/assets/source-view.js" type="module" />
      </>
    );
  /*
   * A shared revision whose author did not also share the source is a single
   * document, and a split with an empty column beside it would only be a
   * narrower way to read it.
   */
  const views =
    source === null
      ? undefined
      : splitView({
          content: compiled,
          contentLabel:
            model.theory === undefined
              ? i18n.t("Document")
              : i18n.t("Theory"),
          legend: i18n.t("Revision view"),
          rail: source,
          railLabel: i18n.t("Source"),
          resizeLabel: i18n.t("Resize the source and document columns"),
          splitLabel: i18n.t("Split"),
          // What the revision is *for* is the compiled thing; the source is
          // how it was made, and it is one tap away.
          start: "content",
        });

  return renderShell(
    context,
    {
      breadcrumb: [
        contentCrumb(i18n),
        model.owned
          ? contentItemCrumb(model.itemId, model.itemTitle)
          : { label: model.itemTitle },
      ],
      ...(views === undefined ? {} : { headerAside: views.viewSwitch }),
      /*
       * The author's own words for this revision, which is what tells two of
       * them apart — "Content revision" only says what every page here is.
       * The trail cuts a long note short (CSS); the words are all still here
       * for a reader who is being read to, and for the tab.
       */
      title:
        model.details.length === 0
          ? i18n.t("Content revision")
          : model.details,
    },
    views === undefined ? compiled : views.split,
  );
}

/**
 * A revision's compiled output as a standalone content document — the target
 * of the revision page's iframe and fullscreen link.
 *
 * Everything but the body is passed straight through rather than relisted:
 * naming the props here meant that `cssHrefs` — and, later, `systems` — arrived
 * from `artifactDocumentProps` at the call site and were dropped on this floor,
 * with nothing to say so.
 */
export function renderRevisionDocument(
  context: Context<AppBindings>,
  model: Omit<ContentDocumentModel, "body" | "i18n" | "locale"> & {
    readonly compiledHtml: string;
  },
): Response {
  const { compiledHtml, ...rest } = model;

  return renderContentDocument(context, {
    ...rest,
    body: raw(compiledHtml),
  });
}

export function renderContentError(
  context: Context<AppBindings>,
  options: {
    readonly message: string;
    readonly status: Status;
    readonly title: string;
  },
): Response {
  return renderShell(
    context,
    {
      breadcrumb: [contentCrumb(context.get("i18n"))],
      status: options.status,
      title: options.title,
    },
    <ErrorSummary>{options.message}</ErrorSummary>,
  );
}
