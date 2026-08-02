# Social cards — platform details, archetypes, dynamic cards

Read this when the brief goes past a single static site-wide image.

## Contents

- [Meta tags](#meta-tags)
- [Sizes and cropping](#sizes-and-cropping)
- [Cache invalidation](#cache-invalidation)
- [Composition archetypes](#composition-archetypes)
- [Per-page and dynamic cards](#per-page-and-dynamic-cards)
- [Checks before shipping](#checks-before-shipping)

## Meta tags

```html
<meta property="og:type"         content="website">
<meta property="og:title"        content="…">
<meta property="og:description"  content="…">
<meta property="og:url"          content="https://example.com/page">
<meta property="og:image"        content="https://example.com/og-image.png">
<meta property="og:image:width"  content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt"    content="…">
<meta property="og:locale"       content="en_US">

<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="…">
<meta name="twitter:description" content="…">
<meta name="twitter:image"       content="https://example.com/og-image.png">
```

Two things scrapers are strict about: the image URL must be **absolute**, and
`og:image:width` / `og:image:height` must match the file. Emit all of it from
one partial or layout helper so a caller cannot set the image without the
dimensions following.

If a page needs no card of its own, it inherits the site-wide one — that's fine.
What isn't fine is a page whose tags point at an image that no longer exists.

## Sizes and cropping

- **1200×630** (1.91:1) is the workhorse. It satisfies Open Graph and Twitter's
  `summary_large_image`, and downscales cleanly everywhere else.
- Twitter renders closer to 2:1 and shaves the top and bottom slightly.
- Messaging apps (iMessage, WhatsApp, Telegram) often show a **much smaller and
  sometimes near-square** preview.
- Keep anything load-bearing — the headline especially — inside a centre-safe
  region, roughly a 5% inset on every edge, and don't let meaning depend on the
  extreme corners.
- Keep the file comfortably under ~1 MB. Flat UI-derived art belongs in PNG;
  photographic backgrounds belong in JPEG.
- `summary` (small square card) is a different product. Only use it when the
  page genuinely has no wide imagery worth showing.

## Cache invalidation

Every platform caches aggressively, and most cache by URL. Replacing
`og-image.png` in place will **not** refresh previews for links already shared,
and often not for new shares either for hours or days.

- Facebook: the Sharing Debugger has a "Scrape Again" button.
- LinkedIn: the Post Inspector re-fetches on demand.
- Twitter/X and most messengers: no reliable manual purge.

The dependable fix is a **new URL** — `og-image-v2.png`, or a query string the
CDN treats as distinct. Worth deciding up front: if the card will be iterated
on, version the filename from day one.

## Composition archetypes

Pick the one that matches what the product actually is, rather than defaulting
to the first.

- **Product scene** — real UI surfaces (cards, rows, badges) arranged with a
  primary artifact in focus and secondaries peeking behind. The default for
  anything with a UI worth showing.
- **Data scene** — a chart, diff, or table rendered in the product's own style.
  Strong for analytics, observability, and dev tools, where the output *is* the
  product.
- **Editorial** — a large typographic statement with a restrained graphic
  accent. Right for writing, docs, changelogs, and launch posts, and the safest
  choice when the UI is not photogenic.
- **Comparison** — two states side by side (before/after, us/them, input/output).
  Communicates a transformation faster than prose can.
- **Object** — a single hero object rendered large: a device, a package, a
  physical product. Needs real art direction to avoid looking like clip art.

Whichever you pick, the headline does the identity work and the figure does the
explaining. If the figure needs a caption to make sense, it's the wrong figure.

## Per-page and dynamic cards

Static site-wide cards are the right default. Move to per-page cards when the
shared thing is the page's *content* — a blog post, a profile, a repository, a
dashboard.

Two ways to build them:

1. **Build-time**: generate one PNG per page during the build with the same
   renderer, writing to a content-addressed path. Simple, cacheable, no runtime
   cost. Best when the page set is known at build time.
2. **Request-time**: a route that renders HTML and screenshots it, or an edge
   function using a satori-style HTML-to-SVG renderer. Necessary for
   user-generated content. Cache hard and set a long `max-age`; scrapers hit
   these endpoints repeatedly.

Either way, keep the **template** in version control and treat the per-page
image as derived output. Guard the text you interpolate: titles are
user-controlled in most systems, so escape them, cap their length, and lay them
out so an unexpectedly long one wraps or truncates rather than destroying the
composition. Render the longest realistic title as one of your test cases.

## Checks before shipping

- View the PNG scaled to ~300px wide. Is the headline still readable?
- Crop it to a square in your head. Does anything essential fall outside?
- Does every label match the product's real wording?
- Do any numbers shown contradict the product's own rules?
- Are all names, logos, and quotes either real-and-yours or clearly anonymous?
- Do the declared meta dimensions match the actual file?
