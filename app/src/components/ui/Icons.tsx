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

const STAR = 'M10 2.75l2.09 4.24 4.68.68-3.39 3.3.8 4.66L10 13.43l-4.18 2.2.8-4.66-3.39-3.3 4.68-.68z'

export const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d={STAR} />
  </Icon>
)

// Filled twin — the "pinned" indicator; the outline star is the "pin" action.
export const IconStarFilled = (p: IconProps) => (
  <Icon {...p} fill="currentColor">
    <path d={STAR} />
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
 * VS Code's "files" codicon (microsoft/vscode-codicons, MIT), traced at 24px —
 * the one exception to this file's 20px/1.6px-stroke rule, so the rail matches
 * VS Code's own shape instead of a restroked knock-off. ActivityBar only;
 * everything else uses IconFiles above.
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

/** Empty folder. */
export const IconFolderOpen = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 6A1.25 1.25 0 0 1 4 4.75h2.9l1.35 1.9H16A1.25 1.25 0 0 1 17.25 7.9v1.35" />
    <path d="M2.75 8.5h15L16 15.5H4.25L2.75 8.5Z" />
  </Icon>
)

/* ---- menu glyphs. Same grid, same stroke as everything above. ------------- */

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

/** "Format file" — a wand, for the one action that rewrites the file for you. */
export const IconWand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 16 14.5 5.5" />
    <path d="M15.5 3.5v2M18.5 6.5h-2M17.7 8.3l-1.4 1.4M8 3.5v2M6.5 6.5h2" />
  </Icon>
)

/** "Generate…" — a `{ }` block with a plus, for the action that writes code
 *  into the current class. Sits beside Format's wand in the same chrome. */
export const IconGenerate = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 4.5C6 4.5 6 6 6 7.5 6 9 5 10 4 10c1 0 2 1 2 2.5 0 1.5 0 3 1.5 3" />
    <path d="M12.5 4.5c1.5 0 1.5 1.5 1.5 3 0 1.5 1 2.5 2 2.5-1 0-2 1-2 2.5 0 1.5 0 3-1.5 3" />
    <path d="M10 8.25v3.5M8.25 10h3.5" />
  </Icon>
)

/** The check inside a selected checkbox row (the field picker). */
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10.5 8 14l7.5-8" />
  </Icon>
)

/**
 * "Install Warsha" — arrow landing INSIDE a device, not a tray (that's
 * IconImport, one row away in the same chrome) — installing puts the app
 * on the phone, so the phone is the container.
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

/** "Download" — the mirror of IconShare: the arrow drops DOWN into the tray. */
export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3v9.5M6.75 9.25 10 12.5l3.25-3.25" />
    <path d="M4.5 11v3.75a1.25 1.25 0 0 0 1.25 1.25h8.5a1.25 1.25 0 0 0 1.25-1.25V11" />
  </Icon>
)

/** "Share as link" — two chain links at 45°, the universal URL glyph. */
export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.25 11.75l3.5-3.5" />
    <path d="M9.5 6.25l1.5-1.5a2.83 2.83 0 0 1 4 4l-1.5 1.5" />
    <path d="M10.5 13.75l-1.5 1.5a2.83 2.83 0 0 1-4-4l1.5-1.5" />
  </Icon>
)

/* ---- menu-row glyphs, so File/Edit/View/Run and the context menus carry a
       leading icon on every row. Same 20px grid, same 1.6px stroke. --------- */

/** "New File" — the file sheet with a plus. */
export const IconFilePlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3.25h6.5L15 6.75v10A1 1 0 0 1 14 17.75H6a1 1 0 0 1-1-1V4.25a1 1 0 0 1 1-1Z" />
    <path d="M11.25 3.5v3.25h3.5" />
    <path d="M10 10.5v3.5M8.25 12.25h3.5" />
  </Icon>
)

/** "Open Recent" — a clock, the universal "recent/history" glyph. */
export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.25" />
    <path d="M10 6.25V10l2.75 1.75" />
  </Icon>
)

