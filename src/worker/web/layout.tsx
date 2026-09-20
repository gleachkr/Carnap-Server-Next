import type { Context } from "hono";
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";
import { canAuthorContent } from "../application/authorization";
import type { AppErrorStatus } from "../application/errors";
import type { AppBindings } from "../http";
import { I18nProvider, useI18n } from "./i18n-context";
import { ProfilePrompt } from "./profile-prompt";
import { SHELL_SCRIPT_ASSET } from "./script-assets";
import { CHROME_STYLE_SHEET, CONTENT_STYLE_SHEET } from "./style-assets";
import {
  LAYOUT_UI_STRINGS_ATTRIBUTE,
  layoutUiStrings,
  uiStringsScript,
} from "./ui-strings";

// Re-exported so the many view modules that reach for the ambient translator
// keep importing it from the layout, next to `renderShell`.
export { useI18n };

type Actor = NonNullable<AppBindings["Variables"]["actor"]>;

/**
 * One step in the breadcrumb trail rendered under the navbar. The trail holds
 * only ancestors; the current page is the shell `title`, rendered as the final
 * non-linked crumb.
 *
 * `href` is optional because a reader can be somewhere whose ancestor is not
 * theirs to open — a shared content revision, whose item page belongs to its
 * author. Such a crumb still orients (it names the lesson this revision is a
 * revision of); it simply does not offer a link that would answer 404.
 */
export interface Crumb {
  readonly href?: string;
  readonly label: string;
}

/**
 * A crumb that definitely links somewhere — what every builder in
 * `./breadcrumbs` returns. Callers reuse a crumb's `href` for the page's own
 * "cancel" link, and that has to stay a string.
 */
export type LinkedCrumb = Crumb & { readonly href: string };

/** What a page answers with: the OK, or one of the error statuses a page can wear. */
export type PageStatus = 200 | AppErrorStatus;

export interface ShellOptions {
  readonly breadcrumb?: readonly Crumb[];
  /**
   * Drop the navbar, breadcrumb and footer, keeping the styles and scripts.
   * For a page framed by someone else's application — an LMS launch — where
   * our navigation is both redundant chrome and an invitation to wander off
   * the one resource the launch named.
   */
  readonly chromeless?: boolean;
  /**
   * A control placed opposite the breadcrumb, on the same row. For something
   * that governs the whole page rather than any one sheet on it — the
   * revision editor's Write/Preview switch, which has to outlive the column
   * it would otherwise sit in. Renders only where the breadcrumb does.
   */
  readonly headerAside?: Child;
  readonly status?: PageStatus;
  readonly title: string;
}

function canUseAdmin(actor: Actor): boolean {
  return actor.capabilities.some(
    (grant) =>
      grant.capability === "site_admin" ||
      grant.capability === "support_operator",
  );
}

/**
 * The monogram a narrow viewport shows in place of the name: its first
 * character, upper-cased. By code point rather than `label[0]`, which on a name
 * beginning outside the BMP would be half a surrogate pair; and clamped back to
 * one code point afterwards, because "ß" upper-cases to "SS" and a two-letter
 * circle is not a monogram.
 */
function profileInitial(label: string): string {
  const [first = ""] = label;
  const [upper = ""] = first.toUpperCase();

  return upper;
}

/**
 * The signed-in actor's account link. We only have a single free-text `name`,
 * so "first name" is just its leading whitespace-delimited word; the profile
 * page (which this opens) carries the full name and the log-out control.
 *
 * Below 700px the name gives way to a monogram (`.nav-profile-mark` in
 * chrome.css), since an admin's three nav items plus an ordinary first name
 * already overflow a phone and wrap the bar to two rows. The link carries the
 * name as its `aria-label` so its accessible name is the same on both sides of
 * the breakpoint: the visible name can then be `display: none`d on a phone
 * without taking the name out of the accessibility tree, and the monogram,
 * which repeats one letter of it, stays out of that tree altogether.
 */
