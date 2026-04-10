// next.config wrapper for Manta-powered Next.js projects.
//
// Usage:
//   // next.config.ts
//   import { withManta } from '@manta/adapter-nextjs'
//   export default withManta({})
//
// Responsibilities:
//  - transpilePackages: all @manta/* workspace packages (they ship as raw TS)
//  - serverExternalPackages: native/CJS deps that Next shouldn't try to bundle
//
// Unlike host-nitro, we do NOT need to proxy /admin/* to a separate Vite dev server.
// The admin dashboard is a React component (MantaDashboard from @manta/dashboard) that
// Next bundles and serves directly via the /admin page. HMR in dev comes from Next's
// own Fast Refresh. Prod builds bundle it into the main app. One less moving part.
//
// We merge with any user-provided config rather than replace it.

// biome-ignore lint/suspicious/noExplicitAny: NextConfig types are not importable without peer dep
type NextConfig = any

const MANTA_WORKSPACE_PACKAGES = [
  '@manta/core',
  '@manta/cli',
  '@manta/sdk',
  '@manta/ui',
  '@manta/dashboard',
  '@manta/dashboard-core',
  '@manta/adapter-nextjs',
  '@manta/adapter-h3',
  '@manta/adapter-database-pg',
  '@manta/adapter-database-neon',
  '@manta/adapter-logger-pino',
]

const SERVER_EXTERNAL_PACKAGES = ['postgres', 'pino', 'pino-pretty', 'drizzle-orm', '@neondatabase/serverless', 'jiti']

export function withManta(nextConfig: NextConfig = {}): NextConfig {
  const userTranspile: string[] = Array.isArray(nextConfig.transpilePackages) ? nextConfig.transpilePackages : []
  const userExternals: string[] = Array.isArray(nextConfig.serverExternalPackages)
    ? nextConfig.serverExternalPackages
    : []

  return {
    ...nextConfig,
    transpilePackages: Array.from(new Set([...userTranspile, ...MANTA_WORKSPACE_PACKAGES])),
    serverExternalPackages: Array.from(new Set([...userExternals, ...SERVER_EXTERNAL_PACKAGES])),
  }
}
