// SPEC-059 -- Service method decorators (higher-order functions)
// Supports both TC39 stage-3 decorators and legacy TS decorators

import type { IMessageAggregator } from '../events/types'

type AnyMethod = (...args: unknown[]) => Promise<unknown>
type ServiceWithManager = { manager?: unknown; __manager?: unknown }
type ServiceWithAggregator = {
  __messageAggregator?: IMessageAggregator
  __eventBus?: { emit: (events: unknown[]) => Promise<void> }
}

// TC39 stage-3 decorator context
interface DecoratorContext {
  kind: string
  name: string | symbol
  addInitializer?: (fn: () => void) => void
}

/**
 * InjectManager -- injects the service's manager as the last argument.
 */
export function InjectManager() {
  return function (
    valueOrTarget: unknown,
    contextOrKey?: DecoratorContext | string,
    descriptor?: PropertyDescriptor,
  ): unknown {
    // TC39 stage-3 format: (value: Function, context: DecoratorContext)
    if (typeof valueOrTarget === 'function' && contextOrKey && typeof contextOrKey === 'object' && contextOrKey.kind === 'method') {
      const original = valueOrTarget as AnyMethod
      return async function (this: ServiceWithManager, ...args: unknown[]) {
        const manager = this.manager ?? this.__manager
        return original.call(this, ...args, manager)
      }
    }

    // Legacy TS format: (target, propertyKey, descriptor)
    if (descriptor && typeof descriptor.value === 'function') {
      const original = descriptor.value as AnyMethod
      descriptor.value = async function (this: ServiceWithManager, ...args: unknown[]) {
        const manager = this.manager ?? this.__manager
        return original.call(this, ...args, manager)
      }
      return descriptor
    }

    return valueOrTarget
  }
}

/**
 * InjectTransactionManager -- wraps the method in a transaction.
 */
export function InjectTransactionManager() {
  return function (
    valueOrTarget: unknown,
    contextOrKey?: DecoratorContext | string,
    descriptor?: PropertyDescriptor,
  ): unknown {
    function wrapMethod(original: AnyMethod): AnyMethod {
      return async function (this: ServiceWithManager, ...args: unknown[]) {
        const manager = this.manager ?? this.__manager
        if (manager && typeof (manager as Record<string, unknown>).transaction === 'function') {
          return (manager as { transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> })
            .transaction(async (tx: unknown) => {
              return original.call(this, ...args, tx)
            })
        }
        return original.call(this, ...args)
      }
    }

    // TC39 stage-3
    if (typeof valueOrTarget === 'function' && contextOrKey && typeof contextOrKey === 'object' && contextOrKey.kind === 'method') {
      return wrapMethod(valueOrTarget as AnyMethod)
    }

    // Legacy TS
    if (descriptor && typeof descriptor.value === 'function') {
      descriptor.value = wrapMethod(descriptor.value as AnyMethod)
      return descriptor
    }

    return valueOrTarget
  }
}

/**
 * EmitEvents -- on success, emit accumulated events. On failure, clear them.
 */
export function EmitEvents() {
  return function (
    valueOrTarget: unknown,
    contextOrKey?: DecoratorContext | string,
    descriptor?: PropertyDescriptor,
  ): unknown {
    function wrapMethod(original: AnyMethod): AnyMethod {
      return async function (this: ServiceWithAggregator, ...args: unknown[]) {
        try {
          const result = await original.call(this, ...args)

          // On success: emit accumulated events
          if (this.__messageAggregator && this.__eventBus) {
            const messages = this.__messageAggregator.getMessages()
            if (messages.length > 0) {
              await this.__eventBus.emit(messages)
              this.__messageAggregator.clearMessages()
            }
          }

          return result
        } catch (err) {
          // On failure: clear accumulated events
          if (this.__messageAggregator) {
            this.__messageAggregator.clearMessages()
          }
          throw err
        }
      }
    }

    // TC39 stage-3
    if (typeof valueOrTarget === 'function' && contextOrKey && typeof contextOrKey === 'object' && contextOrKey.kind === 'method') {
      return wrapMethod(valueOrTarget as AnyMethod)
    }

    // Legacy TS
    if (descriptor && typeof descriptor.value === 'function') {
      descriptor.value = wrapMethod(descriptor.value as AnyMethod)
      return descriptor
    }

    return valueOrTarget
  }
}
