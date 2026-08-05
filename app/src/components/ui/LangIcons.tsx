/**
 * Language marks for Java and Python.
 *
 * These replace the "J" and "Py" letter badges. Two letters in a coloured box
 * is a label, not an icon: it has to be *read*, which is the opposite of what a
 * badge is for, and it tells a student nothing they did not already know.
 *
 * Both marks are drawn monochrome, in currentColor, to match this UI: it is a
 * black/white theme whose only sanctioned chroma is the four semantic tones,
 * and a full-colour brand logo sitting in it read as a foreign object. So each
 * is the recognised *shape* of its language's mark — the two-snake glyph, the
 * steaming cup — recoloured to a single ink, the way a monochrome favicon or a
 * status-bar glyph is. The shape carries the recognition; the colour never did
 * the identifying work in a badge this small. Both are vendored from Devicon's
 * MIT-licensed set (github.com/devicons/devicon) and recorded, with citation,
 * under "Language icons" in docs/legal/THIRD-PARTY.md.
 *
 * One caveat worth keeping visible: the PSF's trademark policy treats a
 * recoloured Python logo as a *derived* logo, distinct from the unaltered mark
 * its nominative-use permission covers. We are choosing the house-style
 * monochrome deliberately for visual coherence; if strict PSF-mark fidelity is
 * ever required, restore the two-colour `python-original` here and give the
 * Python badge its own non-currentColor path.
 *
 * Both are scaled into the same optical box (14 units of a 20 grid) so they
 * carry equal weight in a badge, and both were checked at 24/20/16px on dark
 * badge surfaces before shipping — the sizes FileBadge.tsx actually renders.
 *
 * Every icon is aria-hidden; the accessible name lives on the row or button.
 */
import { type SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

/**
 * Devicon's `java-plain` mark (icons/java/java-plain.svg), embedded unaltered:
 * same single path, only reparented from its native 128×128 viewBox into our
 * 20-unit grid via a translate+scale on a wrapping <g>, which changes nothing
 * about the artwork itself.
 *
 * currentColor: `java-plain` is Devicon's monochrome, recolour-by-design
 * variant, so it inherits the badge's foreground ink. The old two-tone cup
 * (blue cup, red steam) read as a faint smudge on the dark badge; one solid
 * ink is both far more visible and squarely inside this black/white UI.
 */
export const IconJava = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <g transform="translate(3 3) scale(0.109375)">
      <path
        fill="currentColor"
        d="M47.617 98.12c-19.192 5.362 11.677 16.439 36.115 5.969-4.003-1.556-6.874-3.351-6.874-3.351-10.897 2.06-15.952 2.222-25.844 1.092-8.164-.935-3.397-3.71-3.397-3.71zm33.189-10.46c-14.444 2.779-22.787 2.69-33.354 1.6-8.171-.845-2.822-4.805-2.822-4.805-21.137 7.016 11.767 14.977 41.309 6.336-3.14-1.106-5.133-3.131-5.133-3.131zm11.319-60.575c.001 0-42.731 10.669-22.323 34.187 6.024 6.935-1.58 13.17-1.58 13.17s15.289-7.891 8.269-17.777c-6.559-9.215-11.587-13.793 15.634-29.58zm9.998 81.144s3.529 2.91-3.888 5.159c-14.102 4.272-58.706 5.56-71.095.171-4.45-1.938 3.899-4.625 6.526-5.192 2.739-.593 4.303-.485 4.303-.485-4.952-3.487-32.013 6.85-13.742 9.815 49.821 8.076 90.817-3.637 77.896-9.468zM85 77.896c2.395-1.634 5.703-3.053 5.703-3.053s-9.424 1.685-18.813 2.474c-11.494.964-23.823 1.154-30.012.326-14.652-1.959 8.033-7.348 8.033-7.348s-8.812-.596-19.644 4.644C17.455 81.134 61.958 83.958 85 77.896zm5.609 15.145c-.108.29-.468.616-.468.616 31.273-8.221 19.775-28.979 4.822-23.725-1.312.464-2 1.543-2 1.543s.829-.334 2.678-.72c7.559-1.575 18.389 10.119-5.032 22.286zM64.181 70.069c-4.614-10.429-20.26-19.553.007-35.559C89.459 14.563 76.492 1.587 76.492 1.587c5.23 20.608-18.451 26.833-26.999 39.667-5.821 8.745 2.857 18.142 14.688 28.815zm27.274 51.748c-19.187 3.612-42.854 3.191-56.887.874 0 0 2.874 2.38 17.646 3.331 22.476 1.437 57-.8 57.816-11.436.001 0-1.57 4.032-18.575 7.231z"
      />
    </g>
  </svg>
)

