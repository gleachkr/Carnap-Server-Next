/**
 * The systems a document's exercises are set in: what an `:::aufbau-mm0`
 * block declares, what a shipped theory is when named by id, and how an
 * exercise asks for either.
 *
 * Document-level, not per type: the block is compiled by the top-level
 * compiler (`application/content/compiler.ts`), which builds the
 * {@link SystemResolver} every formula-reading exercise type — the four proof
 * types, the model, the translation, the truth table — is handed. Nothing here
 * knows which type is asking.
 */

import { parseSpec, SurfaceLanguage } from "@aufbau/syntax";
import {
  type CompilerDiagnostic,
  diagnostic,
} from "../../application/content/diagnostics";
import { libraryDiagnostic, lineAt } from "../../application/content/mm0";
import { readLanguage } from "../../logic/specs";
import { roleIndex } from "../../logic/specs/roles";
import type { TheoryResolver } from "../../logic/theories";
import {
  BUILT_IN_THEORY_PATHS,
  theoryByPath,
  theorySourceByFileName,
} from "../../logic/theories";
import {
  type DirectiveBlock,
  parseBooleanAttribute,
  requireAttribute,
  validateAttributes,
} from "../authoring";

/**
 * A theory name and the MM0 text an `:::aufbau-mm0` block declares.
 *
 * `source` is the artifact as written and as the route serves it, `@syntax`
 * annotations and all: it is what the `show` panel puts in front of a
 * reader (a file that is also a course's *language* says so in those
 * annotations, and hiding them would show a reader half of it), and it is
 * what the document's systems table freezes. The engine's text — the same
 * with the annotations stripped, since the engine rejects an annotation
 * that is not its own — is made where it is needed, at the read boundary
 * (`join.ts`), not carried here.
 */
export interface AufbauTheory {
  readonly name: string;
  /**
   * What the theory says about itself that a Fitch or Prawitz proof needs in
   * order to write its lines — see {@link DeclaredNotations} — or `null` when
   * the theory could not be read as a spec at all, which the `:::aufbau-mm0`
   * block reports for itself.
   */
  readonly notations: DeclaredNotations | null;
  /** Whether the author asked (`show`) for the source to appear in the lesson. */
  readonly show: boolean;
  readonly source: string;
}

/**
 * The parts of a calculus a proof editor has to know by role, each `null`
 * where the theory does not say: `@syntax role assumption` on the axiom
 * that opens a hypothesis, `role turnstile` and `role context-join` on the
 * constructors of a sequent.
 *
 * These are facts about the calculus, not about any exercise set in it. The
 * proof types write sequents in the theory's own notation and tell an
 * assumption line from a rule line by its axiom; there is exactly one right
 * answer to each per theory, so the theory gives it and no exercise repeats
 * it. A theory that is also a course's language cannot spell a sequent the
 * house way in any case — forallx's comma is the student's argument
 * separator, so its context join is `;` — which is why these were never
 * safe to assume.
 */
export interface DeclaredNotations {
  readonly assumptionRule: string | null;
  readonly contextSymbol: string | null;
  /**
   * Every spelling of the turnstile, `sequentSymbol` first: a starter is
   * recognized in any of them and written back in the canonical one.
   */
  readonly sequentSpellings: readonly string[];
  readonly sequentSymbol: string | null;
}

/**
 * The notations a theory names for itself, or `null` when it cannot be read
 * as a spec.
 *
 * Reading the theory as a *spec* is what makes the roles visible, and an
 * author's extension can make that reading fail in ways that have nothing to
 * do with the question being asked — a name the delimiters split, an
 * annotation we do not know. That failure is the block's own diagnostic
 * ({@link reportUnreadableTheory}), so here it is only `null`, and the proof
 * types stay quiet rather than add three "declares no role" complaints to a
 * theory that declares nothing legible.
 */
function declaredNotations(source: string): DeclaredNotations | null {
  try {
    const index = roleIndex(new SurfaceLanguage(parseSpec(source).spec));

    return {
      assumptionRule: index.ruleFor("assumption"),
      contextSymbol: index.spellingFor("context-join"),
      sequentSpellings: index.spellingsFor("turnstile"),
      sequentSymbol: index.spellingFor("turnstile"),
    };
  } catch {
    return null;
  }
}

/**
 * What `:::aufbau-mm0{…}` accepts. None of the exercise attributes: a theory
 * block declares shared MM0, it is not answered, scored, or fed back.
 */
const AUFBAU_MM0_ATTRIBUTES = ["name", "show", "src"] as const;

