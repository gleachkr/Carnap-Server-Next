/**
 * What `#proof-verifier` resolves to in a browser bundle: nothing.
 *
 * The verifier binds a 1.1 MB wasm module the worker instantiates at the trust
 * boundary, and no browser bundle has a use for it — the client compiles, the
 * worker verifies. But the revision editor's preview bundle compiles and
 * renders content through the same `ExerciseRegistry` the worker grades with,
 * and a type is one object, so the module graph from the preview reaches every
 * type's `evaluate` and, through it, this import. Left alone, the bundler would
 * copy the wasm into `public/assets` as an asset nothing fetches.
 *
 * So `package.json` maps `#proof-verifier` by condition: `workerd` and the
 * default (Bun, for tests and the Bun server) get `verifier.ts`; `browser` gets
 * this. Nothing in a browser calls it — reaching here is a bug in whichever
 * bundle did, hence a throw rather than a quiet "could not check".
 *
 * Self-contained on purpose: even a type-only import of `verifier.ts` would
 * pull that module into the client program, and the whole point is that it
 * is not there. The return type mirrors `VerifyResult` by shape; the callers
 * type-check against both under their own condition, which keeps the two
 * signatures honest.
 */
export function verifyMmb(
  _mm0: string,
  _mmb: Uint8Array,
): Promise<{ readonly errored: boolean; readonly ok: boolean }> {
  return Promise.reject(
    new Error("The proof verifier runs on the server, not in the browser."),
  );
}
