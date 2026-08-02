# Icon sets — what to ship, and the shape each consumer expects

Read this when producing the actual favicon/app-icon files, or when auditing an
existing set.

## Contents

- [The minimum viable set](#the-minimum-viable-set)
- [Authoring the mark](#authoring-the-mark)
- [Maskable icons and the safe zone](#maskable-icons-and-the-safe-zone)
- [favicon.ico](#faviconico)
- [Dark mode](#dark-mode)
- [Web manifest](#web-manifest)
- [Auditing an existing set](#auditing-an-existing-set)

## The minimum viable set

| File | Size | Consumer | Shape |
| --- | --- | --- | --- |
| `favicon.svg` | vector | Modern browsers (preferred when present) | Rounded plate, self-contained |
| `favicon.ico` | 16/32/48 | Legacy browsers, tooling that hard-fetches `/favicon.ico` | Rounded plate |
| `apple-touch-icon.png` | 180×180 | iOS home screen, Safari | Square, full bleed, **no transparency** |
| `icon-192.png` | 192×192 | Android / PWA install | Square, full bleed |
| `icon-512.png` | 512×512 | Splash screens, stores | Square, full bleed |

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

`sizes="any"` on the `.ico` tells browsers that support SVG to prefer the SVG.

iOS composites `apple-touch-icon.png` onto black if it has transparency, and
applies its own rounding — so ship it square and opaque, never pre-rounded.

## Authoring the mark

Author once, derive everything. Give the source SVG two ids so tooling can
reshape it:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64">
  <defs>…</defs>
  <rect id="tile" width="64" height="64" rx="16" fill="…"/>
  <g id="glyph">…</g>
</svg>
```

A 64-unit viewBox is a comfortable grid: `rx="16"` is a 25% radius, and stroke
weights land on convenient halves. Whatever grid you choose, keep the smallest
meaningful feature at or above ~2 units — below that it dissolves at 16px.

If the mark also appears inline in the app (a Blade/JSX/Vue component, so CSS
can size and position it), that's a necessary duplication. Pin it with a test
that asserts the shared geometry appears in both files; otherwise someone edits
one and the site quietly ships two different logos.

## Maskable icons and the safe zone

Android, and increasingly other launchers, crop icons to arbitrary shapes —
circle, squircle, rounded square. The `maskable` purpose promises the icon
tolerates that.

- The tile must be **full bleed**: no transparent margin, no built-in rounding.
- All meaning must sit inside the **central 80% circle**. The corners are
  expendable.
- An inset of roughly 0.8–0.85 on the glyph satisfies this while still filling
  the frame.

`"purpose": "any maskable"` on a single file is a common compromise, and it's
what most projects ship. The honest downside: contexts that use it as `any`
render it visibly padded. If the icon matters, ship **two entries** — an
unpadded one for `any` and an inset one for `maskable`.

## favicon.ico

ICO is a container. Modern practice is to embed PNGs rather than BMPs — every
browser since IE11 reads that, and it avoids the palette and alpha-mask
awkwardness of the original format. 16/32/48 is the useful set.

The structure, if you're assembling one by hand (`scripts/icons.mjs` does this):

- 6-byte header: `reserved=0`, `type=1`, `count=n`
- `n` × 16-byte directory entries: width, height (both `0` meaning 256),
  colour count `0`, reserved `0`, planes `1`, bit depth `32`, byte length,
  byte offset
- the PNG payloads, concatenated

## Dark mode

An SVG favicon can adapt to the browser's theme, which the raster files cannot:

```svg
<style>
  @media (prefers-color-scheme: dark) {
    #tile { fill: #f8fafc; }
    #glyph { fill: #0f172a; }
  }
</style>
```

Only worth doing if the mark genuinely disappears against one theme. A saturated
plate with a light glyph usually reads fine on both, which is why plates are the
common choice for favicons in the first place. Always check the dark-background
cell on the contact sheet before deciding.

## Web manifest

```json
{
  "name": "…",
  "short_name": "…",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Keep `theme_color` in sync with the `<meta name="theme-color">` tag and with the
mark's dominant colour. Set `lang` and `dir` for non-English apps.

## Auditing an existing set

Fast ways to find that a project never actually did this:

- The mark is a framework default (the Laravel, Next, or Vite logo), or a bare
  letter on a coloured square.
- `apple-touch-icon.png` has an alpha channel, or is pre-rounded.
- The manifest declares `maskable` on an icon with transparent margins.
- `favicon.ico` holds a single 16×16 entry.
- The inline logo component and `favicon.svg` have drifted apart.
- The declared `sizes` in the manifest don't match the files' real dimensions.
