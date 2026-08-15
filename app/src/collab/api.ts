/**
 * The Warsha sync API client (COLLAB-SYNC-CONTRACT §3). Small, cross-origin, and
 * modelled on analytics.ts's posture: it never throws at its boundary — every
 * network call resolves to a typed result (or `null`), so a dead or missing
 * backend degrades the app to local-only rather than surfacing an exception the
 * student would see. The editor must work with the API entirely absent.
 *
 * COEP note (contract edge #5): the deployed app runs under COOP+COEP
 * (require-corp), so every response from a *different* origin must carry CORP or
 * be a CORS response. That is the server's job; here we just issue plain `cors`
 * fetches. The base URL comes from `import.meta.env.VITE_WARSHA_API` — unset in
 * dev/offline, which is why `createApi()` returns `null` there.
 */

/** URL-safe? No — the blob is opaque bytes; the server sends it base64 in JSON. */
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export interface DocGetResult {
  id: string
  version: number
  name?: string
  updatedAt?: number
  /** Empty doc → `null` (the server sends an empty blob for a version-0 doc). */
  blob: Uint8Array | null
}

/** Why a GET produced no doc — the cases mean very different things to the caller:
 *  `auth` (401) is terminal token-death; `forbidden` (403) is the authorization
 *  boundary (a viewer with link=none, or a revoked share) — NOT auth-death, so the
 *  live/local layers keep working; `not-found` is a fresh room; `network` retriable. */
export type DocGetErrorKind = 'auth' | 'forbidden' | 'not-found' | 'network'
export interface DocGetError {
  error: DocGetErrorKind
}

export type DocPutResult =
  | { ok: true; version: number }
  /** 409: the version the client sent was stale — merge `blob`, bump to `version`, retry. */
  | { ok: false; conflict: true; version: number; blob: Uint8Array | null }
  /** 401/403/404/413/network — not a conflict; caller keeps the change pending.
   *  `quota` marks a 403 that is an out-of-space quota block (§7.3), NOT a permission
   *  denial: the two 403s mean very different things to the client (contract §5) — a
   *  quota 403 is transient (park + retry when the doc shrinks / space frees), a
   *  permission 403 is a role boundary (the quiet read-only stop). Absent `quota`,
   *  `status === 403` is the permission case, exactly as before. */
  | { ok: false; conflict: false; status: number; quota?: true; usage?: Usage }

// ---- Phase 2: accounts, sharing, quotas (§7) --------------------------------

export interface AuthUser {
  id: string
  email: string
}
export interface Usage {
  docs: number
  bytes: number
  limits: { docs: number; bytes: number }
}
/** A signup/login outcome, with the failure kinds the auth UI must tell apart. */
export type AuthResult =
  | { ok: true; token: string; user: AuthUser }
  /** `taken` = 409 (signup); `weak` = 400 (<8 chars); `invalid` = 401 (login); `network` = unreachable/5xx. */
  | { ok: false; error: 'taken' | 'weak' | 'invalid' | 'network' }
/** /v1/me, or why it failed — `auth` is a dead token (clear the session), `network` is retriable. */
export type MeResult = { user: AuthUser | null; usage: Usage } | { error: 'auth' | 'network' }

export type LinkAccess = 'editor' | 'viewer' | 'none'
export type DocRole = 'owner' | 'editor' | 'viewer'
export interface AclEntry {
  email: string
  role: 'editor' | 'viewer'
}
export interface DocListEntry {
  id: string
  name: string | null
  version: number
  role: DocRole
  linkAccess: LinkAccess
  sizeBytes: number
  updatedAt: string | null
}
export interface DocMetaResult {
  id: string
  name: string | null
  linkAccess: LinkAccess
  version: number
}
/** A non-mutating write-permission probe (see `probeRole`): the answer to
 *  "may I edit this doc?" without a role field on GET. `unknown` = not persisted. */
export type ProbeRole = 'editor' | 'viewer' | 'unknown'

