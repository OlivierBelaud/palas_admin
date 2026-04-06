// SPEC-034 — emitEventStep: Medusa-compatible buffered event emission
//
// The event is only emitted after the workflow has finished successfully.
// If the workflow fails, the event is NOT emitted at all.
//
// Uses IEventBusPort grouped events internally — events are buffered in the
// event bus (Redis in prod) and released by WorkflowManager on success.
//
// Usage (same as Medusa):
//   emitEventStep({ eventName: 'order.created', data: { id: '123' } })
//
// For immediate emission (not buffered), use:
//   app.infra.eventBus.emit(event)  // direct

import type { Message } from '../events/types'
import type { StepDefinition, StepHandlerContext } from './types'

export interface EmitEventStepInput {
  eventName: string
  data: unknown | unknown[]
  options?: {
    priority?: number
  }
}

/**
 * A workflow step that buffers events for emission after workflow success.
 * Compatible with Medusa's emitEventStep API.
 *
 * Events are buffered via the workflow's event group (IEventBusPort grouped events).
 * WorkflowManager releases the group on success, clears it on failure.
 */
export function emitEventStep(input: EmitEventStepInput): StepDefinition {
  const stepName = `emit-event:${input.eventName}`

  return {
    name: stepName,
    handler: async (ctx: StepHandlerContext): Promise<unknown> => {
      const dataArray = Array.isArray(input.data) ? input.data : [input.data]

      for (const data of dataArray) {
        const message: Message = {
          eventName: input.eventName,
          data,
          metadata: {
            timestamp: Date.now(),
            source: 'workflow',
            idempotencyKey: `${ctx.context?.transactionId ?? 'unknown'}:emit:${input.eventName}`,
          },
        }

        // Buffer via __bufferEvent (WorkflowManager stores in grouped events)
        if (ctx.context._bufferEvent) {
          ctx.context._bufferEvent(message)
        }
      }

      return { eventName: input.eventName, buffered: dataArray.length }
    },
  }
}
