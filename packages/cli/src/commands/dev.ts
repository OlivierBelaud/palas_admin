// SPEC-070 — manta dev command
// Starts the Nitro dev server.

import { loadConfig, validateConfigForCommand } from '../config/load-config'
import { loadEnv } from '../config/load-env'
import type { DevOptions, LoadedConfig } from '../types'

export type { MantaRequest } from '../server-bootstrap'

export interface DevCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
}

/**
 * manta dev — Start Nitro dev server.
 */
export async function devCommand(options: DevOptions = {}, cwd: string = process.cwd()): Promise<DevCommandResult> {
  const result: DevCommandResult = { exitCode: 0, errors: [], warnings: [] }

  // [1] Load .env
  const envResult = loadEnv(cwd)
  result.warnings.push(...envResult.warnings)

  // [2] Load config
  let config: LoadedConfig
  try {
    config = await loadConfig(cwd)
  } catch (err) {
    result.exitCode = 1
    result.errors.push(err instanceof Error ? err.message : String(err))
    return result
  }

  // [3] Validate
  const validationErrors = validateConfigForCommand(config, 'dev')
  if (validationErrors.length > 0) {
    result.exitCode = 1
    result.errors.push(...validationErrors)
    return result
  }

  const port = options.port ?? (Number(process.env.PORT) || undefined) ?? config.http?.port ?? 3000

  // [4] Legacy src/admin/ removed — V2 uses src/spa/{name}/ exclusively
  const viteConfigPath: string | undefined = undefined

  // [5] Generate .manta/generated.d.ts (codegen for typed step proxy)
  try {
    const { generateTypesFromModules } = await import('../bootstrap/generate-types')
    await generateTypesFromModules(cwd)
  } catch (err) {
    result.warnings.push(`Types generation failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // [5b] Auto-detect SPAs from src/spa/{name}/ + merge defaults with config overrides
  const spaEntries: Array<{ name: string; viteConfigPath: string; vitePort: number }> = []
  {
    const { discoverResources } = await import('../resource-loader')
    const resources = await discoverResources(cwd)

    if (resources.spas.length > 0) {
      const { generateSpaArtifacts } = await import('../spa/generate-spa')
      const { SPA_DEFAULTS } = await import('@manta/core')
      const configOverrides = config.spa ?? {}
      let nextPort = 5200

      for (const spa of resources.spas) {
        const override = configOverrides[spa.name] ?? {}
        const dashboard = override.dashboard === null ? undefined : (override.dashboard ?? SPA_DEFAULTS.dashboard)
        const preset = override.preset === null ? undefined : (override.preset ?? SPA_DEFAULTS.preset)

        const viteConfig = generateSpaArtifacts({ cwd, spa, dashboard, preset, port })
        spaEntries.push({ name: spa.name, viteConfigPath: viteConfig, vitePort: nextPort++ })
        console.log(
          `  SPA: /${spa.name} (${spa.pages.length} pages${dashboard ? `, ${dashboard}` : ', custom'}${preset ? ` + ${preset}` : ''})`,
        )
      }
    }
  }

  // [6] Launch dev server via @manta/host-nitro
  console.log(`\n  Starting Manta dev server on port ${port}...`)
  console.log(`  Nitro\n`)

  const { startDevServer } = await import('@manta/host-nitro')
  const server = await startDevServer({ cwd, port, viteConfigPath, spas: spaEntries })

  // Block until process exits (or server is closed)
  await new Promise<void>((resolve) => {
    process.on('SIGINT', async () => {
      await server.close()
      resolve()
    })
    process.on('SIGTERM', async () => {
      await server.close()
      resolve()
    })
  })

  return result
}
