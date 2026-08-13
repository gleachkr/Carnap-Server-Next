import type { Context } from "hono";
import type { FC } from "hono/jsx";

import { hasProfilePromptDismissed } from "../cookies";
import { hasName } from "../domain/users";
import type { AppBindings } from "../http";
import { CsrfInput } from "./components";
// From `./i18n-context`, not the layout's re-export: the layout imports this
// module, and going back the other way would close a cycle.
import { useI18n } from "./i18n-context";

type Actor = NonNullable<AppBindings["Variables"]["actor"]>;

/** Where the prompt sends people, and so the one page it stays off. */
const PROFILE_PATH = "/profile";

/**
 * Whether this account is still missing something we should ask its owner for.
 *
 * Today that is only a name, and the cost of not having one is concrete: every
 * roster, gradebook and submission list falls back to the email address, so an
 * instructor marking work sees `s2938471@example.edu` where a name should be.
 * A second field — a student id, say — joins the condition here and gets a
 * sentence in {@link ProfilePrompt}; nothing else needs to know.
 */
function profileNeedsCompleting(actor: Actor): boolean {
  return !hasName(actor.user);
}

/**
 * A quiet strip asking a signed-in reader to fill in what their account is
 * missing.
 *
 * This is where the login form's old name field went. Asking after sign-in
 * rather than before it means the answer comes from the account's owner rather
 * than from whoever submitted a form, and it reaches the people the form never
 * could: an account created by an LTI launch that carried no name claim has
 * never seen the login page at all.
 *
 * Rendered from the page state rather than fired as an event, so it is honest
 * on every page load and simply stops appearing the moment a name is saved —
 * and so it needs no script, which a toast would have, on pages that otherwise
 * ship none.
 */
export const ProfilePrompt: FC<{
  readonly context: Context<AppBindings>;
}> = ({ context }) => {
  const i18n = useI18n();
  const actor = context.get("actor");
  // Also where "Not now" should land: this page, as asked for. `safeNext`
  // rejects anything that is not a same-site path when it comes back, so a
  // request for a URL whose own pathname begins `//` falls back rather than
  // redirecting off the site.
  const url = new URL(context.req.url);

  if (
    actor === null ||
    !profileNeedsCompleting(actor) ||
    hasProfilePromptDismissed(context) ||
    // Not on the page it points at: someone already looking at the name field
    // is being asked to go where they are.
    url.pathname === PROFILE_PATH
  ) {
    return null;
  }

  return (
    <div class="profile-prompt">
      <p>
        {i18n.t(
          "Your work shows up under your email address until you add your name.",
        )}
      </p>
      {/* Both actions are drawn as controls, and the one that does something is
          the solid one. As a bare link beside a bordered button, the offer read
          as the lesser of the two — and the two sat on different baselines,
          since a link is text and a button is a box. */}
      <div class="profile-prompt-actions">
        <a class="button" href={PROFILE_PATH}>
          {i18n.t("Complete your profile")}
        </a>
        <form action="/profile/prompt/dismiss" method="post">
          <CsrfInput context={context} />
          <input
            name="next"
            type="hidden"
            value={`${url.pathname}${url.search}`}
          />
          <button class="ghost" type="submit">
            {i18n.t("Not now")}
          </button>
        </form>
      </div>
    </div>
  );
};
