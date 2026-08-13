import type { AppId } from "./ids";
import type { Timestamp } from "./time";

export type ExternalIdentityProvider = "native" | "lti";

export interface User {
  readonly id: AppId;
  readonly email: string;
  /**
   * When ownership of the address was proven — by a consumed native login
   * link or an LTI link-approval email. Null for addresses only ever
   * asserted by an LMS launch, and always null for placeholder addresses.
   */
  readonly emailVerifiedAt: Timestamp | null;
  readonly name: string | null;
  /**
   * The user's chosen interface language, as a BCP-47 tag. Null means "no
   * choice recorded", so the request's own cookie or `Accept-Language` decides —
   * which is why this is nullable rather than defaulted: a stored default would
   * be indistinguishable from a deliberate pick of the default.
   */
  readonly locale: string | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly disabledAt: Timestamp | null;
}

/**
 * The longest name we store. It is the profile form's limit, and every other
 * writer honours it for one reason: a name that reaches the row without passing
 * that check is one the owner's next profile save would be refused for, leaving
 * them unable to save the page until they shorten a name they never typed.
 */
export const NAME_MAX_LENGTH = 200;

/**
 * A name as it should be stored: trimmed, with blank meaning absent.
 *
 * Shared rather than per-caller because a name arrives from two directions —
 * typed on the profile form, asserted by an LMS launch — and the two have to
 * agree, or {@link hasName} would answer differently depending on which one
 * wrote the row.
 */
export function normalizeName(
  name: string | null | undefined,
): string | null {
  if (name === null || name === undefined) {
    return null;
  }

  const trimmed = name.trim();

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Whether this user has a name to go by.
 *
 * Blank and absent are the same answer, which is why this is a function and not
 * a `!== null`: a name is free text off a form, so `"   "` reaches the row as
 * readily as null does and would display as an empty space where a person
 * should be. Two callers depend on agreeing about it — every list that falls
 * back to an email address, and the prompt that offers to fix that.
 *
 * It is a type predicate because one caller renders `user.email` behind it. The
 * cost is that a false branch narrows the argument to `never`: to ask this
 * question without giving up the value, compare {@link normalizeName} instead.
 */
export function hasName(user: User | null): user is User {
  return user !== null && (user.name?.trim().length ?? 0) > 0;
}

export interface ExternalIdentity {
  readonly id: AppId;
  readonly userId: AppId;
  readonly provider: ExternalIdentityProvider;
  readonly providerSubject: string;
  readonly createdAt: Timestamp;
}
