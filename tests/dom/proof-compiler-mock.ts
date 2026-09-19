import { afterAll, type Mock, mock } from "bun:test";

/**
 * Stand the client's proof-compiler *loader* in with a mock, for the widget
 * tests that drive a proof editor without the wasm engine.
 *
 * Only the loader is replaced; the module's readers stay real, and the
 * loader is put back after the file — `mock.module` is process-wide, and
 * the files that test the real loader and readers share this process. That
 * is also why this is a function called from each test file's top level
 * rather than a module evaluated once: the swap has to happen for every
 * file, and the `afterAll` has to belong to the file that called it.
 *
 * Call it before importing the component under test, which captures the
 * loader when it is evaluated:
 *
 *   const compile = await mockProofCompiler();
 *   await import("../../src/client/components/carnap-aufbau-proof-tree-v1");
 */

type CompileMock = Mock<(mm0: string, proof: string) => unknown>;

/** A compile that succeeds with a placeholder certificate. */
function compilesFine(_mm0: string, _proof: string): unknown {
  return { mmbBytes: new Uint8Array([1, 2, 3]), ok: true };
}

export async function mockProofCompiler(
  implementation: (mm0: string, proof: string) => unknown = compilesFine,
): Promise<CompileMock> {
  const compile: CompileMock = mock(implementation);
  const PROOF_COMPILER = "../../src/client/proof-compiler";
  const realProofCompiler = { ...(await import(PROOF_COMPILER)) };

  mock.module(PROOF_COMPILER, () => ({
    ...realProofCompiler,
    loadProofCompiler: async () => ({ compile }),
  }));

  afterAll(() => {
    mock.module(PROOF_COMPILER, () => ({ ...realProofCompiler }));
  });

  return compile;
}