export interface WarshaApi {
  readonly baseUrl: string
  /** GET /v1/docs/:id → current version + blob, or a typed error (401 vs 404 vs network). */
  getDoc(id: string): Promise<DocGetResult | DocGetError>
  /** PUT /v1/docs/:id with `If-Match: version` and the snapshot bytes. */
  putDoc(id: string, version: number, bytes: Uint8Array): Promise<DocPutResult>
  /** POST /v1/docs — server-assigned id + version 0. Null on failure. */
  createDoc(name?: string): Promise<{ id: string; version: number } | null>
  /** The `ws(s)://…/v1/sync` base URL for the live Yjs WebSocket relay. The
   *  WebsocketProvider appends the room id as a path segment (`/v1/sync/<ULID>`). */
  syncUrl(): string
  /** POST /v1/signal-ticket — mint a single-use, ~60s ticket that authenticates the
   *  live-sync socket, so a long-lived bearer never travels in the WS URL. Null on
   *  failure (the caller connects without one; the server drops it if the doc is
   *  private). */
  mintSyncTicket(): Promise<string | null>
  /** GET /v1/health — a quick reachability probe. */
  health(): Promise<boolean>

  /** POST /v1/devices — mint an anonymous device token (the no-account principal,
   *  §7). Unauthenticated. Null on failure. */
  createDevice(): Promise<string | null>

  // ---- Phase 2 (§7). All resolve to typed results; none throw at the boundary. ----
  /** POST /v1/auth/signup. 201 → session; 409 taken; 400 weak; else network. */
  signup(email: string, password: string): Promise<AuthResult>
  /** POST /v1/auth/login. 200 → session; 401 invalid (uniform); else network. */
  login(email: string, password: string): Promise<AuthResult>
  /** POST /v1/auth/logout — best-effort revoke of the current session token. */
  logout(): Promise<void>
  /** GET /v1/me — the signed-in account (or null) plus usage, or a typed error. */
  me(): Promise<MeResult>
  /** POST /v1/auth/claim-device — re-own the device's docs to the account; the
   *  claimed count, or 0 on any failure. Called automatically after login. */
  claimDevice(deviceToken: string): Promise<number>
  /** GET /v1/docs — docs owned by + shared with the account, or null on failure. */
  listDocs(): Promise<DocListEntry[] | null>
  /** GET /v1/docs/:id/acl — owner only. Null on 403/failure. */
  getAcl(id: string): Promise<AclEntry[] | null>
  /** PUT /v1/docs/:id/acl — owner only. True on 204. */
  setAcl(id: string, email: string, role: 'editor' | 'viewer'): Promise<boolean>
  /** DELETE /v1/docs/:id/acl/:email — owner only, idempotent. True on 204. */
  removeAcl(id: string, email: string): Promise<boolean>
  /** PATCH /v1/docs/:id — owner only (name / linkAccess). Null on 403/failure. */
  patchDoc(id: string, patch: { name?: string | null; linkAccess?: LinkAccess }): Promise<DocMetaResult | null>
  /** Non-mutating write-permission probe (see `ProbeRole`): a stale-version PUT
   *  the server rejects (403 viewer) or 409s (editor) before any write, so a guest
   *  learns its effective role even when it holds only a `#room=` link. */
  probeRole(id: string): Promise<ProbeRole>
}

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Build a client, or `null` when no base URL is configured (the common offline /
 * no-account case). `token` is the Phase-1 static dev secret or device key
 * (`VITE_WARSHA_TOKEN`); Phase 2 swaps it for a real account behind the same header.
 */
