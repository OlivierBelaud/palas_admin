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
  // Expose Vite port so the catch-all route handler can proxy SPA fallback in dev
  if (allSpas.length > 0) {
    process.env.__MANTA_VITE_PORT = String(allSpas[0].vitePort)
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

  // nitro-dev preset auto-externalizes all node_modules — no manual externals list needed
  const nitro = await createNitro({
    rootDir: cwd,
    dev: true,
    preset: 'nitro-dev',
    scanDirs: [resolve(cwd, '.manta', 'server')],
    ...(Object.keys(devProxy).length > 0 ? { devProxy } : {}),
  })

  const server = createDevServer(nitro)
  const listener = await server.listen({ port, hostname: 'localhost' })

  // SPA fallback: intercept SPA sub-routes (e.g. /admin/paniers) at the raw HTTP
  // level BEFORE Nitro's serveStatic. Proxy to Vite with Accept: text/html so
  // Vite returns index.html for client-side routing.
  // biome-ignore lint/suspicious/noExplicitAny: listhen internal
  const httpServer: import('node:http').Server | undefined = (listener as any)?.node?.server
  if (httpServer && allSpas.length > 0) {
    const spaNames = allSpas.map((s) => s.name)
    const originalListeners = httpServer.listeners('request').slice()
    httpServer.removeAllListeners('request')

    httpServer.on('request', async (req, res) => {
      const url = req.url ?? ''
      const matchedSpa = spaNames.find((name) => url.startsWith(`/${name}/`) || url === `/${name}`)

      // Proxy ALL SPA requests to Vite (HTML pages, .tsx, .js, .css, assets)
      // Only skip /api/* routes which are handled by Nitro
      if (matchedSpa && !url.startsWith('/api/') && req.method === 'GET') {
        const spaVitePort = allSpas.find((s) => s.name === matchedSpa)?.vitePort
        if (spaVitePort) {
          try {
            const isHtmlRoute = !url.match(/\.\w+(\?|$)/)
            const headers: Record<string, string> = isHtmlRoute ? { Accept: 'text/html' } : {}
            const viteRes = await fetch(`http://localhost:${spaVitePort}${url}`, { headers })
            if (viteRes.ok) {
              const contentType = viteRes.headers.get('content-type') ?? 'application/octet-stream'
              const body = Buffer.from(await viteRes.arrayBuffer())
              res.writeHead(200, { 'Content-Type': contentType })
              res.end(body)
              return
            }
          } catch {
            // Vite not ready — fall through to Nitro
          }
        }
      }

      // Also proxy Vite internal paths (HMR, source maps, etc.)
      if (url.startsWith('/@vite/') || url.startsWith('/@fs/') || url.startsWith('/node_modules/.vite/')) {
        const spaVitePort = allSpas[0]?.vitePort
        if (spaVitePort) {
          try {
            const viteRes = await fetch(`http://localhost:${spaVitePort}${url}`)
            if (viteRes.ok) {
              const contentType = viteRes.headers.get('content-type') ?? 'application/javascript'
              const body = Buffer.from(await viteRes.arrayBuffer())
              res.writeHead(200, { 'Content-Type': contentType })
              res.end(body)
              return
            }
          } catch {
            // fall through
          }
        }
      }

      // Fall through to original Nitro handlers
      for (const listener of originalListeners) {
        ;(listener as Function).call(httpServer, req, res)
      }
    })
  }

  // Nitro's dev server always registers an `upgrade` handler (crossws) that routes
  // WebSocket upgrades to the catch-all route handler — which crashes because our
  // handler is HTTP-only. Replace it with a proper WS proxy to Vite for HMR.
  if (httpServer && allSpas.length > 0) {
    httpServer.removeAllListeners('upgrade')
    const { createProxyServer } = await import('httpxy')
    const wsProxy = createProxyServer({ ws: true })
    wsProxy.on('error', () => {}) // swallow — Vite reconnects
    httpServer.on('upgrade', (req, socket, head) => {
      const spa = allSpas.find((s) => req.url?.startsWith(`/${s.name}`))
      const target = `http://localhost:${(spa ?? allSpas[0]).vitePort}`
      // httpxy signature: (req, socket, opts, head?) — target goes in opts.
      // Cast socket: Node's http 'upgrade' event yields a Duplex subtype; net.Socket is the expected type.
      wsProxy.ws(req, socket as unknown as import('node:net').Socket, { target }, head as unknown as undefined)
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
  mkdirSync(resolve(targetDir, 'middleware'), { recursive: true })

  // Copy bootstrap
  copyFileSync(resolve(templatesDir, 'manta-bootstrap.ts'), resolve(targetDir, 'manta-bootstrap.ts'))

  // Copy catch-all route
  copyFileSync(resolve(templatesDir, 'routes', '[...].ts'), resolve(targetDir, 'routes', '[...].ts'))

  // Copy SPA fallback middleware (dev-only: proxies /admin/* to Vite for client-side routing)
  copyFileSync(
    resolve(templatesDir, 'middleware', 'spa-fallback.ts'),
    resolve(targetDir, 'middleware', 'spa-fallback.ts'),
  )

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
