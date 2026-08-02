import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The last line of defence.
 *
 * Without a boundary, one thrown render — a corrupt pref, a tree node the
 * explorer did not expect, a browser quirk in a component nobody has touched in
 * months — unmounts the whole React tree and leaves the student looking at the
 * dark first-paint canvas from `index.html`. Not an error, not a spinner:
 * nothing, forever, with their files still safely in OPFS behind it.
 *
 * So the boundary does the two things that matter and nothing else. It says the
 * app broke rather than the student's work, and it offers the escape hatch that
 * fixes the largest class of "it is broken every time I open it" — a bad
 * `localStorage` pref (a console height, an open tab, a project id) that
 * re-crashes the app on every load, which is the crash *loop* rather than the
 * crash. Clearing prefs cannot touch project files: those live in OPFS.
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
    // The QA suites read this off the page's console, and a teacher debugging a
    // classroom iPad has nothing else to go on.
    console.error('Warsha crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="scroller fixed inset-0 bg-surface-0" data-crash="true">
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 p-5">
          <h1 className="text-dlg-title font-semibold text-text-1">Warsha stopped working</h1>
          <div className="note note--danger">
            <p className="note__text">
              Something in Warsha broke. Your files are still saved on this device — reloading the page should bring
              them back.
            </p>
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={() => window.location.reload()}>
            Reload Warsha
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--lg"
            onClick={() => {
              // Layout preferences only. Project files are in OPFS and are not
              // touched here, which is the whole reason this button is safe to
              // offer to a student.
              try {
                localStorage.removeItem('warsha.prefs.v1')
              } catch {
                /* private mode; the reload is still worth doing */
              }
              window.location.reload()
            }}
          >
            Reload and forget my layout
          </button>
          <details>
            <summary className="text-meta text-text-3">What went wrong</summary>
            <pre className="console-failure__detail">{String(error.stack || error.message || error)}</pre>
          </details>
        </div>
      </div>
    )
  }
}
