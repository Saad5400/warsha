# Warsha Collab + Sync — Build Contract

**Status:** Phase 1 (Yjs storage + live collaboration). Single source of truth for the
backend and client teams. If an implementation detail here proves wrong, change *this file*
first, then the code — do not let the two sides diverge silently.

Yjs is the canonical data model. The server is a **dumb blob store** for durable snapshots
plus a **light live-sync relay** (a server-mediated WebSocket that relays tiny Yjs deltas —
NOT a Yjs backend: it holds an ephemeral per-room doc only to answer a joiner and fan out
deltas; durable state stays in S3). It does not persist Yjs and does not own the merge; all
merging is client-side CRDT. (No end-to-end encryption in Phase 1 — plaintext at rest, accepted.)

---

## 1. Yjs document model (client canonical)

One `Y.Doc` per project. Structure:

| Shared type | Key | Value | Meaning |
|---|---|---|---|
| `Y.Map` | `files` | `path → Y.Text` | file contents; `path` is POSIX, root-relative, no leading slash |
| `Y.Map` | `dirs`  | `path → true`   | empty directories (set semantics; CRDT-safe, no dup-append) |
| `Y.Map` | `meta`  | `name`, `entry`, `schema` | project name, Run entry file, schema version (`1`) |

- **Rename/move** = create a new `Y.Text` from the old content under the new key, delete the
  old key. `Y.Text` cannot be re-keyed in place. Acceptable for Phase 1.
- **Doc id** = a ULID. It is simultaneously the WebRTC room name and the blob-store key.

### FsSnapshot ↔ Y.Doc (client helpers to implement)
`FsSnapshot = { files: {path,content}[], dirs: string[] }` (see `app/src/fs/types.ts`).
- `snapshotToYdoc(snap, ydoc)` — populate `files`/`dirs`/`meta`.
- `ydocToSnapshot(ydoc): FsSnapshot`.

### The source-of-truth shift (client architecture rule)
Once a project is collab-enabled, **the `Y.Doc` is the source of truth**. Every filesystem
mutation — create / delete / rename file or folder — must go through `Y.Doc` mutators, **not**
`ProjectStore` directly. A one-way bridge materializes `Y.Doc → OPFS` (debounced) so the
runtimes keep reading real files to Run. Editor edits bind the active file's `Y.Text` to
CodeMirror via `y-codemirror.next`; they flow into OPFS through the same bridge.

---

## 2. Persistence wire format
- Snapshot blob = `Y.encodeStateAsUpdate(ydoc)` → `Uint8Array`.
- Load = `Y.applyUpdate(ydoc, blob)`.
- `version` = monotonic integer per doc, server-owned. Client sends the version it last saw;
  server does compare-and-swap.

---

## 3. Backend HTTP API — Fastify, base `/v1`

Auth: `Authorization: Bearer <token>`, where token is a static dev secret from env (dev mode
only — see §7), a device key from `POST /v1/devices`, **or** a session token from
`/v1/auth/*` (Phase 2). One resolver maps any bearer to a principal; all authenticated
routes and the signaling WS share it.

| Method | Path | Body / Headers | Success | Errors |
|---|---|---|---|---|
| `GET`  | `/v1/health` | — | `200 {ok:true}` | — |
| `POST` | `/v1/devices` | `{}` | `201 {token}` | rate-limited |
| `POST` | `/v1/docs` | `{name?}` | `201 {id, version:0}` | `401` |
| `GET`  | `/v1/docs/:id` | — | `200 {id,version,name,updatedAt, blob}` (blob = base64 or empty) | `401,403,404` (roles: §7.2) |
| `PUT`  | `/v1/docs/:id` | `If-Match: <version>`, `Content-Type: application/octet-stream`, body = snapshot bytes | `200 {version}` (new version) | `401`; `403` (role §7.2 / quota §7.3); `409 {version, blob}` (current state to merge+retry); `413` over cap; `404` only when the id is unknown **and** `If-Match > 0` |

- **409 semantics** are load-bearing: on mismatch the server returns the *current* version and
  blob so the client can `applyUpdate` and retry. Never overwrite blindly.
