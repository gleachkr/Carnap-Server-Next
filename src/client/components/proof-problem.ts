import {
  type RuleShape,
  ruleShapeText,
} from "../../worker/exercise-kit/proof/rule-shape";
import styles from "./rule-shape.css" with { type: "text" };

/**
 * A proof problem as the four proof widgets say it: the engine's message,
 * and — where the line did not fit the rule it cited — that rule's shape
 * (`exercise-kit/proof/rule-shape.ts`), drawn as boxes under it
 * (`./rule-shape.css`).
 *
 * One drawing for every place a problem is shown: the problem line, the hover
 * popup over a tree or Prawitz field, CodeMirror's tooltip and its error
 * list. Framework-free, like those, so the CodeMirror editors and the Preact
 * islands share it. Read as text — the hidden note a tree line is described
 * by, what F8 says, a copy — it is {@link problemText}: the separators the
 * boxes stand in for are in the drawing too, visually hidden.
 */

export const RULE_SHAPE_STYLES = styles;

export interface ProblemText {
  readonly message: string;
  readonly shape: RuleShape | null;
}

/** Each tree or Prawitz node's problems, by node id, in the order said. */
export type NodeProblems = Readonly<Record<string, readonly ProblemText[]>>;

/** A problem with nothing but its message. */
export function plainProblem(message: string): ProblemText {
  return { message, shape: null };
}

/** The problem as text: its message, then its shape a line per rule. */
export function problemText(problem: ProblemText): string {
  return problem.shape === null
    ? problem.message
    : `${problem.message}\n${ruleShapeText(problem.shape)}`;
}

/** Several problems on one place as text, a line apart. */
export function problemsText(problems: readonly ProblemText[]): string {
  return problems.map(problemText).join("\n");
}

/** Several problems on one place, drawn, a line apart. */
export function problemsNodes(problems: readonly ProblemText[]): Node[] {
  return problems.flatMap((problem, index) => [
    ...(index === 0 ? [] : [document.createTextNode("\n")]),
    ...problemNodes(problem),
  ]);
}

/** The problem drawn: its message, then its shape. */
export function problemNodes(problem: ProblemText): Node[] {
  const message = document.createTextNode(problem.message);
  return problem.shape === null
    ? [message]
    : [message, ruleShapeElement(problem.shape)];
}

/**
 * A copy of what `element` draws, to show somewhere else: the problem line
 * copies a node's note, the popup the part of it its field names. Without
 * the ids, which belong to the original alone.
 */
export function copyOfDrawing(element: Element): Node[] {
  return Array.from(element.childNodes, (node) => {
    const copy = node.cloneNode(true);
    if (copy instanceof Element) {
      copy.removeAttribute("id");
      for (const named of copy.querySelectorAll("[id]")) {
        named.removeAttribute("id");
      }
    }
    return copy;
  });
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

/** What a reader of the text meets between two parts, and no one else. */
function separator(text: string): HTMLSpanElement {
  return span("visually-hidden", text);
}

function ruleShapeElement(shape: RuleShape): HTMLElement {
  const drawn = document.createElement("span");
  drawn.className = "rule-shape";

  for (const line of shape) {
    const row = document.createElement("span");
    row.className = "rule-shape-line";
    // The newline its text starts with: the shape stands under its message,
    // and a second side of a pair under the first.
    row.append(separator("\n"), span("rule-shape-label", line.label));
    row.append(separator(": "));

    for (const [at, premise] of line.premises.entries()) {
      if (at > 0) {
        row.append(separator(", "));
      }
      row.append(
        span(
          premise.subproof
            ? "rule-shape-premise is-subproof"
            : "rule-shape-premise",
          premise.text,
        ),
      );
    }

    if (line.premises.length > 0) {
      row.append(
        separator(" "),
        span("rule-shape-therefore", "∴"),
        separator(" "),
      );
    }
    row.append(span("rule-shape-conclusion", line.conclusion));
    drawn.append(row);
  }

  return drawn;
}
