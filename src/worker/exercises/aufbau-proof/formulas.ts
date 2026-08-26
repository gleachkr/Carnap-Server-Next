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
 * **One condition: the theory must declare `@syntax role sentence`.** That is
 * a file saying it is also a *language*, which is exactly the question being
 * asked; `gentzen-lk` declares no `@syntax` at all and reads as it always did.
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

import type { AssertStatement, Scope } from "@aufbau/syntax";
import {
  parseSpec,
  printTerm,
  SurfaceLanguage,
  stripSyntaxAnnotations,
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

export type ProofFormulaReading =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly errors: readonly SpecFormulaError[] };

/** Surface text in, engine text out. */
export type ProofFormulaReader = (text: string) => ProofFormulaReading;

/**
 * Reading a ~30 KB artifact into notation tables is not something to do twice
 * for the same text, so it is done once and kept.
 *
 * The key is the frozen text, which carries the *goal declaration* appended to
 * the theory — so two exercises over one theory do not in fact share an entry,
 * and a page setting several from the same artifact parses it once each. That
 * is the price of the goal being part of the text rather than beside it, which
 * is also what {@link goalBinderScope} reads it back out of. Worth revisiting
 * if a lesson ever gets big enough for it to show; nothing measured says it
 * does.
 */
const languages = new Map<string, ProofLanguage | null>();

/** A theory that is also a language, with the sort it reads a sentence at. */
interface ProofLanguage {
  readonly language: SurfaceLanguage;
  readonly sentence: string;
}

/**
 * The theory read as a language, or `null` where it is not one.
 *
 * `null` covers three cases that all mean the same thing downstream: the text
 * does not read as a spec, it reads but declares no sentence sort, or the
 * caller had no source to offer (a pre-#250 artifact, which froze only the
 * stripped engine text). None of them is an error — every one of them is a
 * proof that goes on being written in engine text.
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
      const sentence = sentenceSort(language);
      read = sentence === undefined ? null : { language, sentence };
    }
  } catch {
    read = null;
  }

  languages.set(source, read);

  return read;
}

/**
 * The sort a shape reads at.
 *
 * A `sequent` falls back to the sentence sort when the theory declares no
 * turnstile: a tree over a theory whose nodes are bare formulas is a coherent
 * thing to build, and it is the sentence sort that such a node holds.
 */
function sortFor(read: ProofLanguage, shape: ProofFormulaShape): string {
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
 * when that text is not a language.
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

  if (read === null) {
    return ENGINE_TEXT;
  }

  const { language } = read;
  const sort = sortFor(read, shape);
  const scope = goalBinderScope(source, goalName);

  return (text) => {
    const result = language.parse(text, { scope, sort });

    if (!result.ok) {
      return { errors: formulaParseErrors(result.diagnostics), ok: false };
    }

    return { ok: true, text: printTerm(language, result.term, "engine") };
  };
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
 * A `source` of `null` is the honest state of an artifact whose theory is not
 * a language — and of any artifact compiled before `source` existed, which is
 * why the pass-through path stays. Both go on as engine text.
 */
export function proofTheoryText(data: {
  readonly mm0?: string;
  readonly source?: string;
}): { readonly mm0: string; readonly source: string | null } {
  if (data.source !== undefined) {
    return { mm0: stripSyntaxAnnotations(data.source), source: data.source };
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
): { readonly problems: readonly NodeFormulaProblem[]; readonly root: Node } {
  const problems: NodeFormulaProblem[] = [];

  const visit = (node: Node): Node => {
    const reading = shouldRead(node)
      ? readFormula(node.formula)
      : ({ ok: true, text: node.formula } as const);

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

  return { problems, root: visit(root) };
}

/**
 * Which theory text a proof exercise freezes, and therefore whether its
 * formulas are read as surface text at all.
 *
 * One decision for all three input modalities, made once at authoring time and
 * carried by *which field arrives* rather than by a flag beside it: `source`
 * means "read what the student types in this language", `mm0` means "the
 * student writes engine text", and there is no way to be told one and shown
 * the other. One condition, the module's own: the theory has to be a language.
 *
 * The goal declaration is appended either way, and its binders are what
 * {@link goalBinderScope} later reads back out of `source`.
 */
export function frozenTheoryText(
  theory: { readonly mm0: string; readonly source: string },
  theoremDecl: string,
): { readonly mm0?: string; readonly source?: string } {
  if (proofLanguage(theory.source) === null) {
    return { mm0: `${theory.mm0}\n${theoremDecl}` };
  }

  return { source: `${theory.source}\n${theoremDecl}` };
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
  const scope = new Map<string, string>();

  if (read === null) {
    return scope;
  }

  let goal: AssertStatement | null = null;

  for (const statement of read.language.spec.statements) {
    if (
      (statement.kind === "theorem" || statement.kind === "axiom") &&
      statement.name === goalName
    ) {
      goal = statement;
    }
  }

  for (const binder of goal?.binders ?? []) {
    if ("sort" in binder.type) {
      scope.set(binder.name, binder.type.sort);
    }
  }

  return scope;
}
