import type { RuntimeSql } from './manta-runtime'

export const KLAVIYO_PROJECTION_KEY = 'abandonment_events'
// The provider fence is intentionally tight: the campaign synchronizes first,
// and each irreversible send must consume that exact generation within 60s.
export const DEFAULT_KLAVIYO_PROJECTION_MAX_AGE_MS = 60 * 1000

export interface KlaviyoProjectionFence {
  generation: number
  syncToken: string
  throughIso: string
}

export interface KlaviyoSyncAttempt extends KlaviyoProjectionFence {
  attemptedAtIso: string
}

export interface KlaviyoProjectionState {
  generation: number | string
  sync_token: string
  status: 'syncing' | 'succeeded' | 'failed'
  last_attempted_at: Date | string
  last_successful_at: Date | string | null
  requested_through: Date | string
  covered_through: Date | string | null
  last_error: string | null
}

export type KlaviyoProjectionFreshness =
  | { ready: true; ageMs: number }
  | {
      ready: false
      reason: 'missing' | 'syncing' | 'failed' | 'incomplete' | 'stale' | 'invalid' | 'superseded'
    }

function asTime(value: Date | string | null): number | null {
  if (value == null) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

export function assessKlaviyoProjectionFreshness(
  state: KlaviyoProjectionState | null,
  now: Date,
  maxAgeMs: number = DEFAULT_KLAVIYO_PROJECTION_MAX_AGE_MS,
): KlaviyoProjectionFreshness {
  if (!state) return { ready: false, reason: 'missing' }
  if (state.status === 'syncing') return { ready: false, reason: 'syncing' }
  if (state.status === 'failed') return { ready: false, reason: 'failed' }
  if (!state.last_successful_at || !state.covered_through) return { ready: false, reason: 'incomplete' }
  const coveredThrough = asTime(state.covered_through)
  if (coveredThrough == null) return { ready: false, reason: 'invalid' }
  const ageMs = now.getTime() - coveredThrough
  if (ageMs < -60_000) return { ready: false, reason: 'invalid' }
  if (ageMs > maxAgeMs) return { ready: false, reason: 'stale' }
  return { ready: true, ageMs: Math.max(0, ageMs) }
}

function sameInstant(left: Date | string | null, rightIso: string): boolean {
  const leftTime = asTime(left)
  const rightTime = asTime(rightIso)
  return leftTime != null && rightTime != null && leftTime === rightTime
}

export function projectionFenceFromState(state: KlaviyoProjectionState): KlaviyoProjectionFence {
  if (!state.covered_through) throw new KlaviyoProjectionUnavailableError('incomplete', state.last_error)
  return {
    generation: Number(state.generation),
    syncToken: state.sync_token,
    throughIso: new Date(state.covered_through).toISOString(),
  }
}

export class KlaviyoProjectionUnavailableError extends Error {
  constructor(
    readonly reason: Exclude<KlaviyoProjectionFreshness, { ready: true }>['reason'],
    readonly lastError?: string | null,
  ) {
    super(`Klaviyo projection unavailable: ${reason}${lastError ? ` (${lastError})` : ''}`)
    this.name = 'KlaviyoProjectionUnavailableError'
  }
}

export async function loadKlaviyoProjectionState(sql: RuntimeSql): Promise<KlaviyoProjectionState | null> {
  const rows = await sql<KlaviyoProjectionState[]>`
    SELECT generation, sync_token, status, last_attempted_at, last_successful_at,
           requested_through, covered_through, last_error
    FROM klaviyo_projection_state
    WHERE projection_key = ${KLAVIYO_PROJECTION_KEY}
    LIMIT 1`
  return rows[0] ?? null
}

export async function requireFreshKlaviyoProjection(
  sql: RuntimeSql,
  now: Date = new Date(),
  maxAgeMs: number = DEFAULT_KLAVIYO_PROJECTION_MAX_AGE_MS,
  expectedFence?: KlaviyoProjectionFence,
): Promise<KlaviyoProjectionState> {
  const state = await loadKlaviyoProjectionState(sql)
  const freshness = assessKlaviyoProjectionFreshness(state, now, maxAgeMs)
  if (!freshness.ready) throw new KlaviyoProjectionUnavailableError(freshness.reason, state?.last_error)
  if (
    expectedFence &&
    (Number(state?.generation) !== expectedFence.generation ||
      state?.sync_token !== expectedFence.syncToken ||
      !sameInstant(state?.covered_through ?? null, expectedFence.throughIso))
  ) {
    throw new KlaviyoProjectionUnavailableError('superseded', state?.last_error)
  }
  return state as KlaviyoProjectionState
}

export function floorToSecond(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 1000) * 1000)
}

export async function startKlaviyoProjectionSyncAttempt(
  sql: RuntimeSql,
  attemptedAt: Date = new Date(),
  syncToken: string = crypto.randomUUID(),
): Promise<KlaviyoSyncAttempt> {
  const through = floorToSecond(attemptedAt)
  const rows = await sql<Array<{ generation: number | string }>>`
    INSERT INTO klaviyo_projection_state (
      projection_key, generation, sync_token, status, last_attempted_at,
      requested_through, consecutive_failures, updated_at
    ) VALUES (
      ${KLAVIYO_PROJECTION_KEY}, 1, ${syncToken}, 'syncing', ${attemptedAt},
      ${through}, 0, ${attemptedAt}
    )
    ON CONFLICT (projection_key) DO UPDATE SET
      generation = klaviyo_projection_state.generation + 1,
      sync_token = EXCLUDED.sync_token,
      status = 'syncing',
      last_attempted_at = EXCLUDED.last_attempted_at,
      requested_through = EXCLUDED.requested_through,
      last_error = NULL,
      updated_at = EXCLUDED.updated_at
    WHERE klaviyo_projection_state.last_attempted_at <= EXCLUDED.last_attempted_at
    RETURNING generation`
  const generation = Number(rows[0]?.generation)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('Klaviyo projection sync attempt was superseded before checkpoint')
  }
  return {
    generation,
    syncToken,
    attemptedAtIso: attemptedAt.toISOString(),
    throughIso: through.toISOString(),
  }
}

export async function markKlaviyoProjectionSyncSucceeded(
  sql: RuntimeSql,
  attempt: KlaviyoSyncAttempt,
  completedAt: Date,
): Promise<void> {
  await sql`
    UPDATE klaviyo_projection_state
    SET status = 'succeeded',
        last_successful_at = ${completedAt},
        covered_through = ${new Date(attempt.throughIso)},
        last_error = NULL,
        consecutive_failures = 0,
        updated_at = ${completedAt}
    WHERE projection_key = ${KLAVIYO_PROJECTION_KEY}
      AND sync_token = ${attempt.syncToken}
      AND generation = ${attempt.generation}
      AND last_attempted_at = ${new Date(attempt.attemptedAtIso)}
      AND requested_through = ${new Date(attempt.throughIso)}`
}

export async function markKlaviyoProjectionSyncFailed(
  sql: RuntimeSql,
  attempt: KlaviyoSyncAttempt,
  failedAt: Date,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  await sql`
    UPDATE klaviyo_projection_state
    SET status = 'failed',
        last_error = ${message.slice(0, 2000)},
        consecutive_failures = consecutive_failures + 1,
        updated_at = ${failedAt}
    WHERE projection_key = ${KLAVIYO_PROJECTION_KEY}
      AND sync_token = ${attempt.syncToken}
      AND generation = ${attempt.generation}
      AND last_attempted_at = ${new Date(attempt.attemptedAtIso)}
      AND requested_through = ${new Date(attempt.throughIso)}`
}
