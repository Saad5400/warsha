import { useSyncExternalStore } from 'react'
import { installState, subscribeInstall, type InstallState } from '../ui/install'

/**
 * The install affordance's state (see ui/install.ts for what the three values
 * mean and why the listener cannot live in an effect).
 *
 * `useSyncExternalStore` rather than useState + useEffect because the event has
 * usually already fired by the time React mounts: an effect-based subscription
 * would read `false` on the first render and only correct itself afterwards,
 * flashing the control in. The snapshot is a plain string, so React's identity
 * check on it is free.
 */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, installState, getServerSnapshot)
}

// Hoisted so it is not a fresh function every render (React warns, then
// re-subscribes). Warsha never server-renders, but StrictMode still calls it.
const getServerSnapshot = (): InstallState => 'none'
