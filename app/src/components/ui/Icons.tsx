/**
 * One icon set, one grid, one stroke weight.
 *
 * These replace the text glyphs the shell was assembled with (▶ ■ ⋯ › ⌄ ✕ +).
 * That is not a taste call: on the target devices those characters resolve to
 * whatever the platform has, so `▶` can arrive as a colour emoji on some Android
 * builds, `⋯` is missing from several OEM fonts, and none of them share a stroke
 * weight with each other. A single 20px grid at 1.6px is what makes the chrome
 * read as one system. (One deliberate exception: IconFilesStack below is a
 * fill-based 24px codicon trace — see its comment.)
 *
 * Every icon is aria-hidden: the accessible name always lives on the button.
 */
import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

function Icon({ size = 20, ...rest }: IconProps & { children?: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  )
}

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" />
  </Icon>
)

export const IconMore = (p: IconProps) => (
  <Icon {...p} strokeWidth="0" fill="currentColor">
    <circle cx="4.5" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="15.5" cy="10" r="1.5" />
  </Icon>
)

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
)

export const IconFolderPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 6A1.25 1.25 0 0 1 4 4.75h2.9l1.35 1.9H16A1.25 1.25 0 0 1 17.25 7.9v6.35A1.25 1.25 0 0 1 16 15.5H4a1.25 1.25 0 0 1-1.25-1.25V6Z" />
    <path d="M10 9.25v3.5M8.25 11h3.5" />
  </Icon>
)

/** The tree disclosure. Rotated 90° by CSS when the folder is open. */
export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.75 5.5 12.25 10l-4.5 4.5" />
  </Icon>
)

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 8.25 10 12.75l4.5-4.5" />
  </Icon>
)

export const IconChevronUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 11.75 10 7.25l4.5 4.5" />
  </Icon>
)

/** Collapse every folder: two chevrons folding toward the middle. */
export const IconCollapseAll = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4.75 10 8.75l4-4M6 15.25 10 11.25l4 4" />
  </Icon>
)

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.75 5.75l8.5 8.5M14.25 5.75l-8.5 8.5" />
  </Icon>
)

/** Run. Filled, because an outlined triangle reads as disabled at 20px. */
export const IconPlay = (p: IconProps) => (
  <Icon {...p} strokeWidth="0" fill="currentColor">
    <path d="M6.5 4.6a.9.9 0 0 1 1.36-.78l7.1 4.4a.9.9 0 0 1 0 1.56l-7.1 4.4A.9.9 0 0 1 6.5 13.4V4.6Z" />
  </Icon>
)

/** Stop. Softly rounded so it does not read as a hard "kill". */
export const IconStop = (p: IconProps) => (
  <Icon {...p} strokeWidth="0" fill="currentColor">
    <rect x="5.5" y="5.5" width="9" height="9" rx="1.6" />
  </Icon>
)

export const IconClear = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 15.5h5.5l7-7-4-4-8.5 8.5v2.5Z" />
    <path d="M9.25 5.75l4 4" />
  </Icon>
)

export const IconFiles = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 6A1.25 1.25 0 0 1 4 4.75h2.9l1.35 1.9H16A1.25 1.25 0 0 1 17.25 7.9v6.35A1.25 1.25 0 0 1 16 15.5H4a1.25 1.25 0 0 1-1.25-1.25V6Z" />
  </Icon>
)

/**
 * The activity bar's Explorer glyph: VS Code's "files" codicon, two overlapping
 * documents. Path data traced from microsoft/vscode-codicons (MIT), fill-based
 * on a 24px grid — the one deliberate exception to this file's 20px/1.6px-stroke
 * rule, because the rail renders VS Code's own shape at VS Code's own size and a
 * restroked approximation reads as a knock-off. Used by ActivityBar only;
 * everything else that means "files" keeps IconFiles's folder above.
 */
export const IconFilesStack = ({ size = 24, ...p }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M7.5 22.5H17.595C17.07 23.4 16.11 24 15 24H7.5C4.185 24 1.5 21.315 1.5 18V6C1.5 4.89 2.1 3.93 3 3.405V18C3 20.475 5.025 22.5 7.5 22.5ZM21 8.121V18C21 19.6545 19.6545 21 18 21H7.5C5.8455 21 4.5 19.6545 4.5 18V3C4.5 1.3455 5.8455 0 7.5 0H12.879C13.4715 0 14.0505 0.24 14.4705 0.6585L20.3415 6.5295C20.766 6.954 21 7.5195 21 8.121ZM13.5 6.75C13.5 7.164 13.8375 7.5 14.25 7.5H19.1895L13.5 1.8105V6.75ZM19.5 18V9H14.25C13.0095 9 12 7.9905 12 6.75V1.5H7.5C6.672 1.5 6 2.1735 6 3V18C6 18.8265 6.672 19.5 7.5 19.5H18C18.828 19.5 19.5 18.8265 19.5 18Z" />
  </svg>
)

