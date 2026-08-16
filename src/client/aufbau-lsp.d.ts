/**
 * Minimal typings for the untyped `@aufbau/lsp` npm package (a JS module).
 * Only the surface the proof-search seam uses: the worker transport, whose
 * messages are JSON strings. See `client/proof-search.ts`, the one caller.
 */
declare module "@aufbau/lsp" {
  export interface WorkerLspServer {
    send(message: unknown): void;
    subscribe(handler: (message: unknown) => void): void;
    unsubscribe(handler: (message: unknown) => void): void;
    setLocale(locale: string): void;
    terminate(): void;
  }

  export function loadLspServerWorker(options?: {
    /** Same-origin URL of the package's `worker.js`, which imports its
     * `./index.js` sibling and fetches `./lsp.wasm` beside it. */
    readonly workerUrl?: string | URL;
    readonly worker?: Worker;
    /**
     * BCP-47 tag deciding what language the server's own diagnostics come out
     * in. A tag it has no catalog for is ignored and leaves it in English.
     */
    readonly locale?: string;
  }): Promise<WorkerLspServer>;
}
