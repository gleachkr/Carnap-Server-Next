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
  /**
   * The identifier the student's institution knows them by — a registrar's
   * student number, not anything of ours. Only an LMS launch writes it, from
   * the `lis.person_sourcedid` claim or a configured custom parameter; nobody
   * can type one, here or on the profile form.
   *
   * It exists for one job: letting an instructor join a Carnap grade export to
   * a roster their institution produced, which an email address does poorly and
   * our own {@link User.id} cannot do at all. Null is the ordinary value — every
   * account that has never been launched into, and every platform that does not
   * share the claim.
   */
  readonly studentId: string | null;
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

/**
 * The longest student ID we store.
 *
 * No form imposes this one — nothing on the site can type a student ID — so it
 * is a sanity bound on what a platform may assert, and the reason an over-long
 * value is dropped rather than truncated: a truncated institutional ID still
 * looks like an ID in a grade export, and joins against the wrong row or none
 * at all without ever saying it was cut.
 */
export const STUDENT_ID_MAX_LENGTH = 200;

/**
 * A student ID as it should be stored, or null when there is nothing storable:
 * trimmed, with both blank and over-{@link STUDENT_ID_MAX_LENGTH} meaning
 * absent.
 *
 * Blank is worth normalizing even though only a platform writes this field:
 * an LMS with the claim configured but the value unset sends `""` or a space
 * rather than omitting it, and a stored `""` would read as "this account has
 * an ID" everywhere that asks.
 *
 * The length test lives here rather than at the caller — the arrangement
 * {@link normalizeName} makes, where the caller applies
 * {@link NAME_MAX_LENGTH} itself — so that every path a value can reach the
 * column by is bounded by construction. There is more than one: a launch that
 * finds an existing account adopts, and a launch that creates one passes
 * straight to the insert.
 */
export function normalizeStudentId(
  studentId: string | null | undefined,
): string | null {
  if (studentId === null || studentId === undefined) {
    return null;
  }

  const trimmed = studentId.trim();

  return trimmed.length === 0 || trimmed.length > STUDENT_ID_MAX_LENGTH
    ? null
    : trimmed;
}

export interface ExternalIdentity {
  readonly id: AppId;
  readonly userId: AppId;
  readonly provider: ExternalIdentityProvider;
  readonly providerSubject: string;
  readonly createdAt: Timestamp;
}