- **Create-on-first-PUT (client-canonical ids):** room ids are ULIDs minted **client-side**, so
  a `#room=` link works offline, before any server contact. A `PUT` with `If-Match: 0` to an
  *unknown* id **creates** the doc at version 1 and returns `200 {version:1}` — this is the
  canonical create path. A `PUT` with `If-Match > 0` to an unknown id is `404` (cannot
  fast-forward a doc that never existed). `POST /v1/docs` stays as *optional* explicit
  pre-creation, reserved for Phase-2 account-scoped creation.
- Size cap per `PUT`: **5 MB** (413 past it). Global `@fastify/rate-limit`. Per-principal
  doc-count + total-bytes quotas are enforced per §7.3.

---

## 4. Live sync — y-websocket relay, WS at `/v1/sync/<room>`
The live layer is a **server-relayed WebSocket** (y-websocket protocol) on
`@fastify/websocket`, **replacing** the former y-webrtc P2P mesh. STUN-only WebRTC P2P dies
behind symmetric NAT (school networks — the target users), giving no live layer and a ~10s
connect; a relay that always connects is more reliable AND lets the server enforce roles. It
stays **light**: only tiny Yjs deltas cross it. The server holds ONE ephemeral in-memory
`Y.Doc` per active room (with gc on) to answer a joiner's `SyncStep1`, merge writers' updates,
and broadcast deltas; it is **evicted the instant the last connection to the room closes**.
The room id is the URL **path segment** (`/v1/sync/<ULID>` — how y-websocket builds its URL),
validated as a canonical ULID before it selects a room.

**Socket auth:** prefer a **single-use, ~60s ticket** — `POST /v1/signal-ticket` (auth)
returns `{ticket}`, presented as the `?ticket=<ticket>` query param — so a long-lived bearer
does not travel in the URL (logs / Referer / proxy history). The legacy `?token=<bearer>` (and
`Authorization` header for non-browser clients) still works but is **deprecated**.

**Read access:** connecting to a room whose doc **is persisted** requires viewer+ (denied
sockets are closed `1008`); rooms with **no persisted doc** stay open to anyone (the room ULID
is the capability). The effective role is computed once at connect.

**★ Write enforcement (the point of moving off P2P):** a socket whose effective role is
`< editor` (a viewer / read-only link holder) may request state (`SyncStep1`) and relay
awareness (cursors), but any inbound Yjs **document update** (`SyncStep2` / update) is
**dropped** — it never merges into the room doc and never fans out. This closes the live-layer
hole the old WebRTC mesh accepted (see §7.2 "Honesty note"): a hostile view-only link holder
can no longer inject edits the server would launder to every peer. It is unit-tested
(viewer's update does NOT reach a second socket / the room doc; an editor's does).

**Resource bounds:** the WS payload is capped at `MAX_SNAPSHOT_BYTES + 64 KiB` (a full-state
sync frame must fit, but no larger); each socket is bounded on message rate; sockets per client
IP are capped; app-level ping/pong reaps idle sockets.

There is **no ICE / TURN / `/v1/ice`** anymore — the relay needs none (removed with the WebRTC
transport).

---

## 5. Client provider stack (all on one `Y.Doc`, all optional)
1. `IndexeddbPersistence(docId, ydoc)` — local durability / offline.
2. `WebsocketProvider(api.syncUrl(), docId, ydoc, { awareness, params:{ticket} })` — live. The
   ticket is minted via `POST /v1/signal-ticket`; the provider is registered as a
   `BlobSyncProvider` remote origin (y-websocket applies incoming updates with the provider
   instance as the origin) so socket-borne deltas are never re-PUT. Skipped entirely when
   offline (`api === null`): the editor still works via IndexedDB. (Same-origin cross-tab sync
   is no longer provided for free — an accepted trade for dropping the P2P/WebRTC stack.)
