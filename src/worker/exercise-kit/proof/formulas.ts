/**
 * Reading a proof's formulas as *surface* text.
 *
 * A proof widget emits `.auf`, and the Aufbau compiler's math parser reads
 * engine text: every token whitespace-separated, every compound operand
 * parenthesized, one canonical spelling per constructor. Left to itself that
 * is what the student has to type — `∀ x (F(x) → G(x))` with the space after
 * the quantifier, no `Ax`, no `~`, no `/\` — while a model or translation
 * exercise set from the very same artifact takes the tight textbook form. The
 * two disagreed about the *layer* long after #241 stopped them disagreeing
 * about the language.
 *
 * This module closes that: parse what the student wrote against the theory's
 * own spec, print the result back in engine mode, and hand *that* to the
 * translator. Two things fall out beyond the notation. A formula that will not
 * read is caught here, with a caret at the character that broke it, instead of
 * arriving as a compiler unification failure about a line the student cannot
 * connect to what they typed. And the spec's lints — forallx's bracket
 * discipline, its refusal of open sentences — start applying to proofs, having
 * previously applied only to the exercise types that parse.
 *
 * **One condition: the theory must name a sort to read this shape at.** For a
 * Fitch or Prawitz line that is the sort carrying `@syntax role sentence`; for
 * a tree node it is the sort the turnstile yields, falling back to the sentence
 * sort. A file naming neither — `gentzen-lk`, which declares no `@syntax` at
 * all — reads as it always did.
 *
 * Note what that condition is *not* (#274). `gentzen-lk` parses as a spec, and
 * the `SurfaceLanguage` built from it reads that file's own formulas quite
 * happily, off the ordinary MM0 notations it declares. It is a language; it
 * simply never says which sort a student's line is in, and nothing here will
 * guess one. The gate is on the sort, asked where the sort is needed.
 *
 * There used to be a second condition, and getting rid of it is what #253 was
 * (see {@link goalBinderScope}). A goal that binds metavariables —
 * `theorem mp (a b: wff): $ (a → b) ; a ⊢ b $`, which is how a textbook states
 * a rule, and how 12 of the 19 forallx rule cases are written — shadows the
 * theory's own lexicon for the length of that theorem. A parse that does not
 * know the binders reads them as the lexicon's letters instead, and does it
 * *quietly*: `P` becomes the predicate letter `P (snil)`, and no proof of that
 * goal can close. #250 dealt with this by refusing to read such a goal at all;
 * the scope deals with it by telling the parser what the engine already knows,
 * which reads those 12 rather than declining them.
 *
 * DOM-free and catalog-free: the client editor compiles the `.auf` it submits,
 * so the browser runs this too, and its complaints travel as unfilled English
 * templates plus values (see `logic/specs/diagnostics.ts`) for the widget's
 * string map to word.
 */

import type {
  AssertStatement,
  Diagnostic,
  MathString,
  Scope,
  Statement,
  Term,
} from "@aufbau/syntax";
import {
  parseSpec,
  printTerm,
  SurfaceLanguage,
  stripSyntaxAnnotations,
  surfaceVocabulary,
  walkTerm,
} from "@aufbau/syntax";
import type { SpecFormulaError } from "../../logic/specs/diagnostics";
import { formulaParseErrors } from "../../logic/specs/diagnostics";
import { roleIndex, sentenceSort } from "../../logic/specs/roles";

/**
 * What a proof's formulas *are*, which differs by input modality.
 *
 * Fitch and Prawitz lines carry a bare formula and the translator builds the
 * sequent around it, so they read at the sentence sort. A tree node states its
 * whole sequent — `flattenProofTree` copies the text through untouched — so it
 * reads at the sort the turnstile yields.
 */
export type ProofFormulaShape = "sentence" | "sequent";

/**
 * One variable a reading met: a token from the sort's `@vars` pool, or a goal
 * binder shadowing one. What a playground exercise (`playground.ts`) binds in
 * the theorem it derives from the proof, since a statement's variables need
 * declaring where a proof line's are bound for it.
 */
export interface ProofVariable {
  readonly name: string;
  readonly sort: string;
}

/**
 * Surface text read to engine text. `variables` is every variable the term
 * holds, deduplicated in first-occurrence order — and absent from a reading
 * that never parsed, which is {@link ENGINE_TEXT}'s: text passed through
 * holds whatever variables it holds, and nothing here has looked.
 */
export type ProofFormulaReading =
  | {
      readonly ok: true;
      readonly text: string;
      readonly variables?: readonly ProofVariable[];
    }
  | { readonly ok: false; readonly errors: readonly SpecFormulaError[] };

