// SPEC-034 — UpstashEventBusAdapter implements IEventBusPort
// Hybrid architecture: local subscriber registry + QStash for durability + Redis for grouped events.
// If QStash is not configured, behaves exactly like InMemoryEventBusAdapter (graceful degradation).

import type { GroupStatus, IEventBusPort, Message } from '@manta/core'
import { MantaError } from '@manta/core'
import { Client as QStashClient } from '@upstash/qstash'
import { Redis } from '@upstash/redis'

export interface UpstashEventBusOptions {
  qstashToken?: string
  qstashUrl?: string
  callbackUrl?: string
  redisUrl?: string
  redisToken?: string
}

const GROUP_KEY_PREFIX = 'manta:eventgroup:'
const GROUP_TTL_SECONDS = 600

export class UpstashEventBusAdapter implements IEventBusPort {
  private _subscribers = new Map<string, Array<{ id: string; handler: (event: Message) => Promise<void> | void }>>()
  private _interceptors: Array<(msg: Message, ctx?: unknown) => void> = []
  private _qstash: QStashClient | null = null
  private _redis: Redis | null = null
  private _callbackUrl: string | null = null
  private _maxActiveGroups = 10000

  // In-memory fallback for grouped events when Redis is not configured
  private _localGroups = new Map<string, Message[]>()
  private _localGroupTtls = new Map<string, ReturnType<typeof setTimeout>>()

  // Hooks
  private _onGroupCreated?: (id: string, count: number) => void
  private _onGroupReleased?: (id: string, count: number) => void
  private _onGroupCleared?: (id: string, count: number, reason: 'explicit' | 'ttl') => void

  constructor(options: UpstashEventBusOptions = {}) {
    const qstashToken = options.qstashToken ?? process.env.QSTASH_TOKEN
    const callbackUrl = options.callbackUrl ?? process.env.QSTASH_CALLBACK_URL
    const redisUrl = options.redisUrl ?? process.env.UPSTASH_REDIS_REST_URL
    const redisToken = options.redisToken ?? process.env.UPSTASH_REDIS_REST_TOKEN

    // QStash (optional — graceful degradation)
    if (qstashToken) {
      this._qstash = new QStashClient({ token: qstashToken })
      this._callbackUrl = callbackUrl ?? null
    }

    // Redis (optional — falls back to in-memory grouped events)
    if (redisUrl && redisToken) {
      this._redis = new Redis({ url: redisUrl, token: redisToken })
    }
  }

  async emit(event: Message | Message[], options?: { groupId?: string }): Promise<void> {
    const events = Array.isArray(event) ? event : [event]

    // E-14 — validate serializable payload
    for (const msg of events) {
      try {
        JSON.stringify(msg)
      } catch {
        throw new MantaError(
          'INVALID_DATA',
          'Event payload is not serializable (circular references or non-serializable values detected)',
        )
      }
    }

    const groupId = options?.groupId

    if (groupId) {
      await this._emitGrouped(events, groupId)
      return
    }

    // Non-grouped: deliver locally + publish to QStash
    for (const msg of events) {
      this._runInterceptors(msg)
      this._deliverLocally(msg)

      // Publish to QStash for durable delivery (fire-and-forget)
      if (this._qstash && this._callbackUrl) {
        this._publishToQStash(msg).catch((err) => {
          console.warn(`[EventBus] QStash publish failed for ${msg.eventName}: ${err?.message ?? err}`)
        })
      }
    }
  }

  subscribe(
    eventName: string,
    handler: (event: Message) => Promise<void> | void,
    options?: { subscriberId?: string },
  ): void {
    const id = options?.subscriberId ?? crypto.randomUUID()

    if (!this._subscribers.has(eventName)) this._subscribers.set(eventName, [])
    const subs = this._subscribers.get(eventName)!

    // Deduplicate by subscriberId (E-07)
    if (subs.some((s) => s.id === id)) return

    subs.push({ id, handler })
  }

