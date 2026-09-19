import { describe, expect, test } from "bun:test";
import { dom } from "../helpers/dom";
import { mockProofCompiler } from "./proof-compiler-mock";
import {
  type MountedTree,
  mountTree,
  treePublicDataFor,
  treeRootField,
  treeRootRule,
  until,
} from "./tree-widget";

/**
 * `allow-sorry` in `<carnap-aufbau-proof-tree>`, standing in for all four
 * proof widgets (they share `readCompileResult` and the base's hold and gate;
 * this one is the island the fixture mounts). With the attribute, a rule
 * admitted with `sorry!` is a warning on the rule field rather than an error
 * on the line, the status line says the rest checks, and the proof is still
 * not correct: no certificate, mark idle. Outside an exam the widget will not
 * submit it and says why; on an exam it lets it go. And a submit that lands
 * while the compile is still pending waits for it, so the gate judges the
 * proof as it stands and not as it stood.
 *
 * The compiler is mocked at the module seam, as in `playground-tree.test.ts`:
 * a proof citing `sorry!` compiles `ok` with one `SorryLine` warning on the
 * token, as the real engine does (`tests/sorry-certificate.test.ts`).
 */

await mockProofCompiler((_mm0: string, proof: string) => {
  const at = proof.indexOf("sorry!");
  if (at === -1) {
    return { diagnostics: [], mmbBytes: new Uint8Array([1, 2, 3]), ok: true };
  }
  const spanStart = Buffer.byteLength(proof.slice(0, at));
  return {
    diagnostics: [
      {
        error: "SorryLine",
        message:
          "proof line is admitted with sorry!; the theorem is not verified",
        severity: "warning",
        spanEnd: spanStart + "sorry!".length,
        spanStart,
      },
    ],
    mmbBytes: new Uint8Array([1, 2, 3]),
    ok: true,
  };
});

await import("../../src/client/components/carnap-aufbau-proof-tree-v1");

const MINI = [
  ':::aufbau-mm0{name="mini"}',
  "provable sort wff;",
  "term imp (a b: wff): wff; infixr imp: $->$ prec 25;",
  "axiom mp (a b: wff): $ a $ > $ a -> b $ > $ b $;",
  ":::",
].join("\n");

function tree(attributes: string): string {
  return `:::aufbau-proof-tree{system="mini" id="t1"${attributes}}\nProve it.\n\ntheorem goal (p: wff): $ p $\n:::`;
}

function mark(mounted: MountedTree): HTMLElement {
  return mounted.form.querySelector(".exercise-mark") as HTMLElement;
}

function status(mounted: MountedTree): string {
  return (
    mounted.form.querySelector("[data-exercise-check-status]")?.textContent ??
    ""
  );
}

