/** @jsxImportSource preact */

import { useLayoutEffect, useRef } from "preact/hooks";
import { type ProblemText, problemsNodes } from "./proof-problem";

/**
 * The hidden note a tree or Prawitz line is described by, holding its
 * problems drawn (`./proof-problem.ts`): a rule's shape as boxes, with the
 * separators a reader of the text needs hidden among them. Read as text, it
 * is what a screen reader hears when focus lands on the line; copied, it is
 * what the problem line under the proof shows (`./problem-keys.ts`), so the
 * two islands draw a problem once, here, and everything else copies it.
 *
 * The errors and the warnings are drawn in parts of their own
 * ({@link problemPartId}), because a line's fields do not share them: the
 * tree squiggles an error on the formula and a `sorry!` on the rule. The
 * hover popup over a field copies that field's part alone
 * (`./problem-popup.ts`), the drawing of exactly the text the field carries.
 *
 * The drawing is DOM the islands' framework does not own, so it is put into
 * a bare span after each render that changes it, as an uncontrolled field's
 * text is.
 */
export function ProblemNote(props: {
  readonly id: string;
  readonly errors?: readonly ProblemText[] | undefined;
  readonly warnings?: readonly ProblemText[] | undefined;
}): preact.JSX.Element {
  const { errors, id, warnings } = props;
  return (
    <span hidden id={id}>
      {errors === undefined ? null : (
        <ProblemPart id={problemPartId(id, "error")} problems={errors} />
      )}
      {errors === undefined || warnings === undefined ? null : "\n"}
      {warnings === undefined ? null : (
        <ProblemPart id={problemPartId(id, "warning")} problems={warnings} />
      )}
    </span>
  );
}

/** The id of the part of note `noteId` drawing its problems of `severity`. */
export function problemPartId(
  noteId: string,
  severity: "error" | "warning",
): string {
  return `${noteId}-${severity}`;
}

function ProblemPart(props: {
  readonly id: string;
  readonly problems: readonly ProblemText[];
}): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    ref.current?.replaceChildren(...problemsNodes(props.problems));
  }, [props.problems]);

  return <span id={props.id} ref={ref} />;
}
