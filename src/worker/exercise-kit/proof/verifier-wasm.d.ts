/**
 * A `.wasm` import resolves to a `WebAssembly.Module` under workerd (the
 * build-time module the runtime instantiates) and to a filesystem path string
 * under Bun (used only in tests). The verifier binding narrows on the shape.
 */
declare module "*.wasm" {
  const value: WebAssembly.Module | string;
  export default value;
}
