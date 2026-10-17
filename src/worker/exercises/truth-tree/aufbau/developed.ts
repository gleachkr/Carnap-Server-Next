/**
 * What a branch marked open asks the engine (#469): that each row on it is
 * developed there, by the axioms `./ok.ts` states from the rules.
 *
 * - each row is asked `tree_ok`, once however often it is written;
 * - a general row is asked `tree_okat_<rule>` at each term of its
 *   instance's sort on the branch (at a name new to it, where a `nonempty`
 *   row's branch has none), at one term where its instances are all one
 *   (`∀x Fa`), or, where its rule names side rows, asked
 *   `tree_okwith_<rule>` at each witness Carnap finds on the branch;
 * - a row a rule on a pair of rows sets off (an identity) is asked
 *   `tree_okpair_<statement>` with every other row it pairs with, in one
 *   direction: the answer's, or every candidate, for a compile that asks
 *   which holds; the matcher's bindings go with it as a hint.
 *
 * A question the engine cannot prove is what the branch is missing. The
 * questions are only written here; `./emit.ts` states them as theorems.
 *
 * DOM-free.
 */

import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import type { TableauIndex, TableauNode } from "../../../../tableau/document";
import type { Missing } from "../report";
import { isLiteral, isSelfIdentity } from "./branch";
import type { InstanceSlot, RulePatterns, TreeDevelopment } from "./criteria";
import { instanceShower, matchFocus, witnesses } from "./criteria";
import type { OkAxioms } from "./ok";
import { atWitnesses } from "./ok";
import type { Bindings } from "./patterns";
import {
  closedSubterms,
  conclude,
  instantiate,
  matchAll,
  occursFree,
  termKey,
} from "./patterns";
import type { Member, RowSortReader } from "./rows";
import { branchText, engineTokens } from "./rows";
import type { TreeTheory } from "./theory";

/**
 * The key of a row a rule on a pair of rows sets off, on the branch ending at
 * a leaf: each branch is complete in a direction of its own.
 */
export function pairingKey(leaf: string, row: string): string {
  return `${leaf} ${row}`;
}

/** A {@link pairingKey}'s leaf and row; null for a key that is not one. */
export function pairingOf(
  key: string,
): { readonly leaf: string; readonly row: string } | null {
  const [leaf, row, ...rest] = key.split(" ");
  return leaf === undefined || row === undefined || rest.length > 0
    ? null
    : { leaf, row };
}

/** A question for the engine: that a row is developed on a branch. */
export interface Question {
  /** The theorem's statement. */
  readonly statement: string;
  /** The judgement's chain, which proves it if anything does. */
  readonly by: string;
  /** What the branch is missing if the engine cannot prove it. */
  readonly missing: Missing;
  /**
   * For a pair: the bindings the matcher found, as a proof line gives
   * them, and the row and statement it is asked by.
   */
  readonly pair?: {
    readonly bindings: string;
    readonly key: string;
    readonly statement: string;
  };
}

/** What a branch is asked, and the statements each paired row could be. */
export interface BranchQuestions {
  readonly questions: readonly Question[];
  /**
   * The rows a rule on a pair of rows sets off, by {@link pairingKey}, each
   * with the statements of the rule that could develop it: the directions
   * it could be substituted in, its rule's own first.
   */
  readonly pairings: ReadonlyMap<string, readonly string[]>;
}

export interface QuestionsInput {
  readonly language: SurfaceLanguage;
  readonly theory: TreeTheory;
  readonly development: TreeDevelopment;
  readonly ok: OkAxioms;
  readonly index: TableauIndex;
  readonly reader: RowSortReader;
  /** The steps written down so far, by `dev`: what each cites. */
  readonly steps: ReadonlyMap<string, { readonly cites: readonly string[] }>;
  /**
   * The instance a row was written with, where it is known, so the rows a
   * general row's own steps wrote can be stated last.
   */
  readonly instanceOf: (row: string) => string | null;
  /**
   * The statement each paired row is asked by, by {@link pairingKey}, its
   * rule's own where none is given; `"every"` for every candidate.
   */
  readonly directions: ReadonlyMap<string, string> | "every";
}

