import type { FastifyInstance } from 'fastify'
import type { Env } from '../env.js'

/**
 * ICE config for WebRTC clients, read from env. Public (no auth) — clients need
 * it to configure peers, and it carries no secrets in dev (a public STUN).
 * Real coturn credentials (turns: on :443) are injected via env at deploy time.
 */
export function registerIce(app: FastifyInstance, env: Env): void {
  app.get('/v1/ice', async () => ({ iceServers: env.ICE_SERVERS }))
}
