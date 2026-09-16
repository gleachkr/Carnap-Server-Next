/**
 * The editor-assistance toggles every proof directive's `options=` sets.
 * DOM-free and dependency-free: the four types' `types.ts` embed the shape in
 * their public data, and the client elements read it.
 */

/**
 * Author toggles for the in-browser editor's assistance. Both default off so an
 * intro propositional-logic problem stays honest; an author teaching, say, ZFC
 * can switch them on.
 *   - `allowAuto`       expose the compiler's `auto?` / `apply?` proof search
 *   - `allowCompletion` expose LSP rule-name completion
 */
export interface AufbauProofOptions {
  readonly allowAuto: boolean;
  readonly allowCompletion: boolean;
}

export function isAufbauProofOptions(
  value: unknown,
): value is AufbauProofOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).allowAuto === "boolean" &&
    typeof (value as Record<string, unknown>).allowCompletion === "boolean"
  );
}
