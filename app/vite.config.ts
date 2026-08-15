import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/**
 * Where this build thinks it lives. Override per-deploy with WARSHA_ORIGIN.
 *
 * No trailing slash — every use below appends its own path, and `${origin}//`
 * is a different URL to a crawler than `${origin}/`.
 */
const DEFAULT_ORIGIN = 'https://warsha.sb.sa'

/**
 * The one place the deployed origin is written down.
 *
 * An SPA built with `base: '/'` is otherwise entirely host-relative and has no
 * reason to know its own origin — except in the four places that cannot be
 * relative: `<link rel=canonical>`, `og:url`, `og:image` and `twitter:image`.
 * A social scraper does not resolve a relative image URL against the page it
 * just fetched. It drops the card.
 *
 * This shipped broken. index.html carried the literal placeholder
 * `https://warsha.example` behind a "DEPLOY STEP: replace this" comment, the
 * replacement never happened, and for as long as that was live every link
 * preview on every platform — WhatsApp, X, Telegram, Slack, Discord — was
 * blank, because warsha.example is an IANA-reserved domain that resolves to
 * nothing. A comment asking a human to remember is not a build step. This is.
 *
 * The default is production, so the failure mode of a forgotten env var is a
 * correct build rather than a placeholder one.
 */
function resolveOrigin(): string {
  // `|| DEFAULT_ORIGIN`, deliberately not `??`. An unset Docker build arg
  // declared as `ARG WARSHA_ORIGIN` + `ENV WARSHA_ORIGIN=${WARSHA_ORIGIN}`
  // arrives here as the EMPTY STRING, not as undefined — and `??` would accept
  // it, yielding href="/" and og:image="/og-image.png". Relative. Which is the
  // original bug wearing a different hat.
  const origin = (process.env.WARSHA_ORIGIN?.trim() || DEFAULT_ORIGIN).replace(/\/+$/, '')
  // Fail the build rather than emit metadata that is quietly wrong. A scraper
  // gives no error message; it just shows no card, which is how the last one
  // went unnoticed. Everything downstream concatenates `${origin}/path`.
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
    throw new Error(
      `WARSHA_ORIGIN must be an absolute origin with no path, e.g. https://warsha.sb.sa — got ${JSON.stringify(process.env.WARSHA_ORIGIN)}`,
    )
  }
  return origin
}

function warshaSiteOrigin(): Plugin {
  const origin = resolveOrigin()
  return {
    name: 'warsha:site-origin',
    // Runs in dev too, so what you see locally is what ships. The token is
    // `__WARSHA_ORIGIN__` and not Vite's own `%VITE_ORIGIN%` on purpose: the
    // built-in form leaves the placeholder *in the output* when the variable is
    // undefined, which is the exact class of bug this function exists to end.
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('__WARSHA_ORIGIN__', origin),
    },
    // robots.txt and sitemap.xml are generated rather than committed to public/
    // for the same reason: both have to spell the origin, and a second
    // hand-maintained copy of it is a second thing to forget.
    //
    // Their absence was itself a live bug. With neither file on disk, nginx's
    // SPA catch-all (`try_files $uri $uri/ /index.html`) answered /robots.txt
    // and /sitemap.xml with 200 text/html — a crawler asking for robots got a
    // React shell. Once the files exist, `$uri` matches first and the catch-all
    // never sees them; deploy/nginx.conf pins that with an explicit =404 so a
    // future build that stops emitting them fails loudly instead of silently
    // serving HTML again.
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(origin) })
      const tutorials = await loadTutorials()
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: sitemapXml(origin, tutorials.map((t) => t.id)),
      })
    },
  }
}

const robotsTxt = (origin: string) => `# Warsha — ${origin}
#
# Indexable URLs: / (x-default, picks the language from the browser), /en/, /ar/,
# and the tutorials — the index at /tutorials/ and one prerendered page per
# lesson (each also under /en/ and /ar/). The sitemap lists them all with their
# hreflang sets; the locale prefix is what gives each language a rankable address.
#
# Everything else this origin serves is a build product the student's browser
# fetches on demand (the engine wasm, ecj.jar, the .NET _framework bundle) and
# nothing links to any of it, so there is nothing worth disallowing — and a
# Disallow covering them would only risk Googlebot reporting blocked resources
# while it renders the page.
User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`

