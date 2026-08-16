/**
 * Reading a submitted model, and deciding whether it does what was asked.
 *
 * Two steps, in the order Carnap runs them (`CounterModel.hs:118-131`): a model
 * that is not well formed is reported as such and never evaluated, so anything
 * downstream can assume a total interpretation.
 *
 * The verdict is data, not sentences. Both the worker and the browser reach
 * this module — the local Check is not an approximation here, because a model
 * exercise has no secret key and both sides run exactly this code — while the
 * words differ (a student reads widget strings, an author reads compiler
 * diagnostics), so wording stays with the callers.
 */

import type { Formula } from "../../first-order";
import type { FunctionRow } from "./fields";
import {
  MAX_DOMAIN_SIZE,
  parseDomain,
  parseFunctionTable,
  parseNatural,
  parseTupleList,
  tupleKey,
  tuplesOver,
} from "./fields";
import type { FiniteModel } from "./model";
import { satisfies } from "./model";
import type { ModelField } from "./signature";
import { symbolKey } from "./signature";

/**
 * The property the targeted formulas must jointly have.
 *
 * Carnap spells these as `counterexample-to` values whose meanings overlap
 * (`validity` and `tautology` are the same test); authoring maps that
 * vocabulary onto these three, so nothing has to be re-derived at grade time.
 */
export type ModelTarget = "all-true" | "all-false" | "not-all-equal";

export interface ModelTask {
  /**
   * Formulas that must come out true whatever else happens: a validity
   * exercise's premises, or a constraint exercise's constraints. Empty for a
   * simple exercise.
   */
  readonly required: readonly Formula[];
  readonly target: ModelTarget;
  /** The formulas {@link target} applies to. Never empty. */
  readonly targeted: readonly Formula[];
}

