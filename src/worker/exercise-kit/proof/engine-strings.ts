import type { Translator } from "../../i18n/translator";

/**
 * The text every proof widget — linear `.auf`, Fitch, tree and Prawitz — has
 * to be able to say, because they all drive the same WASM compiler through
 * the same pipeline (the client's `components/proof-element.ts`): the engine
 * failing, the proof it could not read, a playground with no readable goal,
 * and the `allow-sorry` protocol. The Prawitz widget cannot admit a line
 * (its `enhance` says why), so the last of those never fires there — but the
 * gate that would say it is the one it shares.
 *
 * The verdict itself is not here: it is the shared correctness mark in the
 * action bar, which the server renders with the names for all four of its
 * states on it, so no widget carries text for it. Nor is text that only some
 * of the four read — the `Prove` label, the two CodeMirror editors' fallback
 * for a diagnostic with no message, Fitch's read-only review editor — which
 * each of those widgets' own `strings.ts` carries, so a widget ships only the
 * ids it looks up. Ids are the English text, so a sentence two of them share
 * is still one catalog entry.
 *
 * Note what is *not* here: the compiler's own diagnostics. Those are translated
 * upstream, not by us — `@aufbau/compiler` carries its own catalogs and picks
 * one from the locale `client/proof-compiler.ts` hands it, so a language Aufbau
 * has not translated reaches the student's editor gutter in English however
 * complete our own catalog is. These are our wrappers around it.
 */
export function buildProofEngineStrings(i18n: Translator) {
  return {
    /**
     * Why the Submit button did nothing, under `allow-sorry` outside an exam.
     * Not a verdict, so it shows whatever the feedback setting says.
     */
    "A proof with lines admitted with sorry! cannot be submitted.": i18n.t(
      "A proof with lines admitted with sorry! cannot be submitted.",
    ),
    "Could not load the proof engine.": i18n.t(
      "Could not load the proof engine.",
    ),
    /**
     * The status line under `allow-sorry` when the only problems left are the
     * admissions themselves — on an exam, where the proof may be handed in as
     * it stands. Detail, so `full` feedback only.
     */
    "Every other line checks; lines admitted with sorry! do not score.":
      i18n.t(
        "Every other line checks; lines admitted with sorry! do not score.",
      ),
    /** The same status outside an exam, where the widget holds the proof back. */
    "Every other line checks; a proof with lines admitted with sorry! cannot be submitted.":
      i18n.t(
        "Every other line checks; a proof with lines admitted with sorry! cannot be submitted.",
      ),
    /**
     * A playground's mark when the proof has a last line but the theory
     * cannot say which of its tokens are variables, so no goal can be
     * declared for it (see `./playground.ts`).
     */
    "Could not work out what the last line states.": i18n.t(
      "Could not work out what the last line states.",
    ),
    /** Label on a playground's goal row, before the sequent the proof derives. */
    Proves: i18n.t("Proves"),
    "The proof engine couldn't read this proof — check for unexpected characters.":
      i18n.t(
        "The proof engine couldn't read this proof — check for unexpected characters.",
      ),
  };
}

/** What every proof widget can say; the shared pipeline's `t` is typed to it. */
export type ProofEngineStringId = keyof ReturnType<
  typeof buildProofEngineStrings
>;
