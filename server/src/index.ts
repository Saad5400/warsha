import { buildApp } from './app.js'
import { loadEnv } from './env.js'

async function main(): Promise<void> {
  const env = loadEnv()
  const app = await buildApp({ env, logger: true })

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: env.HOST, port: env.PORT })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
