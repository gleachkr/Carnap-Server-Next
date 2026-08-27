import { describe, expect, test } from "bun:test";
import { adoptShadowRoots, dom, domDocument } from "../helpers/dom";

/**
 * The browser half of the systems table: a widget's payload names the system it
 * is set in, and the element base joins it against the document's one copy
 * before `enhance` ever runs.
 *
 * Tested through the base class rather than through a particular widget,
 * because that is where the join is and every widget inherits it — a test that
 * went through the Fitch element would be testing the Fitch element.
 */

// After `helpers/dom` has installed the globals, so `extends HTMLElement`
// resolves in the window the fixtures are built in.
const { CarnapExerciseElement } = await import(
  "../../src/client/components/base"
);

let seen: unknown = null;

class Probe extends CarnapExerciseElement {
  protected enhance(): void {
    seen = this.publicData;
    this.dataset.enhanced = "true";
  }

  protected getAnswer(): unknown {
    return null;
  }
}

dom.window.customElements.define("carnap-systems-probe", Probe);

/** A system that is also a language: `@syntax` rides in an MM0 doc comment. */
const LANGUAGE = "--| @syntax role sentence\nsort wff;\n";

/** Its engine text, which is what stripping the annotation lines leaves. */
const LANGUAGE_MM0 = "sort wff;\n";

const GOAL = "theorem t: $ a $;";

// One table for the whole file. The base caches its read per document and the
// jsdom harness shares one, which is the browser's own situation: a document's
// table is emitted with it and cannot change under an element's feet.
const table = domDocument.createElement("script");

table.setAttribute("data-carnap-systems", "");
table.type = "application/json";
table.textContent = JSON.stringify({
  engine: { mm0: "sort wff;" },
  ours: { source: LANGUAGE },
});
domDocument.body.append(table);

function mount(payload: Record<string, unknown>): Record<string, unknown> {
  seen = null;

  const host = domDocument.createElement("div");

  host.innerHTML = `<carnap-systems-probe data-exercise-id="ex1"><script data-exercise-hydration type="application/json">${JSON.stringify(
    {
      mode: "answer",
      options: {},
      priorAnswer: null,
      publicData: payload,
      strings: {},
      version: 1,
    },
  )}</script></carnap-systems-probe>`;
  adoptShadowRoots(host);
  domDocument.body.append(host);

  return seen as Record<string, unknown>;
}

describe("the client's systems join", () => {
  test("a keyed payload arrives with its system's text", () => {
    const data = mount({ goalDecl: GOAL, system: "ours" });

    // Both texts, because which one an exercise is at is a fact about its type:
    // the shaped proof widgets read `source`, the linear one reads `mm0`.
    expect(data.source).toBe(`${LANGUAGE}\n${GOAL}`);
    expect(data.mm0).toBe(`${LANGUAGE_MM0}\n${GOAL}`);
  });

  test("a system that is not a language yields engine text only", () => {
    const data = mount({ goalDecl: GOAL, system: "engine" });

    expect(data.source).toBeUndefined();
    expect(data.mm0).toBe(`sort wff;\n${GOAL}`);
  });

  test("a payload that froze its own text is untouched", () => {
    // Every lesson saved before the table existed, whose payload carries the
    // only copy of its theory and no key to look one up by.
    expect(mount({ mm0: "sort nat;" }).mm0).toBe("sort nat;");
  });

  test("a key the table does not answer leaves the payload as it came", () => {
    // A document that failed to carry a system is a bug, but the widget's job
    // is to stay diagnosable rather than to invent text: it hydrates with no
    // theory and its own guard refuses, which leaves the inert server view and
    // a reload notice rather than a certificate verified against nothing.
    expect(mount({ goalDecl: GOAL, system: "absent" })).toEqual({
      goalDecl: GOAL,
      system: "absent",
    });
  });
});
