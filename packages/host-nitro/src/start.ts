// SPEC-039 — Start production Nitro output
// Runs the compiled .output/server/index.mjs from a Nitro build.

export interface StartOptions {
  /** Output directory (default: .output) */
  outputDir?: string
  /** Port override (if supported by the preset) */
  port?: number
}

export interface StartHandle {
  /** Close the production server */
  close(): Promise<void>
}

/**
 * Start a production server from Nitro build output.
 *
 * ```ts
 * import { startProduction } from '@manta/host-nitro'
 *
 * await startProduction({ outputDir: '.output' })
 * ```
 */
export async function startProduction(options: StartOptions = {}): Promise<StartHandle> {
  const { outputDir = '.output', port } = options
  const { resolve } = await import('node:path')
  const { existsSync } = await import('node:fs')
  const { spawn } = await import('node:child_process')

  const entryPath = resolve(outputDir, 'server', 'index.mjs')
  if (!existsSync(entryPath)) {
    throw new Error(`Production build not found at ${entryPath}. Run 'manta build' first.`)
  }

  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  if (port) {
    env.PORT = String(port)
    env.NITRO_PORT = String(port)
  }

  const child = spawn('node', [entryPath], {
    stdio: 'inherit',
    env,
  })

  return {
    async close() {
      child.kill()
    },
  }
}
