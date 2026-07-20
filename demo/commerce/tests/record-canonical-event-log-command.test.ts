import { beforeAll, describe, expect, it, vi } from 'vitest'

type CommandDefinition = {
  workflow(
    input: Record<string, unknown>,
    context: { step: Record<string, unknown> },
  ): Promise<Record<string, unknown>>
}

let command: CommandDefinition

beforeAll(async () => {
  type SchemaChain = {
    optional(): SchemaChain
    nullable(): SchemaChain
    int(): SchemaChain
  }
  const chain: SchemaChain = {
    optional: () => chain,
    nullable: () => chain,
    int: () => chain,
  }
  vi.stubGlobal('defineCommand', (definition: CommandDefinition) => definition)
  vi.stubGlobal('z', {
    object: () => chain,
    record: () => chain,
    unknown: () => chain,
    boolean: () => chain,
    number: () => chain,
  })
  command = (await import('../src/commands/admin/record-canonical-event-log')).default as unknown as CommandDefinition
})

describe('recordCanonicalEventLog command recovery', () => {
  it('recreates missing destination rows when the canonical event already exists', async () => {
    const dispatchCreate = vi.fn(async () => ({}))
    const step = {
      service: {
        contact: { list: vi.fn(async () => []) },
        eventLog: {
          create: vi.fn(async () => {
            throw new Error('duplicate key value violates unique constraint "event_logs_event_id_unique"')
          }),
        },
        dispatchLog: { create: dispatchCreate },
      },
    }

    const result = await command.workflow(
      {
        event: {
          uuid: 'evt_resume',
          event: 'checkout:contact_info_submitted',
          distinct_id: 'visitor_1',
          timestamp: '2026-07-20T10:00:00.000Z',
          properties: {
            $current_url: 'https://fancypalas.com/checkouts/1',
            email: 'buyer@example.com',
            palas_consent_ads: true,
          },
        },
        posthog_forwarded: true,
        posthog_status: 200,
        source_context: {
          client_ip: '203.0.113.10',
          user_agent: 'Vitest',
          gclid: 'gclid_1',
        },
      },
      { step },
    )

    expect(result).toMatchObject({ ok: true, duplicate: true, event_id: 'evt_resume' })
    expect(dispatchCreate).toHaveBeenCalledTimes(2)
    expect(dispatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event_destination_key: 'evt_resume:google_ads',
        destination: 'google_ads',
      }),
    )
    expect(dispatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event_destination_key: 'evt_resume:meta_capi',
        destination: 'meta_capi',
      }),
    )
  })

  it('does not classify arbitrary event_id database failures as duplicate delivery', async () => {
    const step = {
      service: {
        contact: { list: vi.fn(async () => []) },
        eventLog: {
          create: vi.fn(async () => {
            throw new Error('event_id column is unavailable')
          }),
        },
        dispatchLog: { create: vi.fn() },
      },
    }

    await expect(
      command.workflow(
        {
          event: {
            uuid: 'evt_failure',
            event: 'cart:closed',
            distinct_id: 'visitor_1',
            timestamp: '2026-07-20T10:00:00.000Z',
            properties: {},
          },
        },
        { step },
      ),
    ).rejects.toThrow('event_id column is unavailable')
  })
})