/** "Import .zip" — an archive box with an arrow dropping in. */
export const IconImport = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8.5h12v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z" />
    <path d="M8.5 11h3" />
    <path d="M10 2.75v4M8 4.75 10 6.75l2-2" />
  </Icon>
)

/** "Export as .zip" — the same archive box, arrow lifting out. */
export const IconExport = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8.5h12v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z" />
    <path d="M8.5 11h3" />
    <path d="M10 6.75v-4M8 4.75 10 2.75l2 2" />
  </Icon>
)

/** "Save All" — a floppy disk, the write-to-disk glyph. */
export const IconSave = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 4.75A1.25 1.25 0 0 1 5.75 3.5h7.1L16.5 7.15v8.1A1.25 1.25 0 0 1 15.25 16.5H5.75A1.25 1.25 0 0 1 4.5 15.25V4.75Z" />
    <path d="M7.25 3.5v3.25h5V3.5" />
    <path d="M7.25 16.5v-4.25h6.5v4.25" />
  </Icon>
)

/** "Rename" — a pencil. */
export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.25 3.75 16.25 6.75 7.5 15.5 4 16.25 4.75 12.75 13.25 3.75Z" />
    <path d="M11.5 5.5 14.5 8.5" />
  </Icon>
)

/** "Delete" — a trash can. */
export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 6h11" />
    <path d="M6.25 6V4.75a1 1 0 0 1 1-1h5.5a1 1 0 0 1 1 1V6" />
    <path d="M5.75 6l.7 9.25a1 1 0 0 0 1 .95h5.1a1 1 0 0 0 1-.95L14.25 6" />
    <path d="M8.5 8.75v5M11.5 8.75v5" />
  </Icon>
)

/** "Undo" — an arrow curving back to the left. */
export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.25 6 4.5 8.75l2.75 2.75" />
    <path d="M4.5 8.75h7.25a3.5 3.5 0 0 1 0 7H8.5" />
  </Icon>
)

/** "Redo" — Undo mirrored. */
export const IconRedo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.75 6 15.5 8.75l-2.75 2.75" />
    <path d="M15.5 8.75H8.25a3.5 3.5 0 0 0 0 7h3.25" />
  </Icon>
)

/** "Find" — a magnifier. */
export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.75" cy="8.75" r="4.75" />
    <path d="M12.5 12.5 16 16" />
  </Icon>
)

/** "Toggle Console" — a terminal with a prompt caret. */
export const IconTerminal = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.25" y="4.25" width="13.5" height="11.5" rx="1.25" />
    <path d="M6.25 8l2.25 2-2.25 2M10.25 12.25h3.5" />
  </Icon>
)

/** "Zoom In" — a magnifier with a plus. */
export const IconZoomIn = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.75" cy="8.75" r="4.75" />
    <path d="M12.5 12.5 16 16" />
    <path d="M8.75 6.75v4M6.75 8.75h4" />
  </Icon>
)

/** "Zoom Out" — a magnifier with a minus. */
export const IconZoomOut = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.75" cy="8.75" r="4.75" />
    <path d="M12.5 12.5 16 16" />
    <path d="M6.75 8.75h4" />
  </Icon>
)

/** "Reset Zoom" — the magnifier back to its default focus (a centred dot). */
export const IconZoomReset = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.75" cy="8.75" r="4.75" />
    <path d="M12.5 12.5 16 16" />
    <circle cx="8.75" cy="8.75" r="1.15" fill="currentColor" stroke="none" />
  </Icon>
)

/** "Run Button on Left/Right" — two arrows swapping sides. */
export const IconSwap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 7.75h11M12.75 5l2.75 2.75-2.75 2.75" />
    <path d="M15.5 12.25h-11M7.25 9.5 4.5 12.25l2.75 2.75" />
  </Icon>
)

