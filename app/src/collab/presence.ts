/**
 * Who a peer is, for awareness/presence (remote cursors + the "who's here"
 * count). Awareness is WebRTC-only and never persisted (contract §5), so this
 * identity is per-tab and disposable — a friendly name and a stable colour, no
 * account, nothing that outlives the session.
 */

export interface CollabUser {
  name: string
  /** A hex colour used for the remote caret/selection and the presence dot. */
  color: string
}

/** The shape y-codemirror.next's remote-selection plugin reads from awareness. */
export interface AwarenessUserState {
  user: CollabUser
}

const ADJECTIVES = ['Quick', 'Calm', 'Bright', 'Bold', 'Kind', 'Swift', 'Clever', 'Warm', 'Keen', 'Merry']
const ANIMALS = ['Falcon', 'Otter', 'Fox', 'Lynx', 'Heron', 'Ibex', 'Wren', 'Panda', 'Koala', 'Gecko']

// VS Code-ish, high-contrast on the dark canvas; deterministic index, not random,
// so the same picked name keeps the same colour.
const COLORS = ['#4EC9B0', '#569CD6', '#C586C0', '#DCDCAA', '#CE9178', '#9CDCFE', '#B5CEA8', '#E5B95C']

/** A random display identity for this tab's session. */
export function makeUser(): CollabUser {
  const a = ADJECTIVES[(Math.random() * ADJECTIVES.length) | 0]
  const n = ANIMALS[(Math.random() * ANIMALS.length) | 0]
  const color = COLORS[(Math.random() * COLORS.length) | 0]
  return { name: `${a} ${n}`, color }
}

/** A collaborator seen through awareness (self excluded by the caller). */
export interface Peer {
  clientId: number
  user: CollabUser
}
