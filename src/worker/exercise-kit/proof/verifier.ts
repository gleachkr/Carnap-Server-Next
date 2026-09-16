/**
 * Worker-side MMB verifier — the trust boundary's arbiter. Binds the
 * `@aufbau/verifier` wasm ABI directly instead of importing the package's
 * `index.js`, whose top-level `new URL("./verifier.wasm", import.meta.url)`
 * throws under workerd (Stage 0 finding; see [[aufbau-engine-packages]]).
 *
 * The `.wasm` is imported as a build-time module so workerd can instantiate it —
 * workerd forbids `WebAssembly.instantiate(bytes)` at runtime. The import is a
 * relative path into node_modules so it stays a single source of truth with the
 * pinned dependency (no vendored binary). Its shape differs by runtime: workerd
 * hands back a `WebAssembly.Module`; Bun (tests) hands back the file path.
 */
import verifierWasm from "../../../../node_modules/@aufbau/verifier/verifier.wasm";

interface VerifierExports {
  alloc(len: number): number;
  free(ptr: number, len: number): void;
  memory: WebAssembly.Memory;
  result_json_len(): number;
  result_json_ptr(): number;
  verify_pair(
    mm0Ptr: number,
    mm0Len: number,
    mmbPtr: number,
    mmbLen: number,
  ): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let exportsPromise: Promise<VerifierExports> | null = null;

async function instantiate(): Promise<VerifierExports> {
  if (verifierWasm instanceof WebAssembly.Module) {
    const instance = await WebAssembly.instantiate(verifierWasm, {});
    return instance.exports as unknown as VerifierExports;
  }

  // Bun (tests): the import is a filesystem path; read and instantiate the bytes.
  const bytes = await Bun.file(verifierWasm).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as unknown as VerifierExports;
}

function verifierExports(): Promise<VerifierExports> {
  if (exportsPromise === null) {
    exportsPromise = instantiate();
  }

  return exportsPromise;
}

function writeBytes(
  exports: VerifierExports,
  bytes: Uint8Array,
): { ptr: number; len: number } {
  const ptr = exports.alloc(bytes.length);
  if (bytes.length > 0) {
    new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  }
  return { len: bytes.length, ptr };
}

/**
 * Verify an MMB certificate against an MM0 source. `ok` is true iff the MMB is a
 * valid proof of every theorem the mm0 declares — including the frozen goal, so
 * a true result means the student proved it. Any wasm-level failure surfaces as
 * `errored` so the caller can distinguish "not proved" from "could not check".
 */
export interface VerifyResult {
  readonly errored: boolean;
  readonly ok: boolean;
}

export async function verifyMmb(
  mm0: string,
  mmb: Uint8Array,
): Promise<VerifyResult> {
  let exports: VerifierExports;
  try {
    exports = await verifierExports();
  } catch {
    return { errored: true, ok: false };
  }

  const mm0Input = writeBytes(exports, encoder.encode(mm0));
  const mmbInput = writeBytes(exports, mmb);

  try {
    exports.verify_pair(
      mm0Input.ptr,
      mm0Input.len,
      mmbInput.ptr,
      mmbInput.len,
    );
    const ptr = exports.result_json_ptr();
    const len = exports.result_json_len();

    if (ptr === 0 || len === 0) {
      return { errored: true, ok: false };
    }

    const meta = JSON.parse(
      decoder.decode(new Uint8Array(exports.memory.buffer, ptr, len)),
    ) as { readonly ok?: boolean };

    return { errored: false, ok: meta.ok === true };
  } catch {
    return { errored: true, ok: false };
  } finally {
    exports.free(mm0Input.ptr, mm0Input.len);
    exports.free(mmbInput.ptr, mmbInput.len);
  }
}