/** Surface text in, engine text out. */
export type ProofFormulaReader = (text: string) => ProofFormulaReading;

/**
 * Reading a ~30 KB artifact into notation tables is not something to do twice
 * for the same text, so it is done once and kept.
 *
 * The key is the joined text, which carries the *goal declaration* appended to
 * the theory — so two exercises over one theory do not in fact share an entry,
 * and a page setting several from the same artifact parses it once each. That
 * is the price of the goal being part of the text rather than beside it, which
 * is also what {@link goalBinderScope} reads it back out of. The document's
 * systems table shares the theory itself (see `../systems/join.ts`); what is
 * not shared is the parse. Worth revisiting if a lesson ever gets big enough
 * for it to show; nothing measured says it does.
 */
const languages = new Map<string, ProofLanguage | null>();

/** A theory read as a language, and the sort it calls a sentence if it says. */
interface ProofLanguage {
  readonly language: SurfaceLanguage;
  /** `undefined` where the spec carries no `@syntax role sentence`. */
  readonly sentence: string | undefined;
}

/**
 * The theory read as a language, or `null` where the text will not read at all.
 *
 * Every MM0 file that parses is a language here. `new SurfaceLanguage(spec)`
 * asks for no `@syntax`, and one built from a file that declares none still
 * reads that file's own notations — `gentzen-lk`'s `infixl seq: $==>$` is a
 * notation like any other. What such a file lacks is a lexicon, delimiters and
 * roles, and among the roles the one that says which sort a student's formula
 * is in. That question is asked at the point of use ({@link sortFor}) and not
 * here, because it is a different question and its answer differs by shape.
 *
 * So `null` means one of two things, neither of them "not a language": the text
 * does not read as a spec, or the caller had no source to offer (a pre-#250
 * artifact, which froze only the stripped engine text).
 */
function proofLanguage(source: string): ProofLanguage | null {
  const cached = languages.get(source);

  if (cached !== undefined) {
    return cached;
  }

  let read: ProofLanguage | null = null;

  try {
    const { spec, diagnostics } = parseSpec(source);

    if (!diagnostics.some((one) => one.severity === "error")) {
      const language = new SurfaceLanguage(spec);
      read = { language, sentence: sentenceSort(language) };
    }
  } catch {
    read = null;
  }

  languages.set(source, read);

  return read;
}

/**
 * The sort a shape reads at, or `undefined` where the theory names none — the
 * whole of the condition on reading a formula rather than passing it through.
 *
 * A `sequent` falls back to the sentence sort when the theory declares no
 * turnstile: a tree over a theory whose nodes are bare formulas is a coherent
 * thing to build, and it is the sentence sort that such a node holds. The
 * preference runs the other way too, and that is the shape's whole point: a
 * theory naming a turnstile but no sentence has tree nodes that read and Fitch
 * lines that do not, which is exactly what it has said about itself.
 */
function sortFor(
  read: ProofLanguage,
  shape: ProofFormulaShape,
): string | undefined {
  if (shape === "sentence") {
    return read.sentence;
  }

  const turnstile = roleIndex(read.language).termFor("turnstile");
  const yielded =
    turnstile === null
      ? undefined
      : read.language.spec.terms.get(turnstile)?.returnSort;

  return yielded ?? read.sentence;
}

/** Passes text through untouched — the reader for a proof that stays engine text. */
export const ENGINE_TEXT: ProofFormulaReader = (text) => ({ ok: true, text });

/**
 * The reader for a proof exercise's frozen theory text, or {@link ENGINE_TEXT}
 * when that text names no sort to read this shape at.
 *
 * `source` is the artifact as *written* — `@syntax` annotations intact, since
 * they are what carries the lexicon, the delimiters and the elab rules. The
 * engine input is derived from it by stripping (see {@link proofTheoryText});
 * a caller holding only the stripped text holds no language, and passes
 * `null`.
 *
 * `goalName` names the theorem the lines belong to, whose binders they are
 * read in the scope of (see {@link goalBinderScope}). It is required rather
 * than optional because forgetting it is not a failure anyone would notice:
 * the parse still succeeds, against the wrong vocabulary.
 */
export function proofFormulaReader(
  source: string | null | undefined,
  shape: ProofFormulaShape,
  goalName: string,
): ProofFormulaReader {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const sort = read === null ? undefined : sortFor(read, shape);

  if (read === null || sort === undefined) {
    return ENGINE_TEXT;
  }

  const { language } = read;
  const scope = goalBinderScope(source, goalName);

  return (text) => {
    const result = language.parse(text, { scope, sort });

    if (!result.ok) {
      return { errors: formulaParseErrors(result.diagnostics), ok: false };
    }

    return {
      ok: true,
      text: printTerm(language, result.term, "engine"),
      variables: termVariables(result.term),
    };
  };
}

