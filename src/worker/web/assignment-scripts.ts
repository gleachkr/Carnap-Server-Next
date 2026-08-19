import {
  ANSWER_RECORDED_EVENT,
  UNSAVED_ANSWER_ATTRIBUTE,
} from "../exercises/answer-events";
import {
  CORRECTNESS_MARK_CLASS,
  CORRECTNESS_MARK_GLYPHS,
  CORRECTNESS_MARK_LABEL_ATTRIBUTES,
} from "../exercises/correctness-mark";
import {
  EXERCISE_UI_STRINGS_ATTRIBUTE,
  REVIEW_UI_STRINGS_ATTRIBUTE,
  readStringsPrelude,
} from "./ui-strings";

/**
 * The assignment pages' scripts, split out of `assignment-detail.tsx` so
 * {@link ./script-assets} can build files from them without importing the
 * module that renders the markup. See `layout-scripts.ts` for the same split.
 *
 * They divide by page, not by concern: a student answering exercises and an
 * instructor reviewing them are two different documents, and shipping each the
 * other's code would be a request neither of them can use.
 *
 * All of them are loaded `defer`, so the runtime-state and UI-string payloads
 * at the end of the body are parsed before the first line runs.
 */

/**
 * Reveals a "couldn't load — reload" notice for any interactive exercise whose
 * custom element has not enhanced within a deadline. Carnap requires JS for
 * exercises, so an element that never enhances — its bundle failed to load, or
 * it loaded but could not adopt its shadow root — leaves the inert Declarative
 * Shadow DOM on screen with no way to answer; this turns that silent dead state
 * into an actionable message. Enhanced elements set `data-enhanced="true"` (see
 * the client base class), so that marker, not merely `:defined`, is the health
 * signal. Only interactive forms carry a hyphenated custom element, so
 * read-only text forms are skipped.
 */
const COMPONENT_FAILURE_SCRIPT = `
(() => {
${readStringsPrelude(EXERCISE_UI_STRINGS_ATTRIBUTE)}

  const DEADLINE_MS = 8000;
  const forms = document.querySelectorAll("form.exercise");

  if (forms.length === 0) {
    return;
  }

  window.setTimeout(() => {
    for (const form of forms) {
      const element = form.querySelector("[data-exercise-id]");

      if (element === null || element.tagName.indexOf("-") === -1) {
        continue;
      }

      if (element.dataset.enhanced === "true") {
        continue;
      }

      if (form.querySelector(".exercise-load-error") !== null) {
        continue;
      }

      const notice = document.createElement("p");
      notice.className = "exercise-load-error";
      notice.setAttribute("role", "alert");
      notice.textContent =
        S.loadFailed || "This exercise couldn't load. Please reload the page.";
      form.appendChild(notice);
    }
  }, DEADLINE_MS);
})();
`;

/**
 * The exercise runtime: submits every answer form with fetch, keeps its status
 * line current, and warns before a navigation would discard an answer that has
 * not been recorded.
 *
 * Exported only so `tests/unsaved-changes.test.ts` can drive it in jsdom. The
 * alternative — seeding a course, an assignment and an open attempt just to get
 * at the script this returns — tests the seeding, not the runtime.
 */