/**
 * The two-snake Python shape, scaled into our 20 grid and drawn in one ink.
 *
 * Monochrome by design (see the file header): the two halves that carried the
 * PSF blue and gold now both take currentColor, so the mark inherits the
 * badge's foreground like every other glyph in this black/white UI. If strict
 * PSF-mark fidelity is ever required, restore `python-original`'s two colours
 * here — the header note spells out the trade-off.
 */
export const IconPython = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <g transform="translate(2.973 3.010) scale(0.127272)">
      <path
        fill="currentColor"
        d="M55.023-0.077c-25.971,0-26.25,10.081-26.25,12.156c0,3.148,0,12.594,0,12.594h26.75v3.781c0,0-27.852,0-37.375,0c-7.949,0-17.938,4.833-17.938,26.25c0,19.673,7.792,27.281,15.656,27.281c2.335,0,9.344,0,9.344,0s0-9.765,0-13.125c0-5.491,2.721-15.656,15.406-15.656c15.91,0,19.971,0,26.531,0c3.902,0,14.906-1.696,14.906-14.406c0-13.452,0-17.89,0-24.219C82.054,11.426,81.515-0.077,55.023-0.077z M40.273,8.392c2.662,0,4.813,2.15,4.813,4.813c0,2.661-2.151,4.813-4.813,4.813s-4.813-2.151-4.813-4.813C35.46,10.542,37.611,8.392,40.273,8.392z"
      />
      <path
        fill="currentColor"
        d="M55.397,109.923c25.959,0,26.282-10.271,26.282-12.156c0-3.148,0-12.594,0-12.594H54.897v-3.781c0,0,28.032,0,37.375,0c8.009,0,17.938-4.954,17.938-26.25c0-23.322-10.538-27.281-15.656-27.281c-2.336,0-9.344,0-9.344,0s0,10.216,0,13.125c0,5.491-2.631,15.656-15.406,15.656c-15.91,0-19.476,0-26.532,0c-3.892,0-14.906,1.896-14.906,14.406c0,14.475,0,18.265,0,24.219C28.366,100.497,31.562,109.923,55.397,109.923z M70.148,101.454c-2.662,0-4.813-2.151-4.813-4.813s2.15-4.813,4.813-4.813c2.661,0,4.813,2.151,4.813,4.813S72.809,101.454,70.148,101.454z"
      />
    </g>
  </svg>
)

/**
 * The Web mark: a `</>` in the code font's spirit, drawn as strokes on the same
 * 20-unit grid as the language logos above. There is no single vendor logo for
 * "HTML + CSS + JS", and a monochrome angle-bracket pair is the universal shorthand
 * for markup/code — which is exactly what this tile stands for. currentColor, like
 * the others, so it inherits the badge ink.
 */
export const IconWeb = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M7 6.5 3.5 10 7 13.5" />
    <path d="M13 6.5 16.5 10 13 13.5" />
    <path d="M11 5 9 15" />
  </svg>
)

/**
 * The C# mark: a "C" and a sharp, drawn as strokes on the same 20-unit grid as
 * the others. Unlike Python's snakes or Java's cup, C#'s brand *is* its
 * letterform, so a geometric "C#" is the mark here, not a placeholder — the same
 * reasoning that lets IconWeb use a `</>`. currentColor, monochrome, like the
 * rest. Two sharp strokes lean like a musical ♯ so it does not read as "C#" the
 * hashtag.
 */
export const IconCSharp = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M9 7.3A3.5 3.5 0 1 0 9 12.7" />
    <path d="M12.7 6.9 12 13.1" />
    <path d="M15.5 6.9 14.8 13.1" />
    <path d="M11.4 9.3 15.9 9.3" />
    <path d="M11.1 10.9 15.6 10.9" />
  </svg>
)

export type IconLang = 'java' | 'python' | 'web' | 'csharp'

export function LangIcon({ lang, ...rest }: { lang: IconLang } & IconProps) {
  if (lang === 'java') return <IconJava {...rest} />
  if (lang === 'web') return <IconWeb {...rest} />
  if (lang === 'csharp') return <IconCSharp {...rest} />
  return <IconPython {...rest} />
}

/* ---- bare file icons (W2-A) ---------------------------------------------- *
 *
 * The tab strip, breadcrumbs and (at desk) the explorer tree render a bare
 * 16px file icon instead of the chip badge — VS Code parity, where each file
 * type carries its language's brand ink (the Seti convention). This is a
 * deliberate, scoped amendment to the monochrome story in this file's header:
 * chips stay single-ink; the BARE icons are the one place chroma identifies.
 * The hex fills below are sanctioned here the way setup.ts's syntax colours
 * are — they are the palette, not layout, and never leave this file.
 *
 * The letterform marks (JS, TS, #, {}, M↓) follow IconCSharp's precedent: for
 * these languages the brand IS the letterform, so a geometric trace of it is
 * the mark, not a placeholder.
 */

