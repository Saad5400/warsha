import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { DocRepo } from '../db/types.js'
import type { BearerResolver, Principal } from '../auth.js'
import { atLeast, effectiveRole } from '../access.js'
import type { SignalTicketStore } from '../tickets.js'
import { isValidUlid } from '../ulid.js'

/**
 * Live Yjs sync relay — a light server-mediated WebSocket that replaces the
 * y-webrtc P2P mesh (STUN-only P2P dies behind symmetric NAT — school networks).
 * The server holds ONE ephemeral in-memory Y.Doc per active room, answers a
 * joiner's SyncStep1, merges writers' updates, and fans deltas out to peers. It
 * is ONLY the live layer: durable persistence stays in the S3 blob CAS
 * (routes/docs.ts + client blobSync.ts) — full snapshots never travel through here.
 *
 * ★ WRITE ENFORCEMENT (the whole security point of moving off P2P): a socket whose
 * effective role is < editor (a viewer / read-only link holder) may REQUEST state
 * (SyncStep1) and relay awareness (cursors), but any inbound Yjs document update
 * (SyncStep2 / update) is DROPPED — it never merges into the room doc and never
 * fans out. So a hostile view-only link holder cannot inject edits the server
 * would launder to everyone (a regression the WebRTC+CAS design explicitly
 * tolerated; contract §7.2 "Honesty note" — now closed for the live layer).
 *
 * Access (read): identical rule to the old signal relay — viewer+ to connect to a
 * PERSISTED doc; an UNPERSISTED room (repo.getDoc → null) is open to anyone (the
 * room ULID is the unguessable capability). Auth via a single-use `?ticket=`
 * (preferred; POST /v1/signal-ticket) or the deprecated `?token=`/bearer.
 *
 * The room id is the URL PATH segment (`/v1/sync/<ULID>`) because that is how
 * y-websocket's WebsocketProvider builds its URL (`serverUrl + '/' + roomname`);
 * it is validated as a canonical ULID before it selects a room.
 *
 * Resource bounds (ported from the old signal.ts, finding H4): per-IP concurrent
 * socket cap, per-socket message-rate cap, app-level ping/pong idle reaping. The
 * WS payload cap lives in app.ts (MAX_SNAPSHOT_BYTES + 64 KiB) so a full-state
 * frame fits but stays bounded.
 */

const PING_TIMEOUT_MS = 30_000

const WS_CONNECTING = 0
const WS_OPEN = 1

/** Max concurrent sync sockets from one client IP. */
const MAX_SOCKETS_PER_IP = 32
/** Message-rate window + ceiling per socket. This bounds the FRAME COUNT (decode
 *  CPU), NOT bytes — the per-frame budget is now ~MAX_SNAPSHOT_BYTES (a full-state
 *  sync frame can be the whole doc), so a high frame ceiling paired with that big a
 *  frame is a DoS lever. Real editing sits far below this: Yjs coalesces rapid
 *  keystrokes into a handful of tiny deltas, and awareness (cursor) frames are
 *  throttled — a human never sustains 60 frames/s for ten seconds. So the ceiling
 *  is sized to swallow a genuine typing+cursor burst yet cut a flood off early
 *  (was 2000/10s when frames were assumed tiny; the ~5 MB-per-frame reality makes
 *  that far too permissive). Memory growth is bounded separately (MAX_ROOM_DOC_BYTES). */
const MSG_WINDOW_MS = 10_000
const MAX_MESSAGES_PER_WINDOW = 600

// Close codes. y-websocket's default `shouldReconnect` treats codes in the
// 4400-4499 range as PERMANENT (verified against y-websocket 3.1.0:
// `defaultShouldReconnect = (e) => !(e.code >= 4400 && e.code < 4500)`), stopping
// its reconnect loop; every other code (1008 included) is retriable. We mirror the
// HTTP 4xx meaning into that sub-range.
/** Permanent deny (principal resolved but role < viewer): re-minting a ticket can't
 *  change the answer, so signal terminal — y-websocket must NOT spin reconnecting
 *  (each retry re-hits getDoc/getAcl). 44xx == HTTP 403 Forbidden. */
