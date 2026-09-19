import { dom } from "../helpers/dom";
import { compileExercise, type MountedExercise } from "./mount-exercise";

/**
 * `<carnap-aufbau-proof-prawitz>` under jsdom, on the same terms as
 * `./tree-widget.ts`: the document a Prawitz directive is compiled in, and
 * the queries into the mounted forest that its tests share. The mount is
 * `./mount-exercise`'s.
 */

/** The smallest theory a Prawitz exercise compiles over (prawitz-authoring). */
export const PRAWITZ_THEORY = `:::aufbau-mm0{name="prop"}
provable sort wff;
sort ctx;
term top: wff;
term imp (a b: wff): wff;
infixr imp: $→$ prec 25;
--| @syntax role context-join
term join (g h: ctx): ctx;
infixl join: $,$ prec 5;
term hyp (a: wff): ctx;
coercion hyp: wff > ctx;
--| @syntax role turnstile
term nd (g: ctx) (a: wff): wff;
infixl nd: $⊢$ prec 0;
--| @syntax role assumption
axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;
axiom top_i: $ top $;
:::`;

/** `theorem goal: $ top $` over {@link PRAWITZ_THEORY}. */
export function prawitzExercise(attributes = "", theory = PRAWITZ_THEORY) {
  return compileExercise(
    `${theory}\n\n:::aufbau-proof-prawitz{system="prop" id="z"${attributes}}\nProve it.\n\ntheorem goal: $ top $\n:::`,
  );
}

/** Every line of the forest, in document order. */
export function prawitzItems(mounted: MountedExercise): HTMLElement[] {
  return Array.from(
    mounted.root.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  );
}

/** The line's `<proof-tree>`, whose class says whether it is an assumption. */
export function prawitzLineOf(item: HTMLElement): HTMLElement {
  return item.closest("proof-tree") as HTMLElement;
}

/** A derived line's own rule field (a premise's is inside the forest, and
 *  `:scope >` is not something jsdom resolves through a custom element). */
export function prawitzRuleFieldOf(line: HTMLElement): Element | null {
  const inference = Array.from(line.children).find(
    (child) => child.tagName === "PROOF-INFERENCE",
  );
  return inference?.querySelector(".pz-rule") ?? null;
}

/** A line's own formula field. */
export function prawitzFormulaFieldOf(item: HTMLElement): HTMLElement {
  return item.querySelector(".pz-edit") as HTMLElement;
}

export function prawitzPress(item: HTMLElement, key: string): void {
  item.focus();
  item.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    }),
  );
}

/** A toolbar button by its accessible name (the toolbar is icon-only). */
export function prawitzButton(
  mounted: MountedExercise,
  name: string,
): HTMLButtonElement {
  const found = Array.from(
    mounted.root.querySelectorAll<HTMLButtonElement>(".pz-toolbar button"),
  ).find((candidate) => candidate.getAttribute("aria-label") === name);
  if (found === undefined) {
    throw new Error(`no toolbar button named ${name}`);
  }
  return found;
}
