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

// Before the first render, so `<html dir>` is already right when the shell
// paints. Resolving it inside React would show one LTR frame and then flip —
// on a phone that reads as a layout bug, and it is the first thing the student
// sees.
initLocale()

/**
 * A promise nobody awaited is the one failure mode a `try/catch` cannot reach
 * and a React boundary does not see. Left alone it is invisible on a student's
 * iPad — the devtools console they will never open — and the visible symptom is
 * a button that quietly did nothing.
 *
 * We do not surface these to the student: by the time one arrives the UI has
 * usually already reported the same failure through its own path, and a second,
 * technical message would only make a handled failure look worse. What this
 * does is make them *findable*: `window.__warshaErrors` is what the QA suites
 * assert on, so a regression that reintroduces an unhandled rejection fails a
 * test instead of shipping.
 */
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