3. `BlobSyncProvider(docId, ydoc, api)` — **custom**, this repo:
   - on start: `GET /v1/docs/:id` → `applyUpdate`. **Exception:** the host of a
     *freshly minted* room skips this GET — the doc cannot exist server-side yet, and the
     first `PUT If-Match:0` is the create path anyway (no 404 noise). Guests (and a host
     reusing an old room id) always GET.
   - on `ydoc.on('update')` (debounced ~800ms): `PUT` with `If-Match: version`, body = full
     snapshot — **but only for local-origin updates.** An update that arrived over
     y-webrtc / y-indexeddb is its author's to persist; echoing it back caused a PUT storm
     and 409 ping-pong between peers.
   - on `409`: `applyUpdate(returned blob)`, adopt the returned version — and if the
     server blob already contains the client's whole state (the conflict was a no-op),
     go clean **without** retrying; otherwise retry with the merged snapshot.
   - failure taxonomy: `401` is terminal for the session (stop pushing, surface it);
     `413` / over-cap parks pushes until the doc shrinks; network/5xx retries with capped
     exponential backoff + jitter. Never a bare fixed-interval retry loop.
   - **client-side size cap**: the encoded snapshot is checked against the server's 5 MB
     per-PUT cap *before* the request. Over-cap → no PUT, a visible "project too large to
     sync" state; the IndexedDB + WebRTC layers keep working.
   - a doc that is non-empty when the provider attaches (a host's seed) is pushed even if
     nobody ever types — the seed must not wait for the first keystroke.
   - awareness/presence is **not** persisted — WebRTC only.

**Room-id reuse:** a project keeps its room id. The client persists both directions of the
room↔project mapping (`prefs.roomProjects` / `prefs.projectRooms`); re-starting
collaboration on a project reuses its existing room id, so the old blob + IndexedDB state
remain the room's history and previously shared `#room=` links keep working. A reused
room's host must **not** blind-seed a fresh doc (two independent seedings of the same text
double it on CRDT merge): it loads the surviving state first, then reconciles its current
project into the doc with per-key minimal edits. The mappings (and the room's IndexedDB
database) are deleted when the *project* is deleted.

**Bridge safety:** the Project↔doc bridge hard-gates on the project it was created for
(store epoch): if the app's `Project` is re-pointed at another project while a session is
live, the bridge goes inert in both directions. The Project→doc mirror additionally stays
closed on join until the doc's initial (IndexedDB + blob) sync completes, then runs one
reconciliation diff — a partial doc must never be diffed against a full local project.

Base editor must work with **none** of these connected (no account, offline). They are additive.

---

## 6. Repo layout
- `server/` — new Fastify + TypeScript package (Drizzle over Postgres, `@aws-sdk/client-s3`
  for Hetzner S3, `@fastify/websocket`, `@fastify/rate-limit`). `.env.example`, README with
  run steps, a `docker-compose` for local Postgres. **Do not deploy in Phase 1.**
- `app/src/collab/` — new client module: Yjs doc model, FsSnapshot bridge, OPFS materializer,
  BlobSyncProvider, editor binding wiring.

---

## 7. Phase 2 — accounts, sharing, quotas

**Status: built (server side).** Phase 2 makes the backend publicly deployable. Design principles:

- **The no-account moat survives.** Anonymous *device tokens* (`POST /v1/devices`) remain a
  first-class principal: a user with no account can still host and join rooms — they just get
  a small quota and no sharing management. Accounts raise quotas and unlock the share dialog.
- **Principals** = `device:<id>` or `user:<id>`. A device's `<id>` is its opaque token (the
  token *is* the device identity). Every doc has an `owner` principal — set to whoever
  performed the create-on-first-PUT (or `POST /v1/docs`). Legacy Phase-1 rows were backfilled
  as `device:<owner_token>`.
- The static dev bearer secret is **dev-mode only**, and the server **fails closed**:
  `loadEnv()` refuses to boot in production if the dev bearer would be enabled, or if
  `DEV_SHARED_SECRET` is unset / equals the known placeholder. It has no hardcoded default;
  the secret is only required when the bearer is explicitly enabled, and is compared in
  constant time. When enabled it behaves like a well-known device principal so ownership/quota
  logic stays uniform. Sensitive vars (`DATABASE_URL`, S3 endpoint/bucket/credentials,
  `CORS_ORIGINS`) are likewise **required in production** — the server will not boot on dev
  defaults (`localhost`, `minioadmin`, `*`).