/**
 * The three prefixed variants of one indexable path. `${origin}/${path}` is
 * x-default — it resolves the language itself, from the student's own browser —
 * and `/en/${path}` `/ar/${path}` are the two addresses a search engine can
 * attach a language to. `path` is relative to the origin root with no locale
 * prefix and a trailing slash (`''` for home, `'tutorials/<slug>/'` for a
 * lesson).
 *
 * Every page in the cluster carries the whole cluster (including a link to
 * itself); hreflang is only honoured when it is reciprocal, and a page that
 * omits its own entry is dropped from the set.
 */
const hreflangCluster = (origin: string, path = '') => [
  { hreflang: 'x-default', href: `${origin}/${path}` },
  { hreflang: 'en', href: `${origin}/en/${path}` },
  { hreflang: 'ar', href: `${origin}/ar/${path}` },
]

/**
 * Every indexable page, each as three reciprocal hreflang URLs: the home shell,
 * the tutorials index, and one per lesson (slugs passed in from the real
 * TUTORIALS registry, so a new lesson lands in the sitemap automatically).
 *
 * Deliberately no <lastmod>: it would either be the build timestamp (which
 * changes on every deploy and claims a freshness the content does not have) or
 * a hand-maintained date (which rots). Google discounts unreliable lastmod
 * anyway, and an omitted field costs nothing. Add one per-URL when there are
 * real content pages whose dates mean something.
 */
