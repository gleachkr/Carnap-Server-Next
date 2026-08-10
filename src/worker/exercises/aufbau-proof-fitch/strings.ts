import { placeholders, type Translator } from "../../i18n/translator";
import { buildProofEngineStrings } from "../proof-engine-strings";
import type { FitchDiagnosticCode } from "./translate";

/**
 * Interface text for the Fitch proof widget: the shared proof-engine set, plus
 * prose for every structural problem the indentation-to-context translator can
 * report.
 *
 * The translator itself carries only a {@link FitchDiagnosticCode} and its
 * parameters — no prose — so the same diagnostic can be worded in the student's
 * language here and asserted on by code in the tests.
 *
 * A placeholder must not be wrapped in ASCII apostrophes: these are ICU messages,
 * and `'{token}'` is ICU's *escape* for a literal `{token}` — so the quotes are
 * eaten and the brace stops being a placeholder at all. The student's own text is
 * quoted typographically instead, which ICU leaves alone.
 */
export function buildAufbauProofFitchStrings(i18n: Translator) {
  return {
    ...buildProofEngineStrings(i18n),
    ...buildFitchDiagnosticStrings(i18n),
    /** Accessible name of the editor; see `Proof editor` in the linear widget. */
    "Fitch proof editor": i18n.t("Fitch proof editor"),
  };
}

/**
 * The structural half, on its own so that its keys — and nothing else the widget
 * says — form the union {@link FITCH_DIAGNOSTIC_MESSAGES} may name.
 */
function buildFitchDiagnosticStrings(i18n: Translator) {
  return {
    "“{token}” is not a line number or a subproof range like “a-b”.": i18n.t(
      "“{token}” is not a line number or a subproof range like “a-b”.",
      placeholders("token"),
    ),
    "A cited subproof must begin and end at the same indentation level.":
      i18n.t(
        "A cited subproof must begin and end at the same indentation level.",
      ),
    "A cited subproof must not reach back out to a shallower line.": i18n.t(
      "A cited subproof must not reach back out to a shallower line.",
    ),
    "Every proof line needs a justification: '<formula> :<rule> <refs>'.":
      i18n.t(
        "Every proof line needs a justification: '<formula> :<rule> <refs>'.",
      ),
    "Reference “{token}” is inside a subproof that has already closed.":
      i18n.t(
        "Reference “{token}” is inside a subproof that has already closed.",
        placeholders("token"),
      ),
    "Reference “{token}” is not an earlier proof step.": i18n.t(
      "Reference “{token}” is not an earlier proof step.",
      placeholders("token"),
    ),
    "The justification after ':' must name a rule.": i18n.t(
      "The justification after ':' must name a rule.",
    ),
    "This line's indentation does not match any open subproof level.": i18n.t(
      "This line's indentation does not match any open subproof level.",
    ),
  };
}

export type AufbauProofFitchStrings = ReturnType<
  typeof buildAufbauProofFitchStrings
>;

export type AufbauProofFitchStringId = keyof AufbauProofFitchStrings;

type FitchDiagnosticStringId = keyof ReturnType<
  typeof buildFitchDiagnosticStrings
>;

/**
 * Which sentence each structural diagnostic reads as.
 *
 * Kept separate from the builder so the string ids stay the English text — the
 * client's fallback when a payload arrives without strings. `tsc` holds the two
 * together from both ends: the `Record` over the code union rejects a new code
 * with no prose, and the value type rejects anything but a structural sentence.
 *
 * That value type is the sub-builder's keys rather than the whole widget's for a
 * reason. Over `AufbauProofFitchStringId` it also admitted the shared
 * proof-engine ids, so `bad_reference: "Checking"` typechecked — and put the
 * word "Checking" in the CodeMirror gutter where a diagnostic belonged.
 */
export const FITCH_DIAGNOSTIC_MESSAGES: Readonly<
  Record<FitchDiagnosticCode, FitchDiagnosticStringId>
> = {
  bad_reference:
    "“{token}” is not a line number or a subproof range like “a-b”.",
  inaccessible_reference:
    "Reference “{token}” is inside a subproof that has already closed.",
  inconsistent_indentation:
    "This line's indentation does not match any open subproof level.",
  missing_justification:
    "Every proof line needs a justification: '<formula> :<rule> <refs>'.",
  missing_rule: "The justification after ':' must name a rule.",
  range_depth_mismatch:
    "A cited subproof must begin and end at the same indentation level.",
  range_escapes_subproof:
    "A cited subproof must not reach back out to a shallower line.",
  unknown_reference: "Reference “{token}” is not an earlier proof step.",
};