### 7.1 Auth endpoints

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| `POST` | `/v1/auth/signup` | `{email, password}` | `201 {token, user:{id,email}}` | `409` email taken, `400` weak password (<8) |
| `POST` | `/v1/auth/login`  | `{email, password}` | `200 {token, user}` | `401` (uniform for bad email/password) |
| `POST` | `/v1/auth/logout` | — (auth) | `204` (revokes this token) | `401` |
| `GET`  | `/v1/me` | — (auth) | `200 {user \| null, usage:{docs, bytes, limits}}` | `401` |
| `POST` | `/v1/signal-ticket` | — (auth) | `201 {ticket, expiresIn:60}` (single-use live-sync socket ticket, see §4) | `401` |

- Passwords: **argon2id** at rest (`@node-rs/argon2`). Emails lowercased/trimmed, unique.
- Session tokens: opaque 32-byte random (`sess_` prefix), stored **hashed** (sha256) in a
  `sessions` table, sliding 90-day expiry. Sent as `Authorization: Bearer` — same header as
  device tokens; one auth resolver maps any bearer to a principal. Rate-limit signup/login
  hard (`AUTH_RATE_LIMIT_*` env, default 10 / 15 min / IP).
- `POST /v1/auth/logout` revokes session tokens only; presented a device token it is a
  no-op 204 (a device token is an identity, not a session).
- A device's docs can be **claimed** on signup/login: `POST /v1/auth/claim-device {deviceToken}`
  (auth, account principals only — 403 for devices; 404 for an unknown device token) re-owns
  that device's docs to the account and returns `200 {claimed:<count>}`. Client calls it
  automatically after login when it holds a device token. Rate-limited on the hard per-IP
  `AUTH_RATE_LIMIT_*` bucket and audit-logged (account + hashed device token + count).
- Passwords are also bounded above (**≤128 chars**) — an over-long password is `400`
  `weak_password` (signup) / uniform `401` (login), guarding against argon2 hashing-cost DoS.

### 7.2 Sharing model (Google-Docs style)

Per doc: `link_access ∈ {editor, viewer, none}` (default **editor** — preserves Phase-1
"anyone with the #room= link can edit"; the room ULID is the unguessable capability), plus an
ACL of `(doc, email) → editor | viewer` for account-holders.

> **Per-email ACL sharing is flag-gated and OFF by default for the Phase-2 deploy**
> (`ACCOUNT_EMAIL_SHARING_ENABLED`, off in production). Emails are unverified, so honoring an
> ACL-by-email grant lets an attacker squat another user's address and self-grant access
> (finding H2). With the flag **off**: `PUT`/`DELETE /v1/docs/:id/acl` return `403
> {error:"email_sharing_disabled"}` (no grant is created), and `effectiveRole` ignores ACL
> entries entirely — even pre-existing rows grant nothing. `GET /v1/docs/:id/acl` still lists
> (owner only). Owner + link access are unaffected. The ACL code stays intact behind the flag
> for a fast-follow once signup verifies emails.

Effective role = max(owner, ACL entry for the caller's account email *when email sharing is
enabled*, link_access if the caller presented the doc id). Enforcement:

- `GET /v1/docs/:id` requires **viewer+**; `PUT` requires **editor+**; `403 {error:"forbidden"}` otherwise.
  Unknown doc ids stay `404`; missing/invalid bearer stays `401` before any role logic.
- Owner-only (403 for everyone else, 404 for unknown ids):
  - `PATCH /v1/docs/:id {name?, linkAccess?}` → `200 {id,name,linkAccess,version,updatedAt}`
    (`400` on invalid linkAccess);
  - `DELETE /v1/docs/:id` → `204` (deletes S3 blob + doc row; ACL rows cascade);
  - `PUT /v1/docs/:id/acl {email, role}` → `204` (upsert; role ∈ editor|viewer; email normalized) — `403 {error:"email_sharing_disabled"}` when the flag is off;
  - `DELETE /v1/docs/:id/acl/:email` → `204` (idempotent) — `403 {error:"email_sharing_disabled"}` when the flag is off;
  - `GET /v1/docs/:id/acl` → `200 {entries:[{email,role}]}` (works regardless of the flag).
