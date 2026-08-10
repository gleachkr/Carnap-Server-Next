import type { Context } from "hono";
import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { DiagnosticMessageId } from "../application/content/diagnostic-strings";
import type { ContentItem, ContentRevision } from "../domain/content";
import type { User } from "../domain/users";
import type { ExerciseHydration } from "../exercises/hydration";
import type { AppBindings } from "../http";
import {
  splitAtValue,
  type TranslatableMessage,
  translateMessage,
  VALUE,
} from "../i18n/translator";
import { contentCrumb, contentItemCrumb } from "./breadcrumbs";
import {
  ContentFrame,
  ContentSplit,
  CreateBar,
  CsrfInput,
  ErrorSummary,
  Notice,
  Sheet,
  SummaryStrip,
  TableScroll,
  Time,
} from "./components";
import { renderContentDocument } from "./content-document";
import { renderShell, useI18n } from "./layout";
import { revisionDetailsText } from "./revisions";
import {
  EDITOR_UI_STRINGS_ATTRIBUTE,
  editorUiStrings,
  markdownFoldStrings,
  uiStringsScript,
} from "./ui-strings";
import { userDisplayName } from "./users";

type Status = 200 | 400 | 401 | 403 | 404 | 429 | 500;

export function sampleSource(): string {
  return `# Sample exercise

Read the prompt and choose an answer.

::::multiple-choice{#sample title="Sample" points="1"}
Which option is correct?

- [ ] first | The first option
- [x] second | The second option
::::`;
}

