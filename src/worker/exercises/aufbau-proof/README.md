# Linear proof exercise (`aufbau-proof@1`)

Students write a linear Aufbau proof script in CodeMirror. The browser
compiles it with `@aufbau/compiler` into an MMB certificate. The server checks
that certificate independently with `@aufbau/verifier` against the saved
theory and goal. It does not grade the proof text or trust browser status.

Tree, Fitch, and Prawitz proofs use the same compiler and verifier, with
additional code to translate their input formats to linear proof scripts.
The shared engine code — formula reading, the playground goal, the
certificate and verifier, the theorem-header and starter helpers — lives in
`src/worker/exercise-kit/proof/`; this folder holds only the linear type.

## Verification and storage

The author selects a theory and declares a goal theorem. Compilation stores
shared theory text once in the artifact's systems table and stores the goal
with the exercise. `../../exercise-kit/systems/join.ts` joins them into `publicData.mm0` for the
widget and grader. The original source is also available for display and
surface-language parsing.

The browser loads the compiler lazily through `src/client/proof-compiler.ts`.
One instance serves the document's proof widgets, using the document locale.
After edits, the widget compiles the theory and proof and updates
`answerData` with the proof text and base64 certificate.

The server decodes the certificate and calls `verifyMmb` against its own
frozen MM0. Credit is all-or-nothing. A certificate for a different statement
cannot satisfy the saved goal. Verification establishes validity, not
originality: copied valid proofs remain a plagiarism concern.

The server stores `{ proofText }` and the evaluation, not the certificate.
The text can be compiled again for investigation, but old evaluations are
not automatically recalculated. The engine's `sorry!` justification cannot
produce an accepted exercise certificate; `allow-sorry` only changes what the
widget tells the student about one (a warning, and whether the proof may be
submitted), never what it scores.

## Authoring

Declare a named theory before using it, or select a built-in system directly:

```md
:::aufbau-mm0{name="prop"}
delimiter $ ( ) $;
provable sort wff;
term imp (a b: wff): wff;
infixr imp: $->$ prec 25;
axiom ax_1 (a b: wff): $ a -> b -> a $;
:::

:::aufbau-proof{system="prop" id="implication"}
Prove the stated implication.

theorem thm_k (a b: wff): $ a -> b -> a $
----
l1: $ a -> b -> a $ by ax_1 []
:::
```

The exercise body contains prompt prose, a `theorem` declaration, a `----`
separator, and the starter proof body. The theorem name is the first
identifier after `theorem`; it need not match the exercise ID. Students edit
only the proof body.

A theory block accepts raw MM0, a `src` URL, or both. With both, the body is
appended to the referenced source. For example:

```md
:::aufbau-mm0{name="ours" src="/theories/forallx-calgary-2019.mm0"}
--| @syntax delimiter $ Cube $
term Cube (x: tm): wff;
:::
```

Built-ins resolve from imported files under `src/worker/logic/theories/`,
without fetching their URLs. Hosted theories use immutable content-revision
URLs, resolved through stores in the Worker and a same-origin fetch in the
preview. Remote-origin URLs are rejected. See the authoring reference's
[Languages and theories][languages] section for sharing and extensions.

### Attributes

- `id`: required stable exercise ID.
- `system`: required theory-block name or built-in system ID.
  Unknown names produce `unknown_system`.
- `title`, `points`, `exam`, `feedback`: common exercise settings.
- `options`: space-separated `auto` and `complete` flags, both off by
  default. Parsed and stored, but the editor's proof-search and completion
  assistance they are reserved for is not wired up yet.
- `allow-sorry`: boolean. A line admitted with `sorry!` is shown as a
  warning rather than an error, and the proof may be checked around it; it
  still never scores. See the [authoring reference][authoring] for the
  full rule.
- `playground`: boolean. The body has no `theorem` line; the goal is the
  last proof line's `$ … $`, read once in the theory's language (engine
  mode) to find the `@vars` tokens to bind. The widget shows it as "Proves",
  the answer carries it as `goal`, and the worker verifies the certificate
  against the theory plus the `theorem playground …` declaration it rebuilds
  from that goal. See `exercise-kit/proof/playground.ts`.

On `aufbau-mm0`, `name` is required, `src` is optional, and `show` displays a
collapsed source panel. The top-level compiler handles this block separately
from exercise forms.

Linear proof lines use engine syntax, including axiom identifiers. Unlike
the structured proof editors, this editor does not convert student notation
or rule aliases before compilation. See `docs/proof.md` in
[the Aufbau repository](https://github.com/gleachkr/Aufbau) for proof lines,
rule applications, named bindings, and engine declarations.

## Answer data

The widget submits:

```jsonc
{
  "proofText": "thm_k\n----\nl1: $ a -> b -> a $ by ax_1 []",
  "mmb": "<base64 MMB certificate>"
}
```

`proofText` supports display and review; `mmb` is the verified input. The
stored submission omits `mmb`. A playground answer also carries
`goal: { binders, statement }`, which is kept: it is what the recorded
verdict is about, and what the review names as the goal.

## Implementation

- `types.ts`: constants, public/answer shapes, and guards.
- `authoring.ts`: the `:::aufbau-proof` directive compiler. The theory
  block, system resolution and the goal header are the kit's
  (`src/worker/exercise-kit/systems/theory.ts`,
  `src/worker/exercise-kit/proof/authoring.ts`);
  `application/content/mm0.ts` compiles a hosted theory revision (the `mm0`
  content format) and lends the block its library diagnostics.
- `src/worker/exercise-kit/proof/certificate.ts`: certificate decoding.
- `src/worker/exercise-kit/proof/verifier.ts`: `@aufbau/verifier` integration.
- `assessment.ts`: normalization, evaluation, and review.
- `read-only-view.ts`: inert markup and review rendering.
- `src/client/components/carnap-aufbau-proof-v1.ts`: editor element.
- `src/client/proof-compiler.ts`: shared browser compiler loader.

Paths beginning with `src/` are relative to the repository root.
`web/assignment-detail.tsx` builds active submission forms. The editor preview
uses the same compiler and rendering code.

Relevant tests include `tests/aufbau-proof.test.ts` and
`tests/aufbau-proof-verify.test.ts`.

## Limitations

- Search and completion controls remain unimplemented.
- The source panel shows MM0 rather than an engine-rendered rule reference.
- Proof exercises are independent; a later exercise cannot cite an earlier
  exercise's proof as a lemma.

[authoring]: ../../../../docs/carnap-markdown-v1.md
[languages]: ../../../../docs/carnap-markdown-v1.md#languages-and-theories