const ProfileLink: FC<{ readonly actor: Actor }> = ({ actor }) => {
  const name = actor.user.name?.trim();
  const label = name ? (name.split(/\s+/)[0] ?? name) : actor.user.email;

  return (
    <a aria-label={label} class="nav-profile" href="/profile">
      <span class="nav-profile-name">{label}</span>
      <span aria-hidden="true" class="nav-profile-mark">
        {profileInitial(label)}
      </span>
    </a>
  );
};

interface LayoutProps {
  readonly actor: Actor | null;
  readonly breadcrumb: readonly Crumb[];
  readonly children: Child;
  readonly chromeless: boolean;
  readonly headerAside: Child;
  /**
   * The incomplete-profile strip, or null when there is nothing to ask for.
   * Built by `renderShell` because it needs the request — the layout itself
   * takes only what it renders.
   */
  readonly prompt: Child | null;
  readonly title: string;
}

const Layout: FC<LayoutProps> = ({
  actor,
  breadcrumb,
  children,
  chromeless,
  headerAside,
  prompt,
  title,
}) => {
  // Both the words and the tag: `<html lang>` and the client scripts' `Intl`
  // want the locale, and taking it off the translator that worded the page is
  // what stops the two drifting apart.
  const i18n = useI18n();
  // The header is navigation, so it appears when there is somewhere to go. A
  // signed-out visitor gets no nav items and no profile link, which left a bar
  // holding nothing but the brand — and on the login page that brand links to
  // "/", which sends them back to the login page. The footer carries the brand
  // link on exactly those pages, so the way in is still on every one of them.
  const showHeader = !chromeless && actor !== null;
  // The trail holds ancestors, so a top-level page — the course list, the
  // library, the admin index — has none, and a trail of one is not a trail:
  // it is the page title wearing a breadcrumb's clothes, which is exactly
  // the heading these pages don't have. The row still appears for an aside
  // on its own, since the aside needs a row to sit in whatever the trail
  // does.
  const showHeaderRow =
    !chromeless && (breadcrumb.length > 0 || headerAside !== null);

  return (
    <html lang={i18n.locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* --paper under each palette. A phone browser tints its own chrome
            with this, and without the pair a dark-themed phone frames a dark
            page in cream. The media queries are the whole mechanism: the
            stylesheet answers the same question for itself. */}
        <meta
          name="theme-color"
          content="#f1eadf"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#17140f"
          media="(prefers-color-scheme: dark)"
        />
        <title>{`${title} · Carnap`}</title>
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
        {/* Linked rather than inlined so a reader downloads them once and not
            again on the next page; the content layer is the same file the
            content iframe below asks for. Order is the cascade: chrome after
            content, as the concatenation used to be. */}
        <link href={CONTENT_STYLE_SHEET.href} rel="stylesheet" />
        <link href={CHROME_STYLE_SHEET.href} rel="stylesheet" />
        {/* `defer` rather than inline at the end of the body: the fetch starts
            here, in parallel with the rest of the parse, and execution still
            waits for a complete document — so the UI-strings payload below is
            there to be read, and a cold cache costs less than it would from the
            foot of the page. */}
        <script defer src={SHELL_SCRIPT_ASSET.href} />
      </head>
      <body>
        <noscript>
          <div class="noscript-banner">
            {i18n.t(
              "Carnap needs JavaScript enabled to display and complete exercises. Please turn it on for this site.",
            )}
          </div>
        </noscript>
        {showHeader ? (
          <header class="app-header">
            <a class="brand" href="/" aria-label={i18n.t("Carnap home")}>
              <span class="brand-mark" aria-hidden="true">
                ⊨
              </span>
              <span class="brand-word">Carnap</span>
            </a>
            <nav class="app-nav" aria-label={i18n.t("Main navigation")}>
              {actor === null ? null : (
                <a href="/courses">{i18n.t("Courses")}</a>
              )}
              {/* The library is an authoring tool, so it is offered to people who
                may author. A student's library could only ever be empty, and a
                nav item promising one was a standing invitation to a page with
                nothing on it. Reading a library one already owns needs no
                permission — that route stays open to anyone who has the URL. */}
              {actor !== null && canAuthorContent(actor) ? (
                <a href="/content">{i18n.t("Content")}</a>
              ) : null}
              {actor !== null && canUseAdmin(actor) ? (
                <a href="/admin">{i18n.t("Admin")}</a>
              ) : null}
            </nav>
            {actor === null ? null : (
              <>
                <span aria-hidden="true" class="nav-divider" />
                <ProfileLink actor={actor} />
              </>
            )}
          </header>
        ) : null}
        <main class="page-shell">
          {/* Inside the landmark rather than above it: a strip between the
              header and `main` is content belonging to no region, which is
              both an axe finding and a genuine navigation dead spot. */}
          {prompt}
          {showHeaderRow ? (
            <div class="page-header">
              {breadcrumb.length === 0 ? null : (
                <nav aria-label={i18n.t("Breadcrumb")} class="breadcrumb">
                  {breadcrumb.map((crumb) => (
                    <>
                      {crumb.href === undefined ? (
                        <span class="breadcrumb-current">{crumb.label}</span>
                      ) : (
                        <a class="breadcrumb-link" href={crumb.href}>
                          {crumb.label}
                        </a>
                      )}
                      <span aria-hidden="true" class="breadcrumb-sep">
                        ›
                      </span>
                    </>
                  ))}
                  <span aria-current="page" class="breadcrumb-current">
                    {title}
                  </span>
                </nav>
              )}
              {headerAside}
            </div>
          ) : null}
          <div class="page-content">{children}</div>
        </main>
        {chromeless ? null : (
          <footer class="app-footer">
            {/* The way in for a page that dropped the header (see
                `showHeader`); where the header is there, its brand is the
                same link a screen's height above, and a second one is a
                second stop on the way through the page. */}
            {showHeader ? null : (
              <a class="brand" href="/" aria-label={i18n.t("Carnap home")}>
                <span class="brand-mark" aria-hidden="true">
                  ⊨
                </span>
                <span>Carnap</span>
              </a>
            )}
            <div class="footer-meta">
              <span class="copyright">
                {i18n.t(
                  "A platform for teaching and practicing formal logic.",
                )}
              </span>
              <a class="footer-link" href="/donate">
                {i18n.t("Donate to charity →")}
              </a>
            </div>
          </footer>
        )}
        {/* Read by the deferred shell script linked in the head, which cannot
            run until this has been parsed. */}
        {raw(
          uiStringsScript(LAYOUT_UI_STRINGS_ATTRIBUTE, layoutUiStrings(i18n)),
        )}
      </body>
    </html>
  );
};