/** A `src` that is anything but a path on this site: a scheme, or `//host`. */
const ELSEWHERE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The theory a `src=` names, or null with a diagnostic saying which kind of
 * miss it was — the two are worth telling apart, because one is a typo and the
 * other is a feature that does not exist yet.
 *
 * **Built-ins first, and without asking anyone.** A shipped theory resolves
 * from the module graph rather than by fetching the path it names. The bytes
 * are the same either way (`tests/theories.test.ts` holds the route and this
 * resolver to each other), and answering locally is what lets a theory resolve
 * identically here, in the browser preview, and in tests with no server
 * running. It also means the ordinary lesson never touches `resolve`, whose
 * absence is therefore not a failure — it is what a caller with nothing to
 * offer beyond the built-ins passes.
 *
 * A path this site serves out of the *database* is the second backing:
 * `resolve` is how a caller that can read one answers. The third branch, a URL
 * on somebody else's server, is still refused above.
 */
async function resolveTheorySrc(
  src: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
  resolve: TheoryResolver | undefined,
): Promise<string | null> {
  if (ELSEWHERE.test(src)) {
    diagnostics.push(
      diagnostic(
        line,
        "remote_theory_src",
        "“{path}” is not a path this site serves. A theory kept somewhere else is not supported yet.",
        { params: { path: src } },
      ),
    );

    return null;
  }

  const found = theoryByPath(src) ?? (await resolve?.(src)) ?? null;

  if (found === null) {
    diagnostics.push(
      diagnostic(
        line,
        "unknown_theory_src",
        "No theory is served at “{path}”. This site ships: {available}. A theory of your own is at the address on its revision page.",
        {
          params: {
            available: BUILT_IN_THEORY_PATHS.join(", "),
            path: src,
          },
        },
      ),
    );
  }

  return found;
}

/**
 * Compile an `:::aufbau-mm0` theory block. Not an exercise — the top-level
 * compiler handles it inline (like `:::style`), collecting the theory by name so
 * `:::aufbau-proof` blocks can reference it. Declaring a theory does not put it
 * on the page: MM0 source is machinery, and a lesson that teaches from a
 * textbook's rules rarely wants a slab of it above every exercise. `show` asks
 * for the read-only panel.
 *
 * The block's MM0 is a `src=` naming a theory this site serves, a body written
 * inline, or **both** — in which case the body extends the named theory. That
 * is what a course with its own vocabulary needs: the shipped forallx signature
 * is one binary predicate and two unary ones, and without extension the only
 * way to add `Cube` or `Loves` would be to paste all three hundred lines back
 * into the lesson. Appending is how the goal declaration already composes with
 * a theory further down this file, so nothing new is being invented — the
 * author's lines simply arrive last, and the engine reads the result as one
 * theory.
 *
 * The result is stripped of `@syntax` annotations, because what comes back is
 * engine input and `@syntax` is not the engine's — it rejects an annotation it
 * does not know. A built-in theory carries them when it is also the *language*
 * a course teaches (forallx: Calgary is one file for both), and an author is
 * free to write them in an extension for the same reason; either way they are
 * read by `@aufbau/syntax` from the artifact and never reach the compiler.
 *
 * An extension that adds a *name* has one thing to know, and
 * {@link reportUnreadableTheory} is what tells them: whether `Cube` can be
 * written at all is decided by the delimiters, not by the declaration. Against
 * forallx, whose 52 lexicon letters are all delimiters so that `AxF(x)` reads
 * tight, it cannot be — until the extension declares it whole with its own
 * `--| @syntax delimiter $ Cube $`.
 */
export async function compileAufbauMm0(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
  resolve?: TheoryResolver,
): Promise<AufbauTheory | null> {
  validateAttributes(block, AUFBAU_MM0_ATTRIBUTES, diagnostics);

  const name = requireAttribute(block, "name", diagnostics);
  const show = parseBooleanAttribute(
    block.attrs.show,
    block.line,
    "show",
    diagnostics,
  );

  const src = block.attrs.src;
  const extension = block.bodyLines.join("\n").trim();
  const base =
    src === undefined
      ? null
      : await resolveTheorySrc(src, block.line, diagnostics, resolve);

  if (src === undefined && extension.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "empty_theory",
        "An aufbau-mm0 block needs MM0 source in its body, or a src naming a theory this site serves.",
      ),
    );
  }

  // A `src` that did not resolve is not the same as no `src`: compiling the
  // extension on its own would hand the engine a theory missing everything the
  // author expected to build on, and bury the real diagnostic under whatever it
  // said about the fragment.
  if (name === null || (src !== undefined && base === null)) {
    return null;
  }

  const source =
    base === null
      ? extension
      : extension.length === 0
        ? base
        : `${base}\n${extension}`;

  if (source.length === 0) {
    return null;
  }

  reportUnreadableTheory(block, base, source, diagnostics);

  return {
    name,
    notations: declaredNotations(source),
    show,
    source,
  };
}

