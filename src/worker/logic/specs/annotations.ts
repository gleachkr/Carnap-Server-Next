/**
 * The engine annotations a Carnap reader needs from a theory, read once.
 *
 * `@aufbau/syntax` reads `@syntax` and keeps every other `--|` line as a
 * foreign annotation, unread: the engine's own (`@acui`, `@relation`) mean
 * something to the compiler, and Carnap reads two of them to know what the
 * engine will compute. This module is the one place their words are split.
 *
 * DOM-free and free of i18n.
 */

import type { SurfaceLanguage } from "@aufbau/syntax";

/**
 * A term's `@acui assoc comm unit idem`: the laws the engine matches the
 * term modulo. Each of `assoc`, `comm` and `idem` names the axiom stating
 * it and `unit` names the unit term; each is null where the annotation
 * writes `_`.
 */
export interface Acui {
  /** The annotated term: `ctx_join`. */
  readonly term: string;
  /** The sort it builds. */
  readonly sort: string;
  readonly assoc: string | null;
  readonly comm: string | null;
  readonly unit: string | null;
  readonly idem: string | null;
}

/**
 * A sort's `@relation <sort> <term> <refl> <trans> <sym> <mp>`: the
 * equivalence the engine reasons modulo.
 */
export interface SortRelation {
  /** The relation's term: `ctx_eq`, `⟚`'s `jeq`. */
  readonly term: string;
  readonly refl: string;
  /** Its modus ponens, where it names one (`_` where not). */
  readonly mp: string | null;
}

/** An annotation's words, split as the engine splits them. */
function words(text: string): string[] {
  return text.trim().split(/\s+/u);
}

/** A word, or null where it is `_` or missing. */
function named(word: string | undefined): string | null {
  return word === undefined || word === "_" ? null : word;
}

const acuiCache = new WeakMap<SurfaceLanguage, ReadonlyMap<string, Acui>>();

/** Every term's `@acui`, by the annotated term. */
export function acuiOf(language: SurfaceLanguage): ReadonlyMap<string, Acui> {
  let found = acuiCache.get(language);

  if (found === undefined) {
    const map = new Map<string, Acui>();

    for (const info of language.spec.terms.values()) {
      for (const annotation of info.foreignAnnotations) {
        const [head, assoc, comm, unit, idem] = words(annotation.text);

        if (head === "@acui" && !map.has(info.name)) {
          map.set(info.name, {
            assoc: named(assoc),
            comm: named(comm),
            idem: named(idem),
            sort: info.returnSort,
            term: info.name,
            unit: named(unit),
          });
        }
      }
    }

    found = map;
    acuiCache.set(language, found);
  }

  return found;
}

const relationCache = new WeakMap<
  SurfaceLanguage,
  ReadonlyMap<string, SortRelation>
>();

/** Every sort's `@relation`, by sort; the first where a sort has two. */
export function relationsOf(
  language: SurfaceLanguage,
): ReadonlyMap<string, SortRelation> {
  let found = relationCache.get(language);

  if (found === undefined) {
    const map = new Map<string, SortRelation>();

    for (const info of language.spec.rules.values()) {
      for (const annotation of info.foreignAnnotations) {
        const [head, sort, term, refl, , , mp] = words(annotation.text);

        if (
          head === "@relation" &&
          sort !== undefined &&
          term !== undefined &&
          refl !== undefined &&
          !map.has(sort)
        ) {
          map.set(sort, { mp: named(mp), refl, term });
        }
      }
    }

    found = map;
    relationCache.set(language, found);
  }

  return found;
}
