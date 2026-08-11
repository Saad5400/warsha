/**
 * Phase-2 account session state (COLLAB-SYNC-CONTRACT §7). A tiny external store
 * — the session token + cached user live in `prefs` (localStorage), mirrored in
 * memory so React can subscribe without prop-drilling. `useAuth()` re-renders the
 * account/share UI on sign-in or sign-out.
 *
 * The bearer selection is the load-bearing rule: when a session token is present
 * it is the `Authorization: Bearer` for every sync/sharing call; otherwise the
 * app falls back to the device / dev token exactly as Phase 1 did. Anonymous work
 * therefore keeps flowing, and after login `claimDevice` re-owns it to the account.
 */
import { useSyncExternalStore } from 'react'
import { prefs, setPrefsFresh } from '../fs/prefs'
import type { WarshaApi } from './api'

export interface AuthUser {
  id: string
  email: string
}

export interface Usage {
  docs: number
  bytes: number
  limits: { docs: number; bytes: number }
}

export interface AuthState {
  token: string | null
  user: AuthUser | null
  /** Latest usage from /v1/me, when known — drives the account panel's quota bars. */
  usage: Usage | null
}

/**
 * The bearer for any authenticated request: the account session token when signed
 * in, else the anonymous device / dev token (Phase-1 behaviour). Pure so it can be
 * unit-tested without a DOM — see tests/collab/auth.test.ts.
 */
export function selectToken(sessionToken: string | null | undefined, deviceToken: string | undefined): string | undefined {
  return sessionToken ?? deviceToken
}

/**
 * The anonymous principal's bearer: the device token minted from `POST /v1/devices`
 * (persisted in prefs, contract §7), falling back to the env dev token only when no
 * device token has been minted yet (offline / no backend). `ensureDeviceToken`
 * mints and caches it; this getter just reads the current value.
 */
export function deviceToken(): string | undefined {
  return device ?? (import.meta.env.VITE_WARSHA_TOKEN as string | undefined)
}

let device: string | null = prefs().deviceToken

let state: AuthState = {
  token: prefs().sessionToken,
  user: prefs().sessionUser,
  usage: null,
}

/** Dedupe concurrent mints — the boot effect and a first room start may race. */
let minting: Promise<string | null> | null = null

/**
 * Ensure an anonymous device token exists (contract §7): return the cached one,
 * or mint a fresh `POST /v1/devices` token and persist it. Anonymous sync and the
 * write-permission probe authenticate as this device principal, so it must be
 * ready before the first authenticated call. Best-effort — returns null with no
 * backend, and the env dev token remains the last-ditch fallback.
 */
export async function ensureDeviceToken(api: WarshaApi | null): Promise<string | null> {
  if (device) return device
  if (!api) return null
  if (!minting) {
    minting = api.createDevice().then((tok) => {
      minting = null
      if (tok) {
        device = tok
        // Fresh-merge: another tab may hold a session token we must not stomp (M3).
        setPrefsFresh({ deviceToken: tok })
        emit()
      }
      return tok
    })
  }
  return minting
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

/** The bearer to send right now (session token if signed in, else device/dev). */
export function currentToken(): string | undefined {
  return selectToken(state.token, deviceToken())
}

export function authState(): AuthState {
  return state
}

export function isSignedIn(): boolean {
  return state.token !== null && state.user !== null
}

/** Record a fresh session (login / signup) and persist it across reloads. */
export function setSession(token: string, user: AuthUser): void {
  state = { token, user, usage: null }
  // Fresh-merge so a sibling tab's deviceToken/room maps survive this write (M3).
  setPrefsFresh({ sessionToken: token, sessionUser: user })
  emit()
}

/** Drop the session (sign-out, or a 401 on boot validation). */
export function clearSession(): void {
  state = { token: null, user: null, usage: null }
  setPrefsFresh({ sessionToken: null, sessionUser: null })
  emit()
}

/** Update the cached usage (from /v1/me) without touching the token. */
export function setUsage(usage: Usage | null): void {
  state = { ...state, usage }
  emit()
}

/** Update the cached user (e.g. /v1/me confirming identity) and persist it. */
export function setUser(user: AuthUser | null): void {
  if (user === state.user) return
  state = { ...state, user }
  setPrefsFresh({ sessionUser: user })
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** React binding — re-renders on any auth change. */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, authState, authState)
}
