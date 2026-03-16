// SPEC-126 — InMemoryRepository implements IRepository

import type { IRepository, TransactionOptions } from '../ports'
import { MantaError } from '../errors/manta-error'

export class InMemoryRepository implements IRepository<Record<string, unknown>> {
  private _store = new Map<string, Record<string, unknown>>()
  private _entityName = 'entity'

  async find(options?: {
    where?: Record<string, unknown>
    withDeleted?: boolean
    limit?: number
    offset?: number
    order?: Record<string, 'ASC' | 'DESC'>
    cursor?: { after?: string; before?: string; limit?: number }
  }): Promise<Record<string, unknown>[]> {
    let results = Array.from(this._store.values())

    // Filter soft-deleted by default
    if (!options?.withDeleted) {
      results = results.filter((e) => e.deleted_at === null || e.deleted_at === undefined)
    }

    // Apply where filters
    if (options?.where) {
      for (const [key, value] of Object.entries(options.where)) {
        results = results.filter((e) => e[key] === value)
      }
    }

    // Apply ordering
    if (options?.order) {
      const orderEntries = Object.entries(options.order)
      results.sort((a, b) => {
        for (const [field, dir] of orderEntries) {
          const aVal = a[field]
          const bVal = b[field]
          if (aVal === bVal) continue
          if (aVal === undefined || aVal === null) return dir === 'ASC' ? -1 : 1
          if (bVal === undefined || bVal === null) return dir === 'ASC' ? 1 : -1
          const cmp = String(aVal) < String(bVal) ? -1 : 1
          return dir === 'ASC' ? cmp : -cmp
        }
        return 0
      })
    }

    // Cursor pagination
    if (options?.cursor) {
      const afterId = options.cursor.after
      if (afterId) {
        const idx = results.findIndex((e) => e.id === afterId)
        if (idx >= 0) {
          results = results.slice(idx + 1)
        }
      }
      const beforeId = options.cursor.before
      if (beforeId) {
        const idx = results.findIndex((e) => e.id === beforeId)
        if (idx >= 0) {
          results = results.slice(0, idx)
        }
      }
    }

    // Apply offset (mutually exclusive with cursor)
    if (options?.offset && !options?.cursor) {
      results = results.slice(options.offset)
    }

    // Apply limit
    const limit = options?.limit ?? options?.cursor?.limit
    if (limit !== undefined) {
      results = results.slice(0, limit)
    }

    return results
  }

  async findAndCount(options?: Record<string, unknown>): Promise<[Record<string, unknown>[], number]> {
    const results = await this.find(options as Parameters<typeof this.find>[0])
    let all = Array.from(this._store.values())
    if (!(options as Record<string, unknown> | undefined)?.withDeleted) {
      all = all.filter((e) => e.deleted_at === null || e.deleted_at === undefined)
    }
    if ((options as Record<string, unknown> | undefined)?.where) {
      for (const [key, value] of Object.entries((options as Record<string, unknown>).where as Record<string, unknown>)) {
        all = all.filter((e) => e[key] === value)
      }
    }
    return [results, all.length]
  }

  async create(data: Record<string, unknown> | Record<string, unknown>[]): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    if (Array.isArray(data)) {
      return data.map((d) => this._createOne(d))
    }
    return this._createOne(data)
  }

  private _createOne(data: Record<string, unknown>): Record<string, unknown> {
    const id = (data.id as string) ?? crypto.randomUUID()
    const now = new Date()
    const entity: Record<string, unknown> = {
      ...data,
      id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    this._store.set(id, entity)
    return entity
  }

  async update(data: Record<string, unknown> | Record<string, unknown>[]): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    if (Array.isArray(data)) {
      return data.map((d) => this._updateOne(d))
    }
    return this._updateOne(data)
  }

  private _updateOne(data: Record<string, unknown>): Record<string, unknown> {
    const id = data.id as string
    const existing = this._store.get(id)
    if (!existing) throw new MantaError('NOT_FOUND', `Entity "${id}" not found`)
    const updated: Record<string, unknown> = {
      ...existing,
      ...data,
      updated_at: new Date(),
    }
    this._store.set(id, updated)
    return updated
  }

  async delete(ids: string | string[]): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    for (const id of idArray) {
      this._store.delete(id)
    }
  }

  async softDelete(ids: string | string[]): Promise<Record<string, string[]>> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    const deletedIds: string[] = []
    for (const id of idArray) {
      const entity = this._store.get(id)
      if (entity) {
        entity.deleted_at = new Date()
        entity.updated_at = new Date()
        deletedIds.push(id)
      }
    }
    return deletedIds.length > 0 ? { [this._entityName]: deletedIds } : {}
  }

  async restore(ids: string | string[]): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    for (const id of idArray) {
      const entity = this._store.get(id)
      if (entity) {
        entity.deleted_at = null
        entity.updated_at = new Date()
      }
    }
  }

  async serialize(data: unknown, _options?: unknown): Promise<unknown> {
    return JSON.parse(JSON.stringify(data))
  }

  async upsertWithReplace(
    data: Record<string, unknown>[],
    replaceFields?: string[],
    _conflictTarget?: string[],
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = []
    for (const item of data) {
      const id = item.id as string
      const existing = id ? this._store.get(id) : undefined

      if (existing) {
        let updated: Record<string, unknown>
        if (replaceFields && replaceFields.length > 0) {
          updated = { ...existing, updated_at: new Date() }
          for (const field of replaceFields) {
            if (field in item) {
              updated[field] = item[field]
            }
          }
        } else {
          updated = { ...existing, ...item, updated_at: new Date() }
        }
        this._store.set(id, updated)
        results.push(updated)
      } else {
        const entity = this._createOne(item)
        results.push(entity)
      }
    }
    return results
  }

  async transaction<TManager = unknown>(
    task: (transactionManager: TManager) => Promise<unknown>,
    _options?: TransactionOptions,
  ): Promise<unknown> {
    // Snapshot for rollback
    const snapshot = new Map<string, Record<string, unknown>>()
    for (const [key, value] of this._store) {
      snapshot.set(key, { ...value })
    }

    const txManager = {} as TManager
    try {
      return await task(txManager)
    } catch (error) {
      // Rollback
      this._store.clear()
      for (const [key, value] of snapshot) {
        this._store.set(key, value)
      }
      throw error
    }
  }

  _reset() { this._store.clear() }
}
