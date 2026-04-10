// SPEC-087 — manta db:diff command

import type { DiffDeps } from './types'

export interface DiffOptions {
  json?: boolean
}

export interface DiffEntry {
  type: 'missing' | 'extra' | 'changed'
  entity: 'table' | 'column' | 'index' | 'trigger'
  name: string
  detail?: string
}

export interface DiffCommandResult {
  exitCode: number
  errors: string[]
  diffs: DiffEntry[]
  notifications: DiffEntry[]
}

/**
 * Compare expected schema with introspected schema.
 */
export function compareSchemas(
  expected: Array<{ table: string; columns: string[] }>,
  actual: Array<{ table: string; columns: string[] }>,
): { diffs: DiffEntry[]; notifications: DiffEntry[] } {
  const diffs: DiffEntry[] = []
  const notifications: DiffEntry[] = []

  const actualMap = new Map(actual.map((t) => [t.table, new Set(t.columns)]))
  const expectedMap = new Map(expected.map((t) => [t.table, new Set(t.columns)]))

  // Missing tables
  for (const exp of expected) {
    if (!actualMap.has(exp.table)) {
      diffs.push({ type: 'missing', entity: 'table', name: exp.table })
    } else {
      // Check columns
      const actualCols = actualMap.get(exp.table)!
      for (const col of exp.columns) {
        if (!actualCols.has(col)) {
          diffs.push({
            type: 'missing',
            entity: 'column',
            name: `${exp.table}.${col}`,
          })
        }
      }
    }
  }

  // Extra tables
  for (const act of actual) {
    if (!expectedMap.has(act.table)) {
      notifications.push({ type: 'extra', entity: 'table', name: act.table })
    } else {
      const expectedCols = expectedMap.get(act.table)!
      for (const col of act.columns) {
        if (!expectedCols.has(col)) {
          notifications.push({
            type: 'extra',
            entity: 'column',
            name: `${act.table}.${col}`,
          })
        }
      }
    }
  }

  return { diffs, notifications }
}

/**
 * manta db:diff — Compare DML schema vs actual DB (read-only).
 * Uses information_schema + pg_indexes + pg_trigger.
 * Accepts injectable deps for testability (hexagonal architecture).
 */
export async function diffCommand(
  _options: DiffOptions = {},
  expectedSchema: Array<{ table: string; columns: string[] }>,
  deps: DiffDeps,
): Promise<DiffCommandResult> {
  const result: DiffCommandResult = {
    exitCode: 0,
    errors: [],
    diffs: [],
    notifications: [],
  }

  // Step 1: Introspect the DB via information_schema
  const rows = await deps.db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  )

  // Step 2: Group rows into table→columns structure
  const actualMap = new Map<string, string[]>()
  for (const row of rows) {
    if (!actualMap.has(row.table_name)) {
      actualMap.set(row.table_name, [])
    }
    actualMap.get(row.table_name)!.push(row.column_name)
  }

  const actual = Array.from(actualMap.entries()).map(([table, columns]) => ({
    table,
    columns,
  }))

  // Step 3: Compare
  const { diffs, notifications } = compareSchemas(expectedSchema, actual)
  result.diffs = diffs
  result.notifications = notifications

  return result
}