/**
 * A name of `sort` a branch does not mention: a token of the first pool that
 * reads at the sort, for a general row that must be developed at some term
 * on a branch with none (`nonempty`). Developed at a new name, it is
 * developed at one, vacuously; otherwise it is not.
 */
function newName(
  language: SurfaceLanguage,
  sort: string,
  mentioned: ReadonlySet<string>,
): string | null {
  for (const info of language.spec.sorts.values()) {
    for (const token of info.vars) {
      if (mentioned.has(token)) {
        continue;
      }

      const read = language.parse(token, {
        lints: false,
        mode: "engine",
        sort,
      });
      const key = read.ok ? termKey(language, read.term) : null;

      if (key === null) {
        break;
      }

      return key;
    }
  }

  return null;
}

/**
 * Whether a general row's instances are all one: its rule's rows, written at
 * the row with any term for the instance, mention none (`∀x Fa`).
 */
function isVacuous(
  language: SurfaceLanguage,
  slot: InstanceSlot,
  bindings: Bindings,
): boolean {
  // A name no row can spell, so it is in a written row only as the instance.
  const probe: Term = {
    binder: false,
    grouped: false,
    kind: "variable",
    name: " instance",
    sort: slot.sort,
    span: { end: 0, start: 0 },
  };
  const at = new Map([...bindings, [slot.binder, probe]]);

  return slot.templates.every(
    (template) => !occursFree(conclude(language, template, at), probe.name),
  );
}

/** Every variable in a term, binding occurrences too. */
function variablesOf(term: Term): Extract<Term, { kind: "variable" }>[] {
  return term.kind === "variable" ? [term] : term.args.flatMap(variablesOf);
}

/**
 * What each branch marked open is asked, for a theory that says when a row
 * is developed.
 */