export function createApi(
  baseUrl: string | undefined = import.meta.env.VITE_WARSHA_API as string | undefined,
  token: string | undefined = import.meta.env.VITE_WARSHA_TOKEN as string | undefined,
  /** Per-request bearer resolver — Phase 2 passes `currentToken` so a sign-in
   *  swaps the header from the device/dev token to the session token with no
   *  rebuild. Omitted → the static `token` above (Phase-1 behaviour). */
  tokenProvider?: () => string | undefined,
): WarshaApi | null {
  if (!baseUrl) return null
  const base = baseUrl.replace(/\/+$/, '')
  const bearer = () => (tokenProvider ? tokenProvider() : token)
  const jsonAuth = (): Record<string, string> => ({ ...authHeaders(bearer()), 'Content-Type': 'application/json' })

  return {
    baseUrl: base,

    async getDoc(id) {
      try {
        const res = await fetch(`${base}/v1/docs/${encodeURIComponent(id)}`, {
          method: 'GET',
          mode: 'cors',
          headers: { ...authHeaders(bearer()) },
        })
        if (!res.ok) {
          // 401 is terminal token-death; 403 is the EXPECTED viewer/authorization
          // signal (kept distinct so a viewer never sees an "auth failed" toast, M4).
          if (res.status === 401) return { error: 'auth' }
          if (res.status === 403) return { error: 'forbidden' }
          if (res.status === 404) return { error: 'not-found' }
          return { error: 'network' }
        }
        const body = (await res.json()) as { id: string; version: number; name?: string; updatedAt?: number; blob?: string }
        return {
          id: body.id ?? id,
          version: typeof body.version === 'number' ? body.version : 0,
          name: body.name,
          updatedAt: body.updatedAt,
          blob: body.blob ? base64ToBytes(body.blob) : null,
        }
      } catch {
        return { error: 'network' }
      }
    },

    async putDoc(id, version, bytes) {
      try {
        const res = await fetch(`${base}/v1/docs/${encodeURIComponent(id)}`, {
          method: 'PUT',
          mode: 'cors',
          headers: {
            ...authHeaders(bearer()),
            'Content-Type': 'application/octet-stream',
            'If-Match': String(version),
          },
          body: bytes as BodyInit,
        })
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { version?: number }
          return { ok: true, version: typeof body.version === 'number' ? body.version : version + 1 }
        }
        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as { version?: number; blob?: string }
          return {
            ok: false,
            conflict: true,
            version: typeof body.version === 'number' ? body.version : version,
            blob: body.blob ? base64ToBytes(body.blob) : null,
          }
        }
        // 403 is two different failures the client must tell apart (contract §5). Parse
        // the body: `quota_exceeded` (§7.3) is an out-of-space block — recoverable, so
        // flag it `quota` and hand back the server's usage/limits for the UI; anything
        // else (`forbidden`) is the permission boundary a viewer hits, left as the plain
        // non-conflict 403 so the caller keeps today's quiet read-only stop (M4).
        if (res.status === 403) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; usage?: Usage }
          if (body.error === 'quota_exceeded') {
            return { ok: false, conflict: false, status: 403, quota: true, usage: body.usage }
          }
          return { ok: false, conflict: false, status: 403 }
        }
        return { ok: false, conflict: false, status: res.status }
      } catch {
        return { ok: false, conflict: false, status: 0 }
      }
    },

    async createDoc(name) {
      try {
        const res = await fetch(`${base}/v1/docs`, {
          method: 'POST',
          mode: 'cors',
          headers: { ...authHeaders(bearer()), 'Content-Type': 'application/json' },
          body: JSON.stringify(name ? { name } : {}),
        })
        if (!res.ok) return null
        const body = (await res.json()) as { id: string; version: number }
        return { id: body.id, version: typeof body.version === 'number' ? body.version : 0 }
      } catch {
        return null
      }
    },

    syncUrl() {
      // http(s) → ws(s); the live-sync endpoint is the same origin as the API. The
      // WebsocketProvider appends `/<roomId>` and any `?ticket=` param itself.
      return base.replace(/^http/, 'ws') + '/v1/sync'
    },

    async mintSyncTicket() {
      try {
        const res = await fetch(`${base}/v1/signal-ticket`, {
          method: 'POST',
          mode: 'cors',
          headers: { ...authHeaders(bearer()) },
        })
        if (res.status !== 201) return null
        const body = (await res.json().catch(() => ({}))) as { ticket?: string }
        return typeof body.ticket === 'string' ? body.ticket : null
      } catch {
        return null
      }
    },

    async health() {
      try {
        const res = await fetch(`${base}/v1/health`, { method: 'GET', mode: 'cors', headers: { ...authHeaders(bearer()) } })
        return res.ok
      } catch {
        return false
      }
    },

    async createDevice() {
      try {
        const res = await fetch(`${base}/v1/devices`, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (res.status !== 201) return null
        const body = (await res.json()) as { token?: string }
        return typeof body.token === 'string' ? body.token : null
      } catch {
        return null
      }
    },

    // ---- Phase 2 (§7) --------------------------------------------------------

    async signup(email, password) {
      try {
        const res = await fetch(`${base}/v1/auth/signup`, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (res.status === 201) {
          const body = (await res.json()) as { token: string; user: AuthUser }
          return { ok: true, token: body.token, user: body.user }
        }
        if (res.status === 409) return { ok: false, error: 'taken' }
        if (res.status === 400) return { ok: false, error: 'weak' }
        return { ok: false, error: 'network' }
      } catch {
        return { ok: false, error: 'network' }
      }
    },

    async login(email, password) {
      try {
        const res = await fetch(`${base}/v1/auth/login`, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (res.ok) {
          const body = (await res.json()) as { token: string; user: AuthUser }
          return { ok: true, token: body.token, user: body.user }
        }
        if (res.status === 401) return { ok: false, error: 'invalid' }
        return { ok: false, error: 'network' }
      } catch {
        return { ok: false, error: 'network' }
      }
    },

    async logout() {
      try {
        await fetch(`${base}/v1/auth/logout`, { method: 'POST', mode: 'cors', headers: { ...authHeaders(bearer()) } })
      } catch {
        /* best-effort — the client clears its session either way */
      }
    },

    async me() {
      try {
        const res = await fetch(`${base}/v1/me`, { method: 'GET', mode: 'cors', headers: { ...authHeaders(bearer()) } })
        if (res.status === 401) return { error: 'auth' }
        if (!res.ok) return { error: 'network' }
        const body = (await res.json()) as { user: AuthUser | null; usage: Usage }
        return { user: body.user ?? null, usage: body.usage }
      } catch {
        return { error: 'network' }
      }
    },

    async claimDevice(deviceToken) {
      try {
        const res = await fetch(`${base}/v1/auth/claim-device`, {
          method: 'POST',
          mode: 'cors',
          headers: jsonAuth(),
          body: JSON.stringify({ deviceToken }),
        })
        if (!res.ok) return 0
        const body = (await res.json().catch(() => ({}))) as { claimed?: number }
        return typeof body.claimed === 'number' ? body.claimed : 0
      } catch {
        return 0
      }
    },

    async listDocs() {
      try {
        const res = await fetch(`${base}/v1/docs`, { method: 'GET', mode: 'cors', headers: { ...authHeaders(bearer()) } })
        if (!res.ok) return null
        const body = (await res.json()) as { docs?: DocListEntry[] }
        return Array.isArray(body.docs) ? body.docs : null
      } catch {
        return null
      }
    },

    async getAcl(id) {
      try {
        const res = await fetch(`${base}/v1/docs/${encodeURIComponent(id)}/acl`, {
          method: 'GET',
          mode: 'cors',
          headers: { ...authHeaders(bearer()) },
        })
        if (!res.ok) return null
        const body = (await res.json()) as { entries?: AclEntry[] }
        return Array.isArray(body.entries) ? body.entries : null
      } catch {
        return null
      }
    },

    async setAcl(id, email, role) {
      try {
        const res = await fetch(`${base}/v1/docs/${encodeURIComponent(id)}/acl`, {
          method: 'PUT',
          mode: 'cors',
          headers: jsonAuth(),
          body: JSON.stringify({ email, role }),
        })
        return res.status === 204
      } catch {
        return false
      }
    },

    async removeAcl(id, email) {
      try {
        const res = await fetch(`${base}/v1/docs/${encodeURIComponent(id)}/acl/${encodeURIComponent(email)}`, {
          method: 'DELETE',
          mode: 'cors',
          headers: { ...authHeaders(bearer()) },
        })
        return res.status === 204
      } catch {
        return false
      }
    },

    async patchDoc(id, patch) {
      try {
        const res = await fetch(`${base}/v1/docs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          mode: 'cors',
          headers: jsonAuth(),
          body: JSON.stringify(patch),
        })
        if (!res.ok) return null
        return (await res.json()) as DocMetaResult
      } catch {
        return null
      }
    },

    async probeRole(id) {
      // A stale-version PUT: the server checks the role BEFORE the version, and a
      // missing doc with a non-zero If-Match is a 404 (never a create). So the
      // reply tells us the caller's write permission without ever mutating: 403 →
      // viewer, 409 (version mismatch, no write) → editor, 404 → not persisted.
      // If-Match assumes 2147483647 (INT_MAX) is always a stale version — no live
      // doc ever reaches it — so an authorized writer 409s here rather than writing.
      try {
        const res = await fetch(`${base}/v1/docs/${encodeURIComponent(id)}`, {
          method: 'PUT',
          mode: 'cors',
          headers: { ...authHeaders(bearer()), 'Content-Type': 'application/octet-stream', 'If-Match': '2147483647' },
          body: new Uint8Array([0]) as BodyInit,
        })
        if (res.status === 403) return 'viewer'
        if (res.status === 409 || res.ok) return 'editor'
        return 'unknown'
      } catch {
        return 'unknown'
      }
    },
  }
}
