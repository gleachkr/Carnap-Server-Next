import { readFileSync } from "node:fs";
import type { LoadedCompiler } from "@aufbau/compiler";
import { loadCompiler } from "@aufbau/compiler";

/**
 * The Aufbau compiler, loaded once per test process from its wasm in
 * `node_modules`. DOM-free and worker-free, so the jsdom tests can share it.
 */

let compiler: Promise<LoadedCompiler> | null = null;

export function engine(): Promise<LoadedCompiler> {
  // An `ArrayBuffer`, which is what the client's declaration of the package
  // takes, so the jsdom program typechecks this too.
  compiler ??= loadCompiler({
    wasmBytes: new Uint8Array(
      readFileSync(
        new URL(
          "../../node_modules/@aufbau/compiler/compiler.wasm",
          import.meta.url,
        ),
      ),
    ).buffer,
  });

  return compiler;
}
