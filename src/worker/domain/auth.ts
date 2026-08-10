import type { AppId } from "./ids";
import type { Timestamp } from "./time";

export interface NativeLoginChallenge {
  readonly id: AppId;
  readonly email: string;
  readonly name: string | null;
  readonly tokenHash: string;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly consumedAt: Timestamp | null;
}

export interface AuthSession {
  readonly tokenHash: string;
  readonly userId: AppId;
  readonly csrfTokenHash: string;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly revokedAt: Timestamp | null;
  readonly lastSeenAt: Timestamp | null;
}
