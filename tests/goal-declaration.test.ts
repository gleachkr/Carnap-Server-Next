import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { LoadedCompiler } from "@aufbau/compiler";
import { loadCompiler } from "@aufbau/compiler";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  proofFormulaReader,
  proofTheoryText,
} from "../src/worker/exercise-kit/proof/formulas";
import { builtInSystem } from "../src/worker/exercise-kit/systems/theory";
import { ruleCitationShapes } from "../src/worker/exercises/aufbau-proof-fitch/citations";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import { isAufbauProofFitchPublicData } from "../src/worker/exercises/aufbau-proof-fitch/types";
import { FITCH_THEORY_BLOCK } from "./helpers/fitch-theory";

/**
 * A goal declaration read through the system's language, checked against the
 * real engine — the check that matters, since the reason the goal is read at
 * all is that the engine's own math parser refused what an author writes.
 * The lesson here is the one that was reported: over the shipped Calgary
 * system with no block, a goal spelled the way its lines are, which the
 * engine used to answer with "extra proof block with no matching theorem".
 */

let compiler: LoadedCompiler;

function errorsIn(result: { readonly diagnostics?: unknown }): unknown[] {
  return (Array.isArray(result.diagnostics) ? result.diagnostics : []).filter(
    (one) => (one as { severity?: unknown }).severity === "error",
  );
}

beforeAll(async () => {
  compiler = await loadCompiler({
    wasmBytes: readFileSync(
      new URL(
        "../node_modules/@aufbau/compiler/compiler.wasm",
        import.meta.url,
      ),
    ),
  });
});

async function frozen(directive: string) {
  const compiled = await compileCarnapMarkdown(directive);

  if (!compiled.ok) {
    throw new Error(JSON.stringify(compiled.diagnostics));
  }

  const [item] = compiled.artifact.manifest;

  if (item === undefined || !isAufbauProofFitchPublicData(item.publicData)) {
    throw new Error("no Fitch exercise compiled");
  }

  return item.publicData;
}

