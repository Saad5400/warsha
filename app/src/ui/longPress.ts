/**
 * One long-press feel for the whole app: a touch must rest this long, and may
 * wander at most this far, before a press counts as "long". Applied to the tab
 * strip's context menu (components/Tabs.tsx) and the file tree's hold-to-drag /
 * hold-for-menu (hooks/useTreeDnd.ts); the editor's touch docs (editor/
 * hoverDocs.ts) already time to the same 500ms / 8px. Was 360–500ms and
 * 6/8/10px — three different numbers for one gesture.
 */
export const LONG_PRESS_MS = 500
export const LONG_PRESS_SLOP = 8