const EXERCISE_RUNTIME_SCRIPT = `
(() => {
${readStringsPrelude(EXERCISE_UI_STRINGS_ATTRIBUTE)}

  const MARK_GLYPHS = ${JSON.stringify(CORRECTNESS_MARK_GLYPHS)};
  const MARK_LABEL_ATTRIBUTES = ${JSON.stringify(
    CORRECTNESS_MARK_LABEL_ATTRIBUTES,
  )};

  const stateElement = document.querySelector(
    "[data-carnap-exercise-runtime-state]",
  );
  const runtime = stateElement === null
    ? { exercises: {} }
    : JSON.parse(stateElement.textContent || '{"exercises":{}}');
  const exercises = runtime.exercises || {};

  // Placeholder substitution only — the server already picked the message and
  // resolved it for this locale; all that is left is filling the values in.
  function fill(template, values) {
    return String(template).replace(/\\{(\\w+)\\}/g, (match, name) =>
      name in values ? String(values[name]) : match,
    );
  }

  function statusText(state) {
    if (state === undefined) {
      return S.noSubmission || "No submission in this attempt.";
    }

    const evaluation = state.evaluation;
    const when = state.submission.submittedAt;

    // No evaluation, or one whose numbers this student may not see yet: the
    // line says the work is in and stops there. A score is a grade, and grades
    // wait for the release date however much the exercise is willing to say.
    if (!evaluation || evaluation.score === null) {
      return fill(S.submittedAt || "Submitted at {when}.", { when });
    }

    return fill(
      S.submittedAtScored || "Submitted at {when} · {score}/{maxScore}.",
      { maxScore: evaluation.maxScore, score: evaluation.score, when },
    );
  }

  // The recorded answer's verdict, for the correctness mark: is what the server
  // holds *fully* right? Partial credit is not a green check, and an ungraded
  // submission (a hand-marked free response) is not one either — both leave the
  // mark idle, which is what "we do not know that this is right" looks like.
  //
  // Read off the server's own word rather than compared out of the numbers,
  // which are not always here to compare.
  function recordedVerdict(state) {
    const evaluation = state === undefined ? null : state.evaluation;

    return evaluation && evaluation.verdict === "correct" ? "ok" : "idle";
  }

  // The runtime only ever writes these two states, so it needs neither the
  // spinner nor the hover detail the client base class's setMark handles. A
  // widget that can grade itself in the browser overwrites whatever is set here
  // as soon as it has a live verdict; see worker/exercises/correctness-mark.ts.
  function setMark(form, state) {
    const mark = form.querySelector(".${CORRECTNESS_MARK_CLASS}");

    if (mark === null) {
      return;
    }

    const label = mark.getAttribute(MARK_LABEL_ATTRIBUTES[state]);

    mark.dataset.state = state;
    mark.textContent = MARK_GLYPHS[state];

    if (label !== null) {
      mark.setAttribute("aria-label", label);
      // Assigned, not left alone: a widget may have put its own complaint here,
      // and a submission that scores full marks must not keep it as the tooltip
      // over a green check.
      mark.title = label;
    }
  }

  function formAnswer(form) {
    const data = new FormData(form);
    const kind = String(data.get("answerKind") || "");
    const schemaVersion = Number(data.get("schemaVersion") || "0");
    let answerData;

    // An enhancing custom element writes its answer into the hidden answerData
    // field; prefer it when present.
    const encodedAnswer = String(data.get("answerData") || "");

    if (encodedAnswer.length > 0) {
      answerData = JSON.parse(encodedAnswer);
    } else if (data.has("text")) {
      // Free-response and short-answer have no enhancing element yet, so their
      // native text field is read directly until they produce answerData too.
      answerData = { text: String(data.get("text") || "") };
    } else {
      throw new Error(
        S.noAnswerFields || "This exercise form has no known answer fields.",
      );
    }

    return {
      answer: { data: answerData, kind, schemaVersion },
      exerciseId: String(data.get("exerciseId") || ""),
    };
  }

  function idempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return String(Date.now()) + "-" + String(Math.random()).slice(2);
  }

  function stateFromResponse(body) {
    return {
      answerReview: null,
      evaluation: body.evaluation,
      submission: {
        answerKind: body.submission.answerKind,
        exerciseId: body.submission.exerciseId,
        id: body.submission.id,
        submittedAt: body.submission.submittedAt,
      },
    };
  }

  async function errorMessage(response) {
    try {
      const body = await response.json();

      return (
        body.error?.message || S.submitFailed || "The submission was not accepted."
      );
    } catch (_error) {
      return S.submitFailed || "The submission was not accepted.";
    }
  }

  // Leaving with an answer the server has not got should ask first — a reload
  // of a page full of half-finished proofs is otherwise silent and total.
  //
  // The guard lives here, in the content document, because that is the frame
  // the exercise forms are in — and a beforeunload inside a same-origin frame
  // also stops the enclosing assignment page from navigating or reloading. One
  // guard therefore covers the inline frame and the fullscreen view both.
  //
  // An interactive exercise answers for itself: its element flags itself while
  // the reader is ahead of the server, because only the element can tell an
  // edit from one of its own recomputations. The text types have no element, so
  // their saved state is what the server rendered into the field.
  const savedText = new WeakMap();

  function textAnswer(form) {
    const field = form.querySelector("[name=text]");

    return field === null ? null : field.value;
  }

  function hasUnsavedWork() {
    for (const form of document.querySelectorAll("form.exercise")) {
      if (form.querySelector("[data-exercise-id][${UNSAVED_ANSWER_ATTRIBUTE}]") !== null) {
        return true;
      }

      const text = textAnswer(form);

      if (text !== null && savedText.get(form) !== text) {
        return true;
      }
    }

    return false;
  }

  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedWork()) {
      return;
    }

    // The browser writes the wording and decides whether to show it at all, so
    // there is nothing here to translate. Assigning returnValue is the older
    // spelling of the same request, still needed by some engines.
    event.preventDefault();
    event.returnValue = "";
  });

  for (const form of document.querySelectorAll("form.exercise")) {
    const exerciseId = form.dataset.exerciseId || "";
    const status = form.querySelector("[data-exercise-status]");
    const button = form.querySelector("button[type=submit]");

    if (status !== null) {
      status.textContent = statusText(exercises[exerciseId]);
    }

    setMark(form, recordedVerdict(exercises[exerciseId]));
    savedText.set(form, textAnswer(form));

    // The text types have no element to notice an edit for them, so the mark
    // they carry has to come down here: once the field differs from what was
    // recorded, the recorded verdict is about something else.
    // Typed back to what was recorded, the recorded verdict applies again, so
    // this restores as well as clears rather than latching off.
    const field = form.querySelector("[name=text]");

    field?.addEventListener("input", () => {
      setMark(
        form,
        field.value === savedText.get(form)
          ? recordedVerdict(exercises[exerciseId])
          : "idle",
      );
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      // Read before the request, not after: an edit made while it is in flight
      // is unsaved work, and marking the form clean on arrival would lose it.
      const sentText = textAnswer(form);

      if (status !== null) {
        status.textContent = S.submitting || "Submitting…";
      }

      if (button !== null) {
        button.disabled = true;
      }

      try {
        const payload = formAnswer(form);
        const response = await fetch(form.action, {
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey(),
            "X-CSRF-Token": form.querySelector("[name=csrfToken]")?.value || "",
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error(await errorMessage(response));
        }

        const body = await response.json();

        // A checked-but-not-recorded answer leaves the last recorded
        // submission in place; the status line just says to keep going. It also
        // leaves the form dirty — nothing was stored, so leaving the page still
        // loses the attempt.
        if (body.recorded === false) {
          if (status !== null) {
            status.textContent =
              S.notRecorded ||
              "Not correct yet, so nothing was recorded. Try again.";
          }
        } else {
          savedText.set(form, sentText);
          // Tells the element to take what it holds as the new saved state.
          form.dispatchEvent(new CustomEvent("${ANSWER_RECORDED_EVENT}"));

          exercises[exerciseId] = stateFromResponse(body);

          if (status !== null) {
            status.textContent = statusText(exercises[exerciseId]);
          }

          setMark(form, recordedVerdict(exercises[exerciseId]));
        }

        form.dispatchEvent(new CustomEvent("carnap:exercise-submitted", {
          bubbles: true,
          detail: body,
        }));
      } catch (error) {
        if (status !== null) {
          status.textContent = error instanceof Error
            ? error.message
            : S.submitFailed || "The submission was not accepted.";
        }
      } finally {
        if (button !== null) {
          button.disabled = false;
        }
      }
    });
  }
})();
`;