/** The variables a term holds, deduplicated in first-occurrence order. */
function termVariables(term: Term): readonly ProofVariable[] {
  const seen = new Map<string, ProofVariable>();

  walkTerm(term, (node) => {
    if (node.kind === "variable" && !seen.has(node.name)) {
      seen.set(node.name, { name: node.name, sort: node.sort });
    }
  });

  return [...seen.values()];
}

/**
 * The sort a whole *statement* — a proof line's `$ … $`, context and all —
 * reads at: the sequent shape's sort, or, for a theory that names no role at
 * all, the one sort it marks `provable`. `undefined` where even that is
 * ambiguous.
 *
 * Reaching past the roles is deliberate and narrow. A theory that declares no
 * `@syntax` — `gentzen-lk` — has lines nothing reads (#274), and a playground
 * over it still has to learn which of a statement's tokens are variables so
 * as to bind them; a file with exactly one provable sort has said which sort
 * its statements are in, in MM0's own terms, and asking it that much is
 * asking nothing it has not answered.
 */
function statementSort(read: ProofLanguage): string | undefined {
  const bySequent = sortFor(read, "sequent");

  if (bySequent !== undefined) {
    return bySequent;
  }

  const provable = [...read.language.spec.sorts.values()].filter((sort) =>
    sort.modifiers.includes("provable"),
  );

  return provable.length === 1 ? provable[0]?.name : undefined;
}

/**
 * The union of several formulas' variables, first occurrence first, or `null`
 * if any formula's are unknown — one unread formula is enough to make the
 * whole statement's set unknowable. What a translator hands the playground
 * for a line built from several formulas (a context and a conclusion).
 */
export function unionVariables(
  perFormula: readonly (readonly ProofVariable[] | null)[],
): readonly ProofVariable[] | null {
  const seen = new Map<string, ProofVariable>();

  for (const variables of perFormula) {
    if (variables === null) {
      return null;
    }
    for (const variable of variables) {
      if (!seen.has(variable.name)) {
        seen.set(variable.name, variable);
      }
    }
  }

  return [...seen.values()];
}

/**
 * The theory's `@vars` pools, sort to tokens — the whole of what a playground
 * goal may bind — or `null` where the text will not read as a spec.
 */
export function theoryVarsPools(
  source: string | null | undefined,
): ReadonlyMap<string, ReadonlySet<string>> | null {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);

  if (read === null) {
    return null;
  }

  const pools = new Map<string, ReadonlySet<string>>();

  for (const sort of read.language.spec.sorts.values()) {
    pools.set(sort.name, new Set(sort.vars));
  }

  return pools;
}

/**
 * The variables a statement in *engine text* holds, or `null` where the
 * theory cannot say.
 *
 * The fallback for a statement nobody read on the way in: a theory whose
 * lines pass through as engine text ({@link ENGINE_TEXT}) hands the
 * playground a last line it knows nothing about, and this reads that line
 * once, at the statement's sort, with no goal in scope — so the only
 * variables it can find are the `@vars` tokens, which is exactly the set a
 * playground may bind. Read without the lints, since engine text is fully
 * parenthesized by construction.
 *
 * Read in the library's *engine* mode — under the theory's own delimiters,
 * the counterpart of `printTerm`'s engine mode — since that is the text this
 * is handed: the surface delimiters would split what the engine keeps whole
 * (Magnus's `P (snil)` into four names). Not the primary route even so: a
 * statement that *was* read is answered from the reading that produced it,
 * and this is asked only where there was none.
 */
export function statementVariables(
  source: string | null | undefined,
  statement: string,
): readonly ProofVariable[] | null {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const sort = read === null ? undefined : statementSort(read);

  if (read === null || sort === undefined) {
    return null;
  }

  const result = read.language.parse(statement, {
    lints: false,
    mode: "engine",
    scope: new Map(),
    sort,
  });

  return result.ok ? termVariables(result.term) : null;
}