const sitemapXml = (origin: string, tutorialSlugs: string[] = []) => {
  const paths = ['', 'tutorials/', ...tutorialSlugs.map((s) => `tutorials/${s}/`)]
  const block = (path: string) => {
    const cluster = hreflangCluster(origin, path)
    const alternates = cluster
      .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
      .join('\n')
    // The alternates repeat inside every <url>, which looks redundant and is not:
    // the sitemap protocol treats each <url> independently, so a block listed once
    // would annotate one URL and leave the other two unlinked.
    return cluster.map((a) => `  <url>\n    <loc>${a.href}</loc>\n${alternates}\n  </url>`).join('\n')
  }
  const urls = paths.map(block).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
>
${urls}
</urlset>
`
}

/**
 * The tutorials registry, evaluated at build time so the sitemap and the
 * prerendered pages both derive from the ONE source of truth (src/tutorials).
 *
 * It can't be `import`ed here: each lesson pulls in a React icon component, which
 * would drag JSX/React into this Node config. So rolldown (Vite's own bundler)
 * bundles the registry with the icon module stubbed to a Proxy whose every
 * property is a `() => null` — a CJS stub, so rolldown's interop satisfies the
 * lessons' named `import { IconX }` — then it is evaluated from a `data:` URL. The
 * icons are UI-only; the prerender needs the text, not the glyphs. Cached so the
 * sitemap plugin and the page plugin share one evaluation.
 */
interface TutorialStep {
  title: { en: string; ar: string }
  body: { en: string; ar: string }
  shot: string
  alt: { en: string; ar: string }
}
interface TutorialData {
  id: string
  title: { en: string; ar: string }
  summary: { en: string; ar: string }
  steps: TutorialStep[]
}
let tutorialsCache: Promise<TutorialData[]> | null = null
function loadTutorials(): Promise<TutorialData[]> {
  if (!tutorialsCache) tutorialsCache = evalTutorials()
  return tutorialsCache
}
async function evalTutorials(): Promise<TutorialData[]> {
  const { rolldown } = await import('rolldown')
  const bundle = await rolldown({
    input: resolve(__dirname, 'src/tutorials/index.ts'),
    plugins: [
      {
        name: 'stub-icons',
        resolveId(id) {
          return /components\/ui\/(Icons|LangIcons)$/.test(id) ? '\0stub-icons' : null
        },
        load(id) {
          return id === '\0stub-icons' ? 'module.exports = new Proxy({}, { get: () => () => null })' : null
        },
      },
    ],
  })
  const { output } = await bundle.generate({ format: 'esm' })
  await bundle.close()
  const mod = (await import(`data:text/javascript,${encodeURIComponent(output[0].code)}`)) as {
    TUTORIALS: TutorialData[]
  }
  return mod.TUTORIALS
}

/**
 * The per-locale <head>, and the only place Warsha's own marketing copy is
 * written twice.
 *
 * The rules are i18n/ar.ts's rules, because a student reading a search result is
 * the same reader: Java and Python keep their English names (that is what the
 * textbook, the exam and the search box all say), digits are Western, and ورشة
 * is a normal Arabic noun rather than a brand token bolted onto a formula.
 *
 * The Arabic is not a translation of the English line by line — «بلا تثبيت وبلا
 * حساب» carries "no install, no account" in one breath where a literal rendering
 * needs two clauses and reads like a form.
 */
type LocaleMeta = {
  dir: 'ltr' | 'rtl'
  ogLocale: string
  /** Filename in public/, rendered from the matching docs/design/og-image*.html
   *  by tools/brand/build-brand-assets.mjs. An RTL card is not a mirrored LTR
   *  card — the window shells mirror, the code and console panes deliberately do
   *  not — which is why they are two authored documents, not one template. */
  image: string
  title: string
  description: string
  socialDescription: string
  imageAlt: string
}

const LOCALE_META: Record<'en' | 'ar', LocaleMeta> = {
  en: {
    dir: 'ltr',
    ogLocale: 'en_US',
    image: 'og-image.png',
    title: 'Warsha — Java & Python IDE in your browser',
    description:
      'Warsha is a free, open-source IDE that runs Java and Python entirely in your browser — no install, no account. It works on a phone, and your files stay on your device.',
    socialDescription:
      'Write and run Java or Python in your browser. No install, no account — it works on the phone you already have.',
    imageAlt:
      'Warsha on a tablet and a phone: the tablet runs the Java starter with its file tree and console output, the phone runs the Python starter.',
  },
  ar: {
    dir: 'rtl',
    ogLocale: 'ar_SA',
    image: 'og-image-ar.png',
    title: 'ورشة — بيئة برمجة Java و Python داخل المتصفّح',
    description:
      'ورشة بيئة برمجة مجانية ومفتوحة المصدر، تشغّل Java و Python داخل متصفّحك — بلا تثبيت وبلا حساب. تعمل على الجوال، وملفاتك تبقى على جهازك.',
    socialDescription:
      'اكتب Java أو Python وشغّلها في متصفّحك. بلا تثبيت وبلا حساب — تعمل على الجهاز الذي بين يديك.',
    imageAlt:
      'ورشة على جهاز لوحي وهاتف: اللوحي يشغّل قالب Java مع شجرة الملفات والمخرجات، والهاتف يشغّل قالب Python.',
  },
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Emits dist/en/index.html and dist/ar/index.html.
 *
 * These are entry points, not landing pages. Each is the built index.html with a
 * rewritten head, and it boots the same app from the same hashed bundle one
 * directory up — `src/i18n/locale.ts` reads the path prefix and opens in that
 * language. Nothing about `/` changes, and no script is injected into the copy.
 *
 * Why at all: with a single URL, a crawler sees one `<html lang>`, one title and
 * one description. Warsha's interface is bilingual, so that hides half of it
 * from every Arabic query — and `og:locale:alternate` alone is a hint, not an
 * address. hreflang needs somewhere to point.
 *
 * Runs in `closeBundle`, reading dist/index.html off disk, for the same reason
 * the service-worker plugin below does: the finished HTML — hashed asset names,
 * substituted origin, whatever future plugins add — only exists once Vite has
 * written it. Deriving these from the real output rather than re-templating a
 * second copy of the head is what stops the three pages drifting apart.
 */
function warshaLocaleEntries(): Plugin {
  const origin = resolveOrigin()
  return {
    name: 'warsha:locale-entries',
    apply: 'build',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist')
      let root: string
      try {
        root = readFileSync(resolve(distDir, 'index.html'), 'utf8')
      } catch {
        return // No HTML in this output (a library build); nothing to localise.
      }
      for (const [loc, meta] of Object.entries(LOCALE_META)) {
        assertCardSize(resolve(distDir, meta.image), root, meta.image)
        mkdirSync(resolve(distDir, loc), { recursive: true })
        writeFileSync(resolve(distDir, loc, 'index.html'), localiseHtml(root, loc, meta, origin))
      }
    },
  }
}

/**
 * Every locale's card must be exactly the dimensions index.html declares.
 *
 * `og:image:width`/`height` are a promise to the scraper, not a hint: a card
 * whose real pixels disagree gets laid out against the declared box and comes
 * back letterboxed or cropped, and — like every other failure on this path —
 * says nothing at all about why. Now that a second PNG shares one declared size,
 * that is an invariant across two files nobody is watching, so it is checked
 * here instead of remembered.
 *
 * Read straight out of the PNG's IHDR (8-byte signature, 4-byte length, "IHDR",
 * then two big-endian uint32s). No image library for two integers.
 */
function assertCardSize(file: string, rootHtml: string, name: string) {
  const declared = (attr: string) =>
    Number(rootHtml.match(new RegExp(`property="og:image:${attr}"[^>]*content="(\\d+)"`))?.[1])
  const png = readFileSync(file)
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`${name} is not a PNG`)
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  const [dw, dh] = [declared('width'), declared('height')]
  if (w !== dw || h !== dh) {
    throw new Error(
      `${name} is ${w}x${h} but index.html declares og:image ${dw}x${dh}. Re-render it (node tools/brand/build-brand-assets.mjs) or change the declared size — a card that disagrees with its own dimensions is cropped by the scraper with no error.`,
    )
  }
}

/** Replace the `content="…"` of the first <meta> carrying `attr`. The tag may be
 *  wrapped across lines — `[^>]` matches newlines, and cannot escape the tag. */
const setMeta = (html: string, attr: string, value: string) =>
  html.replace(
    new RegExp(`(<meta[^>]*\\b${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*\\scontent=")[^"]*(")`, 'i'),
    (_m, open: string, close: string) => open + escapeHtml(value) + close,
  )

function localiseHtml(root: string, loc: string, meta: LocaleMeta, origin: string): string {
  const self = `${origin}/${loc}/`
  let html = root

  // Static lang/dir rather than waiting for initLocale() to set them. A crawler
  // never runs the script, and a reader gets the first paint already in the
  // right direction instead of one LTR frame that flips.
  html = html.replace(/<html[^>]*>/i, `<html lang="${loc}" dir="${meta.dir}">`)

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`)
  html = setMeta(html, 'name="description"', meta.description)
  html = setMeta(html, 'property="og:title"', meta.title)
  html = setMeta(html, 'property="og:description"', meta.socialDescription)
  html = setMeta(html, 'property="og:image:alt"', meta.imageAlt)
  html = setMeta(html, 'name="twitter:title"', meta.title)
  html = setMeta(html, 'name="twitter:description"', meta.socialDescription)
  html = setMeta(html, 'name="twitter:image:alt"', meta.imageAlt)

  // The card itself. An Arabic result that previews an English screenshot is
  // half a translation — and this is the one asset a reader judges before they
  // have read a word. og:image:width/height are NOT rewritten: both cards are
  // 1200x630, which assertCardSize() checks on every build precisely because
  // that shared assumption now spans two files.
  const image = `${origin}/${meta.image}`
  html = setMeta(html, 'property="og:image"', image)
  html = setMeta(html, 'name="twitter:image"', image)

  // og:locale is what this page IS; the alternate is the other one. Swapping
  // both keeps the pair honest on each copy.
  html = setMeta(html, 'property="og:locale"', meta.ogLocale)
  html = setMeta(
    html,
    'property="og:locale:alternate"',
    loc === 'ar' ? LOCALE_META.en.ogLocale : LOCALE_META.ar.ogLocale,
  )

  // Self-referencing canonical. Pointing these three pages at `/` instead would
  // tell Google the other two should not be indexed at all, which is the exact
  // opposite of why they exist. The hreflang cluster is inherited verbatim from
  // index.html — it is identical on every page by design.
  html = html.replace(
    /(<link rel="canonical" href=")[^"]*(")/i,
    (_m, open: string, close: string) => open + self + close,
  )
  html = setMeta(html, 'property="og:url"', self)

  // No asset-path rewrite needed: under `base: '/'` every reference in the built
  // index.html is already root-absolute (`/assets/…`, `/favicon.svg`,
  // `/coi-serviceworker.js`), so a copy one directory deep at `/en/` points at
  // exactly the same files, and the service worker registered from `/` still has
  // scope `/` and serves all three pages.

  // JSON-LD is parsed rather than patched by regex — it is the one block where a
  // near-miss would ship as silently invalid structured data instead of as a
  // visibly wrong tag. Parsing also validates index.html's copy on every build.
  html = html.replace(
    /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/i,
    (_m, open: string, json: string, close: string) => {
      const data = JSON.parse(json)
      data.url = self
      data.name = loc === 'ar' ? 'ورشة' : 'Warsha'
      data.description = meta.description
      data.inLanguage = loc
      data.image = image
      data.screenshot = image
      return `${open}\n      ${JSON.stringify(data, null, 2).split('\n').join('\n      ')}\n    ${close}`
    },
  )

  return html
}

/** The tutorials index's own heading + lead, per content language (the lessons
 *  themselves carry their titles/summaries). Kept in step with COPY.tutorialsTitle
 *  / tutorialsSubtitle in src/i18n. */
const TUTORIALS_INDEX_META = {
  en: { title: 'Tutorials', subtitle: 'Short, illustrated walkthroughs of everything you can do in Warsha.' },
  ar: { title: 'الدروس', subtitle: 'شروحات قصيرة مصوّرة لكل ما يمكنك فعله في ورشة.' },
} as const

type PageVariant = { prefix: '' | 'en' | 'ar'; loc: 'en' | 'ar' }

/** The three variants every tutorial page ships as, mirroring the /en/ /ar/ home
 *  entries: x-default (English at the unprefixed URL), en, and ar. */
const PAGE_VARIANTS: PageVariant[] = [
  { prefix: '', loc: 'en' },
  { prefix: 'en', loc: 'en' },
  { prefix: 'ar', loc: 'ar' },
]

/**
 * Prerenders the tutorials index and every lesson as static HTML, so search
 * engines index them and a no-JS crawler still reads them.
 *
 * Each page is the built index.html with its <head> retargeted (title,
 * description, canonical, og/twitter, hreflang cluster, JSON-LD) and #root filled
 * with the lesson's real text + screenshots. It boots the same hashed bundle; on
 * mount createRoot() clears #root (a client render, not hydration — no mismatch
 * to reconcile) under the full-screen splash, so a reader never sees the swap,
 * and the router opens the same lesson the URL names. Everything derives from the
 * evaluated TUTORIALS, so the pages and the sitemap cannot drift.
 */
function warshaTutorialPages(): Plugin {
  const origin = resolveOrigin()
  return {
    name: 'warsha:tutorial-pages',
    apply: 'build',
    async closeBundle() {
      const distDir = resolve(__dirname, 'dist')
      let root: string
      try {
        root = readFileSync(resolve(distDir, 'index.html'), 'utf8')
      } catch {
        return // No HTML in this output (a library build); nothing to prerender.
      }
      const tutorials = await loadTutorials()
      const write = (path: string, html: string) => {
        const dir = resolve(distDir, path)
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(dir, 'index.html'), html)
      }
      for (const v of PAGE_VARIANTS) {
        const dirPrefix = v.prefix ? `${v.prefix}/` : ''
        write(`${dirPrefix}tutorials`, renderTutorialsIndex(root, origin, v, tutorials))
        for (const t of tutorials) {
          write(`${dirPrefix}tutorials/${t.id}`, renderLessonPage(root, origin, v, t))
        }
      }
    },
  }
}

/** The self URL of a page under a variant — `${origin}/`, `${origin}/en/`, plus
 *  the path (e.g. `tutorials/getting-started/`). */
const pageUrl = (origin: string, v: PageVariant, path: string) =>
  `${origin}/${v.prefix ? `${v.prefix}/` : ''}${path}`

function renderTutorialsIndex(root: string, origin: string, v: PageVariant, tutorials: TutorialData[]): string {
  const m = TUTORIALS_INDEX_META[v.loc]
  const linkBase = v.prefix ? `/${v.prefix}` : ''
  const items = tutorials
    .map(
      (t) =>
        `        <li><a href="${linkBase}/tutorials/${t.id}/">${escapeHtml(t.title[v.loc])}</a> — ${escapeHtml(t.summary[v.loc])}</li>`,
    )
    .join('\n')
  const body =
    `      <main>\n` +
    `        <h1>${escapeHtml(m.title)}</h1>\n` +
    `        <p>${escapeHtml(m.subtitle)}</p>\n` +
    `        <ul>\n${items}\n        </ul>\n` +
    `      </main>`
  const url = pageUrl(origin, v, 'tutorials/')
  return renderPrerendered(root, origin, {
    ...v,
    path: 'tutorials/',
    title: `${m.title} — Warsha`,
    description: m.subtitle,
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${m.title} — Warsha`,
      description: m.subtitle,
      inLanguage: v.loc,
      url,
    },
  })
}

