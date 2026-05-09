// Unit tests for ResendNotificationAdapter — mocks the Resend SDK so we can
// assert the payload mapping without hitting the network.

import { MantaError } from '@manta/core'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const sendMock = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}))

import { ResendNotificationAdapter } from './adapter'

describe('ResendNotificationAdapter', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  afterEach(() => {
    delete process.env.RESEND_API_KEY
  })

  it('throws if no API key is provided and env is empty', () => {
    expect(() => new ResendNotificationAdapter({})).toThrow(MantaError)
  })

  it('uses RESEND_API_KEY env when apiKey option is omitted', () => {
    process.env.RESEND_API_KEY = 'env-key'
    expect(() => new ResendNotificationAdapter({})).not.toThrow()
  })

  it('throws INVALID_DATA when channel is not email', async () => {
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })
    await expect(a.send({ to: 'b@x.com', channel: 'sms', text: 'hi' })).rejects.toThrow(MantaError)
  })

  it('throws INVALID_DATA when subject is missing', async () => {
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })
    await expect(a.send({ to: 'b@x.com', channel: 'email', html: '<p>hi</p>' })).rejects.toThrow(/subject/i)
  })

  it('throws INVALID_DATA when both html and text are missing', async () => {
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })
    await expect(a.send({ to: 'b@x.com', channel: 'email', subject: 'Hi' })).rejects.toThrow(/html or text/i)
  })

  it('throws INVALID_DATA when neither from nor defaultFrom is set', async () => {
    const a = new ResendNotificationAdapter({ apiKey: 'k' })
    await expect(a.send({ to: 'b@x.com', channel: 'email', subject: 'Hi', text: 'Hi' })).rejects.toThrow(/from/i)
  })

  it('uses defaultFrom when payload omits from', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_1' }, error: null, headers: {} })
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'PALAS <hello@palas.com>' })

    await a.send({ to: 'user@x.com', channel: 'email', subject: 'Hi', html: '<p>x</p>' })

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect((sendMock as Mock).mock.calls[0][0]).toMatchObject({ from: 'PALAS <hello@palas.com>' })
  })

  it('per-call from overrides defaultFrom', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_2' }, error: null, headers: {} })
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })

    await a.send({
      to: 'user@x.com',
      channel: 'email',
      from: 'override@x.com',
      subject: 'Hi',
      text: 'hi',
    })

    expect((sendMock as Mock).mock.calls[0][0]).toMatchObject({ from: 'override@x.com' })
  })

  it('forwards idempotency_key as Idempotency-Key header', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_3' }, error: null, headers: {} })
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })

    await a.send({
      to: 'user@x.com',
      channel: 'email',
      subject: 'Hi',
      text: 'hi',
      idempotency_key: 'cart:123:1',
    })

    expect((sendMock as Mock).mock.calls[0][0].headers).toMatchObject({ 'Idempotency-Key': 'cart:123:1' })
  })

  it('preserves caller headers and adds Idempotency-Key', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_4' }, error: null, headers: {} })
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })

    await a.send({
      to: 'user@x.com',
      channel: 'email',
      subject: 'Hi',
      text: 'hi',
      headers: { 'List-Unsubscribe': '<https://x.com/u>' },
      idempotency_key: 'k-1',
    })

    expect((sendMock as Mock).mock.calls[0][0].headers).toEqual({
      'List-Unsubscribe': '<https://x.com/u>',
      'Idempotency-Key': 'k-1',
    })
  })

  it('passes tags through to the SDK', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_5' }, error: null, headers: {} })
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })

    const tags = [
      { name: 'category', value: 'abandoned-cart' },
      { name: 'cart_id', value: 'c-1' },
    ]
    await a.send({
      to: 'user@x.com',
      channel: 'email',
      subject: 'Hi',
      text: 'hi',
      tags,
    })

    expect((sendMock as Mock).mock.calls[0][0].tags).toEqual(tags)
  })

  it('returns SUCCESS with id when Resend succeeds', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_ok' }, error: null, headers: {} })
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })

    const out = await a.send({
      to: 'user@x.com',
      channel: 'email',
      subject: 'Hi',
      html: '<p>hi</p>',
    })

    expect(out).toEqual({ status: 'SUCCESS', id: 'msg_ok' })
  })

  it('returns FAILURE on Resend error response (4xx)', async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: 'invalid_from_address', message: 'Bad from', statusCode: 422 },
      headers: {},
    })
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'bad@nowhere' })

    const out = await a.send({
      to: 'user@x.com',
      channel: 'email',
      subject: 'Hi',
      text: 'hi',
    })

    expect(out.status).toBe('FAILURE')
    expect(out.error).toBeDefined()
    expect(out.error?.message).toMatch(/invalid_from_address|Bad from/)
  })

  it('throws when SDK throws (network/5xx surface as transport error)', async () => {
    sendMock.mockRejectedValueOnce(new Error('fetch failed'))
    const a = new ResendNotificationAdapter({ apiKey: 'k', defaultFrom: 'a@x.com' })

    await expect(a.send({ to: 'user@x.com', channel: 'email', subject: 'Hi', text: 'hi' })).rejects.toThrow(
      /transport error|fetch failed/i,
    )
  })

  it('uses defaultReplyTo when payload omits replyTo', async () => {
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_r' }, error: null, headers: {} })
    const a = new ResendNotificationAdapter({
      apiKey: 'k',
      defaultFrom: 'a@x.com',
      defaultReplyTo: 'reply@x.com',
    })

    await a.send({ to: 'user@x.com', channel: 'email', subject: 'Hi', text: 'hi' })

    expect((sendMock as Mock).mock.calls[0][0]).toMatchObject({ replyTo: 'reply@x.com' })
  })
})
