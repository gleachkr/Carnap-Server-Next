import type { Context } from "hono";
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";

import { canAuthorContent } from "../application/authorization";
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

export interface PageAction {
  readonly href: string;
  readonly label: string;
}

/**
 * One link in the breadcrumb trail rendered under the navbar. The trail holds
 * only ancestors; the current page is the shell `title`, rendered as the final
 * non-linked crumb.
 */
export interface Crumb {
  readonly href: string;
  readonly label: string;
}

export interface ShellOptions {
  readonly actions?: readonly PageAction[];
  readonly breadcrumb?: readonly Crumb[];
  /**
   * Drop the navbar, breadcrumb and footer, keeping the styles and scripts.
   * For a page framed by someone else's application — an LMS launch — where
   * our navigation is both redundant chrome and an invitation to wander off
   * the one resource the launch named.
   */
  readonly chromeless?: boolean;
  readonly showTitle?: boolean;
  readonly status?: 200 | 400 | 401 | 403 | 404 | 429 | 500;
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
 * The signed-in actor's account link. We only have a single free-text `name`,
 * so "first name" is just its leading whitespace-delimited word; the profile
 * page (which this opens) carries the full name and the log-out control.
 */
const ProfileLink: FC<{ readonly actor: Actor }> = ({ actor }) => {
  const name = actor.user.name?.trim();
  const label = name ? (name.split(/\s+/)[0] ?? name) : actor.user.email;

  return (
    <a class="nav-profile" href="/profile">
      {label}
    </a>
  );
};

interface LayoutProps {
  readonly actions: readonly PageAction[];
  readonly actor: Actor | null;
  readonly breadcrumb: readonly Crumb[];
  readonly children: Child;
  readonly chromeless: boolean;
  /**
   * The incomplete-profile strip, or null when there is nothing to ask for.
   * Built by `renderShell` because it needs the request — the layout itself
   * takes only what it renders.
   */
  readonly prompt: Child | null;
  readonly showTitle: boolean;
  readonly title: string;
}

const Layout: FC<LayoutProps> = ({
  actions,
  actor,
  breadcrumb,
  children,
  chromeless,
  prompt,
  showTitle,
  title,
}) => {
  // Both the words and the tag: `<html lang>` and the client scripts' `Intl`
  // want the locale, and taking it off the translator that worded the page is
  // what stops the two drifting apart.
  const i18n = useI18n();

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
        {chromeless ? null : (
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
              {actions.map((action) => (
                <a class="nav-action" href={action.href}>
                  {action.label}
                </a>
              ))}
            </nav>
            {actor === null ? null : (
              <>
                <span aria-hidden="true" class="nav-divider" />
                <ProfileLink actor={actor} />
              </>
            )}
          </header>
        )}
        <main class="page-shell">
          {/* Inside the landmark rather than above it: a strip between the
              header and `main` is content belonging to no region, which is
              both an axe finding and a genuine navigation dead spot. */}
          {prompt}
          {showTitle && !chromeless ? (
            <nav aria-label={i18n.t("Breadcrumb")} class="breadcrumb">
              {breadcrumb.map((crumb) => (
                <>
                  <a class="breadcrumb-link" href={crumb.href}>
                    {crumb.label}
                  </a>
                  <span aria-hidden="true" class="breadcrumb-sep">
                    ›
                  </span>
                </>
              ))}
              <span aria-current="page" class="breadcrumb-current">
                {title}
              </span>
            </nav>
          ) : null}
          <div class="page-content">{children}</div>
        </main>
        {chromeless ? null : (
          <footer class="app-footer">
            <a class="brand" href="/" aria-label={i18n.t("Carnap home")}>
              <span class="brand-mark" aria-hidden="true">
                ⊨
              </span>
              <span>Carnap</span>
            </a>
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
        actions={options.actions ?? []}
        actor={context.get("actor")}
        breadcrumb={options.breadcrumb ?? []}
        chromeless={chromeless}
        // Not on a chromeless page: those are launches framed by someone
        // else's application, where our own housekeeping is an interruption
        // in the middle of their assignment.
        prompt={chromeless ? null : <ProfilePrompt context={context} />}
        showTitle={options.showTitle ?? true}
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
