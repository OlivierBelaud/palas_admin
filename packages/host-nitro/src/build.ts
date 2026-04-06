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

  copyFileSync(resolve(templatesDir, 'manta-bootstrap.ts'), resolve(targetDir, 'manta-bootstrap.ts'))
  copyFileSync(resolve(templatesDir, 'routes', '[...].ts'), resolve(routesDir, '[...].ts'))

  // Copy manta.config.ts into .manta/server/ so Nitro bundles it into the serverless function.
  // On Vercel, process.cwd() = /var/task/ (the function directory) and the original config file
  // doesn't exist there. By copying it next to the bootstrap template, the bootstrap can import
  // it via a relative path and Nitro's bundler includes it — preserving runtime process.env refs.
  const configSrc = resolve(cwd, 'manta.config.ts')
  if (existsSync(configSrc)) {
    copyFileSync(configSrc, resolve(targetDir, 'manta.config.ts'))
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
