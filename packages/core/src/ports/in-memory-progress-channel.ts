// InMemoryProgressChannel — test-only implementation of IProgressChannelPort.
// See WORKFLOW_PROGRESS.md §9.2 "progress-memory: test containers".
// Uses a plain Map — no TTL, no throttle.

import type { IProgressChannelPort, ProgressSnapshot } from './progress-channel'

export class InMemoryProgressChannel implements IProgressChannelPort {
  private _store = new Map<string, ProgressSnapshot>()

  async set(runId: string, snapshot: ProgressSnapshot): Promise<void> {
    this._store.set(runId, snapshot)
  }

  async get(runId: string): Promise<ProgressSnapshot | null> {
    return this._store.get(runId) ?? null
  }

  async clear(runId: string): Promise<void> {
    this._store.delete(runId)
  }

  _reset() {
    this._store.clear()
  }
}
