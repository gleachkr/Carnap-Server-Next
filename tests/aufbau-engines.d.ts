/**
 * Ambient typings for the untyped Aufbau engine packages, scoped to the test
 * program: the root tsconfig excludes `src/client`, so the client's own
 * `aufbau-compiler.d.ts` is invisible here, and the worker deliberately binds
 * the verifier's raw wasm ABI instead of its index.js (workerd cannot follow
 * the package's `import.meta.url` wasm resolution). Only the surface the
 * engine battery drives.
 */

declare module "@aufbau/compiler" {
  export interface CompileResult {
    readonly ok?: boolean;
    readonly mmbBytes?: Uint8Array;
    readonly diagnostics?: unknown;
  }

  export interface LoadedCompiler {
    compile(mm0Text: string, proofText: string): CompileResult;
  }

  export function loadCompiler(options?: {
    readonly wasmBytes?: Uint8Array | ArrayBuffer;
    readonly wasmUrl?: string | URL;
    readonly locale?: string;
  }): Promise<LoadedCompiler>;
}

declare module "@aufbau/verifier" {
  export interface VerifyResult {
    readonly ok?: boolean;
    readonly diagnostics?: unknown;
  }

  export interface LoadedVerifier {
    verifyPair(mm0Text: string, mmbBytes: Uint8Array): VerifyResult;
  }

  export function loadVerifier(options?: {
    readonly wasmBytes?: Uint8Array | ArrayBuffer;
    readonly wasmUrl?: string | URL;
  }): Promise<LoadedVerifier>;
}

declare module "@aufbau/lsp" {
  /** `process` returns the server's responses; each is a JSON *string*. */
  export interface LspServer {
    process(message: unknown): unknown[];
  }

  export function loadLspServer(options?: {
    readonly wasmBytes?: Uint8Array | ArrayBuffer;
    readonly wasmUrl?: string | URL;
  }): Promise<LspServer>;
}
