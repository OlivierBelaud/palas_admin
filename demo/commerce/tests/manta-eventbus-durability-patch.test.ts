import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const cliRequire = createRequire(require.resolve('@mantajs/cli/package.json'))
const adapterModule = import(pathToFileURL(cliRequire.resolve('@mantajs/adapter-eventbus-upstash')).href)
const publishJSON = vi.fn()

function message(eventName: string) {
  return { eventName, data: {}, metadata: { timestamp: Date.now() } }
}

describe('temporary Manta event-bus durability compatibility patch', () => {
  beforeEach(() => {
    publishJSON.mockReset()
  })

  it('does not resolve emit before QStash acknowledges the publication', async () => {
    let acknowledge: (() => void) | undefined
    publishJSON.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = () => resolve({ messageId: 'msg-1' })
        }),
    )
    const { UpstashEventBusAdapter } = await adapterModule
    const bus = new UpstashEventBusAdapter({
      qstashToken: 'test-token',
      callbackUrl: 'https://admin.test/api/events/qstash',
    })
    ;(bus as unknown as { _qstash: { publishJSON: typeof publishJSON } })._qstash = { publishJSON }
    let settled = false
    const emission = bus.emit(message('contact.refresh-requested')).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(publishJSON).toHaveBeenCalledOnce())
    expect(settled).toBe(false)

    acknowledge?.()
    await expect(emission).resolves.toBeUndefined()
  })

  it('propagates a rejected QStash publication to the caller', async () => {
    publishJSON.mockRejectedValueOnce(new Error('qstash unavailable'))
    const { UpstashEventBusAdapter } = await adapterModule
    const bus = new UpstashEventBusAdapter({
      qstashToken: 'test-token',
      callbackUrl: 'https://admin.test/api/events/qstash',
    })
    ;(bus as unknown as { _qstash: { publishJSON: typeof publishJSON } })._qstash = { publishJSON }

    await expect(bus.emit(message('cart.refresh-requested'))).rejects.toThrow('qstash unavailable')
  })
})
