import { useSyncExternalStore } from 'react'
import { installState, subscribeInstall, type InstallState } from '../ui/install'

/** Install affordance state (see ui/install.ts). useSyncExternalStore avoids a first-render flash — the event usually fires before mount. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, installState, getServerSnapshot)
}

// Hoisted to avoid a fresh function each render (React re-subscribes otherwise);
// StrictMode calls this despite no SSR.
const getServerSnapshot = (): InstallState => 'none'
