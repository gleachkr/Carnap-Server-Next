/**
 * Minimal typings for the untyped `@aufbau/compiler` npm package (a JS module).
 * Only the surface the proof element uses. The compiler runs client-side and
 * produces the MMB certificate; see [[aufbau-engine-packages]].
 */
declare module "@aufbau/compiler" {
  export interface CompileResult {
    readonly ok?: boolean;
    readonly mmbBytes?: Uint8Array;
    readonly diagnostics?: unknown;
    readonly durationMs?: number;
  }

  export interface LoadedCompiler {
    compile(mm0Text: string, proofText: string): CompileResult;
  }

  export function loadCompiler(options?: {
    readonly wasmUrl?: string;
    readonly wasmBytes?: ArrayBuffer;
    readonly module?: WebAssembly.Module;
    /**
     * BCP-47 tag deciding what language the engine's own diagnostics come out
     * in, applied once to this instance. A tag it has no catalog for is ignored
     * and leaves it in English. See `client/proof-compiler.ts`, the one caller.
     */
    readonly locale?: string;
  }): Promise<LoadedCompiler>;
}