describe("a goal read into engine text", () => {
  test("declares, and its starter verifies, against the real engine", async () => {
    const data =
      await frozen(`:::aufbau-proof-fitch{system="forallx-calgary" id="cd" points="3"}
Constructive dilemma

theorem cd : $ P \\/ Q ; P -> S ; Q -> S ⊢ S $
----
P \\/ Q :AS
P -> S :AS
Q -> S :AS
 P    :AS
 S    :imp_elim 2 4
 Q    :AS
 S    :imp_elim 3 6
S     :or_elim 1 4-5 6-7
:::
`);
    const theory = proofTheoryText(data);
    const translated = fitchToAuf(
      data.starterBody,
      data.goalName,
      data.assumptionRule,
      data.sequentSymbol ?? "⊢",
      data.contextSymbol ?? ";",
      proofFormulaReader(theory.source, "sentence", data.goalName),
      ruleCitationShapes(theory.source),
    );

    expect(translated.formulaProblems).toEqual([]);
    expect(translated.diagnostics).toEqual([]);

    const result = compiler.compile(theory.mm0, translated.proofText);
    // A clean compile carries the engine's warnings since 0.0.9 — here, that
    // ∨E's hidden context binders admit more than one split. Errors are what
    // would mean the goal did not declare.
    expect(errorsIn(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("a quantifier touching its variable declares cleanly", async () => {
    const data =
      await frozen(`:::aufbau-proof-fitch{system="forallx-calgary" id="ex" points="3"}
Prove it.

theorem exelim {x y: var} : $ ∃x F(x) ; ∀x (F(x) → G(x)) ⊢ ∃x G(x) $
----
:::
`);
    const result = compiler.compile(
      proofTheoryText(data).mm0,
      `${data.goalName}\n----\n`,
    );

    // The one complaint left is the one an empty proof earns.
    const diagnostics = result.diagnostics as readonly {
      readonly message?: unknown;
    }[];

    expect(
      diagnostics.map((one) => String(one.message).split("\n")[0]),
    ).toEqual(["proof block is empty"]);
  });

  test("the ASCII operators reach the engine as tokens, unread", async () => {
    // `aufbau-proof@1` hands its goal to the engine verbatim, so this is the
    // case that needs `/` kept out of the theory's engine delimiters: `\/`
    // and `/\` are declared notations, and they only tokenize if nothing
    // splits them. The sentence letters take their elided argument by hand,
    // which is the one thing engine text still asks for.
    const data =
      await frozen(`:::aufbau-proof-fitch{system="forallx-calgary" id="raw" points="1"}
Prove it.

theorem raw : $ P ⊢ P $
----
:::
`);
    const source = proofTheoryText(data).mm0.replace(
      /theorem raw[^\n]*$/,
      "theorem raw : $ P snil \\/ Q snil ; P snil /\\ R snil ⊢ P snil $;",
    );
    const result = compiler.compile(source, "raw\n----\n");
    const diagnostics = result.diagnostics as readonly {
      readonly message?: unknown;
    }[];

    expect(
      diagnostics.map((one) => String(one.message).split("\n")[0]),
    ).toEqual(["proof block is empty"]);
  });

  test("old Carnap's `:|-:` is a turnstile in both forallx systems, and `|-` is not", async () => {
    const goal = async (system: string, statement: string) =>
      (
        await frozen(`:::aufbau-proof-fitch{system="${system}" id="g" points="1"}
Prove it.

theorem g {x y: var} : $ ${statement} $
----
:::
`)
      ).goalEngineDecl;

    for (const system of ["forallx-calgary", "forallx-magnus"]) {
      const turnstile = await goal(system, "∀x F(x) ⊢ ∀y F(y)");

      expect(turnstile).toContain("⊢");
      expect(await goal(system, "∀x F(x) :|-: ∀y F(y)")).toBe(turnstile);
      expect(await goal(system, "∀xF(x):|-:∀yF(y)")).toBe(turnstile);
    }
    // `|` and `-` are disjunction and negation, and stay so: a goal typed
    // with `|-` is a sentence, ∀x F(x) ∨ ¬∀y F(y), which is why `:|-:` is the
    // spelling — and a Fitch goal with no turnstile is refused for it.
    const compiled =
      await compileCarnapMarkdown(`:::aufbau-proof-fitch{system="forallx-calgary" id="g" points="1"}
Prove it.

theorem g {x y: var} : $ ∀x F(x) |- ∀y F(y) $
----
:::
`);

    expect(compiled.diagnostics.map((one) => one.code)).toEqual([
      "goal_not_sequent",
    ]);
  });

  test("a goal that uses a variable or name it does not bind is refused, with the binder to add", async () => {
    // What an author reported: read here, quantifier and all, then
    // refused by the engine as "unknown token in math string", which named
    // neither.
    const compiled =
      await compileCarnapMarkdown(`:::aufbau-proof-fitch{system="forallx-calgary" id="u" points="1"}
Prove it.

theorem u {x: var} : $ ∀x B(x) ⊢ ∀y B(y) ∧ B(c) $
----
:::
`);

    expect(compiled.ok).toBe(false);
    expect(
      compiled.diagnostics.map((one) => [one.code, one.line, one.params]),
    ).toEqual([
      ["unbound_goal_variable", 4, { binder: "{y: var}", name: "y" }],
      ["unbound_goal_variable", 4, { binder: "{c: name}", name: "c" }],
    ]);
  });
});

/**
 * A goal is declared beside the theory, and the engine keeps axioms and
 * theorems in one namespace: a goal named after a rule can never compile
 * (#522). Found as `theorem mt` over forallx-calgary-plus, whose MT is the
 * axiom `mt`.
 */
describe("a goal named after one of the theory's rules", () => {
  const DIRECTIVES = {
    "aufbau-proof": "theorem mt : $ P ⊢ P $\n----\n",
    "aufbau-proof-fitch": "theorem mt : $ P ⊢ P $\n----\n",
    "aufbau-proof-prawitz": "theorem mt : $ P ⊢ P $\n",
    "aufbau-proof-tree": "theorem mt : $ P ⊢ P $\n",
  } as const;

  async function diagnosticsOf(source: string) {
    const compiled = await compileCarnapMarkdown(source);

    return compiled.diagnostics.map(({ code, line, severity }) => ({
      code,
      line,
      severity,
    }));
  }

  for (const [kind, body] of Object.entries(DIRECTIVES)) {
    test(`is refused on the goal's own line, in ${kind}`, async () => {
      const diagnostics = await diagnosticsOf(
        `:::${kind}{system="forallx-calgary-plus" id="g" points="1"}\nProve it.\n\n${body}:::\n`,
      );

      expect(diagnostics).toEqual([
        { code: "goal_name_taken", line: 4, severity: "error" },
      ]);
    });
  }

  test("is what the engine refuses", () => {
    const theory = builtInSystem("forallx-calgary-plus");

    if (theory === null) {
      throw new Error("forallx-calgary-plus is not built in");
    }

    const result = compiler.compile(
      `${proofTheoryText(theory).mm0}\ntheorem mt (ph: wff): $ ph ⊢ ph $;`,
      "mt\n----\n",
    );

    expect(
      errorsIn(result).map(
        (one) =>
          String((one as { message?: unknown }).message).split("\n")[0],
      ),
    ).toContain("duplicate axiom or theorem name");
  });

  test("a goal named after a term is not a clash", async () => {
    // Terms, defs and sorts live in other namespaces: `snil` is a term.
    const data =
      await frozen(`:::aufbau-proof-fitch{system="forallx-calgary-plus" id="t" points="1"}
Prove it.

theorem snil : $ P ⊢ P $
----
:::
`);

    expect(data.goalName).toBe("snil");
  });

  test("a playground over a theory with a rule named playground is refused", async () => {
    const diagnostics = await diagnosticsOf(
      `${FITCH_THEORY_BLOCK.replace(
        /\n:::$/,
        "\naxiom playground (a: wff): $ a ⊢ a $;\n:::",
      )}\n\n:::aufbau-proof-fitch{system="prop" id="p" points="0" playground}\nAnything.\n:::\n`,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "playground_name_taken" }),
    );
  });
});
