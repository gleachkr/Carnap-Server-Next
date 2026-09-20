import { type AppId, createAppId } from "../domain/ids";
import { assertJsonValue, type JsonValue } from "../domain/json";
import { type Timestamp, timestampNow } from "../domain/time";
import type { AppStores } from "./stores";

/**
 * What the two admin services — site admin and LTI admin — do around every
 * action they take: read the clock once, and leave an audit row that names
 * the request. Both had their own copy.
 */

/** The moment an action happens, as the ids want it and as the rows want it. */
export function auditMoment(clock: (() => Date) | undefined): {
  readonly date: Date;
  readonly timestamp: Timestamp;
} {
  const date = clock?.() ?? new Date();

  return { date, timestamp: timestampNow(date) };
}

export interface AdminAuditInput {
  readonly action: string;
  readonly actorUserId: AppId;
  readonly metadata: JsonValue;
  readonly targetCourseId?: AppId | null;
  readonly targetUserId?: AppId | null;
  readonly timestamp: Timestamp;
}

export async function appendAdminAudit(
  options: {
    readonly requestId: string;
    readonly stores: Pick<AppStores, "adminAudit">;
  },
  input: AdminAuditInput,
): Promise<void> {
  assertJsonValue(input.metadata);

  await options.stores.adminAudit.append({
    action: input.action,
    actorUserId: input.actorUserId,
    createdAt: input.timestamp,
    id: createAppId(new Date(input.timestamp).getTime()),
    metadata: input.metadata,
    requestId: options.requestId,
    targetCourseId: input.targetCourseId ?? null,
    targetUserId: input.targetUserId ?? null,
  });
}
