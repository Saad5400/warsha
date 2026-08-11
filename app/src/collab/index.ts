/**
 * Phase-1 collaboration/sync layer (COLLAB-SYNC-CONTRACT). Everything the shell
 * touches is re-exported here; the heavy provider stack (yjs, y-webrtc, …) is
 * only pulled in through `useCollab`/`CollabSession`, so a build with
 * collaboration never started tree-shakes it out.
 */
export { useCollab, type CollabState, type UseCollabOptions } from './useCollab'
export { CollabControl } from './CollabControl'
export type { CollabBinding } from './editorBridge'
export type { Peer, CollabUser } from './presence'
export { peekRoomFromUrl, buildRoomUrl, newRoomId } from './room'
