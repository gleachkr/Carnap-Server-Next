# exercise-kit

What the exercise types are built from, kept apart from the types themselves.

`src/worker/exercises/<type>/` holds one exercise type per folder — its
directive compiler, assessment, review rendering, shapes and strings — and
exports it as one `ExerciseType` object from its `index.ts`. Anything two
types share, or that the application and the client need without caring which
type is asking, lives here instead. One rule: **a type imports the kit; the
kit never imports a type.** `src/worker/exercises/index.ts` is the one list
of the types; the registry in `application/content/registry.ts` is three
lookups over it, and nothing else enumerates them.

- `systems/` — the logic an exercise is set in. `theory.ts` compiles an
  `:::aufbau-mm0` block, names a shipped theory by id, and defines the
  `SystemResolver` every formula-reading type is handed; `attribute.ts` reads
  a directive's `system=`; `join.ts` is the document's systems table and the
  join that gives each exercise its copy of the text.
- `proof/` — the proof engine's client-and-worker toolkit: surface-formula
  reading (`formulas.ts`), the playground goal (`playground.ts`), the MMB
  certificate and its verifier (`certificate.ts`, `verifier.ts`), the shared
  authoring helpers (`authoring.ts`: theorem header, starters, `options=`,
  playground body), the linear-body tree parser (`tree-parse.ts`, used by the
  tree and Prawitz types), and the engine's diagnostic strings.
- `formula/` — the formula tree the model, translation and (as a mirror)
  truth-table types read: `parseFormula` over a language spec, the tree
  shapes, and the language lookup.
- the root files — the framework every type plugs into: the `ExerciseType`
  contract itself (`type.ts`), the action bar (`actions.ts`), the hydration
  payload (`hydration.ts`), the named group every exercise renders as
  (`group.ts`, `group.css`), the correctness mark, the answer events, the
  help strings, the authoring helpers (`authoring.ts`: the directive block,
  the common attribute parsers, the manifest assembly) the ten per-type
  `authoring.ts` files are built from, the assessment helpers
  (`assessment.ts`) the ten per-type `assessment.ts` objects share, and the
  page stylesheet for that chrome (`exercise.css`, served by
  `web/styles.ts`).

The kit sits on the consuming side of a few `application/content/` leaves —
the Markdown pipeline (`markdown.ts`, which a type's `authoring.ts`
renders its prompt through), the diagnostic envelope (`diagnostics.ts`) and
its string catalog, the declaration hash, the theory-block compiler, and the
render helpers. None of them knows what an exercise is; the directive
machinery that does is here.

Everything here is imported by the client bundles as well as the worker, so
modules stay DOM-free and catalog-free unless their header says otherwise.
