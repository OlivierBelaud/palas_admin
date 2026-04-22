// UpstashProgressChannel — ephemeral workflow progress via Upstash Redis.
// Implements IProgressChannelPort — see WORKFLOW_PROGRESS.md §5.2 and §9.2.
//
// Key format: `workflow:{runId}:progress` (spec §4 architecture diagram).
// TTL: 3600 seconds (spec §5.2 "TTL 1h").
// `set()` MUST NOT throw — channel errors are logged, not propagated (§10.2 invariant #2).

import type { ILoggerPort, IProgressChannelPort, ProgressSnapshot } from '@manta/core'
import { MantaError } from '@manta/core'
import { Redis } from '@upstash/redis'

const TTL_SECONDS = 3600

export interface UpstashProgressChannelOptions {
  url?: string
  token?: string
}

function progressKey(runId: string): string {
  return `workflow:${runId}:progress`
}

/**
 * Progress channel backed by Upstash Redis.
 *
 * Accepts either a pre-built `Redis` client (preferred — reuses the cache
 * adapter's client) or the same credentials the cache adapter uses.
 *
 * @example
 * const channel = new UpstashProgressChannel(redisClient, { logger })
 */
export class UpstashProgressChannel implements IProgressChannelPort {
  private _redis: Redis
  private _logger?: ILoggerPort

  constructor(clientOrOptions: Redis | UpstashProgressChannelOptions = {}, deps: { logger?: ILoggerPort } = {}) {
    this._logger = deps.logger

    if (clientOrOptions instanceof Redis) {
      this._redis = clientOrOptions
      return
    }

    const options = clientOrOptions
    const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL
    const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN

    if (!url || !token) {
      throw new MantaError(
        'INVALID_DATA',
        'UpstashProgressChannel requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (env or constructor options)',
      )
    }

    this._redis = new Redis({ url, token })
  }

  async set(runId: string, snapshot: ProgressSnapshot): Promise<void> {
    try {
      await this._redis.set(progressKey(runId), JSON.stringify(snapshot), { ex: TTL_SECONDS })
    } catch (err) {
      // Invariant #2: never throw. Log and swallow.
      this._logger?.warn('progress write failed', { err, runId, stepName: snapshot.stepName })
    }
  }

  async get(runId: string): Promise<ProgressSnapshot | null> {
    const raw = await this._redis.get(progressKey(runId))
    if (raw === null || raw === undefined) return null
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as ProgressSnapshot
      } catch {
        return null
      }
    }
    // Upstash auto-parses JSON for some payloads — accept already-parsed objects.
    return raw as ProgressSnapshot
  }

  async clear(runId: string): Promise<void> {
    await this._redis.del(progressKey(runId))
  }
}