  unsubscribe(subscriberId: string): void {
    for (const [eventName, subs] of this._subscribers) {
      this._subscribers.set(
        eventName,
        subs.filter((s) => s.id !== subscriberId),
      )
    }
  }

  async releaseGroupedEvents(eventGroupId: string): Promise<void> {
    if (this._redis) {
      await this._releaseRedisGroup(eventGroupId)
    } else {
      await this._releaseLocalGroup(eventGroupId)
    }
  }

  async clearGroupedEvents(eventGroupId: string): Promise<void> {
    if (this._redis) {
      await this._clearRedisGroup(eventGroupId)
    } else {
      await this._clearLocalGroup(eventGroupId)
    }
  }

  addInterceptor(
    fn: (message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => Promise<void> | void,
  ): void {
    this._interceptors.push(fn as (msg: Message, ctx?: unknown) => void)
  }

  removeInterceptor(
    fn: (message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => Promise<void> | void,
  ): void {
    this._interceptors = this._interceptors.filter((i) => i !== fn)
  }

  onGroupCreated(handler: (id: string, count: number) => void) {
    this._onGroupCreated = handler
  }

  onGroupReleased(handler: (id: string, count: number) => void) {
    this._onGroupReleased = handler
  }

  onGroupCleared(handler: (id: string, count: number, reason: 'explicit' | 'ttl') => void) {
    this._onGroupCleared = handler
  }

  getGroupStatus(eventGroupId: string): GroupStatus | null {
    // Synchronous — only works for local groups. Redis requires async.
    const events = this._localGroups.get(eventGroupId)
    if (!events) return null
    return { exists: true, eventCount: events.length, createdAt: Date.now() }
  }

  /**
   * Handle incoming QStash webhook. Called by the HTTP route handler.
   * Verifies signature and dispatches to local subscribers.
   */
  async handleWebhook(message: Message): Promise<void> {
    this._runInterceptors(message)
    await this._deliverLocallyAsync(message)
  }

  // --- Private: QStash ---

  private async _publishToQStash(msg: Message): Promise<void> {
    if (!this._qstash || !this._callbackUrl) return

    await this._qstash.publishJSON({
      url: this._callbackUrl,
      body: msg,
    })
  }

  // --- Private: Grouped events (Redis path) ---

  private async _emitGrouped(events: Message[], groupId: string): Promise<void> {
    if (this._redis) {
      await this._emitGroupedRedis(events, groupId)
    } else {
      this._emitGroupedLocal(events, groupId)
    }
  }

  private async _emitGroupedRedis(events: Message[], groupId: string): Promise<void> {
    const key = GROUP_KEY_PREFIX + groupId

    // Check if this is a new group
    const exists = await this._redis!.exists(key)
    if (!exists) {
      this._onGroupCreated?.(groupId, 0)
    }

    // RPUSH all events as JSON strings
    const serialized = events.map((e) => JSON.stringify(e))
    await this._redis!.rpush(key, ...serialized)

    // Set TTL on first event (EXPIRE only if not already set)
    if (!exists) {
      await this._redis!.expire(key, GROUP_TTL_SECONDS)
    }
  }

  private async _releaseRedisGroup(eventGroupId: string): Promise<void> {
    const key = GROUP_KEY_PREFIX + eventGroupId

    // LRANGE + DEL atomically
    const raw = await this._redis!.lrange(key, 0, -1)
    await this._redis!.del(key)

    if (!raw || raw.length === 0) return

    const events: Message[] = raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r) as Message)
    this._onGroupReleased?.(eventGroupId, events.length)

    // Deliver all events in FIFO order
    for (const msg of events) {
      this._runInterceptors(msg, { isGrouped: true, eventGroupId })
      await this._deliverLocallyAsync(msg)

      // Also publish to QStash
      if (this._qstash && this._callbackUrl) {
        this._publishToQStash(msg).catch((err) => {
          console.warn(`[EventBus] QStash publish failed for ${msg.eventName}: ${err?.message ?? err}`)
        })
      }
    }
  }

