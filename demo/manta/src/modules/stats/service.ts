// StatsService — simple in-memory counter for demo

export class StatsService {
  private _counters = new Map<string, number>()

  async increment(key: string): Promise<void> {
    this._counters.set(key, (this._counters.get(key) ?? 0) + 1)
  }

  async get(key: string): Promise<number> {
    return this._counters.get(key) ?? 0
  }

  _reset(): void {
    this._counters.clear()
  }
}