export function branchQuestions(
  input: QuestionsInput,
): (node: TableauNode, members: readonly Member[]) => BranchQuestions {
  const { development, language, ok, theory } = input;
  const rules = development.rules;
  // The general rules, with the slot and judgement each is asked by: at each
  // term, or at each witness on the branch. A rule whose axioms could not be
  // stated has none (an author's diagnostic, `./ok.ts`), and is not asked.
  const general = rules.flatMap((rule) => {
    const slot = rule.instance;
    const judgement = ok.general.get(rule.name);

    return slot === null || judgement === undefined
      ? []
      : [{ judgement, rule, slot, witnessed: atWitnesses(rule) }];
  });
  const paired = rules.filter((rule) => rule.criterion?.kind === "pairs");

  // The tokens of every sort's pool: a variable the matcher made up is
  // none of them.
  const pooled = new Set(
    [...language.spec.sorts.values()].flatMap((info) => info.vars),
  );
  const branch = (rows: readonly string[]): string =>
    branchText(theory, rows);
  const texts = (members: readonly Member[]): string[] =>
    members.map((member) => member.text);

  /**
   * The bindings that tell the engine how a statement of a rule on a pair of
   * rows matched them, as a proof line writes them: the matcher's, with each
   * variable it made up (the hole of `{x / b} ph`) given a token of its
   * sort's pool that `text` does not mention. Only a hint: the engine proves
   * the theorem from them or not at all.
   */
  const pairBindings = (
    patterns: RulePatterns,
    bindings: Bindings,
    text: string,
  ): string | null => {
    const taken = new Set(engineTokens(text));
    const renames = new Map<string, Term>();

    for (const value of bindings.values()) {
      for (const variable of variablesOf(value)) {
        if (pooled.has(variable.name) || renames.has(variable.name)) {
          continue;
        }

        const token = language.spec.sorts
          .get(variable.sort)
          ?.vars.find((each) => !taken.has(each));

        if (token === undefined) {
          return null;
        }

        taken.add(token);
        renames.set(variable.name, { ...variable, name: token });
      }
    }

    const written = [...bindings]
      .filter(([meta]) => meta !== patterns.branch)
      .map(([meta, value]) => {
        const engine = termKey(language, instantiate(value, renames));
        return engine === null ? null : `${meta} := $ ${engine} $`;
      });

    return written.some((each) => each === null) ? null : written.join(", ");
  };

  // Of each row, that it is developed; of each general row, that it is at
  // each term of its instance's sort on the branch, or for each witness on
  // it; of each paired row, that it is with each row it pairs with.
  return (node: TableauNode, members: readonly Member[]): BranchQuestions => {
    const questions: Question[] = [];
    const pairings = new Map<string, readonly string[]>();
    const ask = (
      statement: string,
      by: string,
      missing: Missing,
      pair?: Question["pair"],
    ): void => {
      questions.push({
        by,
        missing,
        statement,
        ...(pair === undefined ? {} : { pair }),
      });
    };
    const mentioned = new Set(engineTokens(branch(texts(members))));
    // The branch is a multiset, so its members may be stated in any order:
    // the ones a row's own steps wrote go last, where the axiom names them,
    // and the proof need not move them across the rest of the branch, which
    // costs the branch for every question (a 69-row tree's certificate is
    // 226 KB so, 392 KB in the branch's own order). A row developed some
    // other way is found all the same, at that cost.
    const citing = new Map<string, Set<string>>();

    for (const [dev, step] of input.steps) {
      for (const cite of step.cites) {
        citing.set(cite, (citing.get(cite) ?? new Set()).add(dev));
      }
    }

    const rows = input.index.branchRows(node.id).flatMap((row) => {
      const read = input.reader.read(row.text);
      return read.ok
        ? [{ engine: read.engine, id: row.id, term: read.term }]
        : [];
    });
    // A row written twice is asked about once, on its first copy, and the
    // steps citing either copy develop it.
    const copies = new Map<string, string[]>();

    for (const row of rows) {
      copies.set(row.engine, [...(copies.get(row.engine) ?? []), row.id]);
    }

    const ordered = (text: string, last: (member: Member) => boolean) => {
      const devs = new Set(
        (copies.get(text) ?? []).flatMap((id) => [...(citing.get(id) ?? [])]),
      );
      const rank = (member: Member): number =>
        devs.has(member.dev) ? (last(member) ? 2 : 1) : 0;

      return branch(
        texts(
          [0, 1, 2].flatMap((at) =>
            members.filter((member) => rank(member) === at),
          ),
        ),
      );
    };
    const instanceOf = (row: string | null): string | null =>
      row === null ? null : input.instanceOf(row);
    const terms = new Map<string, readonly string[]>();
    const termsOf = (sort: string): readonly string[] => {
      let found = terms.get(sort);

      if (found === undefined) {
        found = [
          ...new Set(
            rows.flatMap((row) => closedSubterms(language, row.term, sort)),
          ),
        ];
        terms.set(sort, found);
      }

      return found;
    };

    for (const row of rows) {
      if (copies.get(row.engine)?.[0] !== row.id) {
        continue;
      }

      ask(
        `${ok.ok.term} (${row.engine}) (${ordered(row.engine, () => false)})`,
        ok.ok.head,
        { row: row.id },
      );

      for (const { judgement, rule, slot, witnessed } of general) {
        const bindings = matchFocus(language, rule, row.term);

        if (bindings === null) {
          continue;
        }

        const shown = instanceShower(language, rule, bindings);

        if (witnessed) {
          for (const witness of witnesses(
            language,
            rule,
            row.term,
            rows.map((each) => each.term),
          )) {
            ask(
              `${judgement.term} (${row.engine}) (${branch(witness.rows)}) (${ordered(
                row.engine,
                (member) => instanceOf(member.row) === witness.instance,
              )})`,
              judgement.head,
              { names: [shown(witness.instance)], row: row.id },
            );
          }

          continue;
        }

        const at = (term: string, names: readonly string[]): void =>
          ask(
            `${judgement.term} (${row.engine}) (${term}) (${ordered(
              row.engine,
              (member) => instanceOf(member.row) === term,
            )})`,
            judgement.head,
            { names, row: row.id },
          );
        const all = termsOf(slot.sort);

        // A vacuous row (`∀x Fa`) writes the same rows at every term, so it is
        // developed at all of them or at none: asked once, at any one.
        if (isVacuous(language, slot, bindings)) {
          const term = all[0] ?? newName(language, slot.sort, mentioned);

          if (term !== null) {
            at(term, []);
          }

          continue;
        }

        for (const term of all) {
          at(term, [shown(term)]);
        }

        const fresh =
          all.length === 0 && rule.flags.has("nonempty")
            ? newName(language, slot.sort, mentioned)
            : null;

        if (fresh !== null) {
          at(fresh, []);
        }
      }
    }

    // Each row a rule on a pair of rows sets off (an identity), with every
    // other row it pairs with, by one statement of the rule: it is developed
    // one way round for all of them. Which way is the browser's to find, by
    // asking each, and the answer's to say.
    const firsts = rows.filter(
      (row) => copies.get(row.engine)?.[0] === row.id,
    );

    for (const rule of paired) {
      for (const row of firsts) {
        // Each statement the row sets off, with how its first focus row
        // matched: the first way, as an identity `a = b` matches one way.
        const starts = rule.variants.flatMap((patterns) => {
          const [first, second] = patterns.focus;
          const judgement = ok.pairs.get(patterns.name);
          const start =
            first === undefined || patterns.focus.length !== 2
              ? null
              : matchAll(language, first, row.term, patterns.metas).next();

          return judgement === undefined ||
            second === undefined ||
            start === null ||
            start.done === true
            ? []
            : [{ judgement, patterns, second, start: start.value }];
        });

        if (starts.length === 0) {
          continue;
        }

        const key = pairingKey(node.id, row.id);
        // The rule's own statement first, where it applies: asked when the
        // answer names none, and kept on a tie.
        const names = starts.map((each) => each.patterns.name);
        const candidates = [
          ...names.filter((name) => name === rule.patterns.name),
          ...names.filter((name) => name !== rule.patterns.name),
        ];
        const stated =
          input.directions === "every"
            ? candidates
            : [input.directions.get(key) ?? (candidates[0] as string)];
        const partners = firsts.filter(
          (each) =>
            each.id !== row.id &&
            (!rule.flags.has("literals") || isLiteral(language, each.term)),
        );

        pairings.set(key, candidates);

        for (const { judgement, patterns, second, start } of starts) {
          if (!stated.includes(patterns.name)) {
            continue;
          }

          for (const partner of partners) {
            const devs = new Set(
              (copies.get(partner.engine) ?? []).flatMap((id) => [
                ...(citing.get(id) ?? []),
              ]),
            );

            for (const bindings of matchAll(
              language,
              second,
              partner.term,
              patterns.metas,
              start,
            )) {
              // A conclusion that is a self-identity (`b = b`) is true on
              // any branch, and no step need write it.
              const waived = patterns.written.some(
                (premise) =>
                  premise.length > 0 &&
                  premise.every((each) =>
                    isSelfIdentity(
                      language,
                      conclude(language, each, bindings),
                    ),
                  ),
              );
              const hints = waived
                ? null
                : pairBindings(
                    patterns,
                    bindings,
                    `${row.engine} ${partner.engine}`,
                  );

              if (hints === null) {
                continue;
              }

              ask(
                `${judgement.term} (${row.engine}) (${partner.engine}) (${ordered(
                  row.engine,
                  (member) => devs.has(member.dev),
                )})`,
                judgement.head,
                { row: row.id, substitution: true },
                { bindings: hints, key, statement: patterns.name },
              );
            }
          }
        }
      }
    }

    return { pairings, questions };
  };
}
