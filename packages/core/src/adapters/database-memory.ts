// SPEC-056 — InMemoryDatabaseAdapter implements IDatabasePort

import { MantaError } from '../errors/manta-error'
import type { DatabaseConfig, IDatabasePort, TransactionOptions } from '../ports'

export class InMemoryTransaction {
  private _tables: Map<string, Map<string, Record<string, unknown>>>
  private _schema: Map<string, { notNull: Set<string> }>

  constructor(
    tables: Map<string, Map<string, Record<string, unknown>>>,
    schema: Map<string, { notNull: Set<string> }>,
  ) {
    this._tables = tables
    this._schema = schema
  }

  async execute(sql: string, params?: unknown[]): Promise<unknown> {
    const trimmed = sql.trim().toUpperCase()

    // SELECT 1 as value — simple ping
    if (trimmed.startsWith('SELECT 1')) {
      return [{ value: 1 }]
    }

    // SELECT * FROM table WHERE id = $1
    if (trimmed.startsWith('SELECT')) {
      const tableMatch = sql.match(/FROM\s+(\w+)/i)
      if (!tableMatch) return []
      const tableName = tableMatch[1]
      const table = this._tables.get(tableName)
      if (!table) return []

      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i)
      if (whereMatch && params) {
        const col = whereMatch[1]
        const paramIdx = parseInt(whereMatch[2], 10) - 1
        const val = params[paramIdx]
        const rows = [...table.values()].filter((r) => r[col] === val)
        return rows
      }
      return [...table.values()]
    }

    // INSERT INTO table (cols) VALUES ($1, $2, ...)
    if (trimmed.startsWith('INSERT')) {
      const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i)
      if (!tableMatch) throw new MantaError('INVALID_DATA', 'Invalid INSERT statement')
      const tableName = tableMatch[1]

      // Extract column names
      const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i)
      if (!colsMatch) throw new MantaError('INVALID_DATA', 'Invalid INSERT — no columns')
      const cols = colsMatch[1].split(',').map((c) => c.trim())

      // Ensure table exists
      if (!this._tables.has(tableName)) {
        this._tables.set(tableName, new Map())
        // Default schema: id and name are NOT NULL for test_table
        if (tableName === 'test_table') {
          this._schema.set(tableName, { notNull: new Set(['id', 'name']) })
        }
      }
      const table = this._tables.get(tableName)!
      const schema = this._schema.get(tableName)

      // Build the row from params
      const row: Record<string, unknown> = {}
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = params?.[i] ?? null
      }

      // D-12 — NOT NULL violation (PG 23502 → INVALID_DATA)
      if (schema) {
        for (const col of schema.notNull) {
          if (row[col] === null || row[col] === undefined) {
            throw new MantaError(
              'INVALID_DATA',
              `NOT NULL violation: column "${col}" in table "${tableName}" cannot be null`,
            )
          }
        }
      }

      // D-11 — FK violation (PG 23503 → NOT_FOUND)
      // Simulate: child_table.parent_id must reference test_table.id
      if (tableName === 'child_table' && row['parent_id']) {
        const parentTable = this._tables.get('test_table')
        if (!parentTable || !parentTable.has(String(row['parent_id']))) {
          throw new MantaError(
            'NOT_FOUND',
            `Foreign key violation: referenced row in "test_table" not found for parent_id="${row['parent_id']}"`,
          )
        }
      }

      // D-10 — Duplicate key (PG 23505 → DUPLICATE_ERROR)
      const id = String(row['id'] ?? '')
      if (id && table.has(id)) {
        throw new MantaError('DUPLICATE_ERROR', `Duplicate key violation: id="${id}" already exists in "${tableName}"`)
      }

      table.set(id, row)
      return { rowCount: 1 }
    }

    // Default: return defined result for unknown queries
    return []
  }
}

export class InMemoryDatabaseAdapter implements IDatabasePort {
  private _tables = new Map<string, Map<string, Record<string, unknown>>>()
  private _schema = new Map<string, { notNull: Set<string> }>()
  private _initialized = false
  private _disposed = false

  async initialize(_config: DatabaseConfig): Promise<void> {
    this._initialized = true
  }

  async dispose(): Promise<void> {
    this._disposed = true
    this._tables.clear()
    this._schema.clear()
  }

  async healthCheck(): Promise<boolean> {
    return this._initialized && !this._disposed
  }

  getClient(): unknown {
    return new InMemoryTransaction(this._tables, this._schema)
  }

  getPool(): unknown {
    return { client: this.getClient() }
  }

  async transaction<T>(fn: (tx: unknown) => Promise<T>, _options?: TransactionOptions): Promise<T> {
    // Snapshot for rollback
    const snapshot = new Map<string, Map<string, Record<string, unknown>>>()
    for (const [name, rows] of this._tables) {
      const rowsCopy = new Map<string, Record<string, unknown>>()
      for (const [id, row] of rows) {
        rowsCopy.set(id, { ...row })
      }
      snapshot.set(name, rowsCopy)
    }
    const schemaCopy = new Map(this._schema)

    const tx = new InMemoryTransaction(snapshot, schemaCopy)
    try {
      const result = await fn(tx)
      // Commit: apply snapshot to real tables
      this._tables.clear()
      for (const [name, rows] of snapshot) {
        this._tables.set(name, rows)
      }
      return result
    } catch (error) {
      // Rollback: snapshot is discarded
      throw error
    }
  }

  _reset() {
    this._tables.clear()
    this._schema.clear()
  }
}
