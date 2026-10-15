import { describe, expect, test } from "bun:test";
import type { CompileResult } from "@aufbau/compiler";
import { readCompileResult } from "../../src/client/proof-compiler";

/**
 * How a widget reads the compiler's result. The two things it must catch are
 * exactly the ones the engine does *not* fail on: a `sorry!` line, and a
 * warning on a clean compile.
 *
 * `sorry!` (engine 0.0.9) admits a line without a rule. The compile is `ok`
 * and returns an MMB, but that MMB carries a `Sorry` instruction, and the
 * worker's verifier — the trust boundary — refuses it. The reader withholds
 * the certificate and shows the line as a problem, so a student sees the
 * same verdict here as the server would give, rather than a green mark that
 * turns red on submit. An exercise with `allow-sorry` softens the problem to
 * a warning and says the proof is admitted; the certificate is withheld all
 * the same, since the verifier would refuse it all the same.
 *
 * The results here are shaped by hand: `@aufbau/compiler` is mocked for the
 * whole `bun test` run by `proof-compiler.test.ts`, so the real engine cannot
 * be loaded from a dom test. What the real engine returns for an admitted
 * line — `ok`, an MMB, one `SorryLine` warning — and that the verifier then
 * refuses the MMB, is pinned in `tests/sorry-certificate.test.ts`.
 */

const CERTIFICATE = new Uint8Array([0x4d, 0x4d, 0x30, 0x42]);

function admitted(): CompileResult {
  return {
    diagnostics: [
      {
        error: "SorryLine",
        message:
          "proof line is admitted with sorry!; the theorem is not verified",
        severity: "warning",
        spanEnd: 36,
        spanStart: 11,
      },
    ],
    mmbBytes: CERTIFICATE,
    ok: true,
  };
}