/**
 * Progressive enhancement for the review queue: submit the approve and
 * manual-evaluation forms with fetch and reconcile the card in place instead of
 * reloading. Without JS the forms POST and redirect as before; this only takes
 * over once it can, and mirrors the server's render of the new state — the
 * status line, the review-state word, whether the one-click approve still
 * applies, the "needs review" count, and (in the needs-review filter) dropping
 * the card out of the queue it no longer belongs in.
 */
const REVIEW_ACTIONS_SCRIPT = `
(() => {
${readStringsPrelude(REVIEW_UI_STRINGS_ATTRIBUTE)}

  const NEEDS_REVIEW = "needs-review";
  const STATES = S.states || {};
  const EVALUATORS = S.evaluators || {};

  function stateLabelText(state) {
    return STATES[state] || state;
  }

  // Placeholder substitution only; the server resolved the message already.
  function fill(template, values) {
    return String(template).replace(/\\{(\\w+)\\}/g, (match, name) =>
      name in values ? String(values[name]) : match,
    );
  }

  function csrfToken(form) {
    const input = form.querySelector("[name=csrfToken]");

    return input === null ? "" : input.value;
  }

  function evaluationText(evaluation) {
    // Nothing is withheld from an instructor, and this script only ever runs on
    // their review queue — the null check mirrors the server's so the two
    // cannot disagree about a card, not because it is expected to fire.
    if (!evaluation || evaluation.score === null) {
      return S.notGraded || "Not graded";
    }

    // Same id the server's evaluationText uses, so the line does not change
    // shape when this script rewrites a card in place.
    return fill(S.scored || "{score}/{maxScore} · {evaluator}", {
      evaluator: EVALUATORS[evaluation.evaluatorKind] ||
        evaluation.evaluatorKind,
      maxScore: evaluation.maxScore,
      score: evaluation.score,
    });
  }

  // Mirrors submissionNeedsReview + reviewState on the server, and returns the
  // same machine values — never the displayed words, which differ by language.
  function reviewStateOf(evaluation) {
    if (!evaluation) {
      return NEEDS_REVIEW;
    }

    if (evaluation.evaluatorKind === "manual") {
      return "reviewed";
    }

    return evaluation.score < evaluation.maxScore ? NEEDS_REVIEW : "auto-graded";
  }

  const list = document.querySelector(".submission-review-list");
  const filterNav = document.querySelector(".review-filter");
  const filter = filterNav === null ? "all" : filterNav.dataset.filter || "all";
  const countElement = document.querySelector(".review-count-needs");

  function refreshCount() {
    if (countElement === null) {
      return;
    }

    let count = 0;

    for (const label of document.querySelectorAll(
      ".submission-review-card .review-state-label",
    )) {
      if (label.dataset.reviewState === NEEDS_REVIEW) {
        count += 1;
      }
    }

    countElement.textContent = String(count);
  }

  function showEmptyStateIfCleared() {
    if (filter !== "needs-review" || list === null) {
      return;
    }

    if (list.querySelector(".submission-review-card") !== null) {
      return;
    }

    const sheet = document.createElement("section");
    sheet.className = "sheet";
    const section = document.createElement("div");
    section.className = "sheet-section";
    const paragraph = document.createElement("p");
    paragraph.textContent =
      S.allReviewed || "Every recorded submission has been reviewed.";
    section.appendChild(paragraph);
    sheet.appendChild(section);
    list.replaceWith(sheet);
  }

  function showError(card, message) {
    let error = card.querySelector(".review-action-error");

    if (error === null) {
      error = document.createElement("p");
      error.className = "review-action-error small";
      error.setAttribute("role", "alert");
      const footer = card.querySelector(".submission-review-footer");
      (footer === null ? card : footer).appendChild(error);
    }

    error.textContent = message;
  }

  function clearError(card) {
    const error = card.querySelector(".review-action-error");

    if (error !== null) {
      error.remove();
    }
  }

  function applyResult(card, evaluation) {
    clearError(card);
    const state = reviewStateOf(evaluation);

    // A card that no longer needs review has no place in the needs-review
    // queue — drop it the way a reload would, and offer the empty state.
    if (filter === "needs-review" && state !== NEEDS_REVIEW) {
      card.remove();
      refreshCount();
      showEmptyStateIfCleared();
      return;
    }

    const status = card.querySelector(".submission-review-status");

    if (status !== null) {
      status.textContent = evaluationText(evaluation);
    }

    const label = card.querySelector(".review-state-label");

    if (label !== null) {
      // Both halves, so the next refreshCount() sees the new state.
      label.dataset.reviewState = state;
      label.textContent = stateLabelText(state);
    }

    const approve = card.querySelector(".approve-score-form");

    if (approve !== null && state !== NEEDS_REVIEW) {
      approve.remove();
    }

    const details = card.querySelector("details.manual-evaluation");

    if (details !== null) {
      details.open = false;
    }

    refreshCount();
  }

  async function errorMessage(response) {
    try {
      const body = await response.json();

      return (
        (body.error && body.error.message) ||
        S.actionFailed ||
        "The action was not accepted."
      );
    } catch (_error) {
      return S.actionFailed || "The action was not accepted.";
    }
  }

  async function submit(form, payload) {
    const card = form.closest(".submission-review-card");
    const button = form.querySelector("button[type=submit]");

    if (button !== null) {
      button.disabled = true;
    }

    try {
      const response = await fetch(form.action, {
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken(form),
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }

      const body = await response.json();

      if (card !== null) {
        applyResult(card, body.evaluation);
      }
    } catch (error) {
      if (card !== null) {
        showError(
          card,
          error instanceof Error
            ? error.message
            : S.actionFailed || "The action was not accepted.",
        );
      }
    } finally {
      // Harmless if the card (and this button) was removed on success.
      if (button !== null) {
        button.disabled = false;
      }
    }
  }

  for (const form of document.querySelectorAll("form.approve-score-form")) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit(form, {});
    });
  }

  for (const form of document.querySelectorAll("form.manual-evaluation-form")) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      const data = new FormData(form);
      const feedback = String(data.get("feedback") || "");
      // The score alone: what it is out of belongs to the exercise, and the
      // server reads it there. Sending one would be refused.
      submit(form, {
        feedback: feedback.length === 0 ? null : feedback,
        score: Number(data.get("score")),
      });
    });
  }
})();
`;

export { EXERCISE_RUNTIME_SCRIPT };

/**
 * The answering page: the runtime first, then the failure guard that reports a
 * component which never arrived — the order they were emitted in when both
 * were inline, and the order the guard's deadline assumes.
 */
export const EXERCISE_SCRIPT = [
  EXERCISE_RUNTIME_SCRIPT,
  COMPONENT_FAILURE_SCRIPT,
].join("\n");

/** The review page, which runs no exercise runtime of its own. */
export const REVIEW_SCRIPT = REVIEW_ACTIONS_SCRIPT;