/**
 * A statement in engine text, shown the way the theory's language would
 * write it — or `null` where the language cannot read it back.
 *
 * What a playground shows above the proof and what its review names as the
 * goal. The statement is engine text, so it is read in engine mode, at its
 * sort, with `binders` in scope (a goal's own binders are what make its
 * variables legible), and printed in display mode: the textbook's spellings,
 * `¬P` for `(¬ (P (snil)))`. A sequent is
 * split at its turnstile and its context at its join, so the pieces get the
 * spacing a reader expects around `⊢` and `,` — the printer sets a
 * judgement tight, having no convention for one — and the empty context is
 * shown as nothing rather than as `_`.
 *
 * Only where the theory names a sort to read the shape at ({@link sortFor}):
 * a theory with no roles has no display conventions either, and its
 * statement — engine text the student typed — is better shown as typed
 * than re-set by a printer with nothing to go on.
 */
export function statementDisplayText(
  source: string | null | undefined,
  statement: string,
  binders: readonly ProofVariable[],
): string | null {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const sort = read === null ? undefined : sortFor(read, "sequent");

  if (read === null || sort === undefined) {
    return null;
  }

  const { language } = read;
  const result = language.parse(statement, {
    lints: false,
    mode: "engine",
    scope: new Map(binders.map((binder) => [binder.name, binder.sort])),
    sort,
  });

  if (!result.ok) {
    return null;
  }

  const index = roleIndex(language);
  const turnstile = index.termFor("turnstile");
  const join = index.termFor("context-join");
  const term = result.term;

  if (
    turnstile === null ||
    term.kind !== "app" ||
    term.term !== turnstile ||
    term.args.length !== 2
  ) {
    return printTerm(language, term, "display");
  }

  const [context, conclusion] = term.args as readonly [Term, Term];
  const formulas: string[] = [];
  const collect = (node: Term): void => {
    if (node.kind === "app" && node.term === join) {
      for (const arg of node.args) {
        collect(arg);
      }
      return;
    }

    // A nullary constructor at the context's own sort is the empty context.
    if (node.kind === "app" && node.args.length === 0) {
      return;
    }

    formulas.push(printTerm(language, node, "display"));
  };

  collect(context);

  const contextText = formulas.join(
    `${index.spellingFor("context-join") ?? ","} `,
  );
  const turnstileText = index.spellingFor("turnstile") ?? "⊢";
  const conclusionText = printTerm(language, conclusion, "display");

  return contextText.length === 0
    ? `${turnstileText} ${conclusionText}`
    : `${contextText} ${turnstileText} ${conclusionText}`;
}

/**
 * Maps a cited rule name to the one the engine declares. An alias resolves to
 * its rule; anything else stands, so a name the theory never mentions reaches
 * the engine spelled as the student wrote it, to be refused there.
 */
export type ProofRuleReader = (cited: string) => string;

/** Passes every rule name through — the reader where no theory says otherwise. */
export const ENGINE_RULE: ProofRuleReader = (cited) => cited;

/**
 * The rule reader for a proof exercise's frozen theory text: what its
 * `@syntax alias` lines say a proof may cite each rule as. MM0 identifiers are
 * ASCII, so a textbook's `∧I` is never an axiom's own name; the alias is the
 * surface name for the rule, and it is resolved here, once, at the seam where
 * a translator writes `by <rule>` — nowhere else needs to know an alias
 * exists. {@link ENGINE_RULE} where there is no source or it will not read.
 */
export function proofRuleReader(
  source: string | null | undefined,
): ProofRuleReader {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);

  if (read === null) {
    return ENGINE_RULE;
  }

  const aliases = read.language.spec.ruleAliases;

  return (cited) => aliases.get(cited) ?? cited;
}

/**
 * Every spelling the theory gives `rule`: the name it resolves to and each
 * alias of that name, the given spelling among them. What a reader that has
 * the theory's text no longer at hand — the review page's read-only widget —
 * needs in order to recognize the assumption rule however a proof cited it.
 */
export function proofRuleSpellings(
  source: string | null | undefined,
  rule: string,
): readonly string[] {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const spec = read?.language.spec;
  const name = spec?.ruleAliases.get(rule) ?? rule;
  const aliases = spec?.rules.get(name)?.aliases ?? [];

  return [...new Set([rule, name, ...aliases])];
}

