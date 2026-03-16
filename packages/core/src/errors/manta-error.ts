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
      typeof err === 'object' &&
      err !== null &&
      '__isMantaError' in err &&
      (err as MantaError).__isMantaError === true
    )
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
