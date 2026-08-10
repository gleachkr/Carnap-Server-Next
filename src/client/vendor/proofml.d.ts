/**
 * The vendored ProofML module (`proofml.mjs`) is imported for its side effect
 * only — registering the `<proof-tree>` / `<proof-forest>` / `<proof-proposition>`
 * / `<proof-inference>` custom elements. It exports nothing, so a bare module
 * declaration is all `tsc` needs.
 */
declare module "*/proofml.mjs";
