import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { DocRepo } from '../db/types.js'
import type { BearerResolver, Principal } from '../auth.js'
import { atLeast, effectiveRole } from '../access.js'
import type { SignalTicketStore } from '../tickets.js'

/**
 * y-webrtc signaling relay, ported from `y-webrtc/bin/server.js` onto
 * @fastify/websocket. Pure relay: topic subscribe/unsubscribe/publish plus
 * app-level ping/pong. Rooms (topics) are opaque doc ids; the server never
 * inspects publish payloads — it only fans them out to that topic's subscribers.
 *
 * Phase 2 (§7.2): subscribing to a room whose doc is persisted requires
 * viewer+ — the socket authenticates via `?ticket=` (preferred; short-lived,
 * single-use, see /v1/signal-ticket) or the deprecated `?token=` (or an
 * Authorization header on the upgrade request). Rooms with no persisted doc stay
 * open to anyone: they exist purely P2P (offline-first, created before any server
 * contact), and the room ULID is the unguessable capability. Payloads remain
 * uninspected.
 *
 * Resource bounds (finding H4): the socket is capped on subscriptions, message
 * rate, topics per subscribe frame, and sockets per IP; the per-topic access
 * decision is memoized so a subscribe frame cannot amplify into one DB query per
 * topic per frame.
 */

const PING_TIMEOUT_MS = 30_000

const WS_CONNECTING = 0
const WS_OPEN = 1

/** Max distinct topics one socket may be subscribed to at once. */
const MAX_TOPICS_PER_SOCKET = 256
/** Max topics accepted in a single `subscribe` frame. */
const MAX_TOPICS_PER_MESSAGE = 128
/** Max concurrent signaling sockets from one client IP. */
const MAX_SOCKETS_PER_IP = 32
/** Message-rate window + ceiling per socket. */
const MSG_WINDOW_MS = 10_000
const MAX_MESSAGES_PER_WINDOW = 240

interface SignalMessage {
  type?: string
  topics?: unknown
  topic?: unknown
  clients?: number
  [key: string]: unknown
}

