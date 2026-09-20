import { describe, expect, test } from "bun:test";

import {
  type EvaluationForScoring,
  effectiveEvaluation,
} from "../src/worker/domain/assessment";

/**
 * The one choice of "which evaluation counts" that the gradebook, the
 * student's results page and the approve-the-autograde action all make.
 */

function evaluation(
  overrides: Partial<EvaluationForScoring> & { readonly id: string },
): EvaluationForScoring {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    evaluatorKind: "automatic",
    score: 0,
    submissionId: "s1",
    voidedAt: null,
    ...overrides,
  };
}

describe("effectiveEvaluation", () => {
  test("nothing live is nothing", () => {
    expect(effectiveEvaluation([])).toBeNull();
    expect(
      effectiveEvaluation([
        evaluation({
          id: "v",
          score: 5,
          voidedAt: "2026-01-02T00:00:00.000Z",
        }),
      ]),
    ).toBeNull();
  });

  test("the highest automatic score wins, the newest among equals", () => {
    const picked = effectiveEvaluation([
      evaluation({
        createdAt: "2026-01-03T00:00:00.000Z",
        id: "late",
        score: 2,
      }),
      evaluation({
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "high",
        score: 3,
      }),
      evaluation({
        createdAt: "2026-01-02T00:00:00.000Z",
        id: "tie",
        score: 3,
      }),
    ]);

    expect(picked?.id).toBe("tie");
  });

  test("the latest manual grade beats any automatic score", () => {
    const picked = effectiveEvaluation([
      evaluation({ id: "auto", score: 10 }),
      evaluation({
        createdAt: "2026-01-02T00:00:00.000Z",
        evaluatorKind: "manual",
        id: "first",
        score: 1,
      }),
      evaluation({
        createdAt: "2026-01-03T00:00:00.000Z",
        evaluatorKind: "manual",
        id: "revised",
        score: 0,
      }),
    ]);

    expect(picked?.id).toBe("revised");
  });

  test("a voided manual grade gives way to the automatic one", () => {
    const picked = effectiveEvaluation([
      evaluation({ id: "auto", score: 1 }),
      evaluation({
        evaluatorKind: "manual",
        id: "withdrawn",
        score: 9,
        voidedAt: "2026-01-04T00:00:00.000Z",
      }),
    ]);

    expect(picked?.id).toBe("auto");
  });
});
