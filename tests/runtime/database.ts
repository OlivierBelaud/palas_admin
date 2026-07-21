import pg from 'pg'
import { readRuntimeState } from './state'

export async function withRuntimeDatabase<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: readRuntimeState().databaseUrl })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}
