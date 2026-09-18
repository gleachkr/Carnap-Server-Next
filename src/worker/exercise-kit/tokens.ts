import tokenStyles from "./tokens.css" with { type: "text" };

/**
 * The exercise tokens' defaults, for a widget's shadow root: the `:host`
 * block that reads each `--exercise-*` token once into the private `--_` twin
 * every widget rule reads. See `tokens.css` for the contract. Served with the
 * group styles (`EXERCISE_GROUP_SHADOW_STYLES`) into every widget root, and by
 * each review widget into its own.
 */
export const EXERCISE_TOKEN_STYLES = tokenStyles;
