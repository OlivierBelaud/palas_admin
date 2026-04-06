// SPEC-133 — MantaError hierarchy

/**
 * All error types that can be thrown by the Manta framework.
 */
export type MantaErrorType =
  | 'NOT_FOUND'
  | 'INVALID_DATA'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'DUPLICATE_ERROR'
  | 'CONFLICT'
  | 'NOT_ALLOWED'
  | 'UNEXPECTED_STATE'
  | 'DB_ERROR'
  | 'UNKNOWN_MODULES'
  | 'INVALID_STATE'
  | 'NOT_IMPLEMENTED'
  | 'RESOURCE_EXHAUSTED'

/**
 * Base error class for all Manta framework errors.
 * Always throw MantaError, never raw Error.
 *
 * @param type - The error type from MantaErrorType
 * @param message - Human-readable error message
 * @param options - Optional code for programmatic identification
 */
export class MantaError extends Error {
  readonly type: MantaErrorType
  readonly code?: string
  readonly date: Date
  readonly __isMantaError = true as const

  constructor(type: MantaErrorType, message: string, options?: { code?: string }) {
    super(message)
    this.type = type
    this.code = options?.code
    this.date = new Date()
    this.name = 'MantaError'
  }

  /**
   * Type guard to check if an unknown value is a MantaError.
   * Uses duck-typing via __isMantaError brand for cross-package safety.
   *
   * @param err - The value to check
   * @returns True if err is a MantaError
   */
  static is(err: unknown): err is MantaError {
    return (
      typeof err === 'object' && err !== null && '__isMantaError' in err && (err as MantaError).__isMantaError === true
    )
  }

  /**
   * Wrap a raw Error into a MantaError at framework boundaries.
   * If the error is already a MantaError, returns it unchanged.
   * If it's a raw Error, wraps it and logs a developer warning.
   *
   * This enforces the "always MantaError" convention at runtime —
   * making raw Error usage visible immediately instead of silently passing.
   *
   * @param err - The caught error
   * @param context - Where it was caught (e.g. 'subscriber:product-created', 'command:create-product')
   * @returns A MantaError (either the original or a wrapped version)
   */
  static wrap(err: unknown, context: string): MantaError {
    if (MantaError.is(err)) return err

    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined

    // Developer warning — makes the violation visible immediately
    console.warn(
      `  ⚠ [${context}] Raw Error thrown instead of MantaError: "${message}"\n` +
        `    Use: throw new MantaError('UNEXPECTED_STATE', '${message}')\n` +
        (stack ? `    ${stack.split('\n')[1]?.trim()}\n` : ''),
    )

    const wrapped = new MantaError('UNEXPECTED_STATE', message)
    if (stack) wrapped.stack = stack
    return wrapped
  }
}

/**
 * Wraps an error to signal permanent subscriber failure (→ DLQ).
 */
export class PermanentSubscriberError extends Error {
  readonly __isPermanentSubscriber = true as const
  constructor(public readonly cause: Error) {
    super(cause.message)
    this.name = 'PermanentSubscriberError'
  }
}

/**
 * Factory for creating PermanentSubscriberError.
 *
 * @param error - The underlying error
 * @returns A PermanentSubscriberError wrapping the given error
 */
export function permanentSubscriberFailure(error: Error): PermanentSubscriberError {
  return new PermanentSubscriberError(error)
}

/**
 * HTTP error response format as returned by the error handler middleware.
 */
export interface MantaErrorResponse {
  type: string
  message: string
  code?: string
  details?: unknown
  stack?: string
}
