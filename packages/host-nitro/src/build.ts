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
  const { resolve } = await import('node:path')
  const { execSync } = await import('node:child_process')

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
