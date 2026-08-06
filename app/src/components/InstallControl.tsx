import { COPY } from '../copy'
import { useInstallState } from '../hooks/useInstall'
import { promptInstall } from '../ui/install'
import { IconButton } from './ui/Button'
import { IconInstall } from './ui/Icons'

/**
 * Renders nothing except in the 'prompt' state — a permanent button would be clutter
 * when the app is already installed or the browser can't install it. Absent on iOS
 * entirely; that guidance lives on the welcome panel instead (COPY.installIos).
 */
export function InstallControl() {
  const state = useInstallState()
  if (state !== 'prompt') return null
  return (
    <IconButton
      label={COPY.installAction}
      // Same keyboard-open compaction as its TopBar neighbours, or it overlaps the tab strip below 900px.
      className="max-[899px]:kb-open:size-touch-kb"
      // No toast: the browser's own sheet reports the outcome, and the control vanishing is feedback enough.
      onClick={() => void promptInstall()}
    >
      <IconInstall />
    </IconButton>
  )
}
