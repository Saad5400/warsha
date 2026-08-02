/**
 * Language marks for Java and Python.
 *
 * These replace the "J" and "Py" letter badges. Two letters in a coloured box
 * is a label, not an icon: it has to be *read*, which is the opposite of what a
 * badge is for, and it tells a student nothing they did not already know.
 *
 * The two marks are built differently, and the reason is legal, not aesthetic.
 * Both are recorded in full, with citation, under "Language icons" in
 * docs/legal/THIRD-PARTY.md.
 *
 *   Python — the PSF's trademark policy permits the *unaltered* logo, without
 *   prior approval, to indicate that software supports the language, and treats
 *   a recoloured or restyled one as a derived logo needing committee approval.
 *   So we embed the real mark, untouched, rather than drawing a house-style
 *   version: a redrawn one is both less recognisable and the legally worse
 *   option. It does not take currentColor, and must not.
 *
 *   Java — Oracle's Java marks are trademarks we neither copy nor imitate. A
 *   plain coffee cup is not distinctive of Oracle; it is the generic convention
 *   every editor and icon theme uses for a .java file. This one is drawn from
 *   scratch and does take currentColor.
 *
 * Both are scaled into the same optical box (14 units of a 20 grid) so they
 * carry equal weight in a badge, and both were checked at 64/32/24/20/16px on
 * light and dark backgrounds before shipping.
 *
 * Every icon is aria-hidden; the accessible name lives on the row or button.
 */
import { useId, type SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

/**
 * Coffee cup, D-handle, saucer, three curls of steam — filled rather than
 * stroked, because it sits beside the solid Python mark and the 1.6px outline
 * version read as a wireframe next to it.
 *
 * The steam is what makes it coffee rather than a beaker. The saucer is what
 * keeps it a cup rather than a bucket once the steam blurs out below 20px.
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
    <g transform="translate(10 10) scale(0.906) translate(-9.75 -11.3)" fill="currentColor">
      <path d="M3.6 9h9.4v3a4.7 4.7 0 0 1-9.4 0Z" />
      <path d="M13.2 10.4h1.2a2.9 2.9 0 0 1 0 5.8h-1.4v-1.75h1.3a1.15 1.15 0 0 0 0-2.3h-1.1Z" />
      <rect x="2.2" y="17.4" width="12.2" height="1.6" rx=".8" />
      <path
        d="M5.9 7.3c-1-1.1 1-1.9 0-3M8.3 7.3c-1-1.1 1-1.9 0-3M10.7 7.3c-1-1.1 1-1.9 0-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
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
