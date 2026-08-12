# Warsha collab/sync server

A small Fastify + TypeScript service that backs Warsha's real-time collaboration:

- a **dumb blob store** for durable Yjs snapshots (Postgres for metadata + version,
  S3-compatible object storage for the bytes),
- a **light live-sync relay** (the y-websocket protocol) that fans tiny Yjs deltas between
  peers over a server-mediated WebSocket, enforcing roles (a viewer's document updates are
  dropped), and
- **accounts, sharing and quotas** (Phase 2): email+password users, Google-Docs-style
  per-doc ACLs + link access, and per-principal doc/byte quotas.

The server never persists Yjs and never owns the merge — all CRDT merging is client-side; the
relay keeps only an ephemeral per-room doc, evicted when the room empties. See
`../docs/engineering/COLLAB-SYNC-CONTRACT.md` for the authoritative contract (§7 = Phase 2).

## Stack

Node + TypeScript (ESM, strict) · Fastify · Drizzle ORM over Postgres ·
`@aws-sdk/client-s3` (Hetzner S3-compatible; MinIO in dev) · `@fastify/websocket` ·
`@fastify/rate-limit` · `@node-rs/argon2` (argon2id password hashing).

## Layout

```
server/
  src/
    index.ts            entry: load env, build app, listen, graceful shutdown
    app.ts              buildApp() factory (deps injectable for tests)
    env.ts              env parsing + validation
    ulid.ts             dependency-free ULID
    auth.ts             the one bearer→principal resolver (dev secret / session / device)
    access.ts           role model: effective role = max(owner, ACL, link_access)
    quota.ts            usage + quota checks (docs / bytes per principal)
    db/
      schema.ts         Drizzle schema: docs, devices, users, sessions, doc_acl
      client.ts         postgres-js + Drizzle handle
      repo.ts           DocRepo implementation (incl. atomic CAS)
      types.ts          DocRepo / DocRow ports
    storage/
      types.ts          BlobStorage port + versionedKey()
      s3.ts             S3 wrapper (put/get/delete)
    routes/
      health.ts         GET  /v1/health
      devices.ts        POST /v1/devices
      auth.ts           /v1/auth/* + /v1/me (signup/login/logout/claim-device)
      docs.ts           /v1/docs CRUD + ACL endpoints (roles + quotas + CAS)
      sync.ts           WS   /v1/sync/<room>  (y-websocket relay; viewer+ to connect, viewer writes dropped)
  test/
    cas.test.ts         CAS path: 200 bump / 409 stale / 413 oversize / 401 / 404
    auth.test.ts        signup/login/logout/me/claim-device + prod dev-bearer off
    sharing.test.ts     ACL enforcement matrix, link access, delete, list, quotas
    fakes.ts            in-memory DocRepo + BlobStorage
  drizzle/              generated SQL migration(s)
  docker-compose.yml    local Postgres + MinIO (+ bucket bootstrap)
  drizzle.config.ts
```

## Local run

Requires Node >= 20 and Docker (for Postgres + MinIO).

```bash
cd server
cp .env.example .env            # tweak if needed; defaults match docker-compose
npm install

# 1. Start local Postgres + MinIO, and auto-create the S3 bucket.
docker compose up -d

# 2. Apply the Drizzle migration to Postgres.
npm run db:migrate

# 3. Run the server (watch mode).
npm run dev
# → listening on http://0.0.0.0:8787
```

> `npm run dev` and `npm start` load `.env` automatically via Node's `--env-file`
> (`--env-file-if-exists` for `start`, so production reads real env vars with no `.env`
> present). Don't add a `dotenv` import — it would be redundant.

Pointing at Postgres / MinIO is entirely via env (see `.env.example`):

- **Postgres:** `DATABASE_URL` (default `postgres://warsha:warsha@localhost:5432/warsha`,
  which is exactly what `docker compose` brings up).
- **S3 / MinIO:** `S3_ENDPOINT` (`http://localhost:9000`), `S3_REGION`, `S3_BUCKET`
  (`warsha-docs`, created by the `minio-setup` job), `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` (`minioadmin` / `minioadmin`), and `S3_FORCE_PATH_STYLE=true`
  (required for MinIO). Point these at Hetzner in prod — nothing else changes.

MinIO console: http://localhost:9001 (minioadmin / minioadmin).

### Smoke test with curl

