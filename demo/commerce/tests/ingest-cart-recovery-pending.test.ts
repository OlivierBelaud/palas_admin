import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// Execute the real command workflow with a cart repository and controlled
// follow-up failures: swallowing these errors must not create a done receipt.
type Command = { workflow: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> }
let command: Command
beforeAll(async () => {
  vi.stubGlobal('z', z)
  vi.stubGlobal('defineCommand', (value: Command) => value)
  command = (await import('../src/commands/admin/ingest-cart-event')).default as unknown as Command
})
afterAll(() => vi.unstubAllGlobals())

describe('ingest cart recovery result', () => {
  it.each(['contact', 'attribution', 'none'])('keeps failures recoverable: %s', async (failure) => {
    const cart = {
      id: 'cart-1',
      highest_stage: 'completed',
      status: 'completed',
      email: 'fixture@example.test',
      cart_birth_at: '2026-09-21T00:00:00Z',
    }
    const emit = vi.fn(async (_name: string, _payload: unknown) => undefined)
    const result = await command.workflow(
      {
        cart_token: 'token',
        action: 'checkout:completed',
        occurred_at: '2026-09-21T12:00:00Z',
        email: 'fixture@example.test',
        items: [],
        total_price: 10,
        currency: 'EUR',
      },
      {
        step: {
          action: (_name: string, _definition: unknown) => async () => cart,
          service: { cart: { list: async () => [cart], update: async () => cart } },
          command: {
            upsertContactFromCartSignal: async () => {
              if (failure === 'contact') throw new Error('temporary')
            },
            attributeSessionConversion: async () => {
              if (failure === 'attribution') throw new Error('temporary')
            },
          },
          emit,
        },
      },
    )
    expect(result).toEqual({ cart_id: 'cart-1', ...(failure !== 'none' ? { recovery_pending: true } : {}) })
    expect(emit.mock.calls.some((call) => call[0] === 'cart.refresh-requested')).toBe(true)
  })
})