function renderLessonPage(root: string, origin: string, v: PageVariant, t: TutorialData): string {
  const title = t.title[v.loc]
  const summary = t.summary[v.loc]
  const steps = t.steps
    .map(
      (s) =>
        `        <li>\n` +
        `          <h2>${escapeHtml(s.title[v.loc])}</h2>\n` +
        `          <p>${escapeHtml(s.body[v.loc])}</p>\n` +
        `          <img src="/tutorials/${s.shot}.${v.loc}.png" alt="${escapeHtml(s.alt[v.loc])}" width="1280" height="800" loading="lazy" />\n` +
        `        </li>`,
    )
    .join('\n')
  const body =
    `      <main>\n` +
    `        <h1>${escapeHtml(title)}</h1>\n` +
    `        <p>${escapeHtml(summary)}</p>\n` +
    `        <ol>\n${steps}\n        </ol>\n` +
    `      </main>`
  const url = pageUrl(origin, v, `tutorials/${t.id}/`)
  return renderPrerendered(root, origin, {
    ...v,
    path: `tutorials/${t.id}/`,
    title: `${title} — Warsha`,
    description: summary,
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description: summary,
      inLanguage: v.loc,
      image: `${origin}/${LOCALE_META[v.loc].image}`,
      url,
      isPartOf: { '@type': 'WebSite', name: 'Warsha', url: `${origin}/` },
    },
  })
}