export interface SignalDeps {
  repo: DocRepo
  resolveBearer: BearerResolver
  tickets: SignalTicketStore
  /** §7.2 email-ACL gate (finding H2); false ignores ACL-by-email grants. */
  emailSharingEnabled: boolean
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

export function registerSignal(app: FastifyInstance, deps: SignalDeps): void {
  const { repo, resolveBearer, tickets, emailSharingEnabled } = deps

  // topic name -> set of subscribed sockets. Per app instance (closure), so
  // multiple instances (e.g. tests) never share relay state.
  const topics = new Map<string, Set<WebSocket>>()
  // Live socket count per client IP (finding H4: bound total sockets per IP).
  const socketsPerIp = new Map<string, number>()

  const send = (conn: WebSocket, message: unknown): void => {
    if (conn.readyState !== WS_CONNECTING && conn.readyState !== WS_OPEN) {
      conn.close()
      return
    }
    try {
      conn.send(JSON.stringify(message))
    } catch {
      conn.close()
    }
  }

  app.get('/v1/signal', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const ip = req.ip
    const openForIp = socketsPerIp.get(ip) ?? 0
    if (openForIp >= MAX_SOCKETS_PER_IP) {
      // Too many concurrent sockets from this IP: refuse before doing any work.
      try {
        socket.close(1013, 'too many connections')
      } catch {
        /* already closing */
      }
      return
    }
    socketsPerIp.set(ip, openForIp + 1)

    const subscribedTopics = new Set<string>()
    // Memoized per-topic access decision (finding H4): at most one repo.getDoc
    // per distinct topic for this socket's lifetime, not one per subscribe frame.
    const accessCache = new Map<string, boolean>()
    let closed = false
    let pongReceived = true
    let ipReleased = false

    // Message-rate limiter (finding H4).
    let msgCount = 0
    const rateInterval = setInterval(() => {
      msgCount = 0
    }, MSG_WINDOW_MS)

    const releaseIp = (): void => {
      if (ipReleased) return
      ipReleased = true
      const n = (socketsPerIp.get(ip) ?? 1) - 1
      if (n <= 0) socketsPerIp.delete(ip)
      else socketsPerIp.set(ip, n)
    }

    // Resolve the socket's principal once, up front. Anonymous sockets are
    // allowed — link_access / unpersisted-room rules decide what they can join.
    // Preferred: a single-use ticket (?ticket=). Deprecated: a raw bearer (?token=).
    const query = req.query as Record<string, unknown> | undefined
    const ticket = typeof query?.ticket === 'string' ? query.ticket : null
    let principalPromise: Promise<Principal | null>
    if (ticket) {
      principalPromise = Promise.resolve(tickets.consume(ticket))
    } else {
      const token = extractSocketToken(req)
      principalPromise = token ? resolveBearer(token).catch(() => null) : Promise.resolve(null)
    }

    /** viewer+ on persisted docs; unpersisted rooms are open (see module doc). */
    const canSubscribe = async (name: string): Promise<boolean> => {
      const cached = accessCache.get(name)
      if (cached !== undefined) return cached
      const doc = await repo.getDoc(name)
      let allowed: boolean
      if (!doc) {
        allowed = true
      } else {
        const principal = await principalPromise
        const acl =
          emailSharingEnabled && principal?.email
            ? await repo.getAclRole(name, principal.email)
            : null
        allowed = atLeast(effectiveRole(doc, principal, acl, emailSharingEnabled), 'viewer')
      }
      accessCache.set(name, allowed)
      return allowed
    }

    const pingInterval = setInterval(() => {
      if (!pongReceived) {
        socket.close()
        clearInterval(pingInterval)
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
      for (const name of subscribedTopics) {
        const subs = topics.get(name)
        if (subs) {
          subs.delete(socket)
          if (subs.size === 0) topics.delete(name)
        }
      }
      subscribedTopics.clear()
      closed = true
      clearInterval(pingInterval)
      clearInterval(rateInterval)
      releaseIp()
    })

    const handleMessage = async (raw: Buffer | ArrayBuffer | Buffer[]): Promise<void> => {
      if (closed) return
      // Per-socket message-rate cap (finding H4): a flooding socket is dropped.
      if (++msgCount > MAX_MESSAGES_PER_WINDOW) {
        socket.close(1008, 'rate limit')
        return
      }
      let message: SignalMessage
      try {
        const text = Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : Buffer.from(raw as Buffer).toString('utf8')
        message = JSON.parse(text) as SignalMessage
      } catch {
        return
      }
      if (!message || typeof message.type !== 'string') return

      switch (message.type) {
        case 'subscribe': {
          const list = Array.isArray(message.topics) ? message.topics : []
          // Bound the per-frame topic list (finding H4).
          const bounded = list.slice(0, MAX_TOPICS_PER_MESSAGE)
          for (const name of bounded) {
            if (typeof name !== 'string') continue
            if (subscribedTopics.has(name)) continue
            if (subscribedTopics.size >= MAX_TOPICS_PER_SOCKET) break
            if (!(await canSubscribe(name))) {
              // Denied: never join the topic. Payload-blindness is unaffected —
              // this checks room membership, not message contents.
              send(socket, { type: 'access-denied', topic: name })
              continue
            }
            if (closed) return // socket may have closed while we checked
            let set = topics.get(name)
            if (!set) {
              set = new Set()
              topics.set(name, set)
            }
            set.add(socket)
            subscribedTopics.add(name)
          }
          break
        }
        case 'unsubscribe': {
          const list = Array.isArray(message.topics) ? message.topics : []
          for (const name of list) {
            if (typeof name !== 'string') continue
            topics.get(name)?.delete(socket)
            subscribedTopics.delete(name)
          }
          break
        }
        case 'publish': {
          // finding H5: only fan out to a topic this socket actually subscribed
          // to (i.e. passed the subscribe access check). A socket that was
          // denied on subscribe must not be able to inject SDP/ICE into the room.
          if (typeof message.topic === 'string' && subscribedTopics.has(message.topic)) {
            const receivers = topics.get(message.topic)
            if (receivers) {
              message.clients = receivers.size
              for (const receiver of receivers) send(receiver, message)
            }
          }
          break
        }
        case 'ping': {
          send(socket, { type: 'pong' })
          break
        }
        default:
          break
      }
    }

    // Serialize message handling: the subscribe check is async, and a client's
    // publish must never overtake its own earlier subscribe.
    let chain: Promise<void> = Promise.resolve()
    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      chain = chain.then(
        () => handleMessage(raw),
        () => handleMessage(raw),
      )
    })
  })
}
