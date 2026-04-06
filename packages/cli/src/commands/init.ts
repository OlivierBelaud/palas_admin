// SPEC-070 — manta init command

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MantaError } from '@manta/core/errors'
import type { InitOptions, InitPreset } from '../types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ESM-safe require (this file is ESM; bare `require` is undefined here).
const localRequire = createRequire(import.meta.url)

export interface InitCommandResult {
  exitCode: number
  created: string[]
  skipped: string[]
  warnings: string[]
}

const COMMON_SRC_DIRS = [
  'src/modules',
  'src/commands',
  'src/queries',
  'src/subscribers',
  'src/jobs',
  'src/links',
  'src/agents',
  'src/middleware',
]

const NEXT_EXTRA_DIRS = ['src/spa/admin/pages', 'app', 'app/api', 'app/admin', 'lib']

function getDirsToCreate(preset: InitPreset): string[] {
  if (preset === 'next') return [...COMMON_SRC_DIRS, ...NEXT_EXTRA_DIRS]
  return COMMON_SRC_DIRS
}

/**
 * manta init — Initialize a new Manta project.
 * Scaffolds a complete, functional project with Nitro host and admin dashboard.
 * Never destroys existing files. Skips files that already exist.
 */
export async function initCommand(options: InitOptions = {}): Promise<InitCommandResult> {
  const dir = resolve(options.dir ?? process.cwd())
  const preset: InitPreset = options.preset ?? 'nitro'
  const result: InitCommandResult = { exitCode: 0, created: [], skipped: [], warnings: [] }

  // Safety: refuse to scaffold into a workspace root. `pnpm exec` (and similar) rewrite
  // process.cwd() to the nearest workspace root, which previously caused `manta init`
  // run from an empty subdir to dump files into the monorepo root. An explicit --dir
  // is the escape hatch for the rare legitimate "init at workspace root" case.
  if (options.dir === undefined && isWorkspaceRoot(dir)) {
    throw new MantaError(
      'INVALID_DATA',
      `Refusing to init inside a workspace root (${dir}). ` +
        'This is usually caused by running `manta init` through `pnpm exec` / `yarn`, ' +
        'which rewrite cwd to the workspace root. ' +
        'Pass --dir <path> explicitly, or run `manta init` from inside the target project folder.',
    )
  }

  // Create directories (idempotent) — preset-specific list
  for (const d of getDirsToCreate(preset)) {
    mkdirSync(resolve(dir, d), { recursive: true })
  }

  // Generate files (only if they don't exist)
  const projectName = basename(dir)
  const files = preset === 'next' ? getNextTemplateFiles(projectName) : getTemplateFiles(projectName)

  // Try to copy AGENT.md from @manta/core/docs/ (preset-aware)
  const agentMd = resolveAgentMd(preset)
  if (agentMd) {
    files['AGENT.md'] = agentMd
  } else {
    result.warnings.push('Could not find AGENT.md template in @manta/core/docs/. Install @manta/core first.')
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = resolve(dir, filename)
    // Ensure parent directory exists for nested files
    const parentDir = dirname(filePath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }
    if (existsSync(filePath)) {
      result.skipped.push(filename)
    } else {
      writeFileSync(filePath, content)
      result.created.push(filename)
    }
  }

  return result
}

/**
 * Resolve AGENT.md for the requested preset.
 *
 * Strategy: always start from the canonical body (`@manta/core/docs/AGENT.md`) and,
 * when the preset needs extra guidance (e.g. Next hosting model), prepend a small
 * preset-specific header from `packages/cli/src/templates/agent/{preset}.md`. This
 * keeps a single source of truth for primitives and avoids drift between preset
 * variants.
 */
