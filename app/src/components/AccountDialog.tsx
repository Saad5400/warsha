import { useEffect, useId, useRef, useState } from 'react'
import { COPY } from '../copy'
import type { AuthResult, Usage, WarshaApi } from '../collab/api'
import { clearSession, setSession, setUsage, useAuth } from '../collab/auth'
import { Button } from './ui/Button'
import { Modal } from './ui/Dialog'

const TITLE = 'mb-2 text-dlg-title leading-[1.3] font-semibold text-text-1'
const FIELD =
  'min-h-touch w-full rounded-sm border border-border-control bg-surface-4 px-3 text-input text-text-1 ' +
  'aria-[invalid=true]:border-danger'

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Human-readable bytes for the quota bars — MB with one decimal, no library. */
function fmtBytes(n: number): string {
  const mb = n / (1024 * 1024)
  if (mb >= 10) return `${Math.round(mb)} MB`
  return `${mb.toFixed(1)} MB`
}

/**
 * Sign in / sign up / account panel (contract §7.4). One modal, two faces:
 *  - signed out: the auth form (toggle sign-in ⇄ sign-up), inline email/password
 *    validation, 409/401/400 surfacing, a loading state.
 *  - signed in: the account email, quota usage from /v1/me, and Sign out.
 *
 * On a successful login/signup it claims the device's anonymous docs into the
 * account (claimDevice) so pre-account work carries over, then refreshes usage.
 */
export function AccountDialog({
  api,
  onClose,
  notify,
}: {
  /** Null offline — the dialog then just shows an "online only" note. */
  api: WarshaApi | null
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}) {
  const auth = useAuth()
  const titleId = useId()
  const signedIn = auth.token !== null && auth.user !== null

  if (signedIn) {
    return <AccountPanel api={api} onClose={onClose} notify={notify} titleId={titleId} email={auth.user!.email} usage={auth.usage} />
  }
  return <AuthForm api={api} onClose={onClose} notify={notify} titleId={titleId} />
}

