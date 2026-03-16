// NeonEventBusAdapter — persistent events with retry
import type { IEventBusPort } from "@manta/core/ports"
import type { Message } from "@manta/core"
import type { GroupStatus } from "@manta/core/ports"
import type postgres from "postgres"

export class NeonEventBusAdapter implements IEventBusPort {
  private handlers = new Map<string, Array<(event: Message) => Promise<void> | void>>()
  private interceptors: Array<(message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => Promise<void> | void> = []
  private groupedEvents = new Map<string, Message[]>()

  constructor(private sql: postgres.Sql) {}

  async emit(event: Message | Message[], options?: { groupId?: string }): Promise<void> {
    const events = Array.isArray(event) ? event : [event]

    for (const msg of events) {
      // If grouped, buffer instead of dispatching
      if (options?.groupId) {
        const group = this.groupedEvents.get(options.groupId) || []
        group.push(msg)
        this.groupedEvents.set(options.groupId, group)
        continue
      }

      // Persist event to DB
      await this.sql`
        INSERT INTO events (event_name, data, metadata, status)
        VALUES (${msg.eventName}, ${JSON.stringify(msg.data)}::jsonb, ${JSON.stringify(msg.metadata || {})}::jsonb, 'pending')
      `

      // Fire interceptors (fire-and-forget)
      for (const fn of this.interceptors) {
        try { await fn(msg) } catch {}
      }

      // Dispatch to in-memory handlers (for same-invocation subscribers)
      await this.dispatch(msg)
    }
  }

  private async dispatch(msg: Message): Promise<void> {
    const handlers = this.handlers.get(msg.eventName) || []
    for (const handler of handlers) {
      try {
        await handler(msg)
        // Mark as processed in DB
        await this.sql`
          UPDATE events SET status = 'processed', processed_at = NOW(), attempts = attempts + 1
          WHERE id = (
            SELECT id FROM events
            WHERE event_name = ${msg.eventName} AND status = 'pending'
            AND data::text = ${JSON.stringify(msg.data)}
            LIMIT 1
          )
        `
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`[NeonEventBus] Subscriber failed for ${msg.eventName}: ${errorMsg}`)
        // Mark attempt failed, will be retried
        await this.sql`
          UPDATE events SET attempts = attempts + 1, last_error = ${errorMsg},
          status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead_letter' ELSE 'pending' END
          WHERE id = (
            SELECT id FROM events
            WHERE event_name = ${msg.eventName} AND status = 'pending'
            AND data::text = ${JSON.stringify(msg.data)}
            LIMIT 1
          )
        `
      }
    }
  }

  subscribe(
    eventName: string,
    handler: (event: Message) => Promise<void> | void,
    options?: { subscriberId?: string }
  ): void {
    const handlers = this.handlers.get(eventName) || []
    handlers.push(handler)
    this.handlers.set(eventName, handlers)
  }

  unsubscribe(subscriberId: string): void {
    // Simple implementation — remove by reference not possible without tracking IDs
  }

  async releaseGroupedEvents(eventGroupId: string): Promise<void> {
    const events = this.groupedEvents.get(eventGroupId) || []
    this.groupedEvents.delete(eventGroupId)
    for (const msg of events) {
      await this.emit(msg)
    }
  }

  async clearGroupedEvents(eventGroupId: string): Promise<void> {
    this.groupedEvents.delete(eventGroupId)
  }

  addInterceptor(fn: (message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => Promise<void> | void): void {
    this.interceptors.push(fn)
  }

  removeInterceptor(fn: Function): void {
    this.interceptors = this.interceptors.filter((f) => f !== fn)
  }

  // Retry failed events (call this periodically or at bootstrap)
  async retryFailedEvents(): Promise<number> {
    const failed = await this.sql`
      SELECT id, event_name, data, metadata FROM events
      WHERE status = 'pending' AND attempts > 0 AND attempts < max_attempts
      ORDER BY created_at ASC LIMIT 50
    `
    let retried = 0
    for (const row of failed) {
      const msg: Message = {
        eventName: row.event_name,
        data: row.data as Record<string, unknown>,
        metadata: row.metadata as Record<string, unknown>,
      }
      await this.dispatch(msg)
      retried++
    }
    return retried
  }

  // Get dead letter events
  async getDeadLetterEvents(limit = 50): Promise<any[]> {
    return this.sql`
      SELECT * FROM events WHERE status = 'dead_letter'
      ORDER BY created_at DESC LIMIT ${limit}
    `
  }
}
