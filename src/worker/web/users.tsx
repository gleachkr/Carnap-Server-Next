import type { FC } from "hono/jsx";
import type { UserDirectory } from "../application/users";
import { hasName, type User } from "../domain/users";
import type { Translator } from "../i18n/translator";
import { useI18n } from "./layout";

function shortId(id: string): string {
  return id.length <= 12 ? id : id.slice(0, 8);
}

/** The best single-line label for a user: name, else email, else a hint. */
export function userDisplayName(
  i18n: Translator,
  user: User | null,
  fallbackId: string,
): string {
  if (user === null) {
    return i18n.t("Unknown user {id}", { id: shortId(fallbackId) });
  }

  return user.name?.trim() || user.email;
}

/** A secondary detail line to sit under {@link userDisplayName}. */
export function userDisplayMeta(
  i18n: Translator,
  user: User | null,
  fallbackId: string,
): string {
  if (user === null) {
    return i18n.t("User ID {id}", { id: fallbackId });
  }

  if ((user.name?.trim().length ?? 0) > 0) {
    return user.email;
  }

  return i18n.t("User ID {id}", { id: user.id });
}

/**
 * Render a user by id: their name (or email) with the email as a quiet
 * second line when a name is present. Never prints a raw id when a name or
 * email is known.
 *
 * `identified` adds the second line for a user with nothing to put there —
 * "User ID …" — for a ledger whose rows have to stay tellable apart even
 * when the directory has no name or email for one of them.
 */
export const UserLabel: FC<{
  readonly directory: UserDirectory;
  readonly identified?: boolean;
  readonly userId: string;
}> = ({ directory, identified = false, userId }) => {
  const i18n = useI18n();
  const user = directory.get(userId) ?? null;
  const name = userDisplayName(i18n, user, userId);
  const detail =
    identified || hasName(user) ? userDisplayMeta(i18n, user, userId) : null;

  return (
    <>
      {name}
      {detail === null || detail === name ? null : (
        <>
          <br />
          <span class="small">{detail}</span>
        </>
      )}
    </>
  );
};