function resolveAgentMd(preset: InitPreset = 'nitro'): string | null {
  const canonicalBody = loadCanonicalAgentMd()
  if (!canonicalBody) return null

  if (preset === 'nitro') {
    return canonicalBody
  }

  // preset === 'next' — prepend the Next-specific header if we can find it
  const headerPath = resolve(__dirname, '..', 'templates', 'agent', 'nextjs.md')
  if (existsSync(headerPath)) {
    const header = readFileSync(headerPath, 'utf-8').trimEnd()
    return `${header}\n\n---\n\n${canonicalBody}`
  }

  // No header available → return canonical body on its own rather than fail
  return canonicalBody
}

/**
 * Load the canonical AGENT.md body (preset-independent).
 * Same resolution chain as before: workspace @manta/core package.json → walk-up fallback → bundled template.
 */
function loadCanonicalAgentMd(): string | null {
  // Strategy 1: resolve @manta/core package.json via createRequire (ESM-safe).
  // Requires that @manta/core's package.json exposes "./package.json" in its exports.
  try {
    const corePkg = localRequire.resolve('@manta/core/package.json')
    const agentPath = resolve(dirname(corePkg), 'docs', 'AGENT.md')
    if (existsSync(agentPath)) {
      return readFileSync(agentPath, 'utf-8')
    }
  } catch {
    // @manta/core not installed or package.json not exposed — fall through
  }

  // Strategy 2: resolve @manta/core entry point, then walk up to package root.
  // Robust even if the package doesn't expose "./package.json" in exports.
  try {
    const coreEntry = localRequire.resolve('@manta/core')
    let cur = dirname(coreEntry)
    for (let i = 0; i < 6; i++) {
      if (existsSync(resolve(cur, 'package.json'))) {
        const agentPath = resolve(cur, 'docs', 'AGENT.md')
        if (existsSync(agentPath)) {
          return readFileSync(agentPath, 'utf-8')
        }
        break
      }
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  } catch {
    // fall through
  }

  // Strategy 3: bundled fallback template shipped with the CLI.
  // Kept in sync with @manta/core/docs/AGENT.md (copied at release time).
  const fallbackPath = resolve(__dirname, '..', 'templates', 'agent', 'standalone.md')
  if (existsSync(fallbackPath)) {
    return readFileSync(fallbackPath, 'utf-8')
  }

  return null
}

/**
 * Detect whether `dir` is a workspace root (pnpm, yarn, npm workspaces).
 * Used by `manta init` to refuse accidental scaffolding at the monorepo root.
 */
function isWorkspaceRoot(dir: string): boolean {
  if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return true
  const pkgPath = resolve(dir, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { workspaces?: unknown }
    return pkg.workspaces !== undefined
  } catch {
    return false
  }
}

function getTemplateFiles(projectName: string): Record<string, string> {
  const dbName = projectName.replace(/[^a-z0-9_]/g, '_')
  return {
    'manta.config.ts': `import { defineConfig } from '@manta/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL!,
  },
  http: {
    port: Number(process.env.PORT) || 9000,
  },
})
`,
    'nitro.config.ts': `import { existsSync } from 'node:fs'

const adminBuildExists = existsSync('./public/admin')

export default {
  compatibilityDate: '2025-01-01',
  srcDir: '.manta/server',
  publicAssets: adminBuildExists
    ? [{ dir: 'public/admin', baseURL: '/admin' }]
    : [],
  externals: {
    inline: [
      '@manta/core', '@manta/cli', '@manta/adapter-h3',
      '@manta/adapter-database-pg', '@manta/adapter-logger-pino',
      '@manta/host-nitro',
    ],
  },
}
`,
    '.env': `DATABASE_URL=postgresql://localhost:5432/${dbName}
PORT=9000
# JWT_SECRET=change-me-in-production
# ANTHROPIC_API_KEY=
`,
    '.env.example': `DATABASE_URL=postgresql://localhost:5432/${dbName}
PORT=9000
# JWT_SECRET=change-me-in-production
# ANTHROPIC_API_KEY=
`,
    'package.json':
      JSON.stringify(
        {
          name: projectName,
          version: '0.1.0',
          type: 'module',
          scripts: {
            dev: 'manta dev',
            build: 'manta build --preset vercel',
            start: 'manta start',
            generate: 'manta generate',
            'db:generate': 'manta db:generate',
            'db:migrate': 'manta db:migrate',
          },
          dependencies: {
            '@manta/core': 'workspace:*',
            '@manta/cli': 'workspace:*',
            '@manta/host-nitro': 'workspace:*',
            '@manta/adapter-h3': 'workspace:*',
            '@manta/adapter-database-pg': 'workspace:*',
            '@manta/adapter-logger-pino': 'workspace:*',
            '@manta/dashboard': 'workspace:*',
            '@manta/dashboard-core': 'workspace:*',
            '@manta/ui': 'workspace:*',
            '@manta/sdk': 'workspace:*',
            zod: '^3.23.0',
          },
        },
        null,
        2,
      ) + '\n',
    'tsconfig.json':
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            jsx: 'react-jsx',
            outDir: 'dist',
            rootDir: '.',
          },
          include: ['src/**/*.ts', 'src/**/*.tsx', '.manta/generated.d.ts', 'manta.config.ts'],
          exclude: ['node_modules', 'tests'],
        },
        null,
        2,
      ) + '\n',
    '.gitignore': `node_modules/
.manta/
dist/
.output/
public/
.env
`,
    '.manta/generated.d.ts': `// Auto-generated by Manta — provides global types for defineModel, field, etc.
// This file is regenerated on \`manta dev\` or \`manta generate\`.
// Do NOT edit manually.

/// <reference types="@manta/core/src/globals" />

export {}
`,
  }
}