/** "Language" — a globe. */
export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.25" />
    <path d="M3.75 10h12.5" />
    <path d="M10 3.75c1.9 2 2.9 4 2.9 6.25s-1 4.25-2.9 6.25c-1.9-2-2.9-4-2.9-6.25s1-4.25 2.9-6.25Z" />
  </Icon>
)

/** "View only" — the eye a read-only (viewer-role) session wears. */
export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 10s3-5.25 8-5.25S18 10 18 10s-3 5.25-8 5.25S2 10 2 10Z" />
    <circle cx="10" cy="10" r="2.25" />
  </Icon>
)

/** "Sign in / account" — a simple person glyph for the account affordance. */
export const IconUser = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="6.75" r="3" />
    <path d="M4.5 16c0-2.9 2.4-4.75 5.5-4.75S15.5 13.1 15.5 16" />
  </Icon>
)

/** "About" — the info circle. */
export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 9.5v3.75M10 6.75h.01" />
  </Icon>
)

/** A diagnostic error — the circle-cross the status bar's problems item wears. */
export const IconError = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M7.75 7.75l4.5 4.5M12.25 7.75l-4.5 4.5" />
  </Icon>
)

/** A diagnostic warning — the triangle-bang beside it. */
export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.25 16.5 15.5H3.5L10 4.25Z" />
    <path d="M10 9v2.75M10 13.75h.01" />
  </Icon>
)

/** "Command Palette" — the ⌘ loop. */
export const IconCommand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 8h4v4H8z" />
    <path d="M8 8V6.25a1.75 1.75 0 1 0-1.75 1.75H8" />
    <path d="M12 8h1.75A1.75 1.75 0 1 0 12 6.25V8" />
    <path d="M12 12v1.75A1.75 1.75 0 1 0 13.75 12H12" />
    <path d="M8 12H6.25A1.75 1.75 0 1 0 8 13.75V12" />
  </Icon>
)

/** "Copy path" — the two-sheets copy glyph. */
export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7.25" y="7.25" width="8.75" height="8.75" rx="1.4" />
    <path d="M12.75 7.25V5.25A1.5 1.5 0 0 0 11.25 3.75h-6.5A1.5 1.5 0 0 0 3.25 5.25v6.5A1.5 1.5 0 0 0 4.75 13.25h2" />
  </Icon>
)

/** "Cut" — scissors. */
export const IconScissors = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="6.25" r="1.75" />
    <circle cx="6" cy="13.75" r="1.75" />
    <path d="M7.5 7.25 15.5 14M7.5 12.75 15.5 6" />
  </Icon>
)

/** "Paste" — a clipboard. */
export const IconClipboard = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 4.5H5.25A1.25 1.25 0 0 0 4 5.75v9.5A1.25 1.25 0 0 0 5.25 16.5h9.5A1.25 1.25 0 0 0 16 15.25v-9.5A1.25 1.25 0 0 0 14.75 4.5H13.5" />
    <rect x="7.25" y="3.25" width="5.5" height="2.75" rx="0.9" />
  </Icon>
)

/** "Select All" — a dashed marquee with a check. */
export const IconSelectAll = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6.5v-1a1.5 1.5 0 0 1 1.5-1.5h1M13 4h1.5A1.5 1.5 0 0 1 16 5.5v1M16 13.5v1a1.5 1.5 0 0 1-1.5 1.5H13M7 16H5.5A1.5 1.5 0 0 1 4 14.5v-1" />
    <path d="M7.75 10 9.5 11.75 12.5 8.25" />
  </Icon>
)

/** "Explain" — a lightbulb, the "here's what this means" glyph. */
export const IconLightbulb = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 8.75a3.5 3.5 0 1 1 6.4 1.95c-.55.8-1.15 1.35-1.3 2.3H8.4c-.15-.95-.75-1.5-1.3-2.3A3.47 3.47 0 0 1 6.5 8.75Z" />
    <path d="M8.25 15.25h3.5M8.75 13h2.5" />
  </Icon>
)