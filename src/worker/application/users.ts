import type { User } from "../domain/users";
import type { AppStores } from "./stores";

/** A batch-resolved lookup from user id to the user record (or null if gone). */
export type UserDirectory = ReadonlyMap<string, User | null>;

/**
 * Load the users behind a set of ids in one read, however many there are.
 * Every id asked for has an entry, null where the account is gone, so a
 * caller can tell "unknown" from "not asked".
 */
export async function resolveUsers(
  stores: Pick<AppStores, "users">,
  ids: Iterable<string>,
): Promise<UserDirectory> {
  const uniqueIds = [...new Set(ids)];
  const users = await stores.users.listByIds(uniqueIds);
  const byId = new Map(users.map((user) => [user.id, user]));

  return new Map(uniqueIds.map((id) => [id, byId.get(id) ?? null]));
}
