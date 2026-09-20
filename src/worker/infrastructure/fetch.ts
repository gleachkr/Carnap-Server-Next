/**
 * The shape every outbound HTTP client takes as an option, so a test can
 * hand it a fake.
 */
export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The platform's `fetch`, as a {@link Fetcher} a client can keep in a field.
 * Wrapped rather than referenced: calling an unbound global `fetch` through a
 * property throws "Illegal invocation" on Workers.
 */
export const platformFetcher: Fetcher = (input, init) => fetch(input, init);
