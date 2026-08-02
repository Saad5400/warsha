---
name: og-image-and-favicon
description: Design and render Open Graph / social share images, favicons, app icons, and brand marks as committed artifacts generated from HTML/SVG source via headless Chromium. Use whenever someone mentions an og image, og:image, social card, share preview, link preview, Twitter card, favicon, apple-touch-icon, PWA or manifest icons, app icon, logo, or brand mark — and also when they say their link preview looks generic or blank, or when a project still ships a framework-default or placeholder icon. Works both for an existing site (mine its design system, reuse its logo) and for greenfield (establish tokens first). Prefer this over hand-rolling a one-off screenshot script or reaching for an image generator.
---

# Social cards, favicons, and brand marks

Two deliverables, one method: **design in HTML/SVG, render deterministically with
headless Chromium, commit both the source and the artifact.** The output is a
file someone can regenerate and diff, not a binary that appeared once and can
never be reproduced.

## Why the default result looks generic

Ask for a share image and you get logo + wordmark + tagline + URL, centered on a
gradient. It's generic because every element is *about* the product rather than
*made of* it. It would work equally well for any other product if you swapped
four strings.

The fix: **build the image out of the product's own surfaces** — its cards,
charts, score badges, table rows, terminal output, diff hunks, map pins,
whatever it actually renders. A person scrolling a feed learns what the thing
*does* in one glance, which is the only job the image has.

The same trap applies to marks. A star means "ratings", a chat bubble means
"messages", a checkmark means "done" — category signifiers, not identity. And a
mark that's just a Heroicon on a tile is a placeholder, not a logo.

## Before you design anything: get the design system

**Existing site — mine it, don't invent.** Spend real effort here; it's what
separates an image that looks like the product from one that looks like a
stranger's idea of it.

- Read the theme config (`tailwind.config`, CSS custom properties, `theme.ts`,
  design-token files) for colors, radii, shadows, spacing, fonts.
- Open two or three **real components** that will appear in the figure and copy
  their exact treatment — the badge's background/ring/text triple, the bar's
  height and track color, the card's border and shadow. Approximating these is
  the tell that the image was made without looking.
- Grab the **real vocabulary** from enums, i18n files, and constants. Label text
  that's subtly wrong ("Recommended" when the product says "I recommend it") is
  the same tell.
- **Reuse the existing logo as an asset.** Never redraw a client's mark to make
  it fit. Embed the real SVG/PNG. If the brief is only a share image, and it
  needs the logo at all, it belongs as a small quiet element — see the "what to
  leave out" note below.

**Greenfield — establish tokens first, then design.** Pick a type scale, a
neutral ramp, one or two accents, a radius, and a shadow, and write them down
before composing. Consistency is what makes flat geometry look intentional.
If the project will have a UI, choose tokens the UI can actually adopt.

---

## Part 1 — Open Graph / social share images

### Size and format

1200×630 (1.91:1) covers Open Graph and `summary_large_image` Twitter cards.
Emit `og:image:width` / `og:image:height` to match, and use an **absolute** URL.
PNG for flat UI-derived art, JPEG for photography.

Details that bite — per-platform cropping, cache invalidation, dynamic per-page
cards — are in `references/social-cards.md`. Read it when the brief goes beyond
one static site-wide image.

### Composition

The reliable structure is **one headline, one figure, a few proofs**:

- **Headline** (~55–65px): says what the product is *for*, in the product's
  voice. This carries identity and is the only text guaranteed to survive
  thumbnail scaling.
- **Figure** (~45–50% of the canvas): the product-made-of-itself scene.
- **Proofs**: two to four short capability lines or chips. Name real
  capabilities, not aspirations.

Give the figure depth so it reads as a real surface: a primary artifact in
sharp focus, one or two secondary ones peeking behind it at reduced opacity and
a few degrees of rotation. That "there is more where this came from" cue does a
lot of narrative work for very little pixel budget.

For RTL or other non-Latin layouts, set `dir` and `lang` on the root, mirror
directional shapes (bubble tails, arrows, progress fills), and force
`direction: ltr` on numeric fragments like `/ 5` or `v2.1` so they don't
reverse.

### What to leave out

The platform already renders the site name, the domain, and often the favicon
in its own card chrome. Repeating the URL and the app icon inside the image
spends your two most valuable regions on information the viewer is already
getting. Leave them out unless the mark is doing real compositional work.

### Legibility at thumbnail size

Feeds render these small — often 300px wide, sometimes cropped toward square.
After each render, **look at the image scaled down**. The headline must survive;
everything else is allowed to become texture. If the headline is illegible at
1/4 scale, it's too small or too low-contrast.

### Don't fabricate

These images are marketing assets that look like evidence, so the honesty bar is
the same as for any other published claim:

- No invented customer names, testimonials, reviews, or third-party logos.
  Anonymize the supporting cast — cropped edges and unlabeled rows read as
  "more of these exist" without asserting anything false.
- If numbers appear, make them **internally consistent with the product's real
  rules**. When the five bars in a breakdown are supposed to weight out to the
  displayed average, do the arithmetic and make them. Someone will check.
- Don't imply integrations, certifications, or scale the product doesn't have.

### Wire it up

