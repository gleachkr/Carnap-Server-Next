import type { Context } from "hono";

import { AppHttpError } from "./application/errors";
import type { AppStores } from "./application/stores";
import type { AppBindings } from "./http";
import { createD1Stores } from "./infrastructure/database/d1";

/**
 * The stores for this request, or null if this deployment has none.
 *
 * Two hosts supply them two ways: a self-hosted server opens its database at
 * boot and sets them on the context, and the Worker builds them from its `DB`
 * binding on first use. Ask here rather than testing for `env.DB` — a server
 * binds no `DB` at all, so that test reads as "no storage" on a perfectly
 * healthy instance, which is exactly the bug it caused when it was written
 * inline in the actor middleware.
 */
export function optionalStoresForContext(
  context: Context<AppBindings>,
): AppStores | null {
  const existingStores = context.get("stores");

  if (existingStores !== undefined) {
    return existingStores;
  }

  if (context.env.DB === undefined) {
    return null;
  }

  const stores = createD1Stores(context.env.DB);

  context.set("stores", stores);

  return stores;
}

/** The same, for the great majority of callers that cannot proceed without. */
export function storesForContext(context: Context<AppBindings>): AppStores {
  const stores = optionalStoresForContext(context);

  if (stores === null) {
    throw new AppHttpError(
      500,
      "storage_unavailable",
      "Storage is not configured for this request.",
    );
  }

  return stores;
}
