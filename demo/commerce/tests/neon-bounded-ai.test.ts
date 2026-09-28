import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
// biome-ignore lint/style/noRestrictedImports: test fixture type for the installed AI handler
import type { MantaApp } from '@mantajs/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cliRoot = dirname(createRequire(import.meta.url).resolve('@mantajs/cli/package.json'))
const { buildTools: buildAiTools } = await import(pathToFileURL(join(cliRoot, 'dist/ai/chat-handler.js')).href)

beforeEach(() => vi.stubGlobal('require', createRequire(import.meta.url)))
afterEach(() => vi.unstubAllGlobals())

describe('bounded AI entity reads', () => {
  async function boundedTools(...args: Parameters<typeof buildAiTools>) {
    return (await buildAiTools(...args)) as unknown as Record<string, { execute: (input: unknown) => Promise<unknown> }>
  }
  function appFor(service: Record<string, unknown>, queryService?: unknown) {
    return {
      commands: {},
      modules: { fact: service },
      resolve(key: string) {
        if (key === 'factModuleService') return service
        if (key === 'queryService' && queryService) return queryService
        throw new Error('not registered')
      },
    } as unknown as MantaApp
  }

  it('counts entities without fetching their payloads', async () => {
    const list = vi.fn(async () => {
      throw new Error('unbounded read')
    })
    const __queryPage = vi.fn(async () => [[], 141867])
    const tools = await boundedTools(appFor({ list, __queryPage }), ['fact'], [])
    expect(await tools.list_entities.execute({})).toEqual({ fact: 141867 })
    expect(__queryPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 0, offset: 0 }))
    expect(list).not.toHaveBeenCalled()
  })

  it('bounds fallback reads at the repository boundary', async () => {
    const list = vi.fn(async () => {
      throw new Error('unbounded read')
    })
    const __queryPage = vi.fn(async () => [[{ id: 'one', day: 'today' }], 8])
    const tools = await boundedTools(appFor({ list, __queryPage }), ['fact'], [])
    expect(
      await tools.query_entity.execute({
        entity: 'fact',
        fields: ['id'],
        filters: { day: 'today' },
        limit: 1,
        offset: 2,
      }),
    ).toEqual({ data: [{ id: 'one' }], count: 8 })
    expect(__queryPage).toHaveBeenCalledWith(expect.objectContaining({ where: { day: 'today' }, limit: 1, offset: 2 }))
    expect(list).not.toHaveBeenCalled()
  })

  it('never broadens a failed query graph into a full-table read', async () => {
    const list = vi.fn(async () => [])
    const __queryPage = vi.fn(async () => [[], 0])
    const tools = await boundedTools(
      appFor(
        { list, __queryPage },
        {
          graphAndCount: async () => {
            throw new Error('invalid filter')
          },
        },
      ),
      ['fact'],
      [],
    )
    expect(await tools.query_entity.execute({ entity: 'fact' })).toEqual({ error: 'invalid filter' })
    expect(list).not.toHaveBeenCalled()
    expect(__queryPage).not.toHaveBeenCalled()
  })

  it('samples at most one row when schema metadata is absent', async () => {
    const list = vi.fn(async () => {
      throw new Error('unbounded read')
    })
    const __queryPage = vi.fn(async () => [[{ id: 'one' }], 100000])
    const tools = await boundedTools(appFor({ list, __queryPage }), ['fact'], [])
    expect(await tools.describe_entity.execute({ entity: 'fact' })).toMatchObject({
      fields: [{ name: 'id', type: 'text' }],
    })
    expect(__queryPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }))
    expect(list).not.toHaveBeenCalled()
  })
})
