/**
 * The truth-tree editor's `(?)` dialog: what to do, and the keys. DOM-free;
 * the element builds the dialog from these.
 */

import type { TruthTreeStringId } from "../../worker/exercises/truth-tree/strings";
import type { TruthTreeFinish } from "../../worker/exercises/truth-tree/types";
import type { ToolbarIconName } from "./toolbar-icons";

interface Shortcut {
  readonly action: TruthTreeStringId;
  readonly icon?: ToolbarIconName;
  readonly keys: readonly string[];
}

const SHORTCUTS: readonly Shortcut[] = [
  { action: "Move between rows", keys: ["←", "→", "↑", "↓"] },
  { action: "Write the row's sentence", keys: ["Enter"] },
  {
    action:
      "Type the row it develops; Alt-C also works while writing the row",
    keys: ["c", "Alt-C"],
  },
  {
    action: "Type the rule it uses; Alt-J also works while writing the row",
    keys: ["j", "Alt-J"],
  },
  {
    action:
      "From the end of a line, go on to its citation, then its rule; Delete clears either",
    keys: ["→"],
  },
  {
    action: "From the citation being typed, go on to the rule",
    keys: ["Tab"],
  },
  {
    action: "Add a row at the end of the branch",
    icon: "tree-stack",
    keys: ["t"],
  },
  { action: "Split the branch in two", icon: "tree-split", keys: ["s"] },
  { action: "Add a row to this step", icon: "tree-add-row", keys: ["r"] },
  { action: "Close the branch", icon: "tree-close", keys: ["x"] },
  {
    action: "Mark a row the branch closes on, once closing",
    keys: ["Space", "Enter"],
  },
  {
    action: "Mark the branch open and complete",
    icon: "tree-open",
    keys: ["o"],
  },
  {
    action:
      "Delete the row or take back its split; on an end mark, reopen the branch",
    icon: "tree-delete",
    keys: ["Delete"],
  },
  { action: "Undo or redo", icon: "undo", keys: ["Ctrl-Z", "Ctrl-Y"] },
];

/** The keys, bar marking a branch open where no branch may be. */
export function treeShortcuts(
  offersOpen: boolean,
  t: (id: TruthTreeStringId) => string,
): {
  readonly action: string;
  readonly keys: readonly string[];
  readonly icon?: ToolbarIconName;
}[] {
  return SHORTCUTS.filter(
    (shortcut) => shortcut.icon !== "tree-open" || offersOpen,
  ).map((shortcut) => ({
    action: t(shortcut.action),
    keys: shortcut.keys,
    ...(shortcut.icon === undefined ? {} : { icon: shortcut.icon }),
  }));
}

/** What to do, for a tree that is done when `finish` says. */
export function treeHelpIntro(
  finish: TruthTreeFinish,
  t: (id: TruthTreeStringId) => string,
): string[] {
  return [
    t(
      "Move to a row with the arrow keys or by clicking it; each action works on the row or branch there.",
    ),
    t(
      "Write each step's rows, choosing whether they stack on the branch or split it, and type the row they develop and the rule they use in the margin.",
    ),
    finish === "closed"
      ? t(
          "Close a branch where it contradicts itself, citing the rows it closes on. The tree is done when every branch is closed.",
        )
      : finish === "complete"
        ? t(
            "Close a branch where it contradicts itself, citing the rows it closes on, and mark each complete open branch ↑. The tree is done when every branch is closed or marked open.",
          )
        : t(
            "Close a branch where it contradicts itself, citing the rows it closes on, and mark a complete open branch ↑. The tree is done when every branch is closed, or one is marked open.",
          ),
  ];
}
