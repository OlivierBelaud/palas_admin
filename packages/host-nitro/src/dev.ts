// SPEC-039 — Programmatic Nitro dev server for Manta
// Copies framework-owned server templates to .manta/server/
// The dev project has NO server/ directory.

import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface SpaEntry {
  /** SPA name (e.g. 'admin', 'vendor') — served on /{name} */
  name: string
  /** Vite config path for this SPA */
  viteConfigPath: string
  /** Vite dev server port */
  vitePort: number
}

export interface DevServerOptions {
  /** Working directory */
  cwd: string
  /** Dev server port */
  port: number
  /** Vite config path for admin dashboard (starts Vite alongside Nitro) */
  viteConfigPath?: string
  /** Vite dev server port (default: 5199) */
  vitePort?: number
  /** V2: SPAs to serve (generalizes viteConfigPath for N SPAs) */
  spas?: SpaEntry[]
}

export interface DevServerHandle {
  /** Close the dev server and cleanup */
  close(): Promise<void>
  /** The port the server is running on */
  port: number
}

/**
 * Start a Nitro dev server programmatically.
 *
 * Copies framework templates to .manta/server/ then starts Nitro.
 * The dev project has NO server/ directory — this is all framework.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServerHandle> {
  const { cwd, port, viteConfigPath, vitePort = 5199, spas = [] } = options

  // Collect all SPA entries (legacy viteConfigPath + V2 spas)
  const allSpas: SpaEntry[] = [...spas]
  if (viteConfigPath && !allSpas.some((s) => s.name === 'admin')) {
    allSpas.push({ name: 'admin', viteConfigPath, vitePort })
  }

  // Start Vite dev servers for each SPA
  // biome-ignore lint/suspicious/noExplicitAny: child process handles
  const viteProcesses: any[] = []
  for (const spa of allSpas) {
    const proc = await startViteDev(cwd, spa.viteConfigPath, spa.vitePort)
    viteProcesses.push(proc)
  }

  // Copy framework server templates to .manta/server/
  copyServerTemplates(cwd)

  // Build devProxy config for all SPAs
  // Each SPA gets: /{name}, /{name}/, /{name}/** proxied to its Vite dev server
  // Vite internals (/@vite, /@fs, /node_modules/.vite) also proxied for HMR
  // ws: true enables WebSocket upgrade proxying (Vite HMR)
  const devProxy: Record<string, { target: string; ws: true }> = {}
  for (const spa of allSpas) {
    const target = `http://localhost:${spa.vitePort}`
    devProxy[`/${spa.name}/**`] = { target, ws: true }
    devProxy[`/${spa.name}/`] = { target, ws: true }
    devProxy[`/${spa.name}`] = { target, ws: true }
  }
  if (allSpas.length > 0) {
    const target = `http://localhost:${allSpas[0].vitePort}`
    devProxy['/@vite/**'] = { target, ws: true }
    devProxy['/@fs/**'] = { target, ws: true }
    devProxy['/node_modules/.vite/**'] = { target, ws: true }
  }

  // Programmatic Nitro v3 dev server
  const { createNitro, createDevServer, prepare, build } = await import('nitro/builder')

  const nitro = await createNitro({
    rootDir: cwd,
    dev: true,
    preset: 'nitro-dev',
    scanDirs: [resolve(cwd, '.manta', 'server')],
    ...(Object.keys(devProxy).length > 0 ? { devProxy } : {}),
    externals: {
      external: [
        '@manta/core',
        '@manta/cli',
        '@manta/adapter-database-pg',
        '@manta/adapter-logger-pino',
        '@manta/adapter-h3',
        '@manta/host-nitro',
        'postgres',
        'drizzle-orm',
        'drizzle-orm/postgres-js',
        'pino',
        'pino-pretty',
        'jiti',
        'zod',
      ],
    },
  })

  const server = createDevServer(nitro)
  const listener = await server.listen({ port, hostname: 'localhost' })

  // Nitro's dev server always registers an `upgrade` handler (crossws) that routes
  // WebSocket upgrades to the catch-all route handler — which crashes because our
  // handler is HTTP-only. Replace it with a proper WS proxy to Vite for HMR.
  // biome-ignore lint/suspicious/noExplicitAny: listhen internal
  const httpServer: import('node:http').Server | undefined = (listener as any)?.node?.server
  if (httpServer && allSpas.length > 0) {
    httpServer.removeAllListeners('upgrade')
    const { createProxyServer } = await import('httpxy')
    const wsProxy = createProxyServer({ ws: true })
    wsProxy.on('error', () => {}) // swallow — Vite reconnects
    httpServer.on('upgrade', (req, socket, head) => {
      const spa = allSpas.find((s) => req.url?.startsWith(`/${s.name}`))
      const target = `http://localhost:${(spa ?? allSpas[0]).vitePort}`
      wsProxy.ws(req, socket, head, { target })
    })
  }

  await prepare(nitro)
  await build(nitro)

  return {
    port,
    async close() {
      for (const proc of viteProcesses) {
        if (proc) proc.kill()
      }
      await server.close()
      await nitro.close()
    },
  }
}

/**
 * Copy framework server templates from packages/host-nitro/templates/ to .manta/server/
 */
function copyServerTemplates(cwd: string): void {
  const templatesDir = resolve(__dirname, '..', 'templates', 'server')
  const targetDir = resolve(cwd, '.manta', 'server')

  mkdirSync(resolve(targetDir, 'routes'), { recursive: true })

  // Copy bootstrap
  copyFileSync(resolve(templatesDir, 'manta-bootstrap.ts'), resolve(targetDir, 'manta-bootstrap.ts'))

  // Copy catch-all route
  copyFileSync(resolve(templatesDir, 'routes', '[...].ts'), resolve(targetDir, 'routes', '[...].ts'))

  // Copy manta.config.ts so the bootstrap's static import resolves.
  // In dev mode, the manifest doesn't exist → bootstrap falls back to jiti for
  // module loading. But the config import is always static (no jiti needed for config).
  const { existsSync } = require('node:fs') as typeof import('node:fs')
  const configSrc = resolve(cwd, 'manta.config.ts')
  if (existsSync(configSrc)) {
    copyFileSync(configSrc, resolve(targetDir, 'manta.config.ts'))
  }
}

// biome-ignore lint/suspicious/noExplicitAny: child process return
async function startViteDev(cwd: string, viteConfigPath: string, vitePort: number): Promise<any> {
  const { spawn } = await import('node:child_process')

  console.log(`  Starting Vite admin dashboard on port ${vitePort}...`)

  const child = spawn('npx', ['vite', '--config', viteConfigPath, '--port', String(vitePort)], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  })

  child.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[vite] ${msg}`)
  })
  child.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg && !msg.includes('ExperimentalWarning')) console.warn(`[vite] ${msg}`)
  })

  // Wait for Vite to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(`http://localhost:${vitePort}/admin/`)
      if (res.ok) {
        console.log(`  Admin dashboard: http://localhost:${vitePort}/admin/`)
        break
      }
    } catch {
      /* not ready yet */
    }
  }

  return child
}