- All `/v1/docs/:id*` routes validate `:id` as a **canonical ULID** (26-char Crockford
  base32) and return `400` otherwise, before the id can flow into an S3 key.
- `GET /v1/docs` (auth) lists docs owned by + shared with (ACL by account email) the principal:
  `200 {docs:[{id,name,version,role,linkAccess,sizeBytes,updatedAt}]}` where `role` is the
  caller's role on that doc (`owner` | ACL role).
- **Live-sync access check:** the WS socket authenticates via `?ticket=<ticket>` (preferred,
  see §4) or the deprecated `?token=<bearer>` on the `/v1/sync/<room>` URL (or an
  `Authorization` header for non-browser clients). Connecting to a room whose doc **is
  persisted** requires viewer+ — a denied socket is closed (`1008`). Rooms with **no persisted
  doc** stay open to anyone (pre-first-PUT; the room ULID is the capability). A `< editor`
  socket's document updates are **dropped** by the relay (★ write enforcement, §4).
- **Honesty note:** the durable layer (blob store) enforces roles authoritatively, and the
  live relay now **also** enforces them: a viewer-role socket is made read-only in the client
  editor, its durable PUSHes are rejected at the blob store, AND its live document updates are
  dropped at the relay before they can merge or fan out. This closes the old WebRTC hole (where
  peers relayed updates P2P after the subscribe check, so a hostile client could still inject
  edits into the live mesh). Awareness/cursor frames from a viewer are still relayed (presence
  is not a mutation). A fully hostile client forging another principal's ticket is out of scope
  (tickets are single-use, unguessable, ~60s); the room ULID + school context remain the outer
  boundary.
- **Mid-session revocation propagation (H2):** role is probed once at connect, so a link-access
  change would not, on its own, reach an *already-connected* peer. To close this for **honest
  clients**, an owner's `PATCH /v1/docs/:id {linkAccess}` **also writes the new value into the
  `Y.Doc` meta** (`meta.linkAccess`, owner-authored — a guest never writes it). Connected guests
  already observe meta; on a `linkAccess` change a guest re-resolves its effective role and flips
  the editor read-only for `viewer`/`none` (writable again for `editor`; the owner stays writable
  throughout). The owner-authored meta value wins over a late role probe. This is the **live**
  channel; the server PATCH remains the **authoritative** gate (blob store + signaling) for new
  joiners. It is honest-client only: a hostile peer ignoring the meta flip is the *same* accepted
  P2P limitation as above (unguessable room ids, school context) — not made bulletproof here.

### 7.3 Quotas

| Principal | Docs | Total bytes | Per-PUT |
|---|---|---|---|
| device | 10 | 25 MB | 5 MB (413) |
| account | 200 | 250 MB | 5 MB (413) |

Exceeding docs/bytes → `403 {error:"quota_exceeded", usage:{docs,bytes,limits:{docs,bytes}}}`.
Enforced at create (create-on-first-PUT and `POST /v1/docs`: doc count + incoming bytes) and
every PUT (bytes, computed as the sum of stored blob sizes — tracked per doc in
`docs.size_bytes`). On updates the byte delta is charged to the doc's **owner** (their storage
grows), whoever performs the write; shrinking writes always pass. Limits from env:
`QUOTA_DEVICE_DOCS` / `QUOTA_DEVICE_BYTES` / `QUOTA_ACCOUNT_DOCS` / `QUOTA_ACCOUNT_BYTES`.
Legacy Phase-1 rows carry `size_bytes = 0` until their next PUT (dev-only data, accepted).

### 7.4 Client

