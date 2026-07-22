// biome-ignore lint/style/noRestrictedImports: this regression test must exercise the real framework command wrapper and replay engine.
import { createWorkflow, defineCommand, WorkflowManager } from '@mantajs/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { RuntimeSql } from '../manta-runtime'

const runPosthogHogQL = vi.hoisted(() => vi.fn(async () => []))

vi.mock('../posthog-query', () => ({
  posthogPrivateKey: () => 'phx_test',
  runPosthogHogQL,
}))

beforeAll(() => {
  // App commands receive these primitives as Manta build-time globals. Bind
  // the real implementations so the imported command is the production
  // CommandDefinition, including its bound step proxy.
  vi.stubGlobal('defineCommand', defineCommand)
  vi.stubGlobal('z', z)
})

interface SqlCall {
  query: string
  values: unknown[]
}

function createProjectionSql(calls: SqlCall[]): RuntimeSql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?')
    calls.push({ query, values })
    if (query.includes('INSERT INTO klaviyo_projection_state')) return [{ generation: '11' }]
    if (query.includes('UPDATE klaviyo_projection_state')) return []
    throw new Error(`Unexpected SQL: ${query}`)
  }) as unknown as RuntimeSql
  sql.unsafe = async <T>() => [] as T
  return sql
}

describe('syncKlaviyoEvents WorkflowManager replay', () => {
  it('reuses the real command start token, generation and upper bound after repeated post-start failures', async () => {
    const sqlCalls: SqlCall[] = []
    const sql = createProjectionSql(sqlCalls)
    const listKlaviyoEvents = vi
      .fn<() => Promise<unknown[]>>()
      .mockRejectedValueOnce(new Error('first transient high-water failure'))
      .mockRejectedValueOnce(new Error('second transient high-water failure'))
      .mockResolvedValueOnce([])
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const app = {
      infra: {
        logger,
        db: {
          getPool: () => sql,
          raw: async () => [],
        },
      },
      modules: {
        klaviyoEvent: { listKlaviyoEvents },
      },
    }

    const command = (await import('../../commands/admin/sync-klaviyo-events')).default
    const workflow = createWorkflow<{ fullRefresh: boolean }, unknown>(command.name, (input, ctx) =>
      command.workflow(input, ctx),
    )
    const manager = new WorkflowManager(app as never)
    manager.register(workflow)

    const result = await manager.run(command.name, {
      transactionId: 'tx_sync_klaviyo_replay',
      input: { fullRefresh: false },
      cleanup: false,
    })

    const starts = sqlCalls.filter((call) => call.query.includes('INSERT INTO klaviyo_projection_state'))
    const failures = sqlCalls.filter((call) => call.query.includes("SET status = 'failed'"))
    const successes = sqlCalls.filter((call) => call.query.includes("SET status = 'succeeded'"))
    expect(listKlaviyoEvents).toHaveBeenCalledTimes(3)
    expect(starts).toHaveLength(1)
    expect(failures).toHaveLength(2)
    expect(successes).toHaveLength(1)
    expect(runPosthogHogQL).toHaveBeenCalledTimes(1)

    const startToken = starts[0].values[1]
    const startAttemptedAt = starts[0].values[2] as Date
    const startThrough = starts[0].values[3] as Date
    expect(startThrough.getMilliseconds()).toBe(0)
    expect(failures[0].values.slice(3)).toEqual([startToken, 11, startAttemptedAt, startThrough])
    expect(failures[1].values.slice(3)).toEqual([startToken, 11, startAttemptedAt, startThrough])
    expect(successes[0].values.slice(4)).toEqual([startToken, 11, startAttemptedAt, startThrough])
    expect(result.result).toMatchObject({
      projection_fence: {
        generation: 11,
        syncToken: startToken,
        attemptedAtIso: startAttemptedAt.toISOString(),
        throughIso: startThrough.toISOString(),
      },
    })
  })
})
