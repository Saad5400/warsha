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
 * An SPA built with `base: './'` is otherwise entirely relative and has no
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
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(origin) })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(origin) })
    },
  }
}

const robotsTxt = (origin: string) => `# Warsha — ${origin}
#
# Three indexable URLs: / (x-default, picks the language from the browser),
# /en/ and /ar/. They are the same app; the prefix is what gives each language
# an address a search engine can rank. See the sitemap for the hreflang set.
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
 * The three indexable URLs. `/` is x-default — it resolves the language itself,
 * from the student's own browser — and `/en/` `/ar/` are the two addresses a
 * search engine can actually attach a language to.
 *
 * Every page in the cluster carries the whole cluster (including a link to
 * itself); hreflang is only honoured when it is reciprocal, and a page that
 * omits its own entry is dropped from the set.
 */
const hreflangCluster = (origin: string) => [
  { hreflang: 'x-default', href: `${origin}/` },
  { hreflang: 'en', href: `${origin}/en/` },
  { hreflang: 'ar', href: `${origin}/ar/` },
]

/**
 * Deliberately no <lastmod>: it would either be the build timestamp (which
 * changes on every deploy and claims a freshness the content does not have) or
 * a hand-maintained date (which rots). Google discounts unreliable lastmod
 * anyway, and an omitted field costs nothing. Add one per-URL when there are
 * real content pages whose dates mean something.
 */
const sitemapXml = (origin: string) => {
  const cluster = hreflangCluster(origin)
  const alternates = cluster
    .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
    .join('\n')
  // The alternates are repeated inside every <url>, which looks redundant and is
  // not: the sitemap protocol treats each <url> independently, so a block listed
  // once would annotate one URL and leave the other two unlinked.
  const urls = cluster
    .map((a) => `  <url>\n    <loc>${a.href}</loc>\n${alternates}\n  </url>`)
    .join('\n')
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
  title: string
  description: string
  socialDescription: string
  imageAlt: string
}

const LOCALE_META: Record<'en' | 'ar', LocaleMeta> = {
  en: {
    dir: 'ltr',
    ogLocale: 'en_US',
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
        mkdirSync(resolve(distDir, loc), { recursive: true })
        writeFileSync(resolve(distDir, loc, 'index.html'), localiseHtml(root, loc, meta, origin))
      }
    },
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

  // Every relative reference is one directory deeper now. `base: './'` is what
  // makes this a rewrite rather than a rebuild: the bundle, the fonts, the
  // icons, the manifest and coi-serviceworker.js are all still the same files at
  // the origin root, and registering the worker from `../` still gives it scope
  // `/`, so one service worker continues to serve all three pages.
  html = html.replace(/="\.\//g, '="../')

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
      return `${open}\n      ${JSON.stringify(data, null, 2).split('\n').join('\n      ')}\n    ${close}`
    },
  )

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
  base: './',
  plugins: [
    react(),
    tailwind(),
    warshaSiteOrigin(),
    warshaLocaleEntries(),
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
