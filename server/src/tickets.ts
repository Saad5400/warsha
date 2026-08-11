import { randomBytes } from 'node:crypto'
import type { Principal } from './auth.js'

/**
 * Single-use, short-lived tickets for the signaling WebSocket, so a long-lived
 * bearer token need not travel in the `?token=` query string (logs, Referer,
 * proxy history). An authed HTTP call mints one; the socket presents it as
 * `?ticket=` and it is consumed on first use.
 */
export interface SignalTicketStore {
  /** Mint a ticket bound to `principal`, valid for `ttlMs`. */
  issue(principal: Principal): string
  /** Consume a ticket: returns its principal once, then never again; null if unknown/expired. */
  consume(ticket: string): Principal | null
}

const DEFAULT_TTL_MS = 60_000
/** Hard cap on outstanding tickets to bound memory against issue-spam. */
const MAX_OUTSTANDING = 10_000

export function createSignalTicketStore(ttlMs: number = DEFAULT_TTL_MS): SignalTicketStore {
  const map = new Map<string, { principal: Principal; expiresAt: number }>()

  function sweep(now: number): void {
    for (const [k, v] of map) {
      if (v.expiresAt <= now) map.delete(k)
    }
  }

  return {
    issue(principal: Principal): string {
      const now = Date.now()
      if (map.size >= MAX_OUTSTANDING) {
        sweep(now)
        // Still full of live tickets → drop the oldest to stay bounded.
        if (map.size >= MAX_OUTSTANDING) {
          const oldest = map.keys().next().value
          if (oldest !== undefined) map.delete(oldest)
        }
      }
      const ticket = `tkt_${randomBytes(24).toString('base64url')}`
      map.set(ticket, { principal, expiresAt: now + ttlMs })
      return ticket
    },

    consume(ticket: string): Principal | null {
      const entry = map.get(ticket)
      if (!entry) return null
      map.delete(ticket) // single-use, even if expired
      if (entry.expiresAt <= Date.now()) return null
      return entry.principal
    },
  }
}