const WS_CLOSE_FORBIDDEN = 4403
/** Doc/room grew past MAX_ROOM_DOC_BYTES — terminal (reconnecting re-floods). 44xx
 *  == HTTP 413 Payload Too Large. */
const WS_CLOSE_TOO_LARGE = 4413

// y-websocket wire message types (see y-protocols). messageSync carries the Yjs
// sync sub-protocol; messageAwareness carries presence; messageQueryAwareness asks
// for the current awareness set.
const messageSync = 0
const messageAwareness = 1
const messageQueryAwareness = 3

export interface SyncDeps {
  repo: DocRepo
  resolveBearer: BearerResolver
  tickets: SignalTicketStore
  /** §7.2 email-ACL gate (finding H2); false ignores ACL-by-email grants. */
  emailSharingEnabled: boolean
  /** Durable per-snapshot cap; the live room doc is bounded to a small multiple of
   *  it (MAX_ROOM_DOC_BYTES) so one tenant can't grow a room without bound. */
  maxSnapshotBytes: number
}

/** One live room: an ephemeral doc + awareness, plus its connections. Evicted the
 *  instant the last connection closes (see `evict`), so an idle room frees memory. */
interface Room {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  /** conn -> the awareness clientIDs that conn introduced (cleared on its close). */
  conns: Map<WebSocket, Set<number>>
  updateHandler: (update: Uint8Array, origin: unknown) => void
  awarenessHandler: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void
  /** Bytes applied since the last exact size check (FIX3). Encoding the whole doc on
   *  every frame is O(docsize) and would be costly, so we only recompute the real
   *  encoded size once this crosses ROOM_SIZE_CHECK_BYTES — cheap amortized, and the
   *  worst-case overshoot before we notice is one check window. */
  appliedSinceCheck: number
}

function extractSocketToken(req: FastifyRequest): string | null {
  const query = req.query as Record<string, unknown> | undefined
  const fromQuery = query?.token
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  const header = req.headers.authorization
  if (header) {
    const [scheme, token] = header.split(' ')
    if (scheme?.toLowerCase() === 'bearer' && token) return token.trim() || null
  }
  return null
}

function toUint8Array(raw: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw))
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}

