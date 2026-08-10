import type { Context } from "hono";
import type { FC } from "hono/jsx";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { CHARITY_ICONS } from "./charity-icons";
import { Sheet } from "./components";
import { renderShell } from "./layout";

interface Charity {
  readonly blurb: string;
  readonly href: string;
  /** Key into {@link CHARITY_ICONS}; never shown. */
  readonly id: string;
  readonly name: string;
}

/**
 * A small, hand-picked list of organizations aligned with Carnap's purpose —
 * keeping scholarship and the teaching of ideas alive for people who have lost
 * the freedom to pursue them. Kept short and specific rather than exhaustive.
 *
 * A function rather than a `const` because the blurbs are prose: the literals
 * have to sit at an `i18n.t(...)` call to be extracted at all. The names are
 * the organizations' own and stay as they are.
 */
function charities(i18n: Translator): readonly Charity[] {
  return [
    {
      blurb: i18n.t(
        "Arranges and funds fellowships for threatened and displaced scholars at host universities around the world, so they can keep researching and teaching in safety.",
      ),
      href: "https://www.scholarrescuefund.org/",
      id: "scholar-rescue-fund",
      name: "IIE Scholar Rescue Fund",
    },
    {
      blurb: i18n.t(
        "An international network of universities and colleges that protects scholars facing threats and advocates for academic freedom worldwide.",
      ),
      href: "https://www.scholarsatrisk.org/",
      id: "scholars-at-risk",
      name: "Scholars at Risk",
    },
  ];
}

/**
 * The organization's own site icon, vendored in `charity-icons.ts` so the page
 * makes no third-party request — or its initial, for one whose site offers no
 * usable icon. Either way it is decoration: the name is right beside it in text,
 * so an `alt` would only make a screen reader say it twice.
 */
const CharityMark: FC<{ readonly charity: Charity }> = ({ charity }) => {
  const icon = CHARITY_ICONS[charity.id];

  return icon === undefined ? (
    <span aria-hidden="true" class="charity-monogram">
      {charity.name.slice(0, 1)}
    </span>
  ) : (
    <img alt="" class="charity-icon" src={icon} />
  );
};

const CharityEntry: FC<{ readonly charity: Charity }> = ({ charity }) => (
  // Flat, not wrapped: the mark and the name share the first row, and the blurb
  // spans both columns so it starts at the margin rather than indenting under
  // the name (see `.charity` in styles.ts).
  <li class="charity">
    <CharityMark charity={charity} />
    <a
      class="charity-name"
      href={charity.href}
      rel="noopener"
      target="_blank"
    >
      {charity.name}
    </a>
    <p class="small">{charity.blurb}</p>
  </li>
);

export function renderDonatePage(context: Context<AppBindings>): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { title: i18n.t("Support") },
    <Sheet>
      <ul class="charity-list">
        {charities(i18n).map((charity) => (
          <CharityEntry charity={charity} />
        ))}
      </ul>
    </Sheet>,
  );
}