interface Prerendered extends PageVariant {
  path: string
  title: string
  description: string
  body: string
  jsonLd: object
}

/** The shared head/body rewrite — the tutorials analogue of localiseHtml, reusing
 *  the same setMeta/escapeHtml machinery, but retargeting the hreflang cluster and
 *  the #root body per page rather than inheriting the home copy. */
function renderPrerendered(root: string, origin: string, m: Prerendered): string {
  const meta = LOCALE_META[m.loc]
  const self = pageUrl(origin, m, m.path)
  const image = `${origin}/${meta.image}`
  let html = root

  html = html.replace(/<html[^>]*>/i, `<html lang="${m.loc}" dir="${meta.dir}">`)

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(m.title)}</title>`)
  html = setMeta(html, 'name="description"', m.description)
  html = setMeta(html, 'property="og:title"', m.title)
  html = setMeta(html, 'property="og:description"', m.description)
  html = setMeta(html, 'name="twitter:title"', m.title)
  html = setMeta(html, 'name="twitter:description"', m.description)

  // The card stays the locale card (og-image[-ar].png): the lesson screenshots are
  // 1280x800, but og:image is declared 1200x630 and assertCardSize() enforces that
  // — a bespoke per-lesson card is a clean future enhancement, not a regression risk.
  html = setMeta(html, 'property="og:image"', image)
  html = setMeta(html, 'name="twitter:image"', image)
  html = setMeta(html, 'property="og:image:alt"', meta.imageAlt)
  html = setMeta(html, 'name="twitter:image:alt"', meta.imageAlt)

  html = setMeta(html, 'property="og:locale"', meta.ogLocale)
  html = setMeta(html, 'property="og:locale:alternate"', m.loc === 'ar' ? LOCALE_META.en.ogLocale : LOCALE_META.ar.ogLocale)

  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/i, (_m, open: string, close: string) => open + self + close)
  html = setMeta(html, 'property="og:url"', self)

  // Retarget the hreflang cluster: index.html carries the HOME cluster, but this
  // page's three variants must point at this page's URLs (reciprocal, or Google
  // drops the set).
  const cluster = hreflangCluster(origin, m.path)
  html = html.replace(
    /<link rel="alternate" hreflang="x-default"[^>]*>\s*<link rel="alternate" hreflang="en"[^>]*>\s*<link rel="alternate" hreflang="ar"[^>]*>/i,
    cluster.map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`).join('\n    '),
  )

  // JSON-LD swapped for this page's node — stringified (not regex-patched) so a
  // malformed node would be a build error, not silently-invalid structured data.
  html = html.replace(
    /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/i,
    (_m, open: string, _json: string, close: string) =>
      `${open}\n      ${JSON.stringify(m.jsonLd, null, 2).split('\n').join('\n      ')}\n    ${close}`,
  )

  // The crawlable body replaces #root's loading mark. createRoot() clears #root on
  // mount (a client render — no hydration mismatch), under the opaque splash, so a
  // human never sees this; a crawler and a no-JS reader do.
  html = html.replace(/<div id="root">[\s\S]*?<\/div>\s*<\/div>/i, `<div id="root">\n${m.body}\n    </div>`)

  return html
}

