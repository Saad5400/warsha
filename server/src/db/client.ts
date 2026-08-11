import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Database = ReturnType<typeof drizzle<typeof schema>>

export interface DbHandle {
  db: Database
  sql: ReturnType<typeof postgres>
}

/** Open a Postgres connection and wrap it with Drizzle. */
export function createDb(url: string): DbHandle {
  const sql = postgres(url)
  const db = drizzle(sql, { schema })
  return { db, sql }
}
