import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/Button'
import { COPY } from '../copy'

/**
 * Last line of defence: without it, one thrown render blanks the whole React tree
 * to the dark first-paint canvas — no error, no spinner, forever. "Forget layout"
 * clears the localStorage prefs that cause most repeat crashes, without touching
 * project files (those live in OPFS).
 */
interface State {
  error: Error | null
}

export class CrashScreen extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // QA suites and a teacher on a bare iPad both rely on this console line.
    console.error('Warsha crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="scroller fixed inset-0 bg-surface-0" data-crash="true">
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 p-5">
          <h1 className="text-dlg-title font-semibold text-text-1">{COPY.crashTitle}</h1>
          <div className="note note--danger">
            <p className="note__text">
              {COPY.crashBody}
            </p>
          </div>
          <Button variant="primary" large onClick={() => window.location.reload()}>
            {COPY.crashReload}
          </Button>
          <Button
            variant="ghost"
            large
            onClick={() => {
              // Layout prefs only — project files live in OPFS, untouched.
              try {
                localStorage.removeItem('warsha.prefs.v1')
              } catch {
                /* private mode; the reload is still worth doing */
              }
              window.location.reload()
            }}
          >
            {COPY.crashForgetLayout}
          </Button>
          <details>
            <summary className="text-meta text-text-3">{COPY.crashWhatWentWrong}</summary>
            <pre className="console-failure__detail">{String(error.stack || error.message || error)}</pre>
          </details>
        </div>
      </div>
    )
  }
}
