import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { flush } = vi.hoisted(() => ({ flush: vi.fn(async () => ({})) }))
vi.mock('../src/modules/event-hub/dispatch-runner', () => ({ flushDispatchLogByEventDestinationKey: flush }))
// Exercise real normalizer and connector mappings, replacing only framework execution/transport boundary.
describe('canonical delivery provisioning', () => {
  let command: { workflow: (input: unknown, context: unknown) => Promise<unknown> }
  beforeAll(async () => {
    vi.stubGlobal('defineCommand', (value: unknown) => value)
    vi.stubGlobal('z', z)
    command = (await import('../src/commands/admin/record-canonical-event-log')).default as unknown as typeof command
  })
  afterAll(() => vi.unstubAllGlobals())
  it('repairs partial destination writes on duplicate without replacing a sent receipt', async () => {
    const events = new Map<string, unknown>()
    const rows = new Map<string, Record<string, unknown>>()
    let failMeta = true
    const raw = vi.fn(async (_sql: string, _params?: unknown[]) => [])
    const context = {
      step: {
        service: {
          contact: { list: async () => [] },
          eventLog: {
            create: async (row: Record<string, unknown>) => {
              if (events.has(String(row.event_id))) throw new Error('duplicate key')
              events.set(String(row.event_id), row)
            },
          },
          dispatchLog: {
            create: async (row: Record<string, unknown>) => {
              if (row.destination === 'meta_capi' && failMeta) throw new Error('database temporarily unavailable')
              const key = String(row.event_destination_key)
              if (rows.has(key)) throw new Error('duplicate key')
              rows.set(key, row)
            },
          },
        },
        action:
          (_name: string, action: { invoke: (input: unknown, context: unknown) => unknown }) => (input: unknown) =>
            action.invoke(input, { app: { resolve: () => ({ raw }) } }),
      },
    }
    const input = {
      event: {
        uuid: 'evt_purchase',
        event: 'checkout:completed',
        distinct_id: 'visitor1',
        timestamp: '2026-09-22T10:00:00Z',
        properties: {
          $current_url: 'https://fancypalas.com/checkout',
          checkout: {
            shopify_order_id: '1234',
            currency: 'EUR',
            total_price: 20,
            items: [{ variant_id: 'v1', price: 20, quantity: 1 }],
          },
        },
      },
    }
    flush.mockClear()
    await expect(command.workflow(input, context)).rejects.toThrow('database temporarily unavailable')
    expect(flush).not.toHaveBeenCalled()
    const ga4 = rows.get('evt_purchase:ga4')!
    ga4.status = 'sent'
    ga4.request_payload = null // compacted receipt must not be rehydrated
    failMeta = false
    await command.workflow(input, context)
    expect(rows.size).toBe(3)
    expect(rows.get('evt_purchase:ga4')).toBe(ga4)
    expect(ga4).toMatchObject({ status: 'sent', request_payload: null })
    expect(flush.mock.calls).toHaveLength(3)
    expect(raw.mock.calls.some((call) => String(call[0]).includes('dispatch_prepared_at'))).toBe(true)
    expect(events.size).toBe(1)
  })
})
