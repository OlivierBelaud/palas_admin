// SPEC-133 — PG error codes → MantaError mapping tests
// Tests: EM-01 → EM-08

import { describe, it, expect } from 'vitest'
import { mapPgError, isPgError } from '../src/error-mapper'
import { MantaError } from '@manta/core'

describe('Error Mapper — mapPgError', () => {
  it('EM-01 — PG 23505 (UNIQUE) → MantaError(DUPLICATE_ERROR)', () => {
    const pgErr = { code: '23505', message: 'unique violation', detail: 'Key (email)=(a@b.com) already exists.' }
    const err = mapPgError(pgErr)
    expect(err).toBeInstanceOf(MantaError)
    expect(err.type).toBe('DUPLICATE_ERROR')
    expect(err.message).toContain('already exists')
  })

  it('EM-02 — PG 23503 (FK) → MantaError(NOT_FOUND)', () => {
    const pgErr = { code: '23503', message: 'fk violation', detail: 'Key (category_id)=(abc) is not present.' }
    const err = mapPgError(pgErr)
    expect(err).toBeInstanceOf(MantaError)
    expect(err.type).toBe('NOT_FOUND')
    expect(err.message).toContain('not present')
  })

  it('EM-03 — PG 23502 (NOT NULL) → MantaError(INVALID_DATA)', () => {
    const pgErr = { code: '23502', message: 'not null violation', detail: 'Column "title" violates not-null constraint.' }
    const err = mapPgError(pgErr)
    expect(err).toBeInstanceOf(MantaError)
    expect(err.type).toBe('INVALID_DATA')
  })

  it('EM-04 — PG 40001 (SERIALIZATION) → MantaError(CONFLICT)', () => {
    const pgErr = { code: '40001', message: 'could not serialize access' }
    const err = mapPgError(pgErr)
    expect(err).toBeInstanceOf(MantaError)
    expect(err.type).toBe('CONFLICT')
  })

  it('EM-05 — PG 40P01 (DEADLOCK) → MantaError(CONFLICT)', () => {
    const pgErr = { code: '40P01', message: 'deadlock detected' }
    const err = mapPgError(pgErr)
    expect(err).toBeInstanceOf(MantaError)
    expect(err.type).toBe('CONFLICT')
  })

  it('EM-06 — Unknown PG code → MantaError(DB_ERROR)', () => {
    const pgErr = { code: '99999', message: 'something unexpected' }
    const err = mapPgError(pgErr)
    expect(err).toBeInstanceOf(MantaError)
    expect(err.type).toBe('DB_ERROR')
  })

  it('EM-07 — uses detail when available, falls back to message', () => {
    const withDetail = { code: '23505', message: 'violation', detail: 'Duplicate key value' }
    expect(mapPgError(withDetail).message).toBe('Duplicate key value')

    const withoutDetail = { code: '23505', message: 'violation' }
    expect(mapPgError(withoutDetail).message).toBe('violation')
  })

  it('EM-08 — handles missing message gracefully', () => {
    const pgErr = { code: '23505' }
    const err = mapPgError(pgErr)
    expect(err).toBeInstanceOf(MantaError)
    expect(err.message).toBe('Database error')
  })
})

describe('Error Mapper — isPgError', () => {
  it('EM-09 — returns true for objects with string code property', () => {
    expect(isPgError({ code: '23505', message: 'test' })).toBe(true)
    expect(isPgError({ code: '40001' })).toBe(true)
  })

  it('EM-10 — returns false for non-PG errors', () => {
    expect(isPgError(null)).toBe(false)
    expect(isPgError(undefined)).toBe(false)
    expect(isPgError('string')).toBe(false)
    expect(isPgError(42)).toBe(false)
    expect(isPgError(new Error('test'))).toBe(false)
    expect(isPgError({ message: 'no code' })).toBe(false)
    expect(isPgError({ code: 42 })).toBe(false) // numeric code
  })
})