/**
 * The two texts a proof exercise's `publicData` can hold, resolved.
 *
 * `source` is the artifact as written and as `/theories/…` serves it; `mm0` is
 * what a certificate is verified against, and the engine rejects an annotation
 * that is not its own. They differ by the `@syntax` lines and nothing else, so
 * only `source` is frozen and the engine text comes back out by stripping —
 * `stripSyntaxAnnotations` drops whole lines, which is what lets the goal
 * declaration be appended to either one and give the same answer. Freezing
 * both would put a second copy of a 30 KB artifact in the page for every
 * exercise set from it.
 *
 * Where both arrive, `mm0` wins, and that is the join's doing rather than a
 * frozen duplicate: `withSystemText` builds it with the goal declaration in
 * engine text (`goalEngineDecl`) while `source` keeps the declaration as
 * written, and stripping the one would not give the other. A `source` alone
 * is an artifact frozen before the table, whose declaration was engine text
 * to begin with.
 *
 * A `source` of `null` is the honest state of an artifact compiled before
 * `source` existed, which froze the stripped text and nothing else; there is
 * no language to read it in and it goes on as engine text. Every artifact
 * since carries a source, whatever its theory does or does not declare.
 */
export function proofTheoryText(data: {
  readonly mm0?: string;
  readonly source?: string;
}): { readonly mm0: string; readonly source: string | null } {
  if (data.source !== undefined) {
    return {
      mm0: data.mm0 ?? stripSyntaxAnnotations(data.source),
      source: data.source,
    };
  }

  return { mm0: data.mm0 ?? "", source: null };
}

/** A node whose formula would not read, named by the node that carries it. */
export interface NodeFormulaProblem {
  readonly error: SpecFormulaError;
  /** The text that would not read, for a caller with no node to look it up in. */
  readonly formula: string;
  readonly nodeId: string;
}

/**
 * Read every formula in a proof *tree*, giving back the same tree in engine
 * text.
 *
 * The two tree-shaped types translate from a structure rather than from text,
 * so unlike the Fitch translator they can be handed an already-read tree —
 * and want to be. The Prawitz translator decides which assumption leaves a
 * discharge mark answers to by comparing their formulas as *strings*, so
 * reading first is what makes `~P` and `¬P` under one mark the same
 * assumption rather than a `discharge_formula_mismatch`.
 *
 * `shouldRead` skips nodes that carry no formula worth reading: a tree leaf
 * standing for the goal's n-th hypothesis has a `hyp` and contributes `#n`,
 * and whatever text it happens to hold never reaches the `.auf`.
 */
export function readNodeFormulas<
  Node extends {
    readonly formula: string;
    readonly id: string;
    readonly premises: readonly Node[];
  },
>(
  root: Node,
  readFormula: ProofFormulaReader,
  shouldRead: (node: Node) => boolean = () => true,
): {
  readonly problems: readonly NodeFormulaProblem[];
  readonly root: Node;
  /** The variables each read node's formula holds, by node id; `null` where
   *  nothing read it. What a playground's statement is bound from. */
  readonly variables: ReadonlyMap<string, readonly ProofVariable[] | null>;
} {
  const problems: NodeFormulaProblem[] = [];
  const variables = new Map<string, readonly ProofVariable[] | null>();

  const visit = (node: Node): Node => {
    const reading = shouldRead(node)
      ? readFormula(node.formula)
      : ({ ok: true, text: node.formula } as const);

    variables.set(node.id, reading.ok ? (reading.variables ?? null) : null);

    if (!reading.ok) {
      for (const error of reading.errors) {
        problems.push({ error, formula: node.formula, nodeId: node.id });
      }
    }

    // Spreading a generic and replacing two of its fields widens the result
    // past `Node` as far as `tsc` can tell. Every other field is carried
    // through untouched and both replacements have the field's own type.
    return {
      ...node,
      formula: reading.ok ? reading.text : node.formula,
      premises: node.premises.map(visit),
    } as Node;
  };

  const read = visit(root);

  return { problems, root: read, variables };
}

/**
 * The theory as a language object, for machinery that reads the theory's *own
 * statements* rather than a student's formulas — the Fitch citation-shape
 * classifier walks the rule signatures this way. Shares the
 * {@link proofLanguage} cache, so a widget already reading lines from the same
 * source pays for no second parse. `null` only where there is no text or it
 * will not read as a spec: a theory that names no sentence sort still declares
 * the rules this walks, and refusing it here would be answering a question
 * nobody asked.
 */
export function theoryLanguage(
  source: string | null | undefined,
): SurfaceLanguage | null {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);

  return read === null ? null : read.language;
}

/**
 * The theory with one exercise's goal declaration appended — what the compiler
 * itself needs, having the theory and the declaration in hand and no table yet
 * to join against.
 *
 * A join and nothing else, deliberately: every reader in this module takes the
 * text and asks the spec what it can do with it, so an author's diagnostic and
 * the student's squiggle come from one text rather than from two decisions
 * that could disagree. It builds the same text `systemText` in
 * `../systems/join.ts` builds at the join — the same source, the same
 * newline, the same declaration — since that is what the widget is handed
 * later, and the caches here are keyed on it.
 */
