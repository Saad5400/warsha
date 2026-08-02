/**
 * Language marks for Java and Python.
 *
 * These replace the "J" and "Py" letter badges. Two letters in a coloured box
 * is a label, not an icon: it has to be *read*, which is the opposite of what a
 * badge is for, and it tells a student nothing they did not already know.
 *
 * Both marks are handled the same way now, and the reason is legal, not
 * aesthetic: each is an established, real logo for its language, embedded
 * unaltered under nominative use — we state accurately that the language is
 * supported, not that Oracle or the PSF endorse Warsha. Both are recorded in
 * full, with citation, under "Language icons" in docs/legal/THIRD-PARTY.md.
 *
 *   Python — the PSF's trademark policy permits the *unaltered* logo, without
 *   prior approval, to indicate that software supports the language, and treats
 *   a recoloured or restyled one as a derived logo needing committee approval.
 *   So we embed the real mark, untouched, rather than drawing a house-style
 *   version. It does not take currentColor, and must not.
 *
 *   Java — Oracle's Java marks are trademarks we neither copy nor imitate.
 *   What we use instead is Devicon's `java-original` mark: the widely
 *   recognised steaming-cup glyph used across editors and icon themes to mean
 *   ".java file", vendored from an MIT-licensed, community-maintained icon
 *   set (github.com/devicons/devicon), not from Oracle. It is embedded as
 *   shipped, with its own fixed two-tone colours. It does not take
 *   currentColor, and must not — recolouring it is what would make it look
 *   like a redrawn, less recognisable version of the mark everyone already
 *   knows.
 *
 * Both are scaled into the same optical box (14 units of a 20 grid) so they
 * carry equal weight in a badge, and both were checked at 24/20/16px on dark
 * badge surfaces before shipping — the sizes FileBadge.tsx actually renders.
 *
 * Every icon is aria-hidden; the accessible name lives on the row or button.
 */
import { type SVGProps, useId } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

/**
 * Devicon's `java-original` mark (icons/java/java-original.svg), embedded
 * unaltered: same path data, same two brand colours, only reparented from its
 * native 128×128 viewBox into our 20-unit grid via a translate+scale on a
 * wrapping <g>, which changes nothing about the artwork itself.
 *
 * Fixed colours, not currentColor — same rule as the Python mark below, and
 * for the same reason: this is a real logo, not a house-style glyph.
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
        fill="#0074BD"
        d="M47.617 98.12s-4.767 2.774 3.397 3.71c9.892 1.13 14.947.968 25.845-1.092 0 0 2.871 1.795 6.873 3.351-24.439 10.47-55.308-.607-36.115-5.969zm-2.988-13.665s-5.348 3.959 2.823 4.805c10.567 1.091 18.91 1.18 33.354-1.6 0 0 1.993 2.025 5.132 3.131-29.542 8.64-62.446.68-41.309-6.336z"
      />
      <path
        fill="#EA2D2E"
        d="M69.802 61.271c6.025 6.935-1.58 13.17-1.58 13.17s15.289-7.891 8.269-17.777c-6.559-9.215-11.587-13.792 15.635-29.58 0 .001-42.731 10.67-22.324 34.187z"
      />
      <path
        fill="#0074BD"
        d="M102.123 108.229s3.529 2.91-3.888 5.159c-14.102 4.272-58.706 5.56-71.094.171-4.451-1.938 3.899-4.625 6.526-5.192 2.739-.593 4.303-.485 4.303-.485-4.953-3.487-32.013 6.85-13.743 9.815 49.821 8.076 90.817-3.637 77.896-9.468zM49.912 70.294s-22.686 5.389-8.033 7.348c6.188.828 18.518.638 30.011-.326 9.39-.789 18.813-2.474 18.813-2.474s-3.308 1.419-5.704 3.053c-23.042 6.061-67.544 3.238-54.731-2.958 10.832-5.239 19.644-4.643 19.644-4.643zm40.697 22.747c23.421-12.167 12.591-23.86 5.032-22.285-1.848.385-2.677.72-2.677.72s.688-1.079 2-1.543c14.953-5.255 26.451 15.503-4.823 23.725 0-.002.359-.327.468-.617z"
      />
      <path
        fill="#EA2D2E"
        d="M76.491 1.587S89.459 14.563 64.188 34.51c-20.266 16.006-4.621 25.13-.007 35.559-11.831-10.673-20.509-20.07-14.688-28.815C58.041 28.42 81.722 22.195 76.491 1.587z"
      />
      <path
        fill="#0074BD"
        d="M52.214 126.021c22.476 1.437 57-.8 57.817-11.436 0 0-1.571 4.032-18.577 7.231-19.186 3.612-42.854 3.191-56.887.874 0 .001 2.875 2.381 17.647 3.331z"
      />
    </g>
  </svg>
)

/**
 * The PSF two-snake mark, unaltered, scaled into our 20 grid.
 *
 * Do not recolour it, flatten its gradients, or redraw it in the house stroke
 * style. Each of those turns it into a "derived logo", which the PSF policy
 * says needs approval, and drops it out of the nominative-use permission this
 * file relies on. Padding and uniform scaling are fine.
 *
 * The gradient ids are namespaced per instance: two of these render on the
 * welcome screen at once, and duplicate ids in one document make the second
 * copy inherit the first one's paint.
 */