export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
  </Icon>
)

/* ---- 32px empty-state glyphs (spec §7.5). Same grid, same stroke. -------- */

/** No file open. */
export const IconFileLines = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3.25h6.5L15 6.75v10A1 1 0 0 1 14 17.75H6a1 1 0 0 1-1-1V4.25a1 1 0 0 1 1-1Z" />
    <path d="M11.25 3.5v3.25h3.5M7.75 11h4.5M7.75 13.75h3" />
  </Icon>
)

/** Console, never run. */
export const IconTerminal = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="4.25" width="14.5" height="11.5" rx="1.25" />
    <path d="M6 9l2 1.75L6 12.5M10.25 12.5h3.5" />
  </Icon>
)

/** Empty folder. */
export const IconFolderOpen = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 6A1.25 1.25 0 0 1 4 4.75h2.9l1.35 1.9H16A1.25 1.25 0 0 1 17.25 7.9v1.35" />
    <path d="M2.75 8.5h15L16 15.5H4.25L2.75 8.5Z" />
  </Icon>
)

/* ---- menu glyphs. Same grid, same stroke as everything above. ------------- */

/** Import: into the tray. */
export const IconImport = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.75v7.5M6.75 8.25 10 11.5l3.25-3.25" />
    <path d="M4.25 13v2.25a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V13" />
  </Icon>
)

/** Export: out of the tray. */
export const IconExport = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 11.5V4M6.75 7.25 10 4l3.25 3.25" />
    <path d="M4.25 13v2.25a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V13" />
  </Icon>
)

export const IconSave = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.75 4.25h7.75l3 3v8.5a.5.5 0 0 1-.5.5H5.25a.5.5 0 0 1-.5-.5V4.75a.5.5 0 0 1 .5-.5Z" />
    <path d="M7.5 4.25v3.5h5M7.5 12.25h5" />
  </Icon>
)

export const IconTextBigger = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 15 7.5 5l4 10M4.9 12h5.2" />
    <path d="M15 8.75v4.5M12.75 11h4.5" />
  </Icon>
)

export const IconTextSmaller = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 15 7.5 5l4 10M4.9 12h5.2" />
    <path d="M12.75 11h4.5" />
  </Icon>
)

/** Mirror Run/Stop to the other edge, for a left-handed student. */
export const IconSwapSides = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 6.25 4 9.75l3.5 3.5M12.5 6.25 16 9.75l-3.5 3.5" />
    <path d="M4.25 9.75h11.5" />
  </Icon>
)

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 6.5h11M8 6.5V5.25a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6.5" />
    <path d="M6.25 6.5l.55 8.3a1 1 0 0 0 1 .95h4.4a1 1 0 0 0 1-.95l.55-8.3" />
  </Icon>
)

/** "Format file" — a wand, for the one action that rewrites the file for you. */
export const IconWand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 16 14.5 5.5" />
    <path d="M15.5 3.5v2M18.5 6.5h-2M17.7 8.3l-1.4 1.4M8 3.5v2M6.5 6.5h2" />
  </Icon>
)

/**
 * "Install Warsha" — an arrow landing INSIDE a device, not in a tray.
 *
 * Deliberately not the download glyph: IconImport is already an arrow into a
 * tray, and the two actions sit one row apart in the same chrome. What is being
 * installed is the app onto the phone, so the phone is the container.
 */
export const IconInstall = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4.25A1.75 1.75 0 0 1 7.75 2.5h4.5A1.75 1.75 0 0 1 14 4.25v11.5a1.75 1.75 0 0 1-1.75 1.75h-4.5A1.75 1.75 0 0 1 6 15.75V4.25Z" />
    <path d="M10 6.25v5.5M7.75 9.5 10 11.75l2.25-2.25" />
  </Icon>
)

/** "Share as image" — the export-out arrow above a tray. */
export const IconShare = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3v9.5M6.75 6.25 10 3l3.25 3.25" />
    <path d="M4.5 11v3.75a1.25 1.25 0 0 0 1.25 1.25h8.5a1.25 1.25 0 0 0 1.25-1.25V11" />
  </Icon>
)
