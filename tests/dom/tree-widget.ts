import { compileExercise, type MountedExercise } from "./mount-exercise";

/**
 * `<carnap-aufbau-proof-tree>` under jsdom: the document a tree directive is
 * compiled in, and the queries into the mounted island that its tests share.
 * The mount itself is `./mount-exercise`'s, the same one every widget uses.
 */

/**
 * One tree directive, set over a document-local theory: `prelude` is the
 * `:::aufbau-mm0` block (a forallx Magnus reference by default) and
 * `directive` the exercise that names it.
 */
export function treeExercise(
  directive: string,
  prelude = `:::aufbau-mm0{name="fx" src="/theories/forallx-magnus.mm0"}\n:::`,
) {
  return compileExercise(`${prelude}\n\n${directive}`);
}

/** The root node's formula field. Premises render *above* their parent and
 *  so precede it in the DOM; the root is the canvas's own proposition. */
export function treeRootField(mounted: MountedExercise): HTMLElement {
  return mounted.root.querySelector(
    ".proof-tree-canvas > proof-tree > proof-proposition .tree-edit",
  ) as HTMLElement;
}

/** The root node's rule field, under its inference line. */
export function treeRootRule(mounted: MountedExercise): HTMLElement {
  return mounted.root.querySelector(
    ".proof-tree-canvas > proof-tree > proof-inference .tree-rule",
  ) as HTMLElement;
}

/** A toolbar button by its accessible name (the toolbars are icon-only). */
export function toolbarButton(
  mounted: MountedExercise,
  name: string,
): HTMLButtonElement {
  const button = Array.from(
    mounted.root.querySelectorAll<HTMLButtonElement>(".tree-toolbar button"),
  ).find((candidate) => candidate.getAttribute("aria-label") === name);
  if (button === undefined) {
    throw new Error(`no toolbar button named ${name}`);
  }
  return button;
}
