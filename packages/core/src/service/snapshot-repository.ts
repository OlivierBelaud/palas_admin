// SnapshotRepository — auto-snapshot wrapper for TypedRepository.
// Intercepts mutations (update, delete, softDelete, create) and captures
// state before each operation. On rollback(), reverses all operations.
//
// This eliminates manual compensation in service methods — the framework
// handles undo automatically.

import type { TypedRepository } from './define'

interface Snapshot {
  type: 'update' | 'delete' | 'softDelete' | 'create'
  before?: Record<string, unknown>
  id?: string
  ids?: string[]
}

/**
 * Wraps a TypedRepository with automatic snapshotting of mutations.
 * Every update/delete/softDelete captures the entity state before mutation.
 * Every create captures the created ID for deletion on rollback.
 *
 * Call `rollback()` to undo all mutations in reverse order.
 * Call `clearSnapshots()` after a successful operation.
 */
export class SnapshotRepository<T extends Record<string, unknown>> implements TypedRepository<T> {
  private _snapshots: Snapshot[] = []

  constructor(private _inner: TypedRepository<T>) {}

  // ── Reads — passthrough ─────────────────────────────────────────────

  find(options?: Parameters<TypedRepository<T>['find']>[0]): Promise<T[]> {
    return this._inner.find(options)
  }

  findAndCount(options?: Parameters<TypedRepository<T>['findAndCount']>[0]): Promise<[T[], number]> {
    return this._inner.findAndCount(options)
  }

  // ── Mutations — auto-snapshot before execution ──────────────────────

  async create(data: Partial<T> | Partial<T>[]): Promise<T | T[]> {
    const result = await this._inner.create(data)
    // Track created IDs for rollback (delete on compensation)
    const items = Array.isArray(result) ? result : [result]
    for (const item of items) {
      this._snapshots.push({ type: 'create', id: (item as Record<string, unknown>).id as string })
    }
    return result
  }

  async update(data: Partial<T> & { id: string }): Promise<T> {
    // Snapshot: fetch entity before mutation
    const [before] = await this._inner.find({ where: { id: data.id } as unknown as Partial<T> })
    if (before) {
      this._snapshots.push({ type: 'update', before: before as Record<string, unknown>, id: data.id })
    }
    return this._inner.update(data)
  }

  async delete(ids: string | string[]): Promise<void> {
    // Snapshot: fetch all entities before deletion
    const idArray = Array.isArray(ids) ? ids : [ids]
    for (const id of idArray) {
      const [before] = await this._inner.find({ where: { id } as unknown as Partial<T>, withDeleted: true })
      if (before) {
        this._snapshots.push({ type: 'delete', before: before as Record<string, unknown>, id })
      }
    }
    return this._inner.delete(ids)
  }

  async softDelete(ids: string | string[]): Promise<Record<string, string[]>> {
    // Snapshot: fetch all entities before soft-deletion
    const idArray = Array.isArray(ids) ? ids : [ids]
    for (const id of idArray) {
      const [before] = await this._inner.find({ where: { id } as unknown as Partial<T> })
      if (before) {
        this._snapshots.push({ type: 'softDelete', before: before as Record<string, unknown>, id })
      }
    }
    return this._inner.softDelete(ids)
  }

  async restore(ids: string | string[]): Promise<void> {
    return this._inner.restore(ids)
  }

  // ── Compensation ────────────────────────────────────────────────────

  /** Undo all mutations in reverse order. */
  async rollback(): Promise<void> {
    const reversed = [...this._snapshots].reverse()
    for (const snap of reversed) {
      switch (snap.type) {
        case 'update':
          if (snap.before) {
            await this._inner.update(snap.before as Partial<T> & { id: string })
          }
          break
        case 'delete':
          if (snap.before) {
            await this._inner.create(snap.before as Partial<T>)
          }
          break
        case 'softDelete':
          if (snap.id) {
            await this._inner.restore(snap.id)
          }
          break
        case 'create':
          if (snap.id) {
            await this._inner.delete(snap.id)
          }
          break
      }
    }
    this._snapshots = []
  }

  /** Clear snapshots after successful completion (no rollback needed). */
  clearSnapshots(): void {
    this._snapshots = []
  }

  /** Check if there are pending snapshots. */
  get hasSnapshots(): boolean {
    return this._snapshots.length > 0
  }
}
