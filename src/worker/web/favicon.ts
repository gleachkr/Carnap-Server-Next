/**
 * The browser-tab icon: the app's ⊨ brand mark in the palette's blue on the
 * warm sheet, drawn as plain rects rather than a `<text>` glyph so it renders
 * identically everywhere (an SVG favicon is rasterized without the page's fonts,
 * and U+22A8 is missing from many system faces).
 *
 * Served from a route rather than `public/`, which is a build artifact: the icon
 * is part of the shell, and the shell's colors live in the worker.
 *
 * The tile carries its own dark palette, because a favicon is rasterized from
 * this file alone and no stylesheet of ours reaches it — an internal `@media`
 * is the only way it can answer the question. Where a browser does not honour
 * one it simply keeps the light tile, which is what it drew before.
 */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Carnap">
  <style>
    .sheet { fill: #fbf7ef }
    .mark { fill: #0b66d8 }
    @media (prefers-color-scheme: dark) {
      .sheet { fill: #221d16 }
      .mark { fill: #5b9bef }
    }
  </style>
  <rect class="sheet" width="32" height="32" rx="6"/>
  <g class="mark">
    <rect x="8" y="6" width="2.8" height="20" rx="0.6"/>
    <rect x="8" y="12.2" width="16" height="2.8" rx="0.6"/>
    <rect x="8" y="17.6" width="16" height="2.8" rx="0.6"/>
  </g>
</svg>
`;

/** A day is plenty: the icon changes with a deploy, not with content. */
export const FAVICON_CACHE_CONTROL = "public, max-age=86400";