export function registerSync(app: FastifyInstance, deps: SyncDeps): void {
  const { repo, resolveBearer, tickets, emailSharingEnabled, maxSnapshotBytes } = deps

  // FIX3 — bound the ephemeral room doc's memory. `gc:true` only compacts deletes;
  // an authorized editor could still stream distinct large updates and grow one
  // room without bound on a shared multi-tenant box. The durable snapshot cap is
  // maxSnapshotBytes, so the LIVE doc should not vastly exceed it. We cap at 2× that
  // (encoded the same way, `Y.encodeStateAsUpdate`): 1× is the legitimate steady
  // state, the extra 1× is headroom for transient CRDT structure (concurrent
  // structs, the client-state map, content not yet gc'd). A single full-state sync
  // frame is itself allowed up to ~maxSnapshotBytes (app.ts maxPayload), so the
  // ceiling must sit above one frame — 2× does. A room past this is pathological.
  const MAX_ROOM_DOC_BYTES = maxSnapshotBytes * 2
  // Recompute the exact encoded size once this many bytes have been applied since
  // the last check — keeps the O(docsize) encode to ~once per snapshot-worth of
  // traffic (≈1× amortized overhead), bounding worst-case overshoot to one window.
  const ROOM_SIZE_CHECK_BYTES = maxSnapshotBytes

  // room name (ULID) -> Room. Per app instance (closure), so tests never share state.
  const rooms = new Map<string, Room>()
  // Live socket count per client IP (finding H4: bound total sockets per IP).
  const socketsPerIp = new Map<string, number>()

  const send = (conn: WebSocket, bytes: Uint8Array): void => {
    if (conn.readyState !== WS_CONNECTING && conn.readyState !== WS_OPEN) {
      conn.close()
      return
    }
    try {
      conn.send(bytes)
    } catch {
      conn.close()
    }
  }

  const getOrCreateRoom = (name: string): Room => {
    const existing = rooms.get(name)
    if (existing) return existing

    // gc:true — this is an ephemeral relay doc; compacting deleted content keeps
    // its memory footprint small (durable history lives in S3, not here).
    const doc = new Y.Doc({ gc: true })
    const awareness = new awarenessProtocol.Awareness(doc)
    // The server is a relay, not a participant — it holds no local awareness state.
    awareness.setLocalState(null)
    const conns = new Map<WebSocket, Set<number>>()

    // A writer's merged update fans out to every OTHER connection (the origin
    // already has it). origin is the WebSocket we applied the update with.
    const updateHandler = (update: Uint8Array, origin: unknown): void => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, messageSync)
      syncProtocol.writeUpdate(enc, update)
      const msg = encoding.toUint8Array(enc)
      for (const conn of conns.keys()) {
        if (conn === origin) continue
        send(conn, msg)
      }
    }

    // Awareness (cursors) fans out to everyone; we also track which clientIDs each
    // connection introduced, so we can retract them when it drops (no ghost cursors).
    const awarenessHandler = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ): void => {
      const { added, updated, removed } = changes
      const changed = added.concat(updated, removed)
      const controlled = origin ? conns.get(origin as WebSocket) : undefined
      if (controlled) {
        for (const id of added) controlled.add(id)
        for (const id of removed) controlled.delete(id)
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, messageAwareness)
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
      )
      const msg = encoding.toUint8Array(enc)
      for (const conn of conns.keys()) send(conn, msg)
    }

    doc.on('update', updateHandler)
    awareness.on('update', awarenessHandler)

    const room: Room = {
      doc,
      awareness,
      conns,
      updateHandler,
      awarenessHandler,
      appliedSinceCheck: 0,
    }
    rooms.set(name, room)
    return room
  }

  // FIX3 — after a writer's update is applied, keep the room doc bounded. Accumulate
  // the applied frame size (an upper bound on the true update bytes) and, only once
  // it crosses the check window, encode the whole doc once to learn its real size.
  // Over the ceiling → close the socket whose apply tripped the check with a TERMINAL
  // 44xx (reconnecting would just re-flood). Closing the writer(s) stops further
  // growth; the doc stays pinned near the ceiling until the room empties and evicts,
  // and any subsequent writer trips the very next check — so no socket count can grow
  // it unbounded. We do not evict outright: that would punish innocent peers.
  const enforceRoomSize = (room: Room, offender: WebSocket, appliedBytes: number): void => {
    room.appliedSinceCheck += appliedBytes
    if (room.appliedSinceCheck < ROOM_SIZE_CHECK_BYTES) return
    room.appliedSinceCheck = 0
    if (Y.encodeStateAsUpdate(room.doc).length <= MAX_ROOM_DOC_BYTES) return
    try {
      offender.close(WS_CLOSE_TOO_LARGE, 'room too large')
    } catch {
      /* already closing */
    }
  }

  /** Free a room once its last connection has gone (verified no leak). */
  const evict = (name: string): void => {
    const room = rooms.get(name)
    if (!room || room.conns.size > 0) return
    room.doc.off('update', room.updateHandler)
    room.awareness.off('update', room.awarenessHandler)
    room.awareness.destroy()
    room.doc.destroy()
    rooms.delete(name)
  }

  app.get('/v1/sync/:room', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const ip = req.ip
    const openForIp = socketsPerIp.get(ip) ?? 0
    if (openForIp >= MAX_SOCKETS_PER_IP) {
      try {
        socket.close(1013, 'too many connections')
      } catch {
        /* already closing */
      }
      return
    }
    socketsPerIp.set(ip, openForIp + 1)

    let ipReleased = false
    const releaseIp = (): void => {
      if (ipReleased) return
      ipReleased = true
      const n = (socketsPerIp.get(ip) ?? 1) - 1
      if (n <= 0) socketsPerIp.delete(ip)
      else socketsPerIp.set(ip, n)
    }

    const query = req.query as Record<string, unknown> | undefined
    const params = req.params as Record<string, unknown> | undefined

    // The doc id is the URL path segment and MUST be a canonical ULID before it
    // selects a room / would ever flow into an S3 key on the durable side.
    const roomName = typeof params?.room === 'string' ? params.room : ''
    if (!isValidUlid(roomName)) {
      releaseIp()
      try {
        socket.close(1008, 'invalid room')
      } catch {
        /* already closing */
      }
      return
    }

    let closed = false
    let joined = false
    let room: Room | null = null
    let controlledIds: Set<number> | null = null
    // Fail-closed until access resolves: a socket cannot write before we know it may.
    let canWrite = false
    let pongReceived = true

    // Message-rate limiter (finding H4).
    let msgCount = 0
    const rateInterval = setInterval(() => {
      msgCount = 0
    }, MSG_WINDOW_MS)

    const pingInterval = setInterval(() => {
      if (!pongReceived) {
        socket.close()
        return
      }
      pongReceived = false
      try {
        socket.ping()
      } catch {
        socket.close()
      }
    }, PING_TIMEOUT_MS)

    socket.on('pong', () => {
      pongReceived = true
    })

    socket.on('close', () => {
      closed = true
      clearInterval(pingInterval)
      clearInterval(rateInterval)
      releaseIp()
      if (room && joined) {
        // Retract this socket's cursors so peers don't see a ghost (fires the
        // awareness handler → broadcasts the removal to whoever remains).
        if (controlledIds && controlledIds.size > 0) {
          awarenessProtocol.removeAwarenessStates(room.awareness, [...controlledIds], null)
        }
        room.conns.delete(socket)
        if (room.conns.size === 0) evict(roomName)
      }
    })

    // Resolve the socket's principal once (ticket preferred; bearer deprecated).
    const ticket = typeof query?.ticket === 'string' ? query.ticket : null
    let principalPromise: Promise<Principal | null>
    if (ticket) {
      principalPromise = Promise.resolve(tickets.consume(ticket))
    } else {
      const token = extractSocketToken(req)
      principalPromise = token ? resolveBearer(token).catch(() => null) : Promise.resolve(null)
    }

    // Access decision (once, up front): viewer+ to connect to a persisted doc; an
    // unpersisted room is open to anyone. canWrite gates the ★ write-block below.
    // `principalResolved` distinguishes a DEFINITE deny (an authenticated caller who
    // simply lacks the role) from an ANONYMOUS one (no/consumed ticket → principal
    // null) so join() can pick a terminal vs retriable close code (FIX1).
    const accessPromise = (async (): Promise<{
      canConnect: boolean
      canWrite: boolean
      principalResolved: boolean
    }> => {
      const doc = await repo.getDoc(roomName)
      if (!doc) {
        // Unpersisted room: open (the ULID is the capability), and writable — this
        // is a fresh room created before any server contact, exactly the P2P case.
        return { canConnect: true, canWrite: true, principalResolved: false }
      }
      const principal = await principalPromise
      const acl =
        emailSharingEnabled && principal?.email
          ? await repo.getAclRole(roomName, principal.email)
          : null
      const role = effectiveRole(doc, principal, acl, emailSharingEnabled)
      return {
        canConnect: atLeast(role, 'viewer'),
        canWrite: atLeast(role, 'editor'),
        principalResolved: principal != null,
      }
    })()

    const join = (access: {
      canConnect: boolean
      canWrite: boolean
      principalResolved: boolean
    }): void => {
      if (closed) return
      if (!access.canConnect) {
        // FIX1 — pick a close code y-websocket will handle sanely on reconnect:
        //  • principal RESOLVED but role < viewer → PERMANENT deny. Re-minting a
        //    ticket resolves the SAME principal, so the answer can't change; close
        //    with the terminal 4403 so the client stops reconnecting (a retriable
        //    1008 spun an infinite loop re-hitting getDoc/getAcl).
        //  • principal NULL (no ticket, or a single-use ticket already consumed on a
        //    prior connect) → keep the retriable 1008. The single-use ticket means
        //    the OWNER of a viewer/none-link room reconnects as anonymous after any
        //    drop; the client re-mints a fresh ticket before each reconnect (see
        //    session.ts), so a retriable close lets it recover live sync as itself.
        const code = access.principalResolved ? WS_CLOSE_FORBIDDEN : 1008
        try {
          socket.close(code, 'forbidden')
        } catch {
          /* already closing */
        }
        return
      }
      canWrite = access.canWrite
      room = getOrCreateRoom(roomName)
      controlledIds = new Set()
      room.conns.set(socket, controlledIds)
      joined = true

      // Send SyncStep1 (the server's state vector): the client answers with a
      // SyncStep2 carrying whatever the room is missing (dropped if it's a viewer).
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, messageSync)
      syncProtocol.writeSyncStep1(enc, room.doc)
      send(socket, encoding.toUint8Array(enc))

      // Seed the joiner with the room's current awareness (existing cursors).
      const states = room.awareness.getStates()
      if (states.size > 0) {
        const aenc = encoding.createEncoder()
        encoding.writeVarUint(aenc, messageAwareness)
        encoding.writeVarUint8Array(
          aenc,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
        )
        send(socket, encoding.toUint8Array(aenc))
      }
    }

    const handleMessage = (raw: Buffer | ArrayBuffer | Buffer[]): void => {
      if (closed || !joined || !room) return
      try {
        const bytes = toUint8Array(raw)
        const decoder = decoding.createDecoder(bytes)
        const messageType = decoding.readVarUint(decoder)
        switch (messageType) {
          case messageSync: {
            // Peek the sync sub-type so the ★ write-block can act BEFORE anything is
            // applied to the room doc. The decoder is now positioned right after the
            // sub-type, exactly where the specific reader expects it.
            const syncType = decoding.readVarUint(decoder)
            if (syncType === syncProtocol.messageYjsSyncStep1) {
              // Read request: answer with SyncStep2 (this socket only). Always
              // allowed — a viewer may READ the shared state.
              const enc = encoding.createEncoder()
              encoding.writeVarUint(enc, messageSync)
              syncProtocol.readSyncStep1(decoder, enc, room.doc)
              send(socket, encoding.toUint8Array(enc))
            } else if (
              syncType === syncProtocol.messageYjsSyncStep2 ||
              syncType === syncProtocol.messageYjsUpdate
            ) {
              // ★ WRITE-BLOCK: a document mutation. Drop it outright for a
              // read-only socket — it must not merge into the room doc, and with
              // nothing applied the update handler never fans anything out.
              if (!canWrite) return
              if (syncType === syncProtocol.messageYjsSyncStep2) {
                syncProtocol.readSyncStep2(decoder, room.doc, socket)
              } else {
                syncProtocol.readUpdate(decoder, room.doc, socket)
              }
              // FIX3 — this apply may have grown the room doc; keep it bounded. The
              // frame length upper-bounds the applied update bytes (fine as the
              // check trigger — it only makes checks fire sooner, never later).
              enforceRoomSize(room, socket, bytes.length)
            }
            break
          }
          case messageAwareness: {
            // Cursors/presence — allowed for viewers. applyAwarenessUpdate fires the
            // room's awareness handler, which fans the change out to the others.
            awarenessProtocol.applyAwarenessUpdate(
              room.awareness,
              decoding.readVarUint8Array(decoder),
              socket,
            )
            break
          }
          case messageQueryAwareness: {
            const states = room.awareness.getStates()
            const enc = encoding.createEncoder()
            encoding.writeVarUint(enc, messageAwareness)
            encoding.writeVarUint8Array(
              enc,
              awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
            )
            send(socket, encoding.toUint8Array(enc))
            break
          }
          default:
            break
        }
      } catch {
        // A malformed frame must never crash the process — drop it.
      }
    }

    // Serialize behind the access decision: join() must run before any client frame
    // (the client sends its own SyncStep1 immediately on open) is processed, so the
    // room exists and canWrite is known. A denied socket is closed in join().
    let chain: Promise<void> = accessPromise.then(
      (access) => join(access),
      () => {
        // Access resolution should never reject (getDoc/resolveBearer are guarded),
        // but fail closed if it somehow does.
        try {
          socket.close(1011, 'access error')
        } catch {
          /* already closing */
        }
      },
    )

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      if (closed) return
      // Per-socket message-rate cap (finding H4): a flooding socket is dropped.
      if (++msgCount > MAX_MESSAGES_PER_WINDOW) {
        socket.close(1008, 'rate limit')
        return
      }
      chain = chain.then(
        () => handleMessage(raw),
        () => handleMessage(raw),
      )
    })
  })
}
