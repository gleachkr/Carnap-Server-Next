/**
 * The regression battery for translation-equivalence checking, run against the
 * real engines: `auto?` proof search in `@aufbau/lsp`, certificate production
 * in `@aufbau/compiler`, and independent re-verification in
 * `@aufbau/verifier`. This is the net that makes the calculus in
 * `translation/logic/theories.ts` safe to change — a rule change that breaks a
 * known equivalence, or lets a known non-equivalence through, fails here.
 *
 * The LSP protocol loop mirrors Aufbau's own web editor: sync the sibling
 * `current.mm0` / `current.auf` pair (mm0 first), request
 * `textDocument/codeAction` at the `auto?` placeholder, apply the returned
 * edits, and compile the expanded proof. `lsp.process()` returns JSON
 * *strings*, not objects.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { LoadedCompiler } from "@aufbau/compiler";
import { loadCompiler } from "@aufbau/compiler";
import type { LspServer } from "@aufbau/lsp";
import { loadLspServer } from "@aufbau/lsp";
import type { LoadedVerifier } from "@aufbau/verifier";
import { loadVerifier } from "@aufbau/verifier";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import type { Formula } from "../src/worker/exercises/first-order";
import {
  FORALLX_CALGARY_2019,
  parseFormula,
} from "../src/worker/exercises/first-order";
import { TranslationExerciseType } from "../src/worker/exercises/translation/assessment";
import { buildEquivalenceCheck } from "../src/worker/exercises/translation/logic/mm0";
import {
  TRANSLATION_ANSWER_KIND,
  TRANSLATION_SCHEMA_VERSION,
} from "../src/worker/exercises/translation/types";

function wasmBytes(packagePath: string): Uint8Array {
  return readFileSync(
    new URL(`../node_modules/${packagePath}`, import.meta.url),
  );
}

let compiler: LoadedCompiler;
let verifier: LoadedVerifier;
let lsp: LspServer;
let requestId = 0;
let documentVersion = 0;

const MM0_URI = "file:///translation-battery/current.mm0";
const AUF_URI = "file:///translation-battery/current.auf";

function lspRequest(method: string, params: unknown): unknown {
  requestId += 1;
  const out = lsp
    .process({ id: requestId, jsonrpc: "2.0", method, params })
    .map((message) =>
      typeof message === "string"
        ? (JSON.parse(message) as unknown)
        : message,
    );
  const response = out.find(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { id?: number }).id === requestId,
  ) as { error?: unknown; result?: unknown } | undefined;
  if (response?.error !== undefined) {
    throw new Error(`${method}: ${JSON.stringify(response.error)}`);
  }
  return response?.result;
}

function syncDocument(uri: string, languageId: string, text: string): void {
  documentVersion += 1;
  const opened = documentVersion > 2;
  lsp.process(
    opened
      ? {
          jsonrpc: "2.0",
          method: "textDocument/didChange",
          params: {
            contentChanges: [{ text }],
            textDocument: { uri, version: documentVersion },
          },
        }
      : {
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: { languageId, text, uri, version: 1 },
          },
        },
  );
}

interface LspTextEdit {
  readonly newText: string;
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

function applyEdits(text: string, edits: readonly LspTextEdit[]): string {
  let lines = text.split("\n");
  const sorted = [...edits].sort(
    (a, b) =>
      b.range.start.line - a.range.start.line ||
      b.range.start.character - a.range.start.character,
  );
  for (const edit of sorted) {
    const { start, end } = edit.range;
    const startLine = lines[start.line] ?? "";
    const endLine = lines[end.line] ?? "";
    const before =
      lines.slice(0, start.line).join("\n") +
      (start.line > 0 ? "\n" : "") +
      startLine.slice(0, start.character);
    const after =
      endLine.slice(end.character) +
      (end.line < lines.length - 1
        ? `\n${lines.slice(end.line + 1).join("\n")}`
        : "");
    lines = (before + edit.newText + after).split("\n");
  }
  return lines.join("\n");
}

function parse(source: string): Formula {
  const result = parseFormula(source, FORALLX_CALGARY_2019);
  if (!result.ok) {
    throw new Error(`parse failed for ${source}`);
  }
  return result.formula;
}

/** The client's half: search for a proof, expand the edit, compile, and hand
 * back the certificate — or null when the search comes up empty. */