export function theoryLanguageSource(
  theory: { readonly source: string },
  theoremDecl: string,
): string {
  // No declaration, no newline: a playground exercise appends its goal only
  // once the proof has one, and until then the text is the theory's alone —
  // the same bytes the join hands the widget, so the caches key alike.
  return theoremDecl.length === 0
    ? theory.source
    : `${theory.source}\n${theoremDecl}`;
}

/**
 * Whether a `publicData` carries a theory at all, in either of its two shapes.
 *
 * The three widgets each keep a loose structural guard over the payload they
 * hydrate from, and each has to ask this question; asking it in three places is
 * how the tree and Prawitz widgets came to go on demanding `mm0` after the
 * compiler had started freezing `source` instead, which left every concrete
 * forallx exercise unhydrated with the inert server view standing in silence
 * and nothing anywhere saying why. One predicate, so a third shape — if there
 * ever is one — cannot reach two of them and miss the third.
 */
export function hasTheoryText(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as { readonly mm0?: unknown; readonly source?: unknown };

  return typeof data.mm0 === "string" || typeof data.source === "string";
}

/** What a binder displaced, which decides how the warning is worded. */
export type BinderShadowKind = "notation" | "term" | "variable";

/** One goal binder that means something else in the theory's own language. */
export interface BinderShadow {
  /** For `variable`, the sort the name had before the goal bound it. */
  readonly displacedSort?: string;
  readonly kind: BinderShadowKind;
  readonly name: string;
  /** The binder's own sort. */
  readonly sort: string;
}

/**
 * The goal's binders that displace a meaning the theory's language already
 * gave their name — what an author is warned about, and nothing more.
 *
 * A binder whose name is *not* spelled by the language displaces nothing and
 * is not reported. Neither is one that reads, unscoped, to a variable of the
 * binder's own sort: `theorem unimp {x: var}` over an `s`–`z` pool binds `x`
 * to exactly what `x` already meant, and every first-order goal must bind the
 * variables it quantifies over, so warning there would report something no
 * author can avoid. Shadowing means a *different* meaning was pushed aside.
 *
 * At most one per binder, and a `notation` collision outranks a lexicon one:
 * both are worth knowing, but a name that is also a notation or an elab
 * literal takes that spelling away for the length of the exercise, which is
 * the surprising half and the half that makes a line stop parsing.
 */
export function goalBinderShadows(
  source: string | null | undefined,
  goalName: string,
): readonly BinderShadow[] {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);

  if (read === null) {
    return [];
  }

  const { spec } = read.language;
  const vocabulary = surfaceVocabulary(spec);
  const spellings = new Set(vocabulary.tokens);

  for (const rule of spec.elabRules) {
    for (const element of rule.pattern) {
      if (element.kind === "literal") {
        spellings.add(element.token);
      }
    }
  }

  const shadows: BinderShadow[] = [];

  for (const [name, sort] of goalBinderScope(source, goalName)) {
    if (spellings.has(name)) {
      shadows.push({ kind: "notation", name, sort });
      continue;
    }

    const existing = vocabulary.names.get(name);

    if (existing === undefined) {
      continue;
    }

    if (existing.kind === "term") {
      shadows.push({ kind: "term", name, sort });
      continue;
    }

    if (existing.sort !== sort) {
      shadows.push({
        displacedSort: existing.sort,
        kind: "variable",
        name,
        sort,
      });
    }
  }

  return shadows;
}

/**
 * The goal theorem's binders, name to sort — the scope its proof's lines are
 * read in.
 *
 * A theorem's binders shadow the file's declarations for the length of that
 * theorem, in the engine's math parser and so in the student's line too. The
 * binder list is not re-parsed here: `source` is the theory *with the goal
 * declaration appended*, so the spec reader has already read it, and reading
 * the statement it produced is both cheaper and more honest than a regular
 * expression over the same text — it splits `(a b: wff)` into two binders,
 * takes the head of a dependent sort (`(ph: wff x)`), strips a dummy's dot
 * (`{.y: var}`), and leaves a hypothesis binder (`(h: $ … $)`, which carries a
 * formula rather than a type, and introduces no vocabulary) alone.
 *
 * The *last* declaration of the name wins, which is the one appended.
 */
export function goalBinderScope(
  source: string | null | undefined,
  goalName: string,
): Scope {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const goal =
    read === null ? null : findGoal(read.language.spec.statements, goalName);

  return goal === null ? new Map() : binderScope(goal);
}

