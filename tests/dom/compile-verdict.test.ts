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
 * turns red on submit. `sorry!` is not something an exercise offers.
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

  test("keeps the certificate of a proof that proves the goal", () => {
    const verdict = readCompileResult({
      diagnostics: [],
      mmbBytes: CERTIFICATE,
      ok: true,
    });

    expect(verdict.certificate).toBe(CERTIFICATE);
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
});
