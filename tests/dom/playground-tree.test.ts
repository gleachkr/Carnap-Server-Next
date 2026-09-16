import { afterAll, describe, expect, mock, test } from "bun:test";
import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import { exerciseActionsHtml } from "../../src/worker/exercise-kit/actions";
import { EXERCISE_HYDRATION_VERSION } from "../../src/worker/exercise-kit/hydration";
import { withSystemText } from "../../src/worker/exercise-kit/systems/join";
import { renderAufbauProofTreeElement } from "../../src/worker/exercises/aufbau-proof-tree/read-only-view";
import { buildAufbauProofTreeStrings } from "../../src/worker/exercises/aufbau-proof-tree/strings";
import type { AufbauProofTreePublicData } from "../../src/worker/exercises/aufbau-proof-tree/types";
import { i18nFor } from "../../src/worker/i18n";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";

/**
 * `<carnap-aufbau-proof-tree>` in playground mode (#305): the root is the
 * student's to write, the "Proves" line follows it, and what the compiler is
 * handed is the frozen theory *plus* the goal the root makes — the same text
 * the worker will rebuild from the answer's `goal`. The compiler is mocked at
 * the module seam; that the derived declaration compiles and verifies for
 * real is `tests/playground.test.ts`'s business.
 */

const compile = mock((_mm0: string, _proof: string) => ({
  mmbBytes: new Uint8Array([1, 2, 3]),
  ok: true,
}));

// Only the loader is stood in for; the module's readers stay real, and the
// loader is put back afterwards — `mock.module` is process-wide, and the
// files that test the real loader and readers share this process.
const PROOF_COMPILER = "../../src/client/proof-compiler";
const realProofCompiler = { ...(await import(PROOF_COMPILER)) };

mock.module(PROOF_COMPILER, () => ({
  ...realProofCompiler,
  loadProofCompiler: async () => ({ compile }),
}));

afterAll(() => {
  mock.module(PROOF_COMPILER, () => ({ ...realProofCompiler }));
});

// The vendored ProofML elements measure themselves with a ResizeObserver,
// which jsdom does not have; nothing here is about layout.
class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(dom.window as unknown as Record<string, unknown>).ResizeObserver =
  InertResizeObserver;
(globalThis as Record<string, unknown>).ResizeObserver = InertResizeObserver;

await import("../../src/client/components/carnap-aufbau-proof-tree-v1");

async function publicDataFor(
  directive: string,
): Promise<AufbauProofTreePublicData> {
  const result = await compileCarnapMarkdown(
    `:::aufbau-mm0{name="fx" src="/theories/forallx-magnus.mm0"}\n:::\n\n${directive}`,
  );
  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  const item = result.artifact.manifest[0] as ExerciseManifestItem;
  // The browser's join: the payload carries the key, the element the text.
  return withSystemText(
    item.publicData,
    result.artifact.systems,
  ) as unknown as AufbauProofTreePublicData;
}

interface Mounted {
  readonly answerData: HTMLInputElement;
  readonly element: HTMLElement;
  readonly form: HTMLFormElement;
  readonly root: ShadowRoot;
}

function mount(publicData: AufbauProofTreePublicData): Mounted {
  const i18n = i18nFor("en");
  const actions = exerciseActionsHtml(i18n, { slotted: true });
  const hydration = {
    mode: "answer",
    options: {},
    priorAnswer: null,
    publicData,
    strings: buildAufbauProofTreeStrings(i18n),
    version: EXERCISE_HYDRATION_VERSION,
  };
  const html = renderAufbauProofTreeElement(
    publicData,
    {
      component: "carnap-aufbau-proof-tree",
      componentVersion: "1",
      exerciseId: "t1",
      exerciseKind: "aufbau-proof-tree@1",
      i18n,
      title: null,
    },
    `${actions}<script data-exercise-hydration type="application/json">${JSON.stringify(hydration)}</script>`,
  );

  // The element scopes its listeners to an `AbortController`, and jsdom's
  // `addEventListener` refuses a signal from Bun's own. Construction (where
  // the controller is made) and the upgrade (where the listeners are added)
  // are both synchronous with building the fixture, so the window's
  // constructor stands in for exactly that long.
  const globals = globalThis as Record<string, unknown>;
  const saved = globals.AbortController;
  globals.AbortController = (
    dom.window as unknown as Record<string, unknown>
  ).AbortController;
  const form = domDocument.createElement("form");
  try {
    form.className = "exercise-submission";
    form.innerHTML = `<input name="answerData" type="hidden">${html}`;
    adoptShadowRoots(form);
    domDocument.body.append(form);
  } finally {
    globals.AbortController = saved;
  }

  const element = form.querySelector(
    "carnap-aufbau-proof-tree",
  ) as HTMLElement;
  return {
    answerData: form.querySelector(
      'input[name="answerData"]',
    ) as HTMLInputElement,
    element,
    form,
    root: element.shadowRoot as ShadowRoot,
  };
}

async function until(
  condition: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition never held");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function rootField(mounted: Mounted): HTMLElement {
  return mounted.root.querySelector(".tree-edit") as HTMLElement;
}

function typeInto(field: HTMLElement, text: string): void {
  field.textContent = text;
  field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

describe("a playground tree", () => {
  test("the root is the student's to write, and the compiler gets the goal it makes", async () => {
    const mounted = mount(
      await publicDataFor(
        `:::aufbau-proof-tree{system="fx" id="t1" playground}\nBuild anything.\n:::`,
      ),
    );

    expect(mounted.element.dataset.enhanced).toBe("true");
    const field = rootField(mounted);
    expect(field.getAttribute("contenteditable")).toBe("true");
    expect(field.classList.contains("tree-fixed")).toBe(false);
    // A hypothesis leaf cites the goal's n-th hypothesis; a playground's has none.
    const hypothesis = Array.from(
      mounted.root.querySelectorAll<HTMLButtonElement>(
        ".tree-toolbar button",
      ),
    ).find((button) => button.textContent === "Add hypothesis");
    expect(hypothesis?.disabled).toBe(true);
    // Nothing to prove yet: no compile, no goal in the answer.
    expect(compile).toHaveBeenCalledTimes(0);
    expect(JSON.parse(mounted.answerData.value)).not.toHaveProperty("goal");

    typeInto(field, "Fa ⊢ Fa");

    await until(() => compile.mock.calls.length > 0);

    const [mm0, proof] = compile.mock.calls[0] as [string, string];
    expect(mm0).toEndWith(
      "theorem playground {a: name}: $ ((F (a)) ⊢ (F (a))) $;",
    );
    expect(proof).toStartWith("playground\n----\n");
    expect(mounted.root.querySelector(".tree-goal")?.textContent).toBe(
      "Proves Fa ⊢ Fa",
    );

    await until(() => mounted.answerData.value.includes('"mmb":"AQID"'));
    expect(JSON.parse(mounted.answerData.value)).toMatchObject({
      goal: {
        binders: [{ name: "a", sort: "name" }],
        statement: "((F (a)) ⊢ (F (a)))",
      },
    });
  });

  test("an ordinary exercise keeps its fixed root and says nothing about proving", async () => {
    const mounted = mount(
      await publicDataFor(
        `:::aufbau-proof-tree{system="fx" id="t1"}\nProve it.\n\ntheorem t {a: name}: $ Fa ⊢ Fa $\n:::`,
      ),
    );

    expect(rootField(mounted).classList.contains("tree-fixed")).toBe(true);
    expect(mounted.root.querySelector(".tree-goal")).toBeNull();
  });
});
