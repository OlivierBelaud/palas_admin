import { describe, expect, it } from 'vitest'
import { resolveSql } from '../src/utils/manta-runtime'

describe('manta-runtime', () => {
  it('falls back to IDatabasePort when app.infra.db is the drizzle client', () => {
    const sql = Object.assign(async () => [], {
      unsafe: async () => [],
    })
    const dbPort = {
      getPool: () => sql,
      raw: async () => [],
    }
    const app = {
      infra: {
        db: { query: {} },
      },
      resolve: (key: string) => {
        if (key === 'IDatabasePort') return dbPort
        throw new Error(`Unknown key ${key}`)
      },
    }

    expect(resolveSql(app)).toBe(sql)
  })
})
