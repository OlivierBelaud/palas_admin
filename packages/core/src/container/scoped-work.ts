// SPEC-001 — AsyncLocalStorage setup for scoped containers

import { AsyncLocalStorage } from 'node:async_hooks'
import type { IContainer } from './types'

/**
 * Global ALS instance shared across the container hierarchy.
 * Stores the active scoped container for the current async context.
 */
export const containerALS = new AsyncLocalStorage<IContainer>()

/**
 * Run a callback within a scoped container context.
 * Creates a child scope and activates it via AsyncLocalStorage.
 *
 * @param container - The parent container
 * @param fn - Callback receiving the scoped container
 * @returns The callback result
 */
export async function withScope<T>(
  container: IContainer & { _runInScope?: (scope: IContainer, fn: () => T | Promise<T>) => Promise<T> },
  fn: (scopedContainer: IContainer) => Promise<T> | T,
): Promise<T> {
  const scope = container.createScope()
  return containerALS.run(scope, () => fn(scope)) as Promise<T>
}
