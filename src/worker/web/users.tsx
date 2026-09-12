import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { hasName, type User } from "../domain/users";
import type { AppBindings } from "../http";
import type { Translator } from "../i18n/translator";
import { storesForContext } from "../stores";
import { useI18n } from "./layout";

/** A batch-resolved lookup from user id to the user record (or null if gone). */
export type UserDirectory = ReadonlyMap<string, User | null>;

/**
 * Load the users behind a set of ids in one read, however many there are.
 * Every id asked for has an entry, null where the account is gone, so a
 * caller can tell "unknown" from "not asked".
 */
export async function resolveUsers(
  context: Context<AppBindings>,
  ids: Iterable<string>,
): Promise<UserDirectory> {
  const uniqueIds = [...new Set(ids)];
  const users = await storesForContext(context).users.listByIds(uniqueIds);
  const byId = new Map(users.map((user) => [user.id, user]));

  return new Map(uniqueIds.map((id) => [id, byId.get(id) ?? null]));
}

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
 */
export const UserLabel: FC<{
  readonly directory: UserDirectory;
  readonly userId: string;
}> = ({ directory, userId }) => {
  const i18n = useI18n();
  const user = directory.get(userId) ?? null;

  return (
    <>
      {userDisplayName(i18n, user, userId)}
      {hasName(user) ? (
        <>
          <br />
          <span class="small">{user.email}</span>
        </>
      ) : null}
    </>
  );
};
