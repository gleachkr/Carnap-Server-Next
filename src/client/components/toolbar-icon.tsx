/** @jsxImportSource preact */

import {
  TOOLBAR_ICON_PATHS,
  TOOLBAR_ICON_STROKE,
  TOOLBAR_ICON_VIEWBOX,
  type ToolbarIconName,
} from "./toolbar-icons";

/**
 * A toolbar glyph for the Preact editors — the JSX spelling of
 * `createToolbarIcon`, over the same paths. Decorative (`aria-hidden`): the
 * button it sits in carries the name.
 */
export function ToolbarIcon(props: { readonly name: ToolbarIconName }) {
  return (
    <svg
      aria-hidden="true"
      class="toolbar-icon"
      viewBox={TOOLBAR_ICON_VIEWBOX}
    >
      <g {...TOOLBAR_ICON_STROKE}>
        {TOOLBAR_ICON_PATHS[props.name].map((d) => (
          <path d={d} key={d} />
        ))}
      </g>
    </svg>
  );
}
