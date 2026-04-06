// SPEC-057f — manta db:generate command

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { GenerateDeps } from './types'

export interface GenerateOptions {
  name?: string
}

export interface DmlScanResult {
  entities: Array<{ name: string; file: string }>
  warnings: string[]
}

export interface GenerateCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
  migrationFile?: string
  noChanges?: boolean
  dmlScan?: DmlScanResult
}

/**
 * Scan src/modules/**\/models/*.ts for DML defineModel() calls.
 */
export function scanDmlModels(cwd: string): DmlScanResult {
  const entities: Array<{ name: string; file: string }> = []
  const warnings: string[] = []

  const modulesDir = resolve(cwd, 'src', 'modules')
  if (!existsSync(modulesDir)) {
    return { entities, warnings }
  }

  const moduleEntries = readdirSync(modulesDir, { withFileTypes: true })
  for (const moduleEntry of moduleEntries) {
    if (!moduleEntry.isDirectory()) continue

    const modelsDir = resolve(modulesDir, moduleEntry.name, 'models')
    if (!existsSync(modelsDir)) continue

    const modelFiles = readdirSync(modelsDir, { withFileTypes: true })
    for (const modelFile of modelFiles) {
      if (!modelFile.isFile()) continue
      if (!modelFile.name.endsWith('.ts') && !modelFile.name.endsWith('.js')) continue

      const filePath = join('src', 'modules', moduleEntry.name, 'models', modelFile.name)
      const entityName = modelFile.name.replace(/\.(ts|js)$/, '')
      entities.push({ name: entityName, file: filePath })
    }
  }

  return { entities, warnings }
}

/**
 * Detect potential column renames (same type, drop + add on same table).
 */
export function detectRenames(
  dropped: Array<{ table: string; column: string; type: string }>,
  added: Array<{ table: string; column: string; type: string }>,
): Array<{ table: string; from: string; to: string; type: string }> {
  const candidates: Array<{ table: string; from: string; to: string; type: string }> = []

  for (const drop of dropped) {
    for (const add of added) {
      if (drop.table === add.table && drop.type === add.type) {
        candidates.push({
          table: drop.table,
          from: drop.column,
          to: add.column,
          type: drop.type,
        })
      }
    }
  }

  // Sort by dropped column name (alphabetical)
  return candidates.sort((a, b) => a.from.localeCompare(b.from))
}

/**
 * Check if running in non-interactive mode (CI, piped stdin).
 */
export function isNonInteractive(): boolean {
  if (process.env['CI'] === 'true') return true
  if (process.env['MANTA_NON_INTERACTIVE'] === 'true') return true
  if (typeof process.stdin.isTTY === 'undefined' || !process.stdin.isTTY) return true
  return false
}

/**
 * Detect dangerous changes in migration SQL.
 */
export function detectDangerousChanges(sql: string): string[] {
  const warnings: string[] = []
  const lines = sql.split('\n')

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase()
    if (trimmed.startsWith('DROP COLUMN')) {
      warnings.push(line.trim())
    }
    if (trimmed.startsWith('ALTER') && trimmed.includes('TYPE')) {
      warnings.push(line.trim())
    }
    if (trimmed.startsWith('DROP TABLE')) {
      warnings.push(line.trim())
    }
  }

  return warnings
}

/**
 * manta db:generate — Generate SQL migration files from DML changes.
 * Accepts injectable deps for testability (hexagonal architecture).
 */
export async function generateCommand(
  options: GenerateOptions = {},
  cwd: string = process.cwd(),
  deps: GenerateDeps,
): Promise<GenerateCommandResult> {
  const result: GenerateCommandResult = { exitCode: 0, errors: [], warnings: [] }

  // Step 1: Scan DML models
  const dmlScan = scanDmlModels(cwd)
  result.dmlScan = dmlScan
  result.warnings.push(...dmlScan.warnings)

  if (dmlScan.entities.length === 0) {
    result.warnings.push('No DML entities found in src/modules/**/models/')
    result.noChanges = true
    return result
  }

  // Step 2: Write Drizzle schema from DML entities
  await deps.migrationFs.writeDrizzleSchema(dmlScan.entities)

  // Step 3: Call drizzle-kit generate
  const generateResult = await deps.drizzleKit.generate(dmlScan.entities)

  if (!generateResult.migrationFile || !generateResult.sql) {
    result.noChanges = true
    return result
  }

  result.migrationFile = generateResult.migrationFile

  // Step 4: Detect dangerous changes in generated SQL
  const dangerousWarnings = detectDangerousChanges(generateResult.sql)
  result.warnings.push(...dangerousWarnings)

  // Step 5: Write rollback skeleton
  await deps.migrationFs.writeRollbackSkeleton(generateResult.migrationFile)

  return result
}
