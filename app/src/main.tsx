import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { CrashScreen } from './components/CrashScreen'
import { ToastProvider } from './components/ui/Toast'
import { DialogProvider } from './components/ui/DialogProvider'
import { initLocale } from './i18n/locale'

const host = document.getElementById('root')
if (!host) throw new Error('missing #root')

// Before first render, so `<html dir>` is right when the shell paints — resolving it
// inside React would flash one LTR frame first.
initLocale()

/** An unwaited promise is invisible on a student's iPad (no devtools) — just a button
 *  that did nothing. Not surfaced to the student (the UI usually already reported the
 *  failure another way); `window.__warshaErrors` just makes it findable for QA. */
declare global {
  interface Window {
    __warshaErrors?: string[]
  }
}
window.__warshaErrors = []
const record = (what: string) => {
  const log = window.__warshaErrors
  if (log && log.length < 100) log.push(what)
}
window.addEventListener('unhandledrejection', (e) => {
  record(`unhandledrejection: ${String((e.reason as Error)?.message ?? e.reason)}`)
})
window.addEventListener('error', (e) => {
  record(`error: ${e.message}`)
})

createRoot(host).render(
  <StrictMode>
    <CrashScreen>
      <ToastProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ToastProvider>
    </CrashScreen>
  </StrictMode>,
)
