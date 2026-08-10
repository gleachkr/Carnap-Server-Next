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

export interface ExternalIdentity {
  readonly id: AppId;
  readonly userId: AppId;
  readonly provider: ExternalIdentityProvider;
  readonly providerSubject: string;
  readonly createdAt: Timestamp;
}