function typeInto(field: HTMLElement, text: string): void {
  field.textContent = text;
  field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

/** Submit the form the way the page runtime sees it: cancelable, and — as
 *  the runtime does — never allowed to navigate. */
function submit(mounted: MountedTree): Event {
  const event = new dom.window.Event("submit", {
    bubbles: true,
    cancelable: true,
  });
  mounted.form.dispatchEvent(event);
  return event;
}

const REFUSAL =
  "A proof with lines admitted with sorry! cannot be submitted.";
const HOMEWORK =
  "Every other line checks; a proof with lines admitted with sorry! cannot be submitted.";
const EXAM =
  "Every other line checks; lines admitted with sorry! do not score.";

describe("allow-sorry on the tree widget", () => {
  test("an admitted rule is a warning, the rest checks, and the proof is held back", async () => {
    const mounted = mountTree(
      await treePublicDataFor(tree(" allow-sorry"), MINI),
    );
    // The page runtime's bubbling listener: a submit that is not cancelled
    // would be fetched, never navigated.
    const sent: Event[] = [];
    mounted.form.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) {
        sent.push(event);
        event.preventDefault();
      }
    });

    typeInto(treeRootRule(mounted), "sorry!");
    await until(() => treeRootRule(mounted).classList.contains("is-warning"));

    expect(treeRootRule(mounted).getAttribute("title")).toContain("admitted");
    // Not an error anywhere: the line itself is clean.
    expect(treeRootField(mounted).classList.contains("is-error")).toBe(false);
    expect(mark(mounted).dataset.state).toBe("idle");
    expect(status(mounted)).toBe(HOMEWORK);
    // No certificate: the verifier would refuse one, so none is sent.
    expect(JSON.parse(mounted.answerData.value)).toMatchObject({ mmb: "" });

    const refused = submit(mounted);
    expect(refused.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
    expect(status(mounted)).toBe(REFUSAL);

    // Prove the line and it goes.
    typeInto(treeRootRule(mounted), "mp");
    expect(status(mounted)).toBe("");
    await until(() => mark(mounted).dataset.state === "ok");
    expect(treeRootRule(mounted).classList.contains("is-warning")).toBe(
      false,
    );
    submit(mounted);
    expect(sent.length).toBe(1);
  });

  test("on an exam the admitted proof is let go, and told what it is worth", async () => {
    const mounted = mountTree(
      await treePublicDataFor(tree(" allow-sorry"), MINI),
      null,
      { exam: true },
    );
    const sent: Event[] = [];
    mounted.form.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) {
        sent.push(event);
        event.preventDefault();
      }
    });

    typeInto(treeRootRule(mounted), "sorry!");
    await until(() => treeRootRule(mounted).classList.contains("is-warning"));

    expect(status(mounted)).toBe(EXAM);
    submit(mounted);
    expect(sent.length).toBe(1);
  });

  test("a submit during a pending compile waits for it, then is judged", async () => {
    const mounted = mountTree(
      await treePublicDataFor(tree(" allow-sorry"), MINI),
    );
    const sent: Event[] = [];
    mounted.form.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) {
        sent.push(event);
        event.preventDefault();
      }
    });

    // Straight after the keystroke, before the debounce has fired.
    typeInto(treeRootRule(mounted), "sorry!");
    const held = submit(mounted);
    expect(held.defaultPrevented).toBe(true);

    // The hold resubmits once the compile settles, and the gate refuses.
    await until(() => status(mounted) === REFUSAL);
    expect(sent).toEqual([]);
    expect(treeRootRule(mounted).classList.contains("is-warning")).toBe(true);
  });

  test("without allow-sorry an admitted rule is an error on the line, and nothing is held", async () => {
    const mounted = mountTree(await treePublicDataFor(tree(""), MINI));
    const sent: Event[] = [];
    mounted.form.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) {
        sent.push(event);
        event.preventDefault();
      }
    });

    typeInto(treeRootRule(mounted), "sorry!");
    await until(() => treeRootField(mounted).classList.contains("is-error"));

    expect(treeRootRule(mounted).classList.contains("is-warning")).toBe(
      false,
    );
    expect(status(mounted)).toBe("");
    // A wrong proof was always the student's to submit.
    submit(mounted);
    expect(sent.length).toBe(1);
  });

  test("terse feedback withholds the warning and the sentence, not the refusal", async () => {
    const mounted = mountTree(
      await treePublicDataFor(tree(" allow-sorry"), MINI),
      null,
      { feedback: "terse" },
    );

    typeInto(treeRootRule(mounted), "sorry!");
    // Submitted before the compile has run: held, then refused once it has.
    expect(submit(mounted).defaultPrevented).toBe(true);
    // Why the button did nothing is not a verdict, so it is said regardless.
    await until(() => status(mounted) === REFUSAL);

    // What terse withholds: the reason on the line, and the sentence that
    // the rest checks.
    expect(treeRootRule(mounted).classList.contains("is-warning")).toBe(
      false,
    );
    expect(mark(mounted).dataset.state).toBe("idle");
  });
});