```bash
BASE=http://localhost:8787
SECRET=dev-shared-secret-change-me            # DEV_SHARED_SECRET

curl -s $BASE/v1/health                        # {"ok":true}

# Create a doc.
DOC=$(curl -s -X POST $BASE/v1/docs \
  -H "authorization: Bearer $SECRET" -H 'content-type: application/json' \
  -d '{"name":"hello"}')
echo "$DOC"                                    # {"id":"01...","version":0}
ID=$(echo "$DOC" | sed -E 's/.*"id":"([^"]+)".*/\1/')

# Write a snapshot (If-Match must equal the current version).
printf 'hello-bytes' > /tmp/snap.bin
curl -s -X PUT "$BASE/v1/docs/$ID" \
  -H "authorization: Bearer $SECRET" \
  -H 'content-type: application/octet-stream' -H 'if-match: 0' \
  --data-binary @/tmp/snap.bin                 # {"version":1}

# Read it back (blob is base64).
curl -s "$BASE/v1/docs/$ID" -H "authorization: Bearer $SECRET"

# Mint a live-sync ticket, then open the relay socket at ws://…/v1/sync/<ID>?ticket=<ticket>.
curl -s -XPOST $BASE/v1/signal-ticket -H "authorization: Bearer $SECRET"
```

## Scripts

| Script | What |
|---|---|
| `npm run dev` | tsx watch (`src/index.ts`) |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` |
| `npm start` | `node dist/index.js` |
| `npm run typecheck` | `tsc -p tsconfig.json` (no emit) |
| `npm run db:generate` | `drizzle-kit generate` (schema → SQL migration) |
| `npm run db:migrate` | `drizzle-kit migrate` (apply migrations) |
| `npm test` | `vitest run` (unit tests, no DB/S3 needed — uses in-memory fakes) |

## API (base `/v1`)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health` | `{ok:true}` |
| POST | `/v1/devices` | `201 {token}`; hard rate-limited |
| POST | `/v1/auth/signup` | `{email,password}` → `201 {token,user}`; `400` weak password / `409` taken; hard rate-limited |
| POST | `/v1/auth/login` | `{email,password}` → `200 {token,user}`; uniform `401`; hard rate-limited |
| POST | `/v1/auth/logout` | auth → `204` (revokes the presented session token) |
| POST | `/v1/auth/claim-device` | auth (account) `{deviceToken}` → `200 {claimed}`; re-owns that device's docs |
| GET | `/v1/me` | auth → `200 {user\|null, usage:{docs,bytes,limits}}` |
| GET | `/v1/docs` | auth → `200 {docs:[{id,name,version,role,linkAccess,sizeBytes,updatedAt}]}` (owned + shared) |
| POST | `/v1/docs` | `{name?}` → `201 {id, version:0}`; auth; quota-gated |
| GET | `/v1/docs/:id` | viewer+ → `200 {id,version,name,updatedAt,blob}` (blob = base64 or `""`); `403`/`404` |
| PUT | `/v1/docs/:id` | editor+; `If-Match:<version>`, `application/octet-stream` body; CAS → `200 {version}` / `409 {version,blob}` / `403` (role or quota) / `413` / `404` |
| PATCH | `/v1/docs/:id` | owner; `{name?, linkAccess?}` → `200` updated meta |
| DELETE | `/v1/docs/:id` | owner → `204`; deletes S3 blob + rows |
| GET | `/v1/docs/:id/acl` | owner → `200 {entries:[{email,role}]}` |
| PUT | `/v1/docs/:id/acl` | owner; `{email, role: editor\|viewer}` → `204` (upsert) |
| DELETE | `/v1/docs/:id/acl/:email` | owner → `204` (idempotent) |
| POST | `/v1/signal-ticket` | auth → `201 {ticket, expiresIn:60}`; single-use short-lived ticket for the live-sync WS |
| WS | `/v1/sync/:room` | y-websocket live relay; `?ticket=<ticket>` (preferred) or `?token=<bearer>` (**deprecated**) authenticates the socket; connecting to a persisted doc's room needs viewer+; a `<editor` socket's document updates are dropped |

**Auth:** `Authorization: Bearer <token>` where the token is a session token from
`/v1/auth/*`, a device token from `POST /v1/devices`, or (dev mode only) the
`DEV_SHARED_SECRET` env value. One resolver (`src/auth.ts`) maps any bearer to a
principal (`user:<id>` / `device:<token>`); the static dev bearer is rejected when
`NODE_ENV=production` (or `DEV_BEARER_ENABLED=false`). Passwords are argon2id at rest;
session tokens are stored sha256-hashed with a sliding 90-day expiry.

