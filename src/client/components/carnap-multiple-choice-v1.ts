/**
 * `<carnap-multiple-choice>` — the reference interactive exercise element and
 * the first consumer of the v2 component contract.
 *
 * The server renders the option controls into a Declarative Shadow Root (see
 * the worker-side `renderMultipleChoiceElement`), inert and correctly styled
 * with no JS. On connect this element adopts that shadow root, enables the
 * controls, restores the student's prior answer from the hydration payload,
 * and mirrors the live selection into the form's hidden `answerData` field so
 * the runtime records it. The prompt and option labels stay slotted in light
 * DOM, so author CSS and the document's math font still reach them.
 */
import { CarnapExerciseElement, register } from "./base";

class CarnapMultipleChoice extends CarnapExerciseElement {
  private inputs: HTMLInputElement[] = [];

  protected enhance(): void {
    const root = this.shadowRoot;

    // The chrome lives in the Declarative Shadow Root; without it (no DSD
    // support) there is nothing to enhance and the inert SSR view stands.
    if (root === null) {
      return;
    }

    this.inputs = Array.from(
      root.querySelectorAll<HTMLInputElement>("input.mc-input"),
    );

    for (const input of this.inputs) {
      input.disabled = false;
      input.addEventListener("change", () => {
        this.reflectSelection();
        this.syncAnswer();
        // This type cannot grade itself — the key is server-side — so the mark
        // only ever says what the *recorded* answer scored. Changing the
        // selection makes that claim about something else, so it comes down
        // until the next submission puts it back up.
        this.setMark("idle");
      });
    }

    this.restorePriorAnswer();
    this.reflectSelection();
    root.querySelector(".mc")?.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
  }

  protected getAnswer(): { selectedOptionIds: string[] } {
    return {
      selectedOptionIds: this.inputs
        .filter((input) => input.checked)
        .map((input) => input.value),
    };
  }

  /** Re-check the options the student picked before reloading, if any. */
  private restorePriorAnswer(): void {
    const prior = this.priorAnswer;

    if (prior === null || typeof prior !== "object") {
      return;
    }

    const ids = (prior as { selectedOptionIds?: unknown }).selectedOptionIds;

    if (!Array.isArray(ids)) {
      return;
    }

    const selected = new Set(ids.map(String));

    for (const input of this.inputs) {
      input.checked = selected.has(input.value);
    }
  }

  /** Mark each chosen option so the shadow styles can highlight it. */
  private reflectSelection(): void {
    for (const input of this.inputs) {
      input
        .closest(".mc-option")
        ?.toggleAttribute("data-selected", input.checked);
    }
  }
}

register("carnap-multiple-choice", CarnapMultipleChoice);
