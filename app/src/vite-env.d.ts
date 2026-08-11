/// <reference types="vite/client" />

/**
 * Env the collaboration layer reads (COLLAB-SYNC-CONTRACT). Both are optional —
 * unset means "no backend", and the app runs local-only (no live sync, no
 * durable blob store). See app/src/collab/api.ts.
 */
interface ImportMetaEnv {
  /** Base URL of the Warsha sync API, e.g. https://api.warsha.sb.sa (no trailing slash needed). */
  readonly VITE_WARSHA_API?: string
  /** Phase-1 bearer token (static dev secret or device key). Phase 2 swaps this for a real account. */
  readonly VITE_WARSHA_TOKEN?: string
}
