// In-memory IRelationalQueryPort — for dev/test
// Simulates relational queries using in-memory data stores.

import type { IRelationalQueryPort, RelationalQueryConfig } from '../ports/relational-query'

interface RelationMeta {
  type: 'hasOne' | 'hasOneWithFK' | 'belongsTo' | 'hasMany' | 'manyToMany'
  target: string
  foreignKey?: string
  pivotEntity?: string
}

/**
 * In-memory relational query adapter.
 *
 * Stores data per entity and uses relation metadata to resolve JOINs in memory.
 * Suitable for unit/conformance tests — not for production.
 */
export class InMemoryRelationalQuery implements IRelationalQueryPort {
  private _data = new Map<string, Record<string, unknown>[]>()
  private _relations = new Map<string, Record<string, RelationMeta>>()

  /**
   * Seed entity data for testing.
   */
  setData(entityName: string, records: Record<string, unknown>[]): void {
    this._data.set(entityName.toLowerCase(), records)
  }

  /**
   * Register relation metadata for an entity.
   */
  setRelations(entityName: string, relations: Record<string, RelationMeta>): void {
    this._relations.set(entityName.toLowerCase(), relations)
  }

  async findWithRelations(config: RelationalQueryConfig): Promise<Record<string, unknown>[]> {
    const entityKey = config.entity.toLowerCase()
    let records = [...(this._data.get(entityKey) ?? [])]

    // Apply soft-delete filter
    if (!config.withDeleted) {
      records = records.filter((r) => r.deleted_at == null)
    }

    // Apply root-level filters
    if (config.filters) {
      records = this._applyFilters(records, config.filters, entityKey)
    }

    // Apply sorting
    if (config.sort) {
      records = this._applySort(records, config.sort)
    }

    // Apply pagination
    const offset = config.pagination?.offset ?? 0
    const limit = config.pagination?.limit ?? 100
    records = records.slice(offset, offset + limit)

    // Resolve relations based on requested fields
    const relationFields = this._extractRelationFields(config.fields ?? ['*'])
    if (relationFields.length > 0) {
      records = records.map((record) =>
        this._resolveRelations(record, entityKey, relationFields, config.withDeleted ?? false, config.relPagination),
      )
    }

    return records
  }

  async findAndCountWithRelations(config: RelationalQueryConfig): Promise<[Record<string, unknown>[], number]> {
    const entityKey = config.entity.toLowerCase()
    let allRecords = [...(this._data.get(entityKey) ?? [])]

    if (!config.withDeleted) {
      allRecords = allRecords.filter((r) => r.deleted_at == null)
    }

    if (config.filters) {
      allRecords = this._applyFilters(allRecords, config.filters, entityKey)
    }

    const total = allRecords.length
    const results = await this.findWithRelations(config)
    return [results, total]
  }

  private _applyFilters(
    records: Record<string, unknown>[],
    filters: Record<string, unknown>,
    entityKey: string,
  ): Record<string, unknown>[] {
    return records.filter((record) => {
      for (const [key, value] of Object.entries(filters)) {
        if (key.includes('.')) {
          // Dotted path — filter on relation
          const parts = key.split('.')
          const relName = parts[0]
          const relField = parts.slice(1).join('.')
          const relMeta = this._relations.get(entityKey)?.[relName]
          if (!relMeta) return false

          const relRecords = this._getRelatedRecords(record, entityKey, relName, relMeta, false)
          const matches = relRecords.some((r) => InMemoryRelationalQuery._matchValue(r[relField], value))
          if (!matches) return false
        } else {
          if (!InMemoryRelationalQuery._matchValue(record[key], value)) return false
        }
      }
      return true
    })
  }

  /**
   * Evaluate whether a concrete record field `actual` matches the user's
   * `filter` spec. Supports:
   *  - scalar equality (`filter: 'x'`)
   *  - `null` → exact null
   *  - operator bags: `{ $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin }`
   *
   * Mirrors the operators honored by the Drizzle adapter's buildFieldPredicates,
   * so that conformance tests exercise the same semantics across adapters.
   */
  private static _matchValue(actual: unknown, filter: unknown): boolean {
    if (filter === null) return actual == null
    if (typeof filter === 'object' && !Array.isArray(filter)) {
      const ops = filter as Record<string, unknown>
      for (const [op, val] of Object.entries(ops)) {
        switch (op) {
          case '$eq':
            if (actual !== val) return false
            break
          case '$ne':
            if (actual === val) return false
            break
          case '$gt':
            if (!(InMemoryRelationalQuery._compare(actual, val) > 0)) return false
            break
          case '$gte':
            if (!(InMemoryRelationalQuery._compare(actual, val) >= 0)) return false
            break
          case '$lt':
            if (!(InMemoryRelationalQuery._compare(actual, val) < 0)) return false
            break
          case '$lte':
            if (!(InMemoryRelationalQuery._compare(actual, val) <= 0)) return false
            break
          case '$in':
            if (!Array.isArray(val) || !val.includes(actual)) return false
            break
          case '$nin':
            if (!Array.isArray(val) || val.includes(actual)) return false
            break
          default:
            // Unknown operator keys are ignored (matches Drizzle adapter behaviour).
            break
        }
      }
      return true
    }
    return actual === filter
  }