  private async _clearRedisGroup(eventGroupId: string): Promise<void> {
    const key = GROUP_KEY_PREFIX + eventGroupId
    const length = await this._redis!.llen(key)
    await this._redis!.del(key)
    this._onGroupCleared?.(eventGroupId, length, 'explicit')
  }

  // --- Private: Grouped events (Local fallback) ---

  private _emitGroupedLocal(events: Message[], groupId: string): void {
    // Check max active groups (E-13)
    if (!this._localGroups.has(groupId) && this._localGroups.size >= this._maxActiveGroups) {
      throw new MantaError(
        'RESOURCE_EXHAUSTED',
        `Too many active event groups (${this._maxActiveGroups}). Possible leak — check that releaseGroupedEvents/clearGroupedEvents are called.`,
      )
    }

    if (!this._localGroups.has(groupId)) {
      this._localGroups.set(groupId, [])
      this._onGroupCreated?.(groupId, 0)

      // TTL (default 600s)
      const timer = setTimeout(() => {
        const msgs = this._localGroups.get(groupId)
        if (msgs) {
          this._onGroupCleared?.(groupId, msgs.length, 'ttl')
          this._localGroups.delete(groupId)
          this._localGroupTtls.delete(groupId)
        }
      }, GROUP_TTL_SECONDS * 1000)
      this._localGroupTtls.set(groupId, timer)
    }

    this._localGroups.get(groupId)!.push(...events)
  }

  private async _releaseLocalGroup(eventGroupId: string): Promise<void> {
    const events = this._localGroups.get(eventGroupId)
    if (!events) return

    // Clear TTL timer
    const timer = this._localGroupTtls.get(eventGroupId)
    if (timer) clearTimeout(timer)
    this._localGroupTtls.delete(eventGroupId)

    this._localGroups.delete(eventGroupId)
    this._onGroupReleased?.(eventGroupId, events.length)

    // Deliver all events in FIFO order
    for (const msg of events) {
      this._runInterceptors(msg, { isGrouped: true, eventGroupId })
      await this._deliverLocallyAsync(msg)
    }
  }

  private async _clearLocalGroup(eventGroupId: string): Promise<void> {
    const events = this._localGroups.get(eventGroupId)
    const count = events?.length ?? 0

    const timer = this._localGroupTtls.get(eventGroupId)
    if (timer) clearTimeout(timer)
    this._localGroupTtls.delete(eventGroupId)

    this._localGroups.delete(eventGroupId)
    this._onGroupCleared?.(eventGroupId, count, 'explicit')
  }

  // --- Private: Delivery ---

  private _runInterceptors(msg: Message, ctx?: { isGrouped?: boolean; eventGroupId?: string }): void {
    for (const interceptor of this._interceptors) {
      try {
        interceptor(msg, ctx)
      } catch {
        /* ignored — interceptors are fire-and-forget */
      }
    }
  }

  private _deliverLocally(msg: Message): void {
    const handlers = this._subscribers.get(msg.eventName) ?? []
    Promise.all(
      handlers.map((s) => {
        try {
          return Promise.resolve(s.handler(msg)).catch(() => {})
        } catch {
          return Promise.resolve()
        }
      }),
    )
  }

  private async _deliverLocallyAsync(msg: Message): Promise<void> {
    const handlers = this._subscribers.get(msg.eventName) ?? []
    await Promise.all(
      handlers.map((s) => {
        try {
          return Promise.resolve(s.handler(msg))
        } catch {
          return Promise.resolve()
        }
      }),
    )
  }

  /** Configure maxActiveGroups for testing E-13 */
  _setMaxActiveGroups(max: number) {
    this._maxActiveGroups = max
  }

  _reset() {
    this._subscribers.clear()
    this._interceptors = []
    for (const timer of this._localGroupTtls.values()) clearTimeout(timer)
    this._localGroups.clear()
    this._localGroupTtls.clear()
  }
}
