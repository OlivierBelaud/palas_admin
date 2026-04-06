// manta generate — Lightweight type generation without starting the server.
// Used by postinstall to ensure types exist after `pnpm install`.
// Also used by `manta dev` (which calls generateTypesFromModules directly).

import { generateTypesFromModules } from '../bootstrap/generate-types'

export interface GenerateCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
}

/**
 * manta generate — Generate .manta/generated.d.ts from discovered modules, commands, and subscribers.
 * No server boot, no DB connection. Pure static analysis + dynamic import of DML entities.
 */
export async function generateCommand(cwd: string = process.cwd()): Promise<GenerateCommandResult> {
  const result: GenerateCommandResult = { exitCode: 0, errors: [], warnings: [] }

  try {
    await generateTypesFromModules(cwd)
  } catch (err) {
    result.warnings.push(`Type generation failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}