function AuthForm({
  api,
  onClose,
  notify,
  titleId,
}: {
  api: WarshaApi | null
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
  titleId: string
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  const emailProblem = attempted && !emailOk(email) ? COPY.authEmailInvalid : null
  // Signup enforces the 8-char floor inline; sign-in only needs non-empty (the
  // server is the judge, uniformly, so we never hint which half was wrong).
  const passProblem =
    attempted && (mode === 'signup' ? password.length < 8 : password.length === 0)
      ? mode === 'signup'
        ? COPY.authPasswordWeak
        : COPY.authPasswordRequired
      : null
  const canSubmit = emailOk(email) && (mode === 'signup' ? password.length >= 8 : password.length > 0)

  const messageFor = (r: Extract<AuthResult, { ok: false }>): string => {
    switch (r.error) {
      case 'taken':
        return COPY.authErrorTaken
      case 'weak':
        return COPY.authPasswordWeak
      case 'invalid':
        return COPY.authErrorInvalid
      default:
        return COPY.authErrorNetwork
    }
  }

  const submit = async () => {
    setAttempted(true)
    setError(null)
    if (!canSubmit || busy) return
    if (!api) {
      setError(COPY.authErrorNetwork)
      return
    }
    setBusy(true)
    const result = mode === 'signup' ? await api.signup(email.trim(), password) : await api.login(email.trim(), password)
    if (!result.ok) {
      setBusy(false)
      setError(messageFor(result))
      return
    }
    // Land the session so every sync/sharing call now bears the account token.
    setSession(result.token, result.user)
    // Carrying anonymous work into the account (claim-device + tagging local projects
    // account-owned) is NOT done silently here — a shared/lab device would then absorb
    // the previous student's work. The App shows an explicit "Add your projects?" prompt
    // on this sign-in instead (local-first ownership); declining keeps them local.
    // Refresh usage for the account panel that replaces this form.
    const me = await api.me()
    if ('usage' in me) setUsage(me.usage)
    setBusy(false)
    notify(mode === 'signup' ? COPY.authSignedUp : COPY.authSignedIn, 'success')
    onClose()
  }

  return (
    <Modal onCancel={onClose} dismissible labelledBy={titleId}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 id={titleId} className={TITLE}>
          {mode === 'signup' ? COPY.authSignUpTitle : COPY.authSignInTitle}
        </h2>
        <p className="mb-3 text-meta leading-normal text-text-3">{COPY.authIntro}</p>

        <label className="mb-1 block text-meta text-text-2" htmlFor={`${titleId}-email`}>
          {COPY.authEmailLabel}
        </label>
        <input
          id={`${titleId}-email`}
          ref={emailRef}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailProblem ? true : undefined}
          className={FIELD}
        />
        {emailProblem ? <p className="mt-1 text-meta text-danger">{emailProblem}</p> : null}

        <label className="mb-1 mt-3 block text-meta text-text-2" htmlFor={`${titleId}-pass`}>
          {COPY.authPasswordLabel}
        </label>
        <input
          id={`${titleId}-pass`}
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={passProblem ? true : undefined}
          className={FIELD}
        />
        {passProblem ? <p className="mt-1 text-meta text-danger">{passProblem}</p> : null}
        {mode === 'signup' && !passProblem ? (
          <p className="mt-1 text-micro text-text-3">{COPY.authPasswordHint}</p>
        ) : null}

        {error ? (
          <p id={errorId} role="alert" className="mt-3 flex items-start gap-2 text-meta leading-normal text-danger">
            <span aria-hidden="true">✕</span>
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-meta text-accent underline-offset-2 hover:underline"
            onClick={() => {
              setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
              setError(null)
              setAttempted(false)
            }}
          >
            {mode === 'signin' ? COPY.authSwitchToSignUp : COPY.authSwitchToSignIn}
          </button>
          <div className="flex gap-2">
            <Button variant="ghost" large onClick={onClose}>
              {COPY.dlgCancel}
            </Button>
            <Button variant="primary" large type="submit" disabled={busy}>
              {busy ? COPY.authWorking : mode === 'signup' ? COPY.authSignUpAction : COPY.authSignInAction}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function AccountPanel({
  api,
  onClose,
  notify,
  titleId,
  email,
  usage,
}: {
  api: WarshaApi | null
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
  titleId: string
  email: string
  usage: Usage | null
}) {
  const [busy, setBusy] = useState(false)

  // Freshen usage each time the panel opens — the cached copy may be stale after
  // hosting/saving since it was last read.
  useEffect(() => {
    if (!api) return
    let live = true
    void api.me().then((me) => {
      if (live && 'usage' in me) setUsage(me.usage)
    })
    return () => {
      live = false
    }
  }, [api])

  const signOut = async () => {
    setBusy(true)
    await api?.logout()
    clearSession()
    setBusy(false)
    notify(COPY.authSignedOut)
    onClose()
  }

  return (
    <Modal onCancel={onClose} dismissible labelledBy={titleId}>
      <h2 id={titleId} className={TITLE}>
        {COPY.authAccountTitle}
      </h2>
      <p className="mb-4 text-meta leading-normal text-text-2">
        {COPY.authSignedInAs} <span className="font-code text-text-1">{email}</span>
      </p>

      {usage ? (
        <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
          <p className="mb-2 text-meta font-medium text-text-2">{COPY.authUsageTitle}</p>
          <Meter label={COPY.authUsageDocs} value={usage.docs} max={usage.limits.docs} text={`${usage.docs} / ${usage.limits.docs}`} />
          <div className="h-2" />
          <Meter
            label={COPY.authUsageStorage}
            value={usage.bytes}
            max={usage.limits.bytes}
            text={`${fmtBytes(usage.bytes)} / ${fmtBytes(usage.limits.bytes)}`}
          />
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" large onClick={onClose}>
          {COPY.dlgClose}
        </Button>
        <Button variant="danger" large onClick={() => void signOut()} disabled={busy}>
          {busy ? COPY.authWorking : COPY.authSignOut}
        </Button>
      </div>
    </Modal>
  )
}

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-micro text-text-3">
        <span>{label}</span>
        <span className="tabular-nums">{text}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-4" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-(--dur-fast)" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