**Roles (contract §7.2):** effective role on a doc = max(owner, ACL entry for the
account's email, the doc's `linkAccess`). `linkAccess` defaults to `editor` — anyone
presenting the room id can edit, preserving the Phase-1 `#room=` link behavior — and the
owner can restrict it to `viewer` or `none` via PATCH.

> **Per-email ACL sharing is flag-gated and OFF by default** (`ACCOUNT_EMAIL_SHARING_ENABLED`,
> finding H2). Until email verification lands, unverified emails would let an attacker squat
> another user's address and self-grant access. With the flag off the ACL PUT/DELETE endpoints
> return `403 {error:"email_sharing_disabled"}` and existing ACL rows grant nothing; owner +
> link access are unaffected. Do **not** enable it in production yet.

**Quotas (contract §7.3):** device 10 docs / 25 MB, account 200 docs / 250 MB (env-
configurable, `QUOTA_*`). Doc count is checked at create; total bytes on every PUT
(charged to the doc's owner). Over quota → `403 {error:"quota_exceeded", usage}`. The
per-PUT 5 MB cap (`413`) is separate.

**CAS (PUT):** send `If-Match: <version you last saw>`. If it matches, the snapshot is
written to S3 under a fresh versioned key, the version bumps, and you get
`200 {version}`. If it is stale you get `409 {version, blob}` with the *current* state
so the client can `applyUpdate` and retry. Bodies over **5 MB** get `413`.

## Production deploy

The server fails **closed**: `loadEnv()` refuses to boot in production on a fail-open
misconfiguration (dev bearer on, missing sensitive vars, or dev/default credentials).

### Docker image

```bash
docker build -t warsha-server ./server
docker run --env-file ./server/.env.prod -p 8787:8787 warsha-server
```

The multi-stage `Dockerfile` compiles TypeScript, ships a slim prod-deps-only runtime,
bakes in `NODE_ENV=production`, and its entrypoint runs **migrations then the server**
(`node dist/migrate.js && node dist/index.js`) — if migrations fail the container exits
non-zero and never serves an out-of-date schema. `dist/migrate.js` needs only `DATABASE_URL`.

### Required-in-prod env (fail-closed)

These MUST be set to real values under `NODE_ENV=production` (dev defaults are rejected):

| Var | Notes |
|---|---|
| `DATABASE_URL` | Postgres DSN. The dev `warsha:warsha@localhost` value is rejected. |
| `CORS_ORIGINS` | Comma-separated allowed origins. `*` (reflect-any) is rejected. |
| `S3_ENDPOINT` | S3 endpoint. `http://localhost:9000` is rejected. |
| `S3_BUCKET` | Bucket name. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | The `minioadmin` dev creds are rejected. |

Plus `DEV_BEARER_ENABLED` must be off in prod (the default) — booting with it on is refused.
`DEV_SHARED_SECRET` is only needed when the dev bearer is explicitly enabled, and may not be
the well-known placeholder. Everything else (`HOST`, `PORT`, `S3_REGION`, quotas, rate limits,
`MAX_SNAPSHOT_BYTES`, `TRUST_PROXY`) has a safe default; see `.env.example`.

### Behind Traefik (X-Forwarded-For)

The server sits behind Traefik, so per-IP rate-limit buckets (global, device 5/hr,
auth+claim 10/15min) must key off the **real client IP**, not the proxy. Set `TRUST_PROXY`
to the number of proxy hops to trust (default in prod is `1` = Traefik) or an explicit list
of trusted proxy IPs/CIDRs. **Do not** use `TRUST_PROXY=true` (trust-all) in production — it
lets any client spoof `X-Forwarded-For` and mint unlimited rate-limit buckets.

> **Traefik must be configured to _overwrite_ (not append) `X-Forwarded-For`.** With the
> default `forwardedHeaders` behavior Traefik overwrites XFF with the real remote address; do
> not add the client-supplied value to the trusted list. If XFF is appended instead of
> overwritten, a client can prepend a spoofed IP and defeat the per-IP limits.

## Notes

- **Postgres `bytea` fallback** for tiny snapshots is intentionally not implemented —
  S3/MinIO is the single storage path (keeps the `docs` schema exactly as the
  contract specifies).
- **No TURN/STUN/ICE** — the live layer is a server-relayed WebSocket, not WebRTC, so no
  NAT-traversal infra is needed (this is why it always connects on school networks).
- **Device tokens** are stored in plaintext (they are the principal identity used in
  `docs.owner = 'device:<token>'`); session tokens are sha256-hashed. Hashing device tokens
  would require re-keying ownership + the claim flow (a data migration) and is deliberately
  deferred — see the `SECURITY(TODO)` note in `src/routes/devices.ts`.
```