/**
 * Render a full HTML document around `children` and return it as a response.
 * This is the single source of truth for the page chrome; the legacy
 * string-based `page()` helper in `html.ts` delegates here so string-built and
 * JSX-built views share identical navigation, styling, and scripts.
 */
export function renderShell(
  context: Context<AppBindings>,
  options: ShellOptions,
  children: Child,
): Response {
  const chromeless = options.chromeless ?? false;
  const node = (
    <I18nProvider i18n={context.get("i18n")}>
      <Layout
        actor={context.get("actor")}
        breadcrumb={options.breadcrumb ?? []}
        chromeless={chromeless}
        headerAside={options.headerAside ?? null}
        // Not on a chromeless page: those are launches framed by someone
        // else's application, where our own housekeeping is an interruption
        // in the middle of their assignment.
        prompt={chromeless ? null : <ProfilePrompt context={context} />}
        title={options.title}
      >
        {children}
      </Layout>
    </I18nProvider>
  );
  const rendered = node.toString();

  if (typeof rendered !== "string") {
    // All layout components are synchronous, so this should be unreachable —
    // and it must stay that way: the provider above is only concurrency-safe
    // for a synchronous render (see the note in ./i18n-context).
    throw new Error("Layout rendered asynchronously.");
  }

  return context.html(`<!doctype html>${rendered}`, options.status ?? 200);
}