Set `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, and
`twitter:image` from one source of truth in the template, so the declared
dimensions can't drift from the file. Then pin it with a test — see
"Testing what you shipped".

---

## Part 2 — Brand marks, favicons, app icons

### Explore wide, kill fast

Ideas are nearly free at this stage: each candidate is ~10 lines of SVG. Produce
**five or six genuinely different directions**, not one idea with five tweaks,
and judge them all at once on a contact sheet. Two or three rounds is normal —
round one exposes which family has legs, round two refines within it, round
three settles details like fill direction and tonal spread.

Concepts that tend to survive share a property: they encode **what the product
does**, not what category it's in. "Reviews resolving into a score" beats "a
star". Look for a two-element fusion — a container that says the domain plus a
payload that says the mechanism.

### The contact sheet is the judge

Render every candidate at 96, 64, 48, 32, 24, and 16px, plus a circular mask, a
dark background, and a lockup next to the wordmark. `scripts/contact-sheet.mjs`
does this. **Do not evaluate a mark at 512px** — everything looks good there,
and the failures below are invisible until you see the small sizes side by side.

### Failure catalogue

These are the ones that actually kill candidates. Check for them explicitly,
because each is obvious in hindsight and invisible while you're drawing:

- **Faces.** Two dots above a horizontal element is a face. A curve below two
  dots is a smiley. Humans see faces in almost anything, and once you see it you
  cannot unsee it. This kills more monogram and abstract-glyph ideas than
  anything else — check every candidate for it deliberately.
- **Stock UI icons.** Stacked horizontal bars read as text-align. A rounded rect
  with lines reads as a document. Fanned rectangles read as a credit card. If
  the mark is indistinguishable from something in an icon library, it isn't one.
- **Detail that dissolves.** Partial fills, thin strokes, gaps under ~2/64 of
  the canvas, and anything relying on subtle opacity vanish below 32px. A
  "partially filled star" becomes a star.
- **Shapes that collapse.** A pill whose height ≈ its width becomes a circle.
  Give near-square elements clearly different proportions or accept the circle.
- **Tonal spread that's too wide.** Elements below ~55% opacity disappear on
  light backgrounds at small sizes. Keep the range tight (1.0 / 0.8 / 0.6).

### From one mark to the whole icon set

Author the mark once with a `tile` rect and a `glyph` group, then let
`scripts/icons.mjs` emit every artifact from it. Two tile treatments matter:

- **Rounded tile** — `favicon.svg` and `favicon.ico`. The mark stands on its own
  and supplies its own corners.
- **Square, full-bleed tile with the glyph inset** — `apple-touch-icon.png` and
  the PWA icons. The platform supplies the corners and may crop to a circle, so
  the tile must reach every edge while the glyph stays inside the central safe
  zone (~80% for maskable).

Sizes, `purpose` semantics, the ICO format, and dark-mode SVG favicons are in
`references/icon-sets.md`.

---

## The render loop

The single highest-value habit: **render, actually look at the image, fix, repeat.**
Reading your own markup will not find these; every one of them is a real
failure caught only by looking:

- an inline `<span>` ignoring `height`, so a progress bar rendered empty
- `/ 5` rendering as `5 /` inside an RTL container
- a rotated element clipping off the canvas edge
- a label that doesn't match the product's actual wording

Use the Read tool on the rendered PNG. Three or four cycles is normal and cheap.

## Bundled scripts

Run these **from the project root** — Playwright is resolved from the project's
`node_modules` rather than bundled with the skill, so the browser matches the
project (`npm i -D playwright` if it's missing). Pass `CHROMIUM=<path>` when
Playwright's own browser build isn't present, which is common in sandboxes and
CI images. Every script prints its usage when run with no arguments.

| Script | Purpose |
| --- | --- |
| `scripts/render.mjs` | HTML file → PNG at an exact size. Embeds local fonts, waits for `document.fonts.ready`, rasterizes at 2× and downsamples via `scale: 'css'` so the output is exactly the requested dimensions and still crisp. |
| `scripts/fetch-font.mjs` | Pulls a `@fontsource/*` package via `npm pack` into a directory of woff2 files, for `render.mjs` to inline. Use when the site's font is a Google/Bunny font that a headless render can't fetch. |
| `scripts/contact-sheet.mjs` | One or more mark SVGs → a comparison sheet at real pixel sizes, with circular mask, dark background, and wordmark lockup. |
| `scripts/icons.mjs` | A mark SVG (with `id="tile"` and `id="glyph"`) → `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, and PWA icons. |

Fonts must be **inlined as base64** — headless renders frequently have no
network, and a silently-missing font changes every metric in the layout.
`render.mjs` handles this; just point it at a directory of woff2 files.

## Testing what you shipped

These artifacts rot quietly: someone swaps the PNG and the declared dimensions
go stale, or edits the inline logo component and the favicon no longer matches.
Cheap tests that catch it:

- The image exists at the dimensions the meta tags declare, and the tags point
  at it.
- Each icon artifact is present at its expected size; the ICO has the expected
  number of entries.
- If the mark also lives inline in a component, assert the shared geometry
  appears in both files — a drift guard for the one duplication you can't avoid.

Commit the HTML/SVG source next to the artifact and note the regeneration
command in the file header, so the next person changes the source rather than
editing a PNG by hand.