/**
 * Feeds the offline service worker its precache list at build time.
 *
 * public/coi-serviceworker.js reads `self.__WARSHA_PRECACHE__` (the hashed
 * JS/CSS this build emitted) and `self.__WARSHA_VERSION__` (a content hash that
 * names its caches, so a new deploy evicts the old ones). Those globals cannot
 * be known until the bundle exists, so rather than tokenise the vendored SW we
 * PREPEND a two-line header to the copy Vite has already placed in dist/. The
 * source file in public/ is never touched; in dev the globals are simply
 * undefined and the SW falls back to runtime caching only. Build-only.
 */
function warshaServiceWorkerPrecache(): Plugin {
  let assets: string[] = []
  return {
    name: 'warsha:sw-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle)
        .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
        .map((name) => `./${name}`)
        .sort()
    },
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/coi-serviceworker.js')
      let source: string
      try {
        source = readFileSync(swPath, 'utf8')
      } catch {
        // No SW in the output (e.g. a library build) — nothing to inject.
        return
      }
      const version = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 8)
      const header =
        `self.__WARSHA_VERSION__=${JSON.stringify(version)};` +
        `self.__WARSHA_PRECACHE__=${JSON.stringify(assets)};\n`
      writeFileSync(swPath, header + source)
    },
  }
}