/** A raw submitted model: exactly what the student typed, per field label. */
export interface ModelInput {
  readonly domain: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** Why a submitted model is not a model. */
export type ModelProblem =
  | { readonly kind: "domain-empty" }
  | { readonly kind: "domain-unreadable"; readonly position: number }
  | { readonly kind: "domain-too-large"; readonly max: number }
  | {
      readonly kind: "field-unreadable";
      readonly field: string;
      readonly position: number;
    }
  | { readonly kind: "field-outside-domain"; readonly field: string }
  | {
      readonly kind: "function-incomplete";
      readonly field: string;
      readonly argument: string;
    }
  | {
      readonly kind: "function-ambiguous";
      readonly field: string;
      readonly argument: string;
    }
  | { readonly kind: "function-too-large"; readonly field: string };

export type ModelRead =
  | { readonly ok: true; readonly model: FiniteModel }
  | { readonly ok: false; readonly problem: ModelProblem };

/**
 * How a submitted model fared.
 *
 * Both formula lists are reported at once rather than the first failure only,
 * because that is the more useful thing to read back and because Carnap's
 * validity checker does the same: "not all conclusions are false in this model,
 * and not all premises are true".
 */
export interface ModelVerdict {
  readonly ok: boolean;
  /** Set when the model could not be read; the formulas were then not evaluated. */
  readonly problem: ModelProblem | null;
  /** Indices into {@link ModelTask.required} that came out false. */
  readonly requiredFalse: readonly number[];
  /** Whether {@link ModelTask.targeted} failed to have the target property. */
  readonly targetMissed: boolean;
  /**
   * Which targeted formulas are to blame, as indices. Empty for
   * `not-all-equal`, whose failure is a property of the set rather than of any
   * one formula.
   */
  readonly targetOffenders: readonly number[];
}

function readProposition(text: string): boolean | null {
  const value = text.trim().toLowerCase();

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

/** Whether every element of every tuple is in the domain. */
function withinDomain(
  tuples: readonly (readonly number[])[],
  domain: ReadonlySet<number>,
): boolean {
  return tuples.every((tuple) =>
    tuple.every((element) => domain.has(element)),
  );
}

/**
 * Check a function's extension is a total function on the domain.
 *
 * Carnap's `validateFunc` compares the sorted argument tuples against every
 * tuple over the domain and reports "does not have a value specified for some
 * input" or "has more than one value specified for some input". Here the
 * missing or repeated tuple is named, because the student's own generated value
 * table means the only way to reach either message is authored givens.
 */
function checkFunction(
  field: ModelField,
  rows: readonly FunctionRow[],
  domain: readonly number[],
): ModelProblem | null {
  const expected = tuplesOver(domain, field.arity);

  if (expected === null) {
    return { field: field.label, kind: "function-too-large" };
  }

  const seen = new Set<string>();

  for (const row of rows) {
    const key = tupleKey(row.args);

    if (seen.has(key)) {
      return {
        argument: key,
        field: field.label,
        kind: "function-ambiguous",
      };
    }

    seen.add(key);
  }

  for (const tuple of expected) {
    if (!seen.has(tupleKey(tuple))) {
      return {
        argument: tupleKey(tuple),
        field: field.label,
        kind: "function-incomplete",
      };
    }
  }

  return null;
}

/**
 * Read a submitted model, or say why it is not one.
 *
 * Fields are checked in signature order and the first problem is returned, so
 * the student is pointed at one field at a time. (Carnap instead runs every
 * readability check, then every domain-containment check, then the per-kind
 * checks, which can report a later field's problem while an earlier field is
 * still unreadable.)
 */
export function readModel(
  signature: readonly ModelField[],
  input: ModelInput,
): ModelRead {
  const domainText = input.domain.trim();

  if (domainText === "") {
    return { ok: false, problem: { kind: "domain-empty" } };
  }

  const parsedDomain = parseDomain(domainText);

  if (!parsedDomain.ok) {
    return {
      ok: false,
      problem: { kind: "domain-unreadable", position: parsedDomain.position },
    };
  }

  const domain = parsedDomain.value;

  if (domain.length > MAX_DOMAIN_SIZE) {
    return {
      ok: false,
      problem: { kind: "domain-too-large", max: MAX_DOMAIN_SIZE },
    };
  }

  const elements = new Set(domain);
  const constants = new Map<string, number>();
  const functions = new Map<string, ReadonlyMap<string, number>>();
  const propositions = new Map<string, boolean>();
  const relations = new Map<string, ReadonlySet<string>>();

  for (const field of signature) {
    if (field.kind === "domain") {
      continue;
    }

    const text = input.fields[field.label] ?? "";

    if (field.kind === "proposition") {
      const value = readProposition(text);

      if (value === null) {
        return {
          ok: false,
          problem: {
            field: field.label,
            kind: "field-unreadable",
            position: 0,
          },
        };
      }

      propositions.set(field.symbol, value);
      continue;
    }

    if (field.kind === "constant") {
      const parsed = parseNatural(text);

      if (!parsed.ok) {
        return {
          ok: false,
          problem: {
            field: field.label,
            kind: "field-unreadable",
            position: parsed.position,
          },
        };
      }

      if (!elements.has(parsed.value)) {
        return {
          ok: false,
          problem: { field: field.label, kind: "field-outside-domain" },
        };
      }

      constants.set(field.symbol, parsed.value);
      continue;
    }

    if (field.kind === "relation") {
      const parsed = parseTupleList(text, field.arity);

      if (!parsed.ok) {
        return {
          ok: false,
          problem: {
            field: field.label,
            kind: "field-unreadable",
            position: parsed.position,
          },
        };
      }

      if (!withinDomain(parsed.value, elements)) {
        return {
          ok: false,
          problem: { field: field.label, kind: "field-outside-domain" },
        };
      }

      relations.set(
        symbolKey(field.symbol, field.arity),
        new Set(parsed.value.map(tupleKey)),
      );
      continue;
    }

    const parsed = parseFunctionTable(text, field.arity);

    if (!parsed.ok) {
      return {
        ok: false,
        problem: {
          field: field.label,
          kind: "field-unreadable",
          position: parsed.position,
        },
      };
    }

    const values = parsed.value;

    if (
      !withinDomain(
        values.map((row) => [...row.args, row.value]),
        elements,
      )
    ) {
      return {
        ok: false,
        problem: { field: field.label, kind: "field-outside-domain" },
      };
    }

    const problem = checkFunction(field, values, domain);

    if (problem !== null) {
      return { ok: false, problem };
    }

    functions.set(
      symbolKey(field.symbol, field.arity),
      new Map(values.map((row) => [tupleKey(row.args), row.value])),
    );
  }

  return {
    model: { constants, domain, functions, propositions, relations },
    ok: true,
  };
}

/** Whether the truth values have the target property. */
function targetHolds(
  target: ModelTarget,
  values: readonly boolean[],
): boolean {
  if (target === "all-true") {
    return values.every((value) => value);
  }

  if (target === "all-false") {
    return values.every((value) => !value);
  }

  // A counterexample to equivalence: some formula disagrees with another.
  return values.some((value) => value) && values.some((value) => !value);
}

/** Which targeted formulas are to blame when the target is missed. */
function offenders(
  target: ModelTarget,
  values: readonly boolean[],
): readonly number[] {
  if (target === "all-true") {
    return values.flatMap((value, index) => (value ? [] : [index]));
  }

  if (target === "all-false") {
    return values.flatMap((value, index) => (value ? [index] : []));
  }

  return [];
}

/** Evaluate a task against a model that has already been read. */
export function judgeModel(
  task: ModelTask,
  model: FiniteModel,
): ModelVerdict {
  const requiredValues = task.required.map((formula) =>
    satisfies(formula, model),
  );
  const targetedValues = task.targeted.map((formula) =>
    satisfies(formula, model),
  );
  const requiredFalse = requiredValues.flatMap((value, index) =>
    value ? [] : [index],
  );
  const missed = !targetHolds(task.target, targetedValues);

  return {
    ok: requiredFalse.length === 0 && !missed,
    problem: null,
    requiredFalse,
    targetMissed: missed,
    targetOffenders: missed ? offenders(task.target, targetedValues) : [],
  };
}

/** Read a submitted model and evaluate the task against it, in one step. */
export function checkModel(
  signature: readonly ModelField[],
  task: ModelTask,
  input: ModelInput,
): ModelVerdict {
  const read = readModel(signature, input);

  if (!read.ok) {
    return {
      ok: false,
      problem: read.problem,
      requiredFalse: [],
      targetMissed: false,
      targetOffenders: [],
    };
  }

  return judgeModel(task, read.model);
}