export const IconPython = ({ size = 20, ...rest }: IconProps) => {
  const id = useId()
  const blue = `${id}-blue`
  const gold = `${id}-gold`

  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <defs>
        <linearGradient
          id={blue}
          gradientUnits="userSpaceOnUse"
          x1="63.8159"
          y1="56.6829"
          x2="118.4934"
          y2="1.8225"
          gradientTransform="matrix(1 0 0 -1 -53.2974 66.4321)"
        >
          <stop offset="0" stopColor="#387EB8" />
          <stop offset="1" stopColor="#366994" />
        </linearGradient>
        <linearGradient
          id={gold}
          gradientUnits="userSpaceOnUse"
          x1="97.0444"
          y1="21.6321"
          x2="155.6665"
          y2="-34.5308"
          gradientTransform="matrix(1 0 0 -1 -53.2974 66.4321)"
        >
          <stop offset="0" stopColor="#FFE052" />
          <stop offset="1" stopColor="#FFC331" />
        </linearGradient>
      </defs>
      <g transform="translate(2.973 3.010) scale(0.127272)">
        <path
          fill={`url(#${blue})`}
          d="M55.023-0.077c-25.971,0-26.25,10.081-26.25,12.156c0,3.148,0,12.594,0,12.594h26.75v3.781c0,0-27.852,0-37.375,0c-7.949,0-17.938,4.833-17.938,26.25c0,19.673,7.792,27.281,15.656,27.281c2.335,0,9.344,0,9.344,0s0-9.765,0-13.125c0-5.491,2.721-15.656,15.406-15.656c15.91,0,19.971,0,26.531,0c3.902,0,14.906-1.696,14.906-14.406c0-13.452,0-17.89,0-24.219C82.054,11.426,81.515-0.077,55.023-0.077z M40.273,8.392c2.662,0,4.813,2.15,4.813,4.813c0,2.661-2.151,4.813-4.813,4.813s-4.813-2.151-4.813-4.813C35.46,10.542,37.611,8.392,40.273,8.392z"
        />
        <path
          fill={`url(#${gold})`}
          d="M55.397,109.923c25.959,0,26.282-10.271,26.282-12.156c0-3.148,0-12.594,0-12.594H54.897v-3.781c0,0,28.032,0,37.375,0c8.009,0,17.938-4.954,17.938-26.25c0-23.322-10.538-27.281-15.656-27.281c-2.336,0-9.344,0-9.344,0s0,10.216,0,13.125c0,5.491-2.631,15.656-15.406,15.656c-15.91,0-19.476,0-26.532,0c-3.892,0-14.906,1.896-14.906,14.406c0,14.475,0,18.265,0,24.219C28.366,100.497,31.562,109.923,55.397,109.923z M70.148,101.454c-2.662,0-4.813-2.151-4.813-4.813s2.15-4.813,4.813-4.813c2.661,0,4.813,2.151,4.813,4.813S72.809,101.454,70.148,101.454z"
        />
      </g>
    </svg>
  )
}

export type IconLang = 'java' | 'python'

export function LangIcon({ lang, ...rest }: { lang: IconLang } & IconProps) {
  return lang === 'java' ? <IconJava {...rest} /> : <IconPython {...rest} />
}