function findCertificate(
  studentSource: string,
  solutionSource: string,
): Uint8Array | null {
  const student = parse(studentSource);
  const solution = parse(solutionSource);
  const sources = buildEquivalenceCheck(student, solution);

  syncDocument(MM0_URI, "mm0", sources.mm0);
  syncDocument(AUF_URI, "aufbau", sources.auf);
  const actions = lspRequest("textDocument/codeAction", {
    context: { diagnostics: [] },
    range: { end: sources.placeholder, start: sources.placeholder },
    textDocument: { uri: AUF_URI },
  }) as
    | readonly { edit?: { changes?: Record<string, LspTextEdit[]> } }[]
    | null
    | undefined;

  const edits = (actions ?? []).flatMap((action) =>
    action.edit?.changes ? Object.values(action.edit.changes).flat() : [],
  );
  if (edits.length === 0) {
    return null;
  }

  const expanded = applyEdits(sources.auf, edits);
  const compiled = compiler.compile(sources.mm0, expanded);
  expect(compiled.ok).toBe(true);
  const mmb = compiled.mmbBytes ?? new Uint8Array();
  expect(mmb.length).toBeGreaterThan(0);
  return mmb;
}

/** The full client-then-worker path: search, expand, compile, and verify the
 * certificate against an independently rebuilt mm0. */
function checkEquivalent(
  studentSource: string,
  solutionSource: string,
): boolean {
  const mmb = findCertificate(studentSource, solutionSource);

  if (mmb === null) {
    return false;
  }

  // The worker's half: rebuild the mm0 from a fresh parse (emission must be
  // deterministic for the trust boundary to hold) and verify the certificate.
  const rebuilt = buildEquivalenceCheck(
    parse(studentSource),
    parse(solutionSource),
  );
  const verdict = verifier.verifyPair(rebuilt.mm0, mmb);
  expect(verdict.ok).toBe(true);
  return true;
}

describe("propositional equivalences the calculus must certify", () => {
  const CASES: readonly [string, string, string][] = [
    ["commutativity", "P/\\Q", "Q/\\P"],
    ["material conditional", "P->Q", "~P\\/Q"],
    ["De Morgan", "~(P/\\Q)", "~P\\/~Q"],
    ["distribution", "P/\\(Q\\/R)", "(P/\\Q)\\/(P/\\R)"],
    ["contraposition", "P->Q", "~Q->~P"],
    ["absorption", "P", "P/\\(P\\/Q)"],
    ["exportation", "(P/\\Q)->R", "P->(Q->R)"],
    ["biconditional commutativity", "P<->Q", "Q<->P"],
    ["negated biconditional", "~(P<->Q)", "P<->~Q"],
    ["biconditional expansion", "P<->Q", "(P/\\Q)\\/(~P/\\~Q)"],
    ["excluded middle", "⊤", "P\\/~P"],
    ["contradiction", "⊥", "P/\\~P"],
  ];
  for (const [name, left, right] of CASES) {
    test(name, () => {
      expect(checkEquivalent(left, right)).toBe(true);
    });
  }
});

describe("propositional non-equivalences the search must refuse", () => {
  const CASES: readonly [string, string, string][] = [
    ["converse", "P->Q", "Q->P"],
    ["connective swap", "P/\\Q", "P\\/Q"],
    ["distinct letters", "P", "Q"],
    ["a letter is not a truth value", "P", "⊤"],
    ["the truth values are distinct", "⊤", "⊥"],
  ];
  for (const [name, left, right] of CASES) {
    test(name, () => {
      expect(checkEquivalent(left, right)).toBe(false);
    });
  }
});

