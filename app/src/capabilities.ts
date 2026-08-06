/**
 * Startup capability check.
 *
 * On iPadOS every browser — Chrome included — runs on WebKit, so the platform
 * we target is exactly the one most likely to be missing something an engine
 * needs. A student must never sit in front of a dead spinner: if a hard
 * requirement is absent we say so in plain English, and if only interactive
 * input is at risk we warn without blocking.
 *
 * Note on SharedArrayBuffer: it needs cross-origin isolation (COOP/COEP), which
 * a coi-serviceworker typically installs on the *second* load. So missing SAB is
 * a WARNING, never fatal — it may simply not be there yet.
 */

export type CapabilityLevel = 'ok' | 'warn' | 'fatal'

export interface Capability {
  id: 'wasm' | 'opfs' | 'isolation' | 'workers'
  ok: boolean
  /** 'fatal' — the IDE cannot work. 'warn' — degraded, still usable. */
  severity: 'fatal' | 'warn'
  /** No message here — this runs at boot, maybe before locale resolves. The student-facing
   *  string per `id` lives in i18n, looked up by `capabilityMessage()` in CapabilityScreens.tsx. */
}

export interface CapabilityReport {
  level: CapabilityLevel
  /** Only the checks that failed. */
  problems: Capability[]
  fatal: Capability[]
  warnings: Capability[]
}

function hasWasm(): boolean {
  try {
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
  } catch {
    return false
  }
}

function hasOpfs(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
  } catch {
    return false
  }
}

function hasWorkers(): boolean {
  return typeof Worker === 'function'
}

function hasIsolation(): boolean {
  // Either signal is enough: SAB may exist without crossOriginIsolated on some
  // configurations, and vice versa after a coi-serviceworker reload.
  const sab = typeof SharedArrayBuffer === 'function'
  const isolated = typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false
  return sab || isolated
}

export function checkCapabilities(): CapabilityReport {
  const checks: Capability[] = [
    {
      id: 'wasm',
      ok: hasWasm(),
      severity: 'fatal',
    },
    {
      id: 'workers',
      ok: hasWorkers(),
      severity: 'fatal',
    },
    {
      id: 'opfs',
      ok: hasOpfs(),
      severity: 'warn',
    },
    {
      id: 'isolation',
      ok: hasIsolation(),
      severity: 'warn',
    },
  ]

  const problems = checks.filter((c) => !c.ok)
  const fatal = problems.filter((c) => c.severity === 'fatal')
  const warnings = problems.filter((c) => c.severity === 'warn')
  return {
    level: fatal.length ? 'fatal' : warnings.length ? 'warn' : 'ok',
    problems,
    fatal,
    warnings,
  }
}

