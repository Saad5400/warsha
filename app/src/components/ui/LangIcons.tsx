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
