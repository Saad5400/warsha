/**
 * Standalone migration runner for production/container boot. Applies the Drizzle
 * SQL migrations in `./drizzle` then exits. Runs before the server starts (see
 * the Dockerfile CMD) so the schema is always current. Deliberately reads only
 * DATABASE_URL from the environment — migrating must not require the full app
 * env (S3 creds etc.) to be present.
 */
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL is required to run migrations')

  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
  const sql = postgres(url, { max: 1 })
  try {
    const db = drizzle(sql)
    await migrate(db, { migrationsFolder })
    console.log('migrations applied')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
