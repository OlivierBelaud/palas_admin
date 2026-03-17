// SPEC-034 — InMemoryEventBusAdapter implements IEventBusPort

import type { IEventBusPort, Message, GroupStatus } from '../ports'
import { MantaError } from '../errors/manta-error'

export class InMemoryEventBusAdapter implements IEventBusPort {
  private _subscribers = new Map<string, Array<{ id: string; handler: (event: Message) => Promise<void> | void }>>()
  private _interceptors: Array<(msg: Message, ctx?: unknown) => void> = []
  private _groups = new Map<string, Message[]>()
  private _maxActiveGroups = 10000
  private _groupTtls = new Map<string, ReturnType<typeof setTimeout>>()

  // Hooks
  private _onGroupCreated?: (id: string, count: number) => void
  private _onGroupReleased?: (id: string, count: number) => void
  private _onGroupCleared?: (id: string, count: number, reason: 'explicit' | 'ttl') => void

  async emit(event: Message | Message[], options?: { groupId?: string }): Promise<void> {
    const events = Array.isArray(event) ? event : [event]

    // E-14 — SPEC-034: Validate serializable payload
    for (const msg of events) {
      try {
        JSON.stringify(msg)
      } catch {
        throw new MantaError('INVALID_DATA', 'Event payload is not serializable (circular references or non-serializable values detected)')
      }
    }

    const groupId = options?.groupId

    if (groupId) {
      // Check max active groups (E-13)
      if (!this._groups.has(groupId) && this._groups.size >= this._maxActiveGroups) {
        throw new MantaError('RESOURCE_EXHAUSTED', `Too many active event groups (${this._maxActiveGroups}). Possible leak — check that releaseGroupedEvents/clearGroupedEvents are called.`)
      }

      if (!this._groups.has(groupId)) {
        this._groups.set(groupId, [])
        this._onGroupCreated?.(groupId, 0)

        // TTL (default 600s) — works with fake timers
        const timer = setTimeout(() => {
          const msgs = this._groups.get(groupId)
          if (msgs) {
            this._onGroupCleared?.(groupId, msgs.length, 'ttl')
            this._groups.delete(groupId)
            this._groupTtls.delete(groupId)
          }
        }, 600_000)
        this._groupTtls.set(groupId, timer)
      }

      this._groups.get(groupId)!.push(...events)
      return // Grouped events are NOT delivered immediately
    }

    // Non-grouped: deliver immediately
    for (const msg of events) {
      // Interceptors (fire-and-forget, read-only)
      for (const interceptor of this._interceptors) {
        try { interceptor(msg) } catch { /* ignored */ }
      }

      // Deliver to subscribers — fire-and-forget (async, not awaited)
      // Same pattern as Medusa: "Subscribers listening to the event(s) are executed asynchronously."
      const handlers = this._subscribers.get(msg.eventName) ?? []
      Promise.all(handlers.map((s) => {
        try { return Promise.resolve(s.handler(msg)) } catch { return Promise.resolve() }
      })).catch(() => {})
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
      this._subscribers.set(eventName, subs.filter((s) => s.id !== subscriberId))
    }
  }

  async releaseGroupedEvents(eventGroupId: string): Promise<void> {
    const events = this._groups.get(eventGroupId)
    if (!events) return

    // Clear TTL timer
    const timer = this._groupTtls.get(eventGroupId)
    if (timer) clearTimeout(timer)
    this._groupTtls.delete(eventGroupId)

    this._groups.delete(eventGroupId)
    this._onGroupReleased?.(eventGroupId, events.length)

    // Deliver all events in FIFO order
    for (const msg of events) {
      for (const interceptor of this._interceptors) {
        try { interceptor(msg, { isGrouped: true, eventGroupId }) } catch { /* ignored */ }
      }

      const handlers = this._subscribers.get(msg.eventName) ?? []
      await Promise.all(handlers.map((s) => {
        try { return Promise.resolve(s.handler(msg)) } catch { return Promise.resolve() }
      }))
    }
  }

  async clearGroupedEvents(eventGroupId: string): Promise<void> {
    const events = this._groups.get(eventGroupId)
    const count = events?.length ?? 0

    const timer = this._groupTtls.get(eventGroupId)
    if (timer) clearTimeout(timer)
    this._groupTtls.delete(eventGroupId)

    this._groups.delete(eventGroupId)
    this._onGroupCleared?.(eventGroupId, count, 'explicit')
  }

  addInterceptor(fn: (message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => void): void {
    this._interceptors.push(fn as (msg: Message, ctx?: unknown) => void)
  }

  removeInterceptor(fn: Function): void {
    this._interceptors = this._interceptors.filter((i) => i !== fn)
  }

  onGroupCreated(handler: (id: string, count: number) => void) { this._onGroupCreated = handler }
  onGroupReleased(handler: (id: string, count: number) => void) { this._onGroupReleased = handler }
  onGroupCleared(handler: (id: string, count: number, reason: 'explicit' | 'ttl') => void) { this._onGroupCleared = handler }

  getGroupStatus(eventGroupId: string): GroupStatus | null {
    const events = this._groups.get(eventGroupId)
    if (!events) return null
    return { exists: true, eventCount: events.length, createdAt: Date.now() }
  }

  /** Configure maxActiveGroups for testing E-13 */
  _setMaxActiveGroups(max: number) { this._maxActiveGroups = max }
  _reset() {
    this._subscribers.clear()
    this._interceptors = []
    for (const timer of this._groupTtls.values()) clearTimeout(timer)
    this._groups.clear()
    this._groupTtls.clear()
  }
}