/** A goal's own binders, name to sort; a hypothesis binder binds no name. */
function binderScope(goal: AssertStatement): Scope {
  const scope = new Map<string, string>();

  for (const binder of goal.binders) {
    if ("sort" in binder.type) {
      scope.set(binder.name, binder.type.sort);
    }
  }

  return scope;
}

/**
 * The last statement declaring `goalName` — last, because the goal declaration
 * is appended to the theory and a name it collides with was declared earlier.
 */
function findGoal(
  statements: readonly Statement[],
  goalName: string,
): AssertStatement | null {
  let goal: AssertStatement | null = null;

  for (const statement of statements) {
    if (
      (statement.kind === "theorem" || statement.kind === "axiom") &&
      statement.name === goalName
    ) {
      goal = statement;
    }
  }

  return goal;
}

/**
 * The goal as a *statement* — what the student was asked to prove — or `null`
 * where the text declares no such goal to read.
 *
 * A goal is stored as an MM0 declaration, and a declaration says more than the
 * question does. `theorem unimp {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ; F(a)
 * ⊢ G(a) $` names the theorem, binds its schematic letters and its bound
 * variable, and wraps the statement in `$ … $` — and none of that is the
 * exercise. The name is the engine's handle on the goal, and is not even the
 * id the student meets in a gradebook; `{x: var}` is what makes `∀ x` legal at
 * all. So what comes back is the `>`-chain alone, which is the tree and
 * Prawitz editors' `goalFormula` for every goal that has no `>` in it.
 *
 * Reading the parsed statement rather than cutting the declaration text at its
 * first `$` is what keeps a hypothesis binder (`(h: $ … $)`) from being taken
 * for the statement. What the theory declares about *reading* does not come
 * into it: splitting a declaration is MM0's own grammar, so a theory naming no
 * sentence sort has a statement to show like any other. The formulas inside
 * stay whatever they were, engine text or surface, and only the bookkeeping
 * around them comes off.
 */
export function goalStatementText(
  source: string | null | undefined,
  goalName: string,
): string | null {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const goal =
    read === null ? null : findGoal(read.language.spec.statements, goalName);

  if (goal === null) {
    return null;
  }

  return [...goal.hypotheses, goal.conclusion]
    .map((part) => ("text" in part ? part.text.trim() : part.sort))
    .join(" > ");
}

/**
 * The goal's hypotheses in citation order — what `#1`, `#2`, … name in a
 * proof over it — as the author wrote them; empty where the text declares no
 * such goal, or the goal has none.
 *
 * The engine numbers hypotheses "in the order they appear in the header":
 * the `(h: $ … $)` binders first, then the `>`-chain, with the conclusion
 * never among them. A binder that names a sort (`{x: var}`, `(a: wff)`)
 * is not a hypothesis and is skipped without taking a number. Read from the
 * parsed declaration for the same reason {@link goalStatementText} is:
 * cutting the text at its dollar signs would take the binders for the
 * statement, or the statement for a binder.
 *
 * The tree editor draws a hypothesis leaf from this list rather than from
 * anything the student typed — the leaf is a citation, and its text is
 * whatever the citation names.
 */
export function goalHypothesisTexts(
  source: string | null | undefined,
  goalName: string,
): readonly string[] {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const goal =
    read === null ? null : findGoal(read.language.spec.statements, goalName);

  if (goal === null) {
    return [];
  }

  const texts: string[] = [];

  for (const binder of goal.binders) {
    if ("text" in binder.type) {
      texts.push(binder.type.text.trim());
    }
  }

  for (const hypothesis of goal.hypotheses) {
    if ("text" in hypothesis) {
      texts.push(hypothesis.text.trim());
    }
  }

  return texts;
}

/** One `$ … $` of a goal declaration that the theory's language refused. */
export interface GoalFormulaProblem {
  readonly error: SpecFormulaError;
  /** The text that would not read, as the author wrote it. */
  readonly formula: string;
}

export type GoalDeclarationReading =
  | { readonly ok: true; readonly declaration: string }
  | { readonly ok: false; readonly problems: readonly GoalFormulaProblem[] };

