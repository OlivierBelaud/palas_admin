// SPEC-034 — IEventBusPort interface

import type { Message } from '../events/types'
import type { GroupStatus } from './types'

/**
 * Event bus port contract.
 * Adapters: InMemoryEventBus (dev), Vercel Queues (prod).
 */
export interface IEventBusPort {
  /**
   * Emit one or more events. Optionally group them by eventGroupId.
   * @param event - A single message or array of messages
   * @param options - Optional groupId for grouped events
   */
  emit(event: Message | Message[], options?: { groupId?: string }): Promise<void>

  /**
   * Subscribe a handler to an event name.
   * @param eventName - The event name to subscribe to
   * @param handler - The handler function
   * @param options - Optional subscriberId for unsubscribe
   */
  subscribe(
    eventName: string,
    handler: (event: Message) => Promise<void> | void,
    options?: { subscriberId?: string },
  ): void

  /**
   * Unsubscribe a handler by its subscriberId.
   * @param subscriberId - The subscriber to remove
   */
  unsubscribe(subscriberId: string): void

  /**
   * Release all grouped events for the given groupId (emit them to subscribers).
   * @param eventGroupId - The group to release
   */
  releaseGroupedEvents(eventGroupId: string): Promise<void>

  /**
   * Clear all grouped events for the given groupId without emitting.
   * @param eventGroupId - The group to clear
   */
  clearGroupedEvents(eventGroupId: string): Promise<void>

  /**
   * Add an interceptor that observes messages as they are emitted.
   * Interceptors are read-only, fire-and-forget.
   * @param fn - The interceptor function
   */
  addInterceptor(
    fn: (message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => Promise<void> | void,
  ): void

  /**
   * Remove a previously added interceptor.
   * @param fn - The interceptor function to remove
   */
  removeInterceptor(
    fn: (message: Message, context?: { isGrouped?: boolean; eventGroupId?: string }) => Promise<void> | void,
  ): void

  /**
   * Optional: hook called when a new event group is created.
   * @param handler - Callback receiving groupId and event count
   */
  onGroupCreated?(handler: (eventGroupId: string, eventCount: number) => void): void

  /**
   * Optional: hook called when a group is released.
   * @param handler - Callback receiving groupId and event count
   */
  onGroupReleased?(handler: (eventGroupId: string, eventCount: number) => void): void

  /**
   * Optional: hook called when a group is cleared.
   * @param handler - Callback receiving groupId, count, and reason
   */
  onGroupCleared?(handler: (eventGroupId: string, eventCount: number, reason: 'explicit' | 'ttl') => void): void

  /**
   * Optional: get the status of a grouped event set.
   * @param eventGroupId - The group to check
   * @returns GroupStatus or null if group does not exist
   */
  getGroupStatus?(eventGroupId: string): GroupStatus | null

  /**
   * Optional readiness probe. Returns true if the event bus backend is reachable.
   * Used by /health/ready (BC-F22). If the adapter does not implement ping(),
   * the readiness handler treats the event bus as present but unprobed.
   */
  ping?(): Promise<boolean>
}