  private static _compare(a: unknown, b: unknown): number {
    if (a == null && b == null) return 0
    if (a == null) return -1
    if (b == null) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    const as = String(a)
    const bs = String(b)
    return as < bs ? -1 : as > bs ? 1 : 0
  }

  private _applySort(
    records: Record<string, unknown>[],
    sort: Record<string, 'asc' | 'desc'>,
  ): Record<string, unknown>[] {
    return [...records].sort((a, b) => {
      for (const [field, direction] of Object.entries(sort)) {
        const aVal = a[field]
        const bVal = b[field]
        if (aVal === bVal) continue
        const cmp = (() => {
          if (aVal == null && bVal == null) return 0
          if (aVal == null) return 1 // nulls last
          if (bVal == null) return -1
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        })()
        if (cmp === 0) continue
        return direction === 'desc' ? -cmp : cmp
      }
      return 0
    })
  }

  private _extractRelationFields(fields: string[]): string[] {
    const relations: string[] = []
    for (const field of fields) {
      if (field.includes('.')) {
        const relName = field.split('.')[0]
        if (!relations.includes(relName)) {
          relations.push(relName)
        }
      }
    }
    return relations
  }

  private _resolveRelations(
    record: Record<string, unknown>,
    entityKey: string,
    relationFields: string[],
    withDeleted: boolean,
    relPagination?: Record<string, { limit?: number; offset?: number }>,
  ): Record<string, unknown> {
    const result = { ...record }
    const entityRelations = this._relations.get(entityKey)
    if (!entityRelations) return result

    for (const relName of relationFields) {
      const relMeta = entityRelations[relName]
      if (!relMeta) continue

      let related = this._getRelatedRecords(record, entityKey, relName, relMeta, withDeleted)

      // Apply relation pagination
      const relPag = relPagination?.[relName]
      if (relPag) {
        const relOffset = relPag.offset ?? 0
        const relLimit = relPag.limit ?? related.length
        related = related.slice(relOffset, relOffset + relLimit)
      }

      if (relMeta.type === 'hasOne' || relMeta.type === 'hasOneWithFK' || relMeta.type === 'belongsTo') {
        result[relName] = related[0] ?? null
      } else {
        result[relName] = related
      }
    }

    return result
  }

  private _getRelatedRecords(
    record: Record<string, unknown>,
    entityKey: string,
    _relName: string,
    relMeta: RelationMeta,
    withDeleted: boolean,
  ): Record<string, unknown>[] {
    const targetKey = relMeta.target.toLowerCase()
    let targetRecords = [...(this._data.get(targetKey) ?? [])]

    if (!withDeleted) {
      targetRecords = targetRecords.filter((r) => r.deleted_at == null)
    }

    switch (relMeta.type) {
      case 'hasMany': {
        const fk = relMeta.foreignKey ?? `${entityKey}_id`
        return targetRecords.filter((r) => r[fk] === record.id)
      }
      case 'hasOne':
      case 'hasOneWithFK': {
        const fk = relMeta.foreignKey ?? `${entityKey}_id`
        return targetRecords.filter((r) => r[fk] === record.id)
      }
      case 'belongsTo': {
        const fk = relMeta.foreignKey ?? `${targetKey}_id`
        return targetRecords.filter((r) => r.id === record[fk])
      }
      case 'manyToMany': {
        if (!relMeta.pivotEntity) return []
        const pivotKey = relMeta.pivotEntity.toLowerCase()
        const pivotRecords = this._data.get(pivotKey) ?? []
        const leftFk = `${entityKey}_id`
        const rightFk = `${targetKey}_id`
        const matchingPivots = pivotRecords.filter((p) => p[leftFk] === record.id)
        const targetIds = new Set(matchingPivots.map((p) => p[rightFk]))
        return targetRecords.filter((r) => targetIds.has(r.id))
      }
      default:
        return []
    }
  }

  _reset(): void {
    this._data.clear()
    this._relations.clear()
  }
}