/**
 * The goal's declaration with every `$ … $` in it read through the theory's
 * language and re-printed in engine text, or `null` where the theory names no
 * sort to read at — the same condition that leaves a proof's *lines* alone.
 *
 * A declaration is MM0, and MM0's own math strings are engine text: `∃x` is
 * one token to the engine, and a Calgary sentence letter `P` is a term
 * wanting its elided argument. (The operator spellings are not the problem:
 * `\/`, `->` and the rest are ordinary MM0 notations, and the engine reads
 * them once no delimiter splits them — which is why the forallx theories keep
 * `/` out of their engine delimiters.) So
 * an author writing the goal the way they write the lines — which is the
 * only way a student ever sees it — got a declaration the engine refused,
 * and the refusal surfaced as the widget's "extra proof block with no
 * matching theorem". Reading the goal the way the lines are read closes both
 * halves of that: the engine is handed what it can parse, and what it cannot
 * is an authoring diagnostic with the parser's own complaint.
 *
 * What is rewritten is the math strings alone — hypothesis binders,
 * `>`-chain hypotheses, the conclusion — spliced back into the declaration's
 * own text, so the name, the binders and the shape of the statement stay the
 * author's. Each reads at the sort a tree node reads at (the turnstile's, or
 * the sentence's where there is none); a goal stated as a bare sentence over
 * a theory that also has a turnstile falls back to the sentence sort, since
 * `⊢ P → P` and `P → P` are both things such a theory can be asked to prove.
 *
 * Read without the lints. Bracket discipline, chain refusal and closed
 * sentences are the conventions a student's *line* is held to, and a goal is
 * not a student's line: `(∀ x F(x)) ∧ G(a)` is not the book's spelling, but it
 * is grammatical, it means what the engine will take it to mean, and it is
 * the author's to show. What is refused is what is not the language at all —
 * an explicit `snil`, or `F a` juxtaposed where the language spells `F(a)` —
 * since a goal the student could not type in any spelling is not a goal to
 * hand them. Fully parenthesized text, engine output included, reads. `aufbau-proof` never calls this, its
 * students typing engine text by definition.
 */
export function goalEngineDeclaration(
  source: string | null | undefined,
  goalName: string,
): GoalDeclarationReading | null {
  const read =
    source === null || source === undefined ? null : proofLanguage(source);
  const goal =
    read === null ? null : findGoal(read.language.spec.statements, goalName);
  const judgement = read === null ? undefined : sortFor(read, "sequent");

  if (
    source === null ||
    source === undefined ||
    read === null ||
    goal === null ||
    judgement === undefined
  ) {
    return null;
  }

  const { language } = read;
  const scope = binderScope(goal);
  const sorts =
    read.sentence === undefined || read.sentence === judgement
      ? [judgement]
      : [judgement, read.sentence];
  const problems: GoalFormulaProblem[] = [];
  let declaration = "";
  let cursor = goal.span.start;

  for (const formula of goalFormulas(goal)) {
    const reading = readAtSorts(language, formula.text, scope, sorts);

    declaration += source.slice(cursor, formula.span.start);

    if (reading.ok) {
      declaration += `$ ${reading.text} $`;
    } else {
      for (const error of reading.errors) {
        problems.push({ error, formula: formula.text.trim() });
      }
      declaration += source.slice(formula.span.start, formula.span.end);
    }

    cursor = formula.span.end;
  }

  declaration += source.slice(cursor, goal.span.end);

  return problems.length > 0
    ? { ok: false, problems }
    : { declaration, ok: true };
}

/** Every math string a goal declaration carries, in source order. */
function goalFormulas(goal: AssertStatement): readonly MathString[] {
  const formulas: MathString[] = [];

  for (const binder of goal.binders) {
    if ("text" in binder.type) {
      formulas.push(binder.type);
    }
  }

  for (const hypothesis of goal.hypotheses) {
    if ("text" in hypothesis) {
      formulas.push(hypothesis);
    }
  }

  formulas.push(goal.conclusion);

  return formulas.sort(
    (first, second) => first.span.start - second.span.start,
  );
}

/**
 * Read `text` at the first of `sorts` it reads at.
 *
 * A refusal that is *only* a sort mismatch means the text read as a term of
 * some other sort, which the next sort may be; anything else is the parser's
 * real complaint. When nothing reads, the complaint reported is the first
 * that was more than a mismatch, and the first attempt's otherwise.
 */
function readAtSorts(
  language: SurfaceLanguage,
  text: string,
  scope: Scope,
  sorts: readonly string[],
): ProofFormulaReading {
  const refusals: (readonly Diagnostic[])[] = [];

  for (const sort of sorts) {
    const result = language.parse(text, { lints: false, scope, sort });

    if (result.ok) {
      return { ok: true, text: printTerm(language, result.term, "engine") };
    }

    refusals.push(result.diagnostics);
  }

  const refusal =
    refusals.find(
      (diagnostics) =>
        !diagnostics.every((one) => one.id === "term_not_sentence"),
    ) ??
    refusals[0] ??
    [];

  return { errors: formulaParseErrors(refusal), ok: false };
}