/**
 * Next.js preset — scaffolds a Next App Router project with Manta mounted inline.
 *
 * Key differences vs the Nitro preset:
 *  - No nitro.config.ts — Next owns the HTTP server.
 *  - No separate Vite dev server — @manta/dashboard is bundled directly by Next via
 *    transpilePackages configured in withManta().
 *  - /api/[...manta]/route.ts catch-all forwards every HTTP method to Manta.
 *  - /admin/[[...slug]]/page.tsx mounts MantaDashboard as a client component.
 */
function getNextTemplateFiles(projectName: string): Record<string, string> {
  const dbName = projectName.replace(/[^a-z0-9_]/g, '_')
  return {
    'manta.config.ts': `import { defineConfig } from '@manta/core'

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL!,
  },
  http: {
    port: Number(process.env.PORT) || 3000,
  },
})
`,
    'next.config.ts': `import { withManta } from '@manta/adapter-nextjs'

export default withManta({})
`,
    '.env': `DATABASE_URL=postgresql://localhost:5432/${dbName}
PORT=3000
# JWT_SECRET=change-me-in-production
# ANTHROPIC_API_KEY=
`,
    '.env.example': `DATABASE_URL=postgresql://localhost:5432/${dbName}
PORT=3000
# JWT_SECRET=change-me-in-production
# ANTHROPIC_API_KEY=
`,
    'package.json': `${JSON.stringify(
      {
        name: projectName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          generate: 'manta generate',
          'db:generate': 'manta db:generate',
          'db:migrate': 'manta db:migrate',
        },
        dependencies: {
          '@manta/core': 'workspace:*',
          '@manta/cli': 'workspace:*',
          '@manta/adapter-nextjs': 'workspace:*',
          '@manta/adapter-database-pg': 'workspace:*',
          '@manta/adapter-logger-pino': 'workspace:*',
          '@manta/dashboard': 'workspace:*',
          '@manta/dashboard-core': 'workspace:*',
          '@manta/ui': 'workspace:*',
          '@manta/sdk': 'workspace:*',
          next: '^15.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          zod: '^3.23.0',
        },
        devDependencies: {
          '@tailwindcss/postcss': '^4.0.0',
          '@types/node': '^22.0.0',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          postcss: '^8.4.0',
          tailwindcss: '^4.0.0',
          typescript: '^5.6.0',
        },
      },
      null,
      2,
    )}\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'esnext'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          allowJs: true,
          noEmit: true,
          jsx: 'preserve',
          incremental: true,
          resolveJsonModule: true,
          isolatedModules: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.manta/generated.d.ts'],
        exclude: ['node_modules'],
      },
      null,
      2,
    )}\n`,
    '.gitignore': `node_modules/
.manta/
.next/
next-env.d.ts
dist/
.output/
.env
`,
    '.manta/generated.d.ts': `// Auto-generated by Manta — provides global types for defineModel, field, etc.
// This file is regenerated on \`manta generate\` (or manually via \`pnpm generate\`).
// Do NOT edit manually.

/// <reference types="@manta/core/src/globals" />

export {}
`,
    'postcss.config.mjs': `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
`,
    'app/globals.css': `@import 'tailwindcss';

/* Dashboard theme — single source of truth for colors, radii, shadows, @theme inline.
   Already contains @source directives scanning dashboard-core, ui, and dashboard source
   files, so utility class usage across the workspace is picked up automatically. */
@import '@manta/dashboard-core/src/index.css';
`,
    'app/layout.tsx': `import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: '${projectName}',
  description: 'Manta + Next.js app',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
    'app/page.tsx': `export default function Home() {
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>${projectName}</h1>
      <p>Manta + Next.js is running.</p>
      <ul>
        <li><a href="/admin">/admin</a> — Manta dashboard</li>
        <li><a href="/api/openapi.json">/api/openapi.json</a> — OpenAPI spec</li>
      </ul>
    </main>
  )
}
`,
    'app/api/[...manta]/route.ts': `// Catch-all route: forward every HTTP method to Manta.
// See @manta/adapter-nextjs/handler for implementation.
export { GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD } from '@manta/adapter-nextjs/handler'
`,
    'app/admin/[[...slug]]/page.tsx': `'use client'

// Manta admin dashboard — loaded dynamically (client-only).
// The [[...slug]] catch-all hands every /admin/* path to react-router inside MantaDashboard.
//
// Why spaConfig is required:
//  MantaDashboard gates its "loading" state on (registry fetched OR spaConfig provided).
//  The registry endpoint is auth-protected, so without spaConfig the dashboard would spin
//  forever (registry fetch skipped while unauthenticated → login never shown). Passing
//  spaConfig flips hasStaticConfig=true and lets the login screen render immediately.
//
// Why apiUrl is empty:
//  Same-origin fetches like \`/api/admin/login\` are relative and resolve against the current
//  page's origin. Passing '' avoids a hydration mismatch from reading window.location.origin
//  only on the client.

import dynamic from 'next/dynamic'
import spaConfig from '@/src/spa/admin/config'

const Dashboard = dynamic(
  () => import('@manta/dashboard').then((m) => ({ default: m.MantaDashboard })),
  { ssr: false, loading: () => <div style={{ padding: 32 }}>Loading admin…</div> },
)

export default function MantaAdminPage() {
  return <Dashboard apiUrl="" basename="/admin" spaConfig={spaConfig} />
}
`,
    'src/modules/admin/entities/admin/model.ts': `// Admin user — triggers Manta's auth routes (/api/admin/login, /me, CRUD, invite)
// and seeds \`admin@manta.local\` / \`admin\` automatically in dev mode.
export default defineUserModel('admin', {
  role: field.enum(['super_admin', 'editor', 'viewer']).default('super_admin'),
})
`,
    'src/spa/admin/config.ts': `import { defineSpa } from '@manta/dashboard-core'

// SPA config for the admin dashboard.
// Passed to <MantaDashboard spaConfig={...}/> in app/admin/[[...slug]]/page.tsx.
// Controls title, navigation, AI features. Extend navigation as you add modules.
export default defineSpa({
  title: '${projectName} Admin',
  navigation: [],
  ai: false,
})
`,
  }
}
