import { THEORY_PANEL_STYLES } from "../exercises/aufbau-proof/theory-panel";
import { EXERCISE_GROUP_STYLES } from "../exercises/group";
import chromeStyles from "./chrome.css" with { type: "text" };
import contentStyles from "./content.css" with { type: "text" };
import exerciseStyles from "./exercises.css" with { type: "text" };
import { MATH_FONT_FACE } from "./math-font";
import { UI_FONT_FACES } from "./ui-fonts";

/**
 * Styles come in two layers. CONTENT_STYLES carries everything that styles
 * authored content and exercise forms; it is shared between the app shell and
 * the standalone content documents served into iframes, so the two render
 * identically. CHROME_STYLES is app-shell only (navigation, sheets, tables of
 * records, dialogs).
 *
 * The split is what the two layers are *for*, and it is also what makes them
 * worth caching separately: a lesson page is two documents, and the shared
 * layer is then one download that serves both. See `./style-assets`, which
 * turns each into a hashed URL — nothing here is embedded in a page.
 *
 * The rules themselves are in `./content.css`, `./exercises.css` and
 * `./chrome.css`, read as text (see `src/text-modules.d.ts`). What is left
 * here is the assembly, which is all this module was ever doing that CSS
 * cannot do for itself: two generated blocks whose URLs carry content hashes,
 * and two shared blocks other modules also serve into shadow roots.
 */
export const CONTENT_STYLES = [
  // Generated, not authored: both carry hashed URLs a stylesheet cannot spell.
  UI_FONT_FACES,
  MATH_FONT_FACE,
  contentStyles,
  // Order is load-bearing here and only here: `exercises.css` restyles
  // `.exercise-prompt` and `.visually-hidden`, which this block declares.
  EXERCISE_GROUP_STYLES,
  exerciseStyles,
  // Last because it may be: everything in it is under `.aufbau-theory`.
  THEORY_PANEL_STYLES,
].join("\n");

export const CHROME_STYLES = chromeStyles;