describe("first-order equivalences the calculus must certify", () => {
  const CASES: readonly [string, string, string][] = [
    ["quantifier De Morgan", "~Ex~F(x)", "AxF(x)"],
    ["negation passage", "~AxF(x)", "Ex~F(x)"],
    ["quantifier swap within a block", "AxAyH(x,y)", "AyAxH(y,x)"],
    ["existential swap", "ExEyH(x,y)", "EyExH(y,x)"],
    ["universal over conjunction", "Ax(F(x)/\\G(x))", "AxF(x)/\\AxG(x)"],
    ["existential over disjunction", "Ex(F(x)\\/G(x))", "ExF(x)\\/ExG(x)"],
    ["antecedent passage", "Ax(F(x)->P)", "ExF(x)->P"],
    ["consequent passage", "Ax(P->F(x))", "P->AxF(x)"],
    ["identity rides along as an atom", "a=b/\\F(a)", "F(a)/\\a=b"],
    ["nested mixed prefix", "~Ax(F(x)->EyG(y))", "Ex(F(x)/\\Ay~G(y))"],

    // A witness nothing in the branch determines: the operand that closes it
    // does not mention the bound variable, so *any* object serves and the
    // engine has to invent one from the `@vars` pool. These fail wholesale if
    // that pool overlaps the goal's binders — see SPARE_VARS in theories.ts.
    ["conjunction with a sentence", "Ax(F(x)/\\P)", "AxF(x)/\\P"],
    ["conjunction with a closed atom", "Ax(F(x)/\\G(a))", "AxF(x)/\\G(a)"],
    ["disjunction with a sentence", "Ex(F(x)\\/P)", "ExF(x)\\/P"],
    // Vacuous: the instance is the same formula for every witness, so there
    // is nothing to invent *over* and nothing to read back from the closing
    // branch. The engine has to pick an arbitrary witness on its own.
    ["vacuous universal", "AxP", "P"],
    ["vacuous existential", "ExP", "P"],

    // Cross-shape prenexing: a chain that has to *nest* two quantifiers that
    // started in parallel positions, or the reverse. This is the family the
    // earlier rewrite-based (`conversion?`) design could not reach at all —
    // the nominal egraph wanted contradictory binder names for the two shapes.
    // Here the binders are ordinary rule binders and the proofs go through.
    ["parallel versus nested", "AxF(x)/\\AyG(y)", "AxAy(F(x)/\\G(y))"],
    ["deep prenexing", "(ExF(x)\\/P)->AyG(y)", "AxAy((F(x)\\/P)->G(y))"],
  ];
  for (const [name, left, right] of CASES) {
    test(name, () => {
      expect(checkEquivalent(left, right)).toBe(true);
    });
  }
});

describe("first-order non-equivalences the search must refuse", () => {
  const CASES: readonly [string, string, string][] = [
    ["quantifier strength", "AxF(x)", "ExF(x)"],
    ["quantifier order across kinds", "AxEyH(x,y)", "EyAxH(x,y)"],
    ["identity is syntactic", "a=b/\\F(a)", "a=b/\\F(b)"],
    ["distinct constants", "F(a)", "F(b)"],
    ["crossed arguments", "F(a)/\\G(b)", "F(b)/\\G(a)"],
    ["distribution that does not hold", "Ax(F(x)->G(x))", "AxF(x)->AxG(x)"],
    ["identity is not a tautology", "a=a", "⊤"],
  ];
  for (const [name, left, right] of CASES) {
    test(name, () => {
      expect(checkEquivalent(left, right)).toBe(false);
    });
  }
});

