// SPEC-133 — PG error codes → MantaError

import { MantaError } from '@manta/core/errors'

/**
 * Maps PostgreSQL error codes to MantaError types.
 * See https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export function mapPgError(error: unknown): MantaError {
  const pgError = error as { code?: string; message?: string; detail?: string }
  const code = pgError.code
  const message = pgError.message ?? 'Database error'
  const detail = pgError.detail

  switch (code) {
    // 23505 — unique_violation → DUPLICATE_ERROR
    case '23505':
      return new MantaError('DUPLICATE_ERROR', detail ?? message)

    // 23503 — foreign_key_violation → NOT_FOUND
    case '23503':
      return new MantaError('NOT_FOUND', detail ?? message)

    // 23502 — not_null_violation → INVALID_DATA
    case '23502':
      return new MantaError('INVALID_DATA', detail ?? message)

    // 40001 — serialization_failure → CONFLICT
    case '40001':
      return new MantaError('CONFLICT', message)

    // 40P01 — deadlock_detected → CONFLICT
    case '40P01':
      return new MantaError('CONFLICT', message)

    default:
      return new MantaError('DB_ERROR', message)
  }
}

/**
 * Checks if an error is a PostgreSQL error with a code property.
 */
export function isPgError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  )
}