/**
 * Report a block whose MM0 will not read as a language, at a line its author
 * can act on.
 *
 * The complaint used to surface one level away: an exercise set in the block
 * said only that the system "does not read as a language", while the library
 * had said which name the delimiters split, and where. Declaring an ordinary
 * `term Cube (sq: seq): wff;` against forallx is the case that costs — its
 * lexicon letters are all delimiters, so `Cube` segments as `C u b e` and no
 * student could ever type it — and the author was told none of that.
 *
 * Reading here is not a second read: the first exercise naming this block does
 * the same one, and `readLanguage` memoizes on the text.
 *
 * **Errors only.** forallx: Calgary warns nine times over about its
 * engine-only tokens (`⊢`, `≐`, …) — correct reports about a file the author
 * did not write, and every block extending it would inherit the noise.
 *
 * The theory is still returned. A block that answered with nothing would send
 * every exercise naming it to `unknown_system`, which lists the systems in
 * scope and would not mention that this one is right here and broken.
 */
function reportUnreadableTheory(
  block: DirectiveBlock,
  base: string | null,
  source: string,
  diagnostics: CompilerDiagnostic[],
): void {
  const read = readLanguage(source);

  if (read.language !== null) {
    return;
  }

  // Where the author's own text starts in the composed source. A `src` is a
  // file they named rather than wrote, so anything wrong inside it is reported
  // at the block itself instead of at a line of theirs that does not exist.
  const bodyStart = base === null ? 0 : base.length + 1;
  const body = block.bodyLines.join("\n");
  const trimmed = body.length - body.trimStart().length;

  for (const one of read.errors) {
    diagnostics.push(
      libraryDiagnostic(
        one.span.start < bodyStart
          ? block.line
          : block.line + lineAt(body, one.span.start - bodyStart + trimmed),
        one,
      ),
    );
  }

  // A file that read as statements and still could not be assembled into a
  // parser: the library threw rather than reporting, so there are no spans and
  // the block's own line is the only honest place to say it.
  if (read.errors.length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "unusable_mm0",
        "This MM0 does not read: {reason}",
        { params: { reason: read.thrown ?? "unknown" } },
      ),
    );
  }
}

/**
 * A shipped theory as a system, by the id an author writes in `system=` — which
 * is the file's stem, and so the tail of the address `src=` takes.
 *
 * The `show` is false because nobody asked: a global is named, not declared, so
 * there is no block for an author to have written `show` on. Reading a theory
 * this way is the same reading `:::aufbau-mm0` gives it, notations and all, so
 * an exercise cannot behave differently for having skipped the block.
 */
export function builtInSystem(id: string): AufbauTheory | null {
  const source = theorySourceByFileName(`${id}.mm0`);

  if (source === null) {
    return null;
  }

  return {
    name: id,
    notations: declaredNotations(source),
    show: false,
    source,
  };
}

/**
 * How an exercise gets the system it names.
 *
 * Two namespaces, in one order: an `:::aufbau-mm0` block this document
 * declares, then an id the server ships. A document-local block wins, which is
 * what lets a course extend forallx and go on calling the result what it likes.
 *
 * The resolver reports its own miss, because only the caller that built it
 * knows *both* namespaces — a diagnostic written here could name the shipped
 * ids and would never mention that a block was looked for, which is exactly the
 * case a typo'd block name lands in. See `application/content/compiler.ts`.
 */
export type SystemResolver = (
  name: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
) => AufbauTheory | null;

/**
 * The system an exercise's `system=` names, with both the missing attribute and
 * the unresolvable name already reported.
 *
 * Shared by all four proof types (and, through the same resolver, by the two
 * semantic ones), so that "which logic am I in" is asked one way everywhere.
 */
export function requireSystem(
  block: DirectiveBlock,
  resolve: SystemResolver,
  diagnostics: CompilerDiagnostic[],
): AufbauTheory | null {
  const name = requireAttribute(block, "system", diagnostics);

  return name === null ? null : resolve(name, block.line, diagnostics);
}
