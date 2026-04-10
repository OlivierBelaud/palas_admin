// Lazy singleton bootstrap for Manta inside a Next.js process.
//
// Mirrors packages/host-nitro/templates/server/manta-bootstrap.ts, but:
//  - runs in-process inside Next.js route handlers (no template copy to .manta/server)
//  - skips jiti: loadConfig() from @manta/cli already handles TS config loading via native dynamic import()
//  - honours MANTA_CWD for cases where Next runs handlers from a different working dir
//    (e.g. .next/server/...) and filesystem scans would otherwise break
//  - imports from @manta/cli SUBPATHS (/bootstrap, /config, /env) rather than the barrel,
//    so webpack never traverses the CLI command files that pull in host-nitro → nitro → rollup → fsevents
//
// The bootstrap runs ONCE per Node process. All route handlers share the same app + adapter.
// This is the exact same pattern host-nitro uses in serverless mode.

import type { BootstrappedApp } from '@manta/cli/bootstrap'

let _bootstrapped: Promise<BootstrappedApp> | null = null

async function bootstrap(): Promise<BootstrappedApp> {
  const cwd = process.env.MANTA_CWD ?? process.cwd()

  // Defer @manta/cli imports until first request so Next's module graph doesn't
  // try to bundle CLI-only code into the client. We import specific subpaths
  // to avoid the main barrel (which pulls in dev/build commands → host-nitro).
  const [{ bootstrapApp }, { loadConfig }, { loadEnv }, jitiModule] = await Promise.all([
    import('@manta/cli/bootstrap'),
    import('@manta/cli/config'),
    import('@manta/cli/env'),
    import('jiti'),
  ])

  loadEnv(cwd)

  // Next's webpack server compilation cannot runtime-load arbitrary .ts files
  // (manta.config.ts, src/modules/**, etc.) — it only compiles files in its
  // own module graph. We sidestep this by using jiti, which transpiles + caches
  // TS on the fly. Both loadConfig and bootstrapApp accept a custom importer.
  const createJiti = jitiModule.createJiti ?? jitiModule.default
  const jiti = createJiti(cwd, { interopDefault: true })
  // biome-ignore lint/suspicious/noExplicitAny: jiti.import returns unknown module shape
  const importFn = (path: string) => jiti.import(path) as Promise<any>

  const config = await loadConfig(cwd, { importFn })

  const mode = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
  return bootstrapApp({ config, cwd, mode, importFn })
}

function ensureBootstrap(): Promise<BootstrappedApp> {
  if (!_bootstrapped) {
    _bootstrapped = bootstrap()
  }
  return _bootstrapped
}

/**
 * Get the Manta HTTP adapter. All route handlers registered at boot are reachable
 * via `adapter.handleRequest(req)`.
 */
export async function getMantaAdapter() {
  const { adapter } = await ensureBootstrap()
  return adapter
}

/**
 * Get the fully initialised Manta app (services, query graph, event bus, etc.).
 * Useful for React Server Components that want to bypass HTTP and call services directly.
 */
export async function getMantaApp() {
  const { app } = await ensureBootstrap()
  return app
}