describe("emission", () => {
  test("alpha variants emit identically", () => {
    const a = buildEquivalenceCheck(parse("AxF(x)"), parse("P"));
    const b = buildEquivalenceCheck(parse("AyF(y)"), parse("P"));
    expect(a.mm0).toBe(b.mm0);
  });

  test("each quantifier occurrence gets its own binder", () => {
    const sources = buildEquivalenceCheck(
      parse("AxAyH(x,y)"),
      parse("AzF(z)"),
    );
    expect(sources.mm0).toContain("(∀ v0 (∀ v1 (p_H_2 v0 v1)))");
    expect(sources.mm0).toContain("(∀ v2 (p_F_1 v2))");
    expect(sources.mm0).toContain("theorem check {v0 v1 v2: obj}:");
  });

  test("mixed prefixes keep their written order", () => {
    const sources = buildEquivalenceCheck(parse("AxEyH(x,y)"), parse("P"));
    expect(sources.mm0).toContain("(∀ v0 (∃ v1 (p_H_2 v0 v1)))");
  });

  test("subscripted and multi-arity symbols mangle apart", () => {
    const sources = buildEquivalenceCheck(
      parse("F(a)/\\F(a,b)"),
      parse("F_2(a_2)"),
    );
    expect(sources.mm0).toContain("term p_F_1 (a0: obj): form;");
    expect(sources.mm0).toContain("term p_F_2 (a0 a1: obj): form;");
    expect(sources.mm0).toContain("term p_Fs2_1 (a0: obj): form;");
    expect(sources.mm0).toContain("term c_a: obj;");
    expect(sources.mm0).toContain("term c_as2: obj;");
  });

  test("a purely propositional pair gets no first-order machinery", () => {
    const sources = buildEquivalenceCheck(parse("P/\\Q"), parse("Q/\\P"));
    expect(sources.mm0).not.toContain("sort obj;");
    expect(sources.mm0).not.toContain("axiom rall ");
    expect(sources.mm0).toContain("axiom rand ");
  });

  test("the placeholder points at auto?", () => {
    const sources = buildEquivalenceCheck(parse("P"), parse("Q"));
    const line = sources.auf.split("\n")[sources.placeholder.line] ?? "";
    expect(
      line.slice(
        sources.placeholder.character,
        sources.placeholder.character + "auto?".length,
      ),
    ).toBe("auto?");
  });
});

describe("the exercise type grades a searched certificate", () => {
  async function manifestItem(source: string): Promise<ExerciseManifestItem> {
    const compiled = await compileCarnapMarkdown(source);
    if (!compiled.ok) {
      throw new Error("compile failed");
    }
    const item = compiled.artifact.manifest[0];
    if (item === undefined) {
      throw new Error("no manifest item");
    }
    return item;
  }

  async function grade(
    item: ExerciseManifestItem,
    text: string,
    mmb: Uint8Array | null,
  ): Promise<string> {
    const type = new TranslationExerciseType();
    const normalized = type.normalizeAnswer(
      {
        data: {
          text,
          ...(mmb === null
            ? {}
            : { mmb: Buffer.from(mmb).toString("base64"), solutionIndex: 0 }),
        } as never,
        kind: TRANSLATION_ANSWER_KIND,
        schemaVersion: TRANSLATION_SCHEMA_VERSION,
      },
      item,
    );
    if (!normalized.ok) {
      throw new Error("normalization failed");
    }
    const evaluation = await type.evaluate(
      normalized.answer,
      item,
      {} as never,
    );
    return evaluation.status;
  }

  test("a certificate found by the search verifies and scores", async () => {
    const item =
      await manifestItem(`::::translation{#t1 variant="first-order"}
Everything is fine.

- AxF(x)
::::`);

    // The stored solution is canonical source; the certificate must target it.
    const mmb = findCertificate("~Ex~F(x)", "AxF(x)");
    expect(mmb).not.toBeNull();
    expect(await grade(item, "~Ex~F(x)", mmb)).toBe("correct");
  });

  test("a certificate for a different statement does not transfer", async () => {
    const item =
      await manifestItem(`::::translation{#t1 variant="first-order"}
Everything is fine.

- AxF(x)
::::`);

    // Proves ~Ex~F(x) ↔ AxF(x); submitted with text AyG(y), whose rebuilt
    // mm0 states a different theorem entirely.
    const mmb = findCertificate("~Ex~F(x)", "AxF(x)");
    expect(mmb).not.toBeNull();
    expect(await grade(item, "AyG(y)", mmb)).toBe("incorrect");
  });
});

beforeAll(async () => {
  compiler = await loadCompiler({
    wasmBytes: wasmBytes("@aufbau/compiler/compiler.wasm"),
  });
  verifier = await loadVerifier({
    wasmBytes: wasmBytes("@aufbau/verifier/verifier.wasm"),
  });
  lsp = await loadLspServer({
    wasmBytes: wasmBytes("@aufbau/lsp/lsp.wasm"),
  });
  lspRequest("initialize", { capabilities: {} });
  lsp.process({ jsonrpc: "2.0", method: "initialized", params: {} });
});
