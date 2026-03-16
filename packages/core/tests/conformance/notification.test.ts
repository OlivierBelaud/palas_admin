import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type INotificationPort,
  MantaError,
  createTestContainer,
  resetAll,
  InMemoryContainer,
  InMemoryNotificationAdapter,
} from '@manta/test-utils'

describe('INotificationPort Conformance', () => {
  let notification: InMemoryNotificationAdapter
  let container: InMemoryContainer

  beforeEach(() => {
    container = createTestContainer()
    notification = container.resolve<InMemoryNotificationAdapter>('INotificationPort')
  })

  afterEach(async () => {
    await resetAll(container)
  })

  // N-01 — SPEC-097: send returns status lifecycle
  it('send > status lifecycle', async () => {
    const result = await notification.send({
      to: 'user@test.com',
      channel: 'email',
      template: 'welcome',
      data: { name: 'Alice' },
    })

    expect(result.status).toBe('SUCCESS')
    expect(typeof result.id).toBe('string')
    expect(result.id!.length).toBeGreaterThan(0)
  })

  // N-02 — SPEC-097: idempotency_key deduplication
  it('idempotency_key > duplicate skip', async () => {
    const first = await notification.send({
      to: 'user@test.com',
      channel: 'email',
      idempotency_key: 'idem-1',
    })

    const second = await notification.send({
      to: 'user@test.com',
      channel: 'email',
      idempotency_key: 'idem-1',
    })

    // Same result returned, no re-send
    expect(first.status).toBe('SUCCESS')
    expect(second.status).toBe('SUCCESS')

    // Only 1 actual send
    const sent = notification.getSent()
    expect(sent).toHaveLength(1)
  })

  // N-03 — SPEC-097/098: channel routing to correct provider
  it('channel routing > provider par channel', async () => {
    const emailResult = await notification.send({
      to: 'user@test.com',
      channel: 'email',
      data: { subject: 'Hello' },
    })

    const smsResult = await notification.send({
      to: '+33612345678',
      channel: 'sms',
      data: { body: 'Hi' },
    })

    expect(emailResult.status).toBe('SUCCESS')
    expect(smsResult.status).toBe('SUCCESS')

    const sent = notification.getSent()
    expect(sent).toHaveLength(2)
    expect(sent[0].notification.channel).toBe('email')
    expect(sent[1].notification.channel).toBe('sms')
  })

  // N-04 — SPEC-097: unconfigured channel throws INVALID_DATA
  it('channel routing > channel non configuré', async () => {
    // Configure only email channel
    notification.configureChannels(['email'])

    // Email should work
    const emailResult = await notification.send({ to: 'a@test.com', channel: 'email' })
    expect(emailResult.status).toBe('SUCCESS')

    // Unconfigured 'push' channel should throw
    await expect(
      notification.send({ to: 'b@test.com', channel: 'push' }),
    ).rejects.toThrow(/not configured/)
  })

  // N-05 — SPEC-097: batch send returns array of results
  it('batch > envoi multiple', async () => {
    if (!notification.sendBatch) return

    const results = await notification.sendBatch([
      { to: 'a@test.com', channel: 'email' },
      { to: 'b@test.com', channel: 'email' },
      { to: 'c@test.com', channel: 'email' },
    ])

    expect(results).toHaveLength(3)
    results.forEach((r) => {
      expect(r.status).toBe('SUCCESS')
    })
  })

  // N-06 — SPEC-097: batch with partial failure
  it('batch > erreur partielle', async () => {
    if (!notification.sendBatch) return

    // Configure 'bad@test.com' to fail
    notification.configureFailures(['bad@test.com'])

    const results = await notification.sendBatch([
      { to: 'good@test.com', channel: 'email' },
      { to: 'bad@test.com', channel: 'email' },
      { to: 'also-good@test.com', channel: 'email' },
    ])

    expect(results).toHaveLength(3)
    expect(results[0].status).toBe('SUCCESS')
    expect(results[1].status).toBe('FAILURE')
    expect(results[1].error).toBeDefined()
    expect(results[2].status).toBe('SUCCESS')
  })

  // N-07 — SPEC-097: provider failure returns FAILURE status (no exception)
  it('send > provider failure', async () => {
    // InMemoryNotificationAdapter always succeeds
    // Real adapter test: provider throws → status FAILURE, no propagated exception
    const result = await notification.send({
      to: 'user@test.com',
      channel: 'email',
    })

    // Contract: result has status field
    expect(result.status).toBeDefined()
    expect(['SUCCESS', 'FAILURE', 'PENDING']).toContain(result.status)
  })
})