describe("readCompileResult", () => {
  test("withholds the certificate of a proof that admits a line", () => {
    const verdict = readCompileResult(admitted());

    expect(verdict.certificate).toBeNull();
    // An error like any other, to this exercise — not an admission it makes
    // anything of.
    expect(verdict.admitted).toBe(false);
    // The problem keeps the engine's wording and span, and is an error to
    // the student: something to fix, not a note.
    expect(verdict.problems).toEqual([
      {
        error: "SorryLine",
        message:
          "proof line is admitted with sorry!; the theorem is not verified",
        severity: "error",
        spanEnd: 36,
        spanStart: 11,
      },
    ]);
  });

  test("with allow-sorry the admission is a warning, and still no certificate", () => {
    const verdict = readCompileResult(admitted(), { allowSorry: true });

    expect(verdict.certificate).toBeNull();
    expect(verdict.admitted).toBe(true);
    expect(verdict.problems).toEqual([
      {
        error: "SorryLine",
        message:
          "proof line is admitted with sorry!; the theorem is not verified",
        severity: "warning",
        spanEnd: 36,
        spanStart: 11,
      },
    ]);
  });

  test("with allow-sorry an admission beside a failed line is not an admitted proof", () => {
    // Since 0.0.17 the engine checks past a failed line, so it reports the
    // admission it used to report only on an otherwise clean compile. The
    // proof's other lines do not all check, which is what `admitted` says.
    const verdict = readCompileResult(
      {
        diagnostics: [
          {
            error: "UnifyMismatch",
            message:
              "the statement and cited premises could not be matched against this rule",
            rule: "and_elim_r",
            severity: "error",
          },
          {
            error: "SorryLine",
            message:
              "proof line is admitted with sorry!; the theorem is not verified",
            severity: "warning",
          },
        ],
        ok: false,
      } as CompileResult,
      { allowSorry: true },
    );

    expect(verdict.certificate).toBeNull();
    expect(verdict.admitted).toBe(false);
    expect(verdict.problems.map((problem) => problem.severity)).toEqual([
      "error",
      "warning",
    ]);
  });

  test("keeps the certificate of a proof that proves the goal", () => {
    const verdict = readCompileResult({
      diagnostics: [],
      mmbBytes: CERTIFICATE,
      ok: true,
    });

    expect(verdict.certificate).toBe(CERTIFICATE);
    expect(verdict.admitted).toBe(false);
    expect(verdict.problems).toEqual([]);
  });

  test("drops the engine's other warnings and keeps its errors", () => {
    const verdict = readCompileResult({
      diagnostics: [
        {
          error: "UnusedTheoremParameter",
          message: "p unused",
          severity: "warning",
        },
        {
          error: "AmbiguousAcuiMatch",
          message: "split",
          severity: "warning",
        },
        {
          error: "MissingBinder",
          message: "no a",
          severity: "error",
          spanEnd: 5,
          spanStart: 3,
        },
        "not a record",
      ],
      ok: false,
    });

    expect(verdict.certificate).toBeNull();
    expect(verdict.problems).toEqual([
      {
        error: "MissingBinder",
        message: "no a",
        severity: "error",
        spanEnd: 5,
        spanStart: 3,
      },
    ]);
  });

  test("keeps the engine's headline and drops the context it prints under it", () => {
    const verdict = readCompileResult({
      diagnostics: [
        {
          error: "RefCountMismatch",
          lineLabel: "l4",
          message:
            "wrong number of references for rule application\ntheorem: g\nline: l4\nrule: and_intro\nphase: theorem application",
          rule: "and_intro",
          severity: "error",
        },
      ],
      ok: false,
    });

    expect(verdict.problems).toEqual([
      {
        error: "RefCountMismatch",
        // The line it is about, as the engine labels it: what leads a truth
        // tree's diagnostic back to its row.
        lineLabel: "l4",
        message: "wrong number of references for rule application",
        // Not from the text: the engine's own field, for the rule's shape.
        rule: "and_intro",
        severity: "error",
      },
    ]);
  });

  test("a clean compile with only warnings keeps its certificate", () => {
    const verdict = readCompileResult({
      diagnostics: [
        {
          error: "AmbiguousAcuiMatch",
          message: "split",
          severity: "warning",
        },
      ],
      mmbBytes: CERTIFICATE,
      ok: true,
    });

    expect(verdict.certificate).toBe(CERTIFICATE);
    expect(verdict.problems).toEqual([]);
  });

  test("names the token an unknown-token error is about", () => {
    // The engine's own record, as it reports a goal that forgot a binder:
    // the headline is the same for every token, and the token is in `detail`.
    const verdict = readCompileResult({
      diagnostics: [
        {
          detail: { kind: "unknown_math_token", token: "tv" },
          error: "UnknownMathToken",
          message: "unknown token in math string\nname: t\ntoken: tv",
          severity: "error",
          spanEnd: 33056,
          spanStart: 33054,
        },
      ],
      ok: false,
    } as CompileResult);

    expect(verdict.problems).toEqual([
      {
        error: "UnknownMathToken",
        message: "unknown token in math string",
        severity: "error",
        spanEnd: 33056,
        spanStart: 33054,
        token: "tv",
      },
    ]);
  });

  test("names the rule a line did not fit, and only for a misfit", () => {
    // The engine's own records for gh #36's ∨E and for a citation count it
    // refused; the rule is a field on every rule-application record, but it
    // is only the subject of these two.
    const verdict = readCompileResult({
      diagnostics: [
        {
          error: "UnifyMismatch",
          message:
            "the statement and cited premises could not be matched against this rule\ntheorem: IV11\nline: l6\nrule: or_elim",
          rule: "or_elim",
          severity: "error",
        },
        {
          error: "RefCountMismatch",
          message: "wrong number of references for rule application",
          rule: "and_intro",
          severity: "error",
        },
        {
          error: "SorryLine",
          message: "proof line is admitted with sorry!",
          rule: "and_intro",
          severity: "warning",
        },
      ],
      ok: false,
    } as CompileResult);

    expect(verdict.problems.map((problem) => problem.rule)).toEqual([
      "or_elim",
      "and_intro",
      undefined,
    ]);
  });
});
