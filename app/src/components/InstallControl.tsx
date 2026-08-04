import { COPY } from '../copy'
import { useInstallState } from '../hooks/useInstall'
import { promptInstall } from '../ui/install'
import { IconButton } from './ui/Button'
import { IconInstall } from './ui/Icons'

/**
 * The title bar's install control — present only while there is something to
 * install.
 *
 * It renders nothing in two of the three states, and that is the point: a
 * permanent "Install" button in a bar that already holds three controls would be
 * clutter for the majority of sessions, where the app is either already
 * installed or the browser cannot install it. This one appears when the browser
 * says it is installable and leaves for good when it is not — including the
 * moment the student installs from the omnibox instead of from here.
 *
 * It is deliberately absent on iOS, where a button could only ever open a dialog
 * telling the student to go and use the Share sheet themselves. That sentence
 * lives on the welcome panel instead (COPY.installIos), where it is read once
 * rather than tapped and dismissed.
 *
 * Chrome that is tapped rarely lives at the top (principle 4), and this is the
 * rarest tap in the app — at most once per device, ever.
 */
export function InstallControl() {
  const state = useInstallState()
  if (state !== 'prompt') return null
  return (
    <IconButton
      label={COPY.installAction}
      // Same keyboard-open compaction as its neighbours in TopBar — below 900px
      // a 40px control in an uncompacted bar lands on the tab strip.
      className="max-[899px]:kb-open:size-touch-kb"
      // The browser's own sheet reports the outcome; a toast on top of it would
      // be a second notification for one action. The control vanishing IS the
      // feedback for the accepted case, and `appinstalled` keeps it gone.
      onClick={() => void promptInstall()}
    >
      <IconInstall />
    </IconButton>
  )
}
