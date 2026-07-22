import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const client = { unsafe: vi.fn() }
const postgresFactory = vi.fn(() => client)

vi.mock('postgres', () => ({ default: postgresFactory }))

const runtimePromise = import('./runtime.mjs')

function jwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

describe('Vercel fast-function runtime', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL
    process.env.JWT_SECRET = 'runtime-contract-secret'
  })

  afterEach(() => {
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET
  })

  it('recovers from missing cold-start configuration and reuses one bounded warm client', async () => {
    const { db } = await runtimePromise
    expect(() => db()).toThrow('DATABASE_URL is not configured')

    process.env.DATABASE_URL = 'postgresql://runtime-contract.test/database'
    const [first, second] = [db(), db()]

    expect(first).toBe(client)
    expect(second).toBe(client)
    expect(postgresFactory).toHaveBeenCalledTimes(1)
    expect(postgresFactory).toHaveBeenCalledWith(process.env.DATABASE_URL, {
      connect_timeout: 5,
      idle_timeout: 20,
      max: 2,
      prepare: false,
    })
  })

  it('derives authentication independently from each concurrent request', async () => {
    const { requireAdmin } = await runtimePromise
    const secret = process.env.JWT_SECRET as string
    const adminA = jwt({ id: 'admin-a', type: 'admin' }, secret)
    const adminB = jwt({ id: 'admin-b', actor_type: 'admin' }, secret)
    const requests = [
      new Request('https://admin.test/a', { headers: { authorization: `Bearer ${adminA}` } }),
      new Request('https://admin.test/b', { headers: { cookie: `manta.admin.access=${adminB}` } }),
      new Request('https://admin.test/anonymous'),
    ]

    const results = await Promise.all(requests.map(async (request) => requireAdmin(request)))

    expect(results.map((result) => result?.id ?? null)).toEqual(['admin-a', 'admin-b', null])
  })
})
