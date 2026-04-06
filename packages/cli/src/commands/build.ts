// SPEC-074, SPEC-100 — manta build command

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type {
  BuildOptions,
  ManifestJobEntry,
  ManifestLinkEntry,
  ManifestModuleEntry,
  ManifestRouteEntry,
  ManifestSubscriberEntry,
  ManifestWorkflowEntry,
} from '../types'

const VALID_PRESETS = ['node', 'vercel', 'aws-lambda', 'cloudflare', 'bun']

export interface BuildCommandResult {
  exitCode: number
  errors: string[]
  warnings: string[]
  manifest?: {
    routes: ManifestRouteEntry[]
    subscribers: ManifestSubscriberEntry[]
    workflows: ManifestWorkflowEntry[]
    jobs: ManifestJobEntry[]
    links: ManifestLinkEntry[]
    modules: ManifestModuleEntry[]
  }
}

/**
 * manta build — Build the project for deployment.
 * Does NOT connect to DB. Does NOT validate secrets.
 * Generates manifest in .manta/manifest/ then runs Nitro build.
 */
export async function buildCommand(
  options: BuildOptions = {},
  cwd: string = process.cwd(),
): Promise<BuildCommandResult> {
  const result: BuildCommandResult = { exitCode: 0, errors: [], warnings: [] }
  const preset = options.preset ?? 'node'

  // Validate preset
  if (!VALID_PRESETS.includes(preset)) {
    result.exitCode = 1
    result.errors.push(`Unknown preset '${preset}'. Available presets: ${VALID_PRESETS.join(', ')}`)
    return result
  }

  // Scan filesystem and generate manifest
  const manifestDir = resolve(cwd, '.manta', 'manifest')
  mkdirSync(manifestDir, { recursive: true })

  const routes = scanRoutes(cwd)
  const subscribers = scanSubscribers(cwd)
  const workflows = scanWorkflows(cwd)
  const jobs = scanJobs(cwd)
  const links = scanLinks(cwd)
  const modules = scanModules(cwd)

  // Write manifest files
  writeFileSync(join(manifestDir, 'routes.json'), JSON.stringify({ routes }, null, 2))
  writeFileSync(join(manifestDir, 'subscribers.json'), JSON.stringify({ subscribers }, null, 2))
  writeFileSync(join(manifestDir, 'workflows.json'), JSON.stringify({ workflows }, null, 2))
  writeFileSync(join(manifestDir, 'jobs.json'), JSON.stringify({ jobs }, null, 2))
  writeFileSync(join(manifestDir, 'links.json'), JSON.stringify({ links }, null, 2))
  writeFileSync(join(manifestDir, 'modules.json'), JSON.stringify({ modules }, null, 2))

  result.manifest = { routes, subscribers, workflows, jobs, links, modules }

  // Auto-detect SPAs from src/spa/{name}/ + merge defaults with config overrides
  const { discoverResources } = await import('../resource-loader')
  const resources = await discoverResources(cwd)

  // Load config for SPA overrides (optional)
  let spaOverrides: Record<string, { dashboard?: string | null; preset?: string | null }> = {}
  try {
    const { loadConfig } = await import('../config/load-config')
    const loadedConfig = await loadConfig(cwd)
    spaOverrides = (loadedConfig as { spa?: typeof spaOverrides }).spa ?? {}
  } catch {
    // No config — use defaults
  }

  if (resources.spas.length > 0) {
    const { generateSpaArtifacts } = await import('../spa/generate-spa')
    const { SPA_DEFAULTS } = await import('@manta/core')

    for (const spa of resources.spas) {
      const override = spaOverrides[spa.name] ?? {}
      const dashboard = override.dashboard === null ? undefined : (override.dashboard ?? SPA_DEFAULTS.dashboard)
      const presetPkg = override.preset === null ? undefined : (override.preset ?? SPA_DEFAULTS.preset)

      console.log(`  Building SPA: ${spa.name} (${spa.pages.length} pages)...`)
      try {
        const viteConfig = generateSpaArtifacts({
          cwd,
          spa,
          dashboard,
          preset: presetPkg,
        })
        const { spawnSync } = await import('node:child_process')
        const spaOutDir = resolve(cwd, 'public', spa.name)
        const buildResult = spawnSync('npx', ['vite', 'build', '--config', viteConfig, '--outDir', spaOutDir], {
          cwd,
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: 'production' },
        })
        if (buildResult.status !== 0) {
          throw new Error(`Vite build for SPA "${spa.name}" exited with code ${buildResult.status}`)
        }
        console.log(`  ✓ SPA "${spa.name}" built`)
      } catch (err) {
        result.warnings.push(`Failed to build SPA "${spa.name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Generate vercel.json for Vercel preset
  if (preset === 'vercel') {
    generateVercelConfig(cwd, jobs)
  }

  // Delegate to Nitro build via @manta/host-nitro (only if nitro.config.ts exists)
  const nitroConfigPath = join(cwd, 'nitro.config.ts')
  if (existsSync(nitroConfigPath)) {
    console.log(`\n  Building for preset: ${preset}...`)
    try {
      const { buildForProduction } = await import('@manta/host-nitro')
      await buildForProduction({ cwd, preset })
      console.log('  ✓ Nitro build complete')

      // Patch Vercel config.json to add SPA rewrite for /admin/* → /admin/index.html.
      // Nitro's Build Output API generates config.json with routes that bypass vercel.json
      // rewrites entirely. Without this patch, /admin falls through to the serverless
      // catch-all and 404s because Nitro has no handler for it (the SPA is static).
      if (preset === 'vercel') {
        const configPath = join(cwd, '.vercel', 'output', 'config.json')
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, 'utf-8'))
          const routes: Array<Record<string, unknown>> = config.routes ?? []
          // Insert the SPA fallback AFTER 'handle: filesystem' so that
          // /admin/assets/*.js is served by the filesystem handler first,
          // and only bare /admin/* paths (no matching file) get the index.html.
          const fsIdx = routes.findIndex((r) => r.handle === 'filesystem')
          if (fsIdx >= 0) {
            routes.splice(fsIdx + 1, 0, {
              src: '/admin(/.*)?',
              dest: '/admin/index.html',
              status: 200,
            })
          }
          config.routes = routes
          writeFileSync(configPath, JSON.stringify(config, null, 2))
          console.log('  ✓ Vercel config.json patched (SPA /admin fallback)')
        }
      }
    } catch (err) {
      result.exitCode = 1
      result.errors.push('Nitro build failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return result
}

// ──────────────────────────────────────────────
// Vercel-specific config generation
// ──────────────────────────────────────────────

function generateVercelConfig(cwd: string, jobs: ManifestJobEntry[]): void {
  const vercelJson: Record<string, unknown> = {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    buildCommand: 'npx manta build --preset vercel',
    framework: null,
    rewrites: [{ source: '/admin/:path*', destination: '/admin/index.html' }],
  }
  if (jobs.length > 0) {
    vercelJson.crons = jobs.map((job) => ({
      path: `/api/crons/${job.id}`,
      schedule: job.schedule || '0 */6 * * *',
    }))
  }
  writeFileSync(resolve(cwd, 'vercel.json'), JSON.stringify(vercelJson, null, 2))
  console.log('  ✓ vercel.json generated')
}

// ──────────────────────────────────────────────
// Filesystem scanning
// ──────────────────────────────────────────────

function scanRoutes(cwd: string): ManifestRouteEntry[] {
  const routes: ManifestRouteEntry[] = []
  const apiDir = resolve(cwd, 'src', 'api')
  if (!existsSync(apiDir)) return routes

  scanRoutesRecursive(apiDir, apiDir, routes)
  return routes
}

function scanRoutesRecursive(dir: string, apiDir: string, routes: ManifestRouteEntry[]): void {
  if (!existsSync(dir)) return
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      scanRoutesRecursive(fullPath, apiDir, routes)
    } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
      const relDir = relative(apiDir, dir)
      const pathSegments = relDir.split('/').filter(Boolean)
      const namespace = pathSegments[0] ?? 'root'
      const routePath = '/' + pathSegments.join('/')

      routes.push({
        path: routePath,
        methods: ['GET', 'POST'], // simplified — real impl would parse exports
        file: relative(resolve(apiDir, '..', '..'), fullPath),
        namespace,
        middlewares: [],
      })
    }
  }
}

function scanSubscribers(cwd: string): ManifestSubscriberEntry[] {
  return scanSimpleDir(cwd, 'src/subscribers').map((file) => ({
    id: file
      .replace(/\.(ts|js)$/, '')
      .split('/')
      .pop()!,
    file,
    events: [], // Would parse from file
  }))
}

function scanWorkflows(cwd: string): ManifestWorkflowEntry[] {
  return scanSimpleDir(cwd, 'src/workflows').map((file) => ({
    id: file
      .replace(/\.(ts|js)$/, '')
      .split('/')
      .pop()!,
    file,
    steps: [], // Would parse from file
  }))
}

function scanJobs(cwd: string): ManifestJobEntry[] {
  return scanSimpleDir(cwd, 'src/jobs').map((file) => ({
    id: file
      .replace(/\.(ts|js)$/, '')
      .split('/')
      .pop()!,
    file,
    schedule: '', // Would parse from file
  }))
}

function scanLinks(cwd: string): ManifestLinkEntry[] {
  return scanSimpleDir(cwd, 'src/links').map((file) => ({
    id: file
      .replace(/\.(ts|js)$/, '')
      .split('/')
      .pop()!,
    file,
    modules: [],
    table: '',
  }))
}

function scanModules(cwd: string): ManifestModuleEntry[] {
  const modulesDir = resolve(cwd, 'src', 'modules')
  if (!existsSync(modulesDir)) return []

  const entries = readdirSync(modulesDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory())
    .filter((e) => {
      const indexPath = resolve(modulesDir, e.name, 'index.ts')
      return existsSync(indexPath)
    })
    .map((e) => ({
      name: e.name,
      file: `src/modules/${e.name}/index.ts`,
      models: [],
      service: '',
    }))
}

function scanSimpleDir(cwd: string, relPath: string): string[] {
  const dir = resolve(cwd, relPath)
  if (!existsSync(dir)) return []

  const files: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      files.push(`${relPath}/${entry.name}`)
    }
  }
  return files
}