const ItemsTable: FC<{
  readonly canAuthor: boolean;
  readonly items: readonly ContentItem[];
}> = ({ canAuthor, items }) => {
  const i18n = useI18n();

  if (items.length === 0) {
    // "You have not written any yet" is an invitation, and reads as a taunt to
    // somebody who cannot. The sheet's description says why; this says what.
    return (
      <p class="small">
        {canAuthor
          ? i18n.t("You have not created any content items yet.")
          : i18n.t("You do not own any content items.")}
      </p>
    );
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Title")}</th>
          <th>{i18n.t("Updated")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr>
            <td>
              <a href={`/content/${item.id}`}>{item.title}</a>
            </td>
            <td>
              <Time value={item.updatedAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
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
    </CreateBar>
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
  readonly sourceText: string;
}> = ({ context, details, diagnostics, itemId, sourceText }) => {
  const i18n = useI18n();

  return (
    <form action={`/content/${itemId}/revisions/new`} method="post">
      <Sheet
        className="source-sheet"
        description={i18n.t(
          "Write Carnap Markdown — the preview follows along — then save an immutable revision.",
        )}
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
        title={i18n.t("New revision")}
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
          {i18n.t("Carnap Markdown")}
        </label>
        <textarea
          data-editor-source
          id={SOURCE_FIELD_ID}
          name="sourceText"
          required
          rows={18}
          // Carnap Markdown is mostly directive names, attribute keys, and
          // logical operators; a spellchecker marks nearly all of it, which
          // buries the words an author would actually want flagged. (CodeMirror
          // turns it off itself, so this is the no-JS path.)
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
 * a revision straight from a Markdown file.
 */
const RevisionFooterActions: FC<{
  readonly context: Context<AppBindings>;
  readonly itemId: string;
}> = ({ context, itemId }) => {
  const i18n = useI18n();

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
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          aria-label={i18n.t("Carnap Markdown file")}
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

const RevisionsTable: FC<{
  readonly revisions: readonly ContentRevision[];
}> = ({ revisions }) => {
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
              </a>
            </td>
            <td>
              <Time value={revision.createdAt} />
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

  return renderShell(
    context,
    { title: i18n.t("Content library") },
    <Sheet
      description={description}
      footer={
        model.canAuthor ? (
          <ContentItemCreateBar context={context} />
        ) : undefined
      }
      title={i18n.t("Your content")}
    >
      <ItemsTable canAuthor={model.canAuthor} items={model.items} />
    </Sheet>,
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
            ]}
          />
        }
        title={i18n.t("Content record")}
      />
      <Sheet
        description={i18n.t(
          "Immutable snapshots that published assignments point to.",
        )}
        footer={
          model.canAuthor ? (
            <RevisionFooterActions context={context} itemId={model.item.id} />
          ) : undefined
        }
        title={i18n.t("Revisions")}
      >
        <RevisionsTable revisions={model.revisions} />
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
    readonly sourceText: string;
    readonly status?: Status;
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    {
      breadcrumb: [
        contentCrumb(i18n),
        contentItemCrumb(model.itemId, model.itemTitle),
      ],
      ...(model.status === undefined ? {} : { status: model.status }),
      title: i18n.t("New revision"),
    },
    <>
      {model.error === undefined ? null : (
        <ErrorSummary>{model.error}</ErrorSummary>
      )}
      <div class="editor-mode-switch" data-editor-mode-switch>
        <button
          aria-pressed="true"
          class="ghost"
          data-mode-target="write"
          type="button"
        >
          {i18n.t("Write")}
        </button>
        <button
          aria-pressed="false"
          class="ghost"
          data-mode-target="preview"
          type="button"
        >
          {i18n.t("Preview")}
        </button>
      </div>
      <ContentSplit
        // Nothing has compiled yet, so there is no earlier preview to dim as
        // stale — the column would just be an empty box. The preview bundle
        // drops the class for good the first time a document lands.
        {...(model.previewDocumentHtml === null
          ? { className: "preview-empty" }
          : {})}
        content={
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
        }
        mode="write"
        rail={
          <RevisionEditor
            context={context}
            details={model.details}
            diagnostics={model.diagnostics}
            itemId={model.itemId}
            sourceText={model.sourceText}
          />
        }
      />
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

export function renderRevision(
  context: Context<AppBindings>,
  model: {
    readonly createdAt: string;
    readonly details: string;
    readonly itemId: string;
    readonly itemTitle: string;
    readonly revisionId: string;
    readonly sourceText: string;
  },
): Response {
  const i18n = context.get("i18n");
  const documentUrl = `/content/revisions/${model.revisionId}/document`;
  const foldStrings = markdownFoldStrings(i18n);

  return renderShell(
    context,
    {
      breadcrumb: [
        contentCrumb(i18n),
        contentItemCrumb(model.itemId, model.itemTitle),
      ],
      title: i18n.t("Content revision"),
    },
    <ContentSplit
      content={
        <ContentFrame
          fullscreenHref={documentUrl}
          src={documentUrl}
          title={i18n.t("Compiled content")}
        />
      }
      rail={
        <>
          <Sheet
            description={i18n.t(
              "Immutable source and compiled output for this revision.",
            )}
            summary={
              <SummaryStrip
                items={[
                  {
                    label: i18n.t("Created"),
                    value: <Time value={model.createdAt} />,
                  },
                ]}
              />
            }
            title={i18n.t("Revision record")}
          >
            {/* The note reads as the sentence it is. It was briefly a
                summary-strip cell next to the date, but that slot sets its value
                in the large display serif — sized for a count or a timestamp,
                and a sentence wrapped across three lines of it. */}
            <p {...(model.details.length === 0 ? { class: "muted" } : {})}>
              {revisionDetailsText(i18n, model.details)}
            </p>
          </Sheet>
          <Sheet className="source-sheet" title={i18n.t("Source")}>
            {/* The `<pre>` is the whole rendering without JS; the source-view
                bundle swaps it for the read-only CodeMirror the editor uses, so
                a directive reads as a directive here too. The names travel as
                attributes because that bundle has no catalog of its own. */}
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
      }
    />,
  );
}

/**
 * A revision's compiled output as a standalone content document — the target
 * of the revision page's iframe and fullscreen link.
 */
export function renderRevisionDocument(
  context: Context<AppBindings>,
  model: {
    readonly compiledHtml: string;
    readonly componentAssets: readonly string[];
    readonly css?: string;
    readonly cssReset?: boolean;
    readonly exerciseHydration: Record<string, ExerciseHydration>;
    readonly title: string;
  },
): Response {
  return renderContentDocument(context, {
    body: raw(model.compiledHtml),
    componentAssets: model.componentAssets,
    exerciseHydration: model.exerciseHydration,
    ...(model.css === undefined ? {} : { css: model.css }),
    ...(model.cssReset === undefined ? {} : { cssReset: model.cssReset }),
    title: model.title,
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