- Settings/menu: sign in / sign up / sign out; session token in localStorage prefs
  (`prefs.sessionToken` + cached `prefs.sessionUser`). One bearer resolver
  (`collab/auth.ts` `currentToken`): session token when signed in, else the device/dev
  token — so anonymous work keeps flowing and a sign-in upgrades every call with no rebuild.
  On boot a stored token is validated against `/v1/me` (cleared on 401, kept on a network
  error). After login the client auto-calls `claim-device` with the device token to carry
  anonymous docs over. Usage (docs/bytes vs limits) from `/v1/me` shows in the account panel.
- Share dialog (replaces the bare copy-link) — owner sees the link-access picker
  (Anyone-with-link: Editor / Viewer / Off) + copy-link; a guest sees copy-link only. An
  anonymous device owner can still set link access (device principal owns the doc).
- **Deviation (link-only for this deploy):** per-person email sharing is **deferred** until
  signup verifies emails — it is a spoofing risk without it. The client does **not** call
  `PUT`/`DELETE /v1/docs/:id/acl`; the email block is shown disabled ("coming soon"). The
  ACL endpoints + `getAcl`/`setAcl`/`removeAcl` client methods remain for the fast-follow;
  the server gates the write endpoints behind a flag meanwhile.
- Viewer role: editor is read-only (`EditorState.readOnly` + `EditorView.editable(false)` on
  every collab file, plus a "View only" indicator); edits are impossible, not silently
  dropped, so no local OPFS divergence — yCollab's programmatic dispatches still stream
  remote edits in. This flip is driven both by the connect-time role probe **and** by a
  mid-session `meta.linkAccess` change (H2, §7.2) — the same read-only wiring for both.
- **Restart re-bind (H1):** stopping then re-starting collaboration on a project **reuses** its
  room id, so the new session's doc loads from persisted history rather than a synchronous seed;
  its materialised content matches the open Project verbatim, so `Project.revision` never bumps.
  The open editor must therefore re-bind to the new session's `Y.Text` off a **separate signal**
  — a structural-change observer on the doc's `files` map (`CollabState.filesRev`), not `revision`
  — or post-restart edits go only to OPFS and never enter the shared doc while "Live" is shown.
- **Lazy device-token mint (L1):** the anonymous device token (`POST /v1/devices`) is minted on
  the **first collaborate action** (host/join) or on sign-in (`claim-device`), **never on boot**.
  A visitor who never collaborates and never signs in makes **zero `/v1` calls** and creates no
  device row; collab paths await `ensureDeviceToken` before their first authenticated request.
- **Known non-fatal console error (M1, accepted for v1):** under concurrent multi-peer editing,
  `y-codemirror.next`'s remote-selection plugin can throw a bounds `RangeError` ("Invalid
  position N in document of length M") when a remote awareness cursor resolves to a `Y.Text`
  index momentarily ahead of the local CodeMirror document (content/awareness sync race).
  CodeMirror **isolates** the throw — the plugin is skipped for that one update and re-renders
  correctly on the next — so it is non-fatal, but by default it spams the console. The only
  precise fix is a two-line index clamp inside the library's `YRemoteSelectionsPluginValue.update`
  (in `node_modules`, must not be patched); recomposing `yCollab` to substitute a clamped
  selections plugin is not possible because y-codemirror.next does not export its undo-manager
  facet/plugin (a recompose would break the verified-good per-file local-only CRDT undo). We
  therefore install an `EditorView.exceptionSink` (`app/src/editor/setup.ts`) that swallows
  **only** that specific benign error and forwards everything else — the console stays clean and
  real plugin crashes still surface.
- **Deviation (role discovery):** `GET /v1/docs/:id` carries **no** role/linkAccess field, so
  a link-only guest can't read its effective role from the fetch. The client learns write
  permission with a **non-mutating probe** (`WarshaApi.probeRole`): a `PUT` with a deliberately
  stale `If-Match` (sentinel `2147483647`) and a 1-byte body. The server checks the role
  *before* the version, and returns `404` for a missing doc with non-zero `If-Match` — so the
  reply is `403` → viewer, `409` (version mismatch, **no write**) → editor, `404` →
  not-yet-persisted (open room, stays writable). A signed-in guest's role is also visible via
  `GET /v1/docs`'s `role` field; the probe is the general path that also covers anonymous
  link-viewers. The host is always the owner and skips the probe.
