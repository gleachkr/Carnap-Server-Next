# Aufbau-proof exercise (`aufbau-proof@1`)

A proof the student writes and the **Aufbau engine** checks. The student's
browser compiles their proof against a fixed theory to an MMB certificate; the
worker independently re-verifies that certificate. The compiler is the untrusted
convenience; the [verifier](./verifier.ts) is the arbiter — see the engine notes
in memory (`aufbau-engine-packages`).

This is the first GUI layer on the Aufbau engine (`gleachkr/Aufbau`, published as
the `@aufbau/compiler` and `@aufbau/verifier` npm/wasm packages). v1 is a plain
CodeMirror text editor.

## The trust boundary

- The instructor authors an **`aufbau-mm0`** theory (sorts, terms, axioms) and,
  in each **`aufbau-proof`**, a goal `theorem`. The compiler **freezes** the
  theory plus the goal declaration into `publicData.mm0`.
- The **client** ([`carnap-aufbau-proof-v1.ts`](../../../client/components/carnap-aufbau-proof-v1.ts))
  compiles `mm0 + (goal header + student body)` on each edit and writes
  `{ proofText, mmb }` (the base64 certificate) into `answerData`. It gets the
  engine from [`proof-compiler.ts`](../../../client/proof-compiler.ts), which
  loads `@aufbau/compiler` lazily (its ~5 MB wasm) once for the whole page and in
  the reader's language — all four proof types share that one instance.
- The **worker** ([`assessment.ts`](./assessment.ts) → [`verifier.ts`](./verifier.ts))
  decodes the MMB and `verifyPair`s it against the *frozen* mm0 — never the
  student's proofText. `ok` ⇔ the declared goal is proved. All-or-nothing.

Because verification is bound to the mm0 we hold, a certificate for a different
statement will not verify, and a valid certificate *is* a valid proof however it
was produced (copying is a plagiarism concern, not a soundness one).

## Authoring syntax

Two directives. `aufbau-mm0` declares a named theory (raw MM0 body, rendered as a
read-only panel); `aufbau-proof` references it and states the goal.

```md
:::aufbau-mm0{name="prop"}
delimiter $ ( ) $;
provable sort wff;
term imp (a b: wff): wff; infixr imp: $->$ prec 25;
axiom top_i: $ top $;
axiom ax_1 (a b: wff): $ a -> b -> a $;
:::

:::aufbau-proof{theory="prop" id="identity"}
Prove the law of identity.

theorem thm_k (a b: wff): $ a -> b -> a $
----
l1: $ a -> b -> a $ by ax_1 []
:::
```

The proof body is: prompt prose, a `theorem <name>: $ … $` line (the goal, in MM0
declaration syntax — the first identifier after `theorem` is the goal name and
the whole line becomes the frozen mm0's theorem declaration), a `----` underline,
then the starter proof body. The student edits only the body.

### Attributes

| Attribute | Directive | Meaning |
| --- | --- | --- |
| `name` | `aufbau-mm0` | theory name other proof blocks reference (required) |
| `src` | `aufbau-mm0` | external theory — **not supported yet** (`unsupported_theory_src`) |
| `id` | `aufbau-proof` | exercise id (required) |
| `theory` | `aufbau-proof` | a theory declared earlier in the document (required) |
| `title`, `points`, `exam`, `feedback` | `aufbau-proof` | as for every exercise |
| `options` | `aufbau-proof` | space-separated: `auto` (proof search), `complete` (rule completion) |

Theories must be declared **before** the proofs that use them (matching the
engine's own no-forward-reference model); an unknown name is `unknown_theory`.

## Proof-script format

Proof lines, `by`, rule applications, named bindings, `auto?`/`exact?` holes, and
theory declarations (`term`, `axiom`, `theorem`, notation) are the engine's, not
this repo's. See `docs/proof.md` in `gleachkr/Aufbau`.

## How it fits together

| File | Role |
| --- | --- |
| [`types.ts`](./types.ts) | constants, `publicData`/`answerData` shapes, guards |
| [`authoring.ts`](./authoring.ts) | `compileAufbauMm0`, `compileAufbauProof` |
| [`verifier.ts`](./verifier.ts) | wasm-ABI binding over `@aufbau/verifier` |
| [`assessment.ts`](./assessment.ts) | normalize + evaluate (verify) + review |
| [`read-only-view.ts`](./read-only-view.ts) | inert DSD chrome + review render |
| [`carnap-aufbau-proof-v1.ts`](../../../client/components/carnap-aufbau-proof-v1.ts) | the editor element |
| [`proof-compiler.ts`](../../../client/proof-compiler.ts) | the page's one `@aufbau/compiler`, and its locale |

The theory panel is emitted as a plain markdown content node by the top-level
compiler (like `:::style`), which also collects theories and dispatches proof
blocks. The interactive answer form is wired in `assignment-detail.tsx`
(`aufbauProofSubmissionForm`); the authoring live-preview runs the same engine
check per proof (`editor-preview.ts`).

### Answer shape

```jsonc
{
  "proofText": "thm_k\n----\nl1: $ a -> b -> a $ by ax_1 []", // display/review only
  "mmb": "<base64 MMB certificate>"                            // the graded input
}
```

## Roadmap

- Wire the `auto?` / `complete` toggles to the LSP (`@aufbau/lsp`).
- `src=` theories (an in-system `item:` reference is preferred over an external
  URL fetch).
- Engine-rendered theory panel (an `<aufbau-index>`-style pretty print) instead
  of raw MM0.
- Cross-cell proof documents (a later proof citing an earlier proof's lemmas);
  v1 proofs are independent, each verified against the shared theory.
- Additional GUI layers (structured / Fitch-style) on the same engine.
