import type { FastifyInstance } from 'fastify'

export function registerHealth(app: FastifyInstance): void {
  app.get('/v1/health', async () => ({ ok: true }))
}