const Mark = ({ size = 20, ...rest }: IconProps & { children?: React.ReactNode }) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  />
)

/** The "JS" letterform: J's stem-and-hook beside the S-curve. */
const IconJSMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M8.6 6v6.3a2.3 2.3 0 0 1-4.6 0" />
    <path d="M15.8 6.8C15.1 5.9 11.7 6 11.8 7.9C11.9 9.9 16 9 16 11.1C16 13.1 12.5 13.3 11.6 12.2" />
  </Mark>
)

/** The "TS" letterform: same S as JS, T in place of the J. */
const IconTSMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M3.4 6.3h5.2M6 6.3v7.4" />
    <path d="M15.8 6.8C15.1 5.9 11.7 6 11.8 7.9C11.9 9.9 16 9 16 11.1C16 13.1 12.5 13.3 11.6 12.2" />
  </Mark>
)

/** Markup's angle-bracket pair — IconWeb's shape without the slash. */
const IconHtmlMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M7.5 6.5 4 10l3.5 3.5" />
    <path d="M12.5 6.5 16 10l-3.5 3.5" />
  </Mark>
)

/** The selector hash. */
const IconCssMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M8.3 5.5 6.9 14.5M13.1 5.5l-1.4 9" />
    <path d="M5.4 8.6h9.8M4.8 11.4h9.8" />
  </Mark>
)

/** The brace pair. */
const IconJsonMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M7.6 4.6c-1.6 0-2.2.9-2.2 2.1v1.4c0 1-.5 1.9-1.8 1.9 1.3 0 1.8.9 1.8 1.9v1.4c0 1.2.6 2.1 2.2 2.1" />
    <path d="M12.4 4.6c1.6 0 2.2.9 2.2 2.1v1.4c0 1 .5 1.9 1.8 1.9-1.3 0-1.8.9-1.8 1.9v1.4c0 1.2-.6 2.1-2.2 2.1" />
  </Mark>
)

/** Markdown's M-and-down-arrow. */
const IconMarkdownMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M2.8 13.2V6.8l2.7 3.1 2.7-3.1v6.4" />
    <path d="M13.6 6.8v6.2M11.3 10.9l2.3 2.3 2.3-2.3" />
  </Mark>
)

/** The plain-document outline for txt and anything unrecognised. */
const IconDocMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M5 3.25h6.5L15 6.75v10A1 1 0 0 1 14 17.75H6a1 1 0 0 1-1-1V4.25a1 1 0 0 1 1-1Z" />
    <path d="M11.25 3.5v3.25h3.5M7.75 11h4.5M7.75 13.75h3" />
  </Mark>
)

/** ext → brand ink. Values are the VS Code Seti fills (W2-A task 4). */
const FILE_FILLS: Record<string, string> = {
  py: '#519aba',
  java: '#e76f00',
  cs: '#68217a',
  js: '#cbcb41',
  mjs: '#cbcb41',
  jsx: '#cbcb41',
  ts: '#519aba',
  tsx: '#519aba',
  html: '#e37933',
  htm: '#e37933',
  css: '#519aba',
  json: '#cbcb41',
  md: '#519aba',
}

/** txt and unknown extensions: the neutral document grey. */
const DOC_FILL = '#c5c5c5'

/**
 * The bare colored file icon, keyed by extension. Every glyph draws in
 * currentColor, so the fill rides in as an inline `color` — consumers can
 * still override it via `style` if a context ever needs the neutral ink.
 */
export function FileIcon({ ext, size = 16, style, ...rest }: { ext: string } & IconProps) {
  const props = { size, style: { color: FILE_FILLS[ext] ?? DOC_FILL, ...style }, ...rest }
  switch (ext) {
    case 'py':
      return <IconPython {...props} />
    case 'java':
      return <IconJava {...props} />
    case 'cs':
      return <IconCSharp {...props} />
    case 'js':
    case 'mjs':
    case 'jsx':
      return <IconJSMark {...props} />
    case 'ts':
    case 'tsx':
      return <IconTSMark {...props} />
    case 'html':
    case 'htm':
      return <IconHtmlMark {...props} />
    case 'css':
      return <IconCssMark {...props} />
    case 'json':
      return <IconJsonMark {...props} />
    case 'md':
      return <IconMarkdownMark {...props} />
    default:
      return <IconDocMark {...props} />
  }
}
