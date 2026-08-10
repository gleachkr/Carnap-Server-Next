import { createMiddleware } from "hono/factory";

import type { AppBindings } from "../http";
import { REQUEST_ID_HEADER } from "../http";

const MAX_REQUEST_ID_LENGTH = 200;

function usableRequestId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed || trimmed.length > MAX_REQUEST_ID_LENGTH) {
    return undefined;
  }

  return trimmed;
}

export function requestIdMiddleware() {
  return createMiddleware<AppBindings>(async (context, next) => {
    const requestId =
      usableRequestId(context.req.header(REQUEST_ID_HEADER)) ??
      crypto.randomUUID();

    context.set("requestId", requestId);
    context.header(REQUEST_ID_HEADER, requestId);

    await next();
  });
}
