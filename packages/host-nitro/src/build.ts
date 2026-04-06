// SPEC-039 — Nitro production build for Manta
// Delegates to nitropack build (v2) or nitro build (v3 when stable).

export interface BuildOptions {
  /** Working directory */
  cwd: string
  /** Deployment preset (vercel, node, cloudflare, etc.) */
  preset: string
  /** Output directory (default: .output) */
  outputDir?: string
}

export interface BuildResult {
  /** Output directory path */
  outputDir: string
  /** Preset used */
  preset: string
}

/**
 * Build a Manta project for production using Nitro.
 *
 * Runs `nitropack build` with the specified preset. The resulting output
 * includes the compiled server (catch-all route + Manta bootstrap) and
 * any static assets (admin dashboard).
 *
 * ```ts
 * import { buildForProduction } from '@manta/host-nitro'
 *
 * await buildForProduction({ cwd: '.', preset: 'node' })
 * // .output/server/index.mjs ready to run
 * ```
 */
export async function buildForProduction(options: BuildOptions): Promise<BuildResult> {
  const { cwd, preset, outputDir = '.output' } = options
  const { resolve, dirname } = await import('node:path')
  const { execSync } = await import('node:child_process')
  const { copyFileSync, mkdirSync, existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')

  // Copy framework server templates to .manta/server/ BEFORE running Nitro build.
  // In dev mode, dev.ts handles this. In build mode, we must do it here because
  // nitro.config.ts has `srcDir: '.manta/server'` — without these files, Nitro
  // compiles an empty server with no routes and the deploy 404s on everything.
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const templatesDir = resolve(__dirname, '..', 'templates', 'server')
  const targetDir = resolve(cwd, '.manta', 'server')
  const routesDir = resolve(targetDir, 'routes')

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  if (!existsSync(routesDir)) mkdirSync(routesDir, { recursive: true })

  copyFileSync(resolve(templatesDir, 'routes', '[...].ts'), resolve(routesDir, '[...].ts'))

  // Copy manta.config.ts
  const configSrc = resolve(cwd, 'manta.config.ts')
  if (existsSync(configSrc)) {
    copyFileSync(configSrc, resolve(targetDir, 'manta.config.ts'))
  }

  // Generate a PRODUCTION bootstrap that statically imports the manifest.
  // The dev template uses require('./manifest') which DOES NOT WORK in ESM bundles
  // (require is a CommonJS thing, the Nitro bundle is ESM). The prod bootstrap uses
  // a static `import ... from './manifest'` which Nitro/rolldown traces and bundles.
  //
  // If no manifest.ts exists (non-serverless preset), fall back to the dev template.
  const manifestPath = resolve(targetDir, 'manifest.ts')
  if (existsSync(manifestPath)) {
    const prodBootstrap = `// @ts-nocheck — Auto-generated PRODUCTION bootstrap (manifest with lazy imports)
import { bootstrapApp } from '@manta/cli/bootstrap'
import { loadEnv } from '@manta/cli/env'
import mantaConfigModule from './manta.config'
import { moduleImports, preloadedResources } from './manifest'

let _bootstrapped: any = null

async function bootstrap() {
  if (_bootstrapped) return _bootstrapped
  const cwd = process.cwd()
  loadEnv(cwd)
  const config = mantaConfigModule.default ?? mantaConfigModule

  // Resolve all lazy imports AFTER globals are registered inside bootstrapApp.
  // The lazy imports are () => import('...') functions that only execute when called.
  // bootstrapApp's importFn calls them on demand → user code runs AFTER
  // defineModel/field/etc. are set on globalThis.
  const importFn = async (path: string): Promise<Record<string, unknown>> => {
    const lazyFn = moduleImports[path]
    if (lazyFn) return lazyFn()
    // Fallback: try without/with extension
    const withoutExt = path.replace(/\\.tsx?$/, '')
    for (const [key, fn] of Object.entries(moduleImports)) {
      if (key.replace(/\\.tsx?$/, '') === withoutExt) return fn()
    }
    return {}
  }

  _bootstrapped = await bootstrapApp({
    config,
    cwd,
    mode: 'dev',
    preloadedResources: preloadedResources as any,
    importFn,
  })
  return _bootstrapped
}

const _promise = bootstrap()
export async function getMantaAdapter() { const { adapter } = await _promise; return adapter }
export async function getMantaApp() { const { app } = await _promise; return app }
`
    const { writeFileSync: wfs } = require('node:fs') as typeof import('node:fs')
    wfs(resolve(targetDir, 'manta-bootstrap.ts'), prodBootstrap)
  } else {
    // No manifest → use the dev template (jiti-based runtime discovery)
    copyFileSync(resolve(templatesDir, 'manta-bootstrap.ts'), resolve(targetDir, 'manta-bootstrap.ts'))
  }

  const presetArg = preset === 'node' ? 'node-server' : preset

  execSync(`npx nitro build --preset ${presetArg}`, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  })

  return {
    outputDir: resolve(cwd, outputDir),
    preset,
  }
}