export default defineConfig({
  // Root-absolute asset paths (`/assets/…`, `/warsha-*`), so the app boots
  // correctly at any URL depth — `/`, `/en/`, `/tutorials/<slug>`. The former
  // `base: './'` made every reference relative to the current path, which 404s
  // at a deep route and is why the `/en//ar/` entries once stripped their prefix
  // before the bundle loaded. Absolute paths retire that whole class of bug; the
  // app is only ever served from the origin root (see resolveOrigin).
  base: '/',
  plugins: [
    react(),
    tailwind(),
    warshaSiteOrigin(),
    warshaLocaleEntries(),
    warshaTutorialPages(),
    warshaServiceWorkerPrecache(),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  // Required, not a preference (runtimes/python/INTEGRATION.md §2a). The engines
  // resolve their worker with `new Worker(new URL('./worker.js', import.meta.url),
  // { type: 'module' })`. Vite's default 'iife' wraps the emitted worker chunk and
  // rewrites import.meta.url inside it, which lands you on the classic-worker
  // failure mode: importScripts fetches no-cors, coi-serviceworker passes the
  // opaque response through, and COEP: require-corp then blocks the loader.
  worker: { format: 'es' },
  server: {
    port: 8083,
    // Two reasons, both real: docs/design/tokens.css is imported in place from
    // outside app/, and `vite dev` otherwise 403s the engines' worker.js under
    // runtimes/ — which surfaces as a misleading "worker failed to start".
    fs: { allow: ['..'] },
  },
  preview: { port: 8083 },
})
