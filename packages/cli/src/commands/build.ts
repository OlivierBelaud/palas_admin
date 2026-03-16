// SPEC-074, SPEC-100 — manta build command

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import type {
  BuildOptions,
  ManifestRouteEntry,
  ManifestSubscriberEntry,
  ManifestWorkflowEntry,
  ManifestJobEntry,
  ManifestLinkEntry,
  ManifestModuleEntry,
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
    result.errors.push(
      `Unknown preset '${preset}'. Available presets: ${VALID_PRESETS.join(', ')}`,
    )
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

  // Preset-specific build
  if (preset === 'vercel') {
    await buildForVercel(cwd, result)
  }

  return result
}

// ──────────────────────────────────────────────
// Vercel preset build
// ──────────────────────────────────────────────

async function buildForVercel(cwd: string, result: BuildCommandResult): Promise<void> {
  const outputDir = resolve(cwd, '.vercel', 'output')
  const functionsDir = resolve(outputDir, 'functions', 'api', '__handler.func')
  const staticDir = resolve(outputDir, 'static')

  mkdirSync(functionsDir, { recursive: true })
  mkdirSync(staticDir, { recursive: true })

  // 1. Generate the serverless function entry point
  const handlerCode = generateVercelHandler(cwd)
  writeFileSync(resolve(functionsDir, 'index.mjs'), handlerCode)

  // Write .vc-config.json for the function
  writeFileSync(resolve(functionsDir, '.vc-config.json'), JSON.stringify({
    runtime: 'nodejs20.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    maxDuration: 30,
  }, null, 2))

  // 2. Build the admin dashboard (Vite static build)
  const adminDir = resolve(cwd, 'src', 'admin')
  const viteConfig = resolve(cwd, 'vite.config.ts')
  if (existsSync(adminDir) && existsSync(join(adminDir, 'index.html'))) {
    console.log('  Building admin dashboard...')
    const { execSync } = await import('node:child_process')
    try {
      execSync(`npx vite build --config "${viteConfig}" --outDir "${resolve(staticDir, 'admin')}"`, {
        cwd,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' },
      })
      console.log('  ✓ Admin dashboard built')
    } catch (err) {
      result.warnings.push('Failed to build admin dashboard: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // 3. Generate config.json (Vercel Build Output API)
  const config = {
    version: 3,
    routes: [
      // API routes → serverless function
      { src: '/api/(.*)', dest: '/api/__handler' },
      // Health endpoints → serverless
      { src: '/health/(.*)', dest: '/api/__handler' },
      // Admin dashboard → static files (SPA fallback)
      { handle: 'filesystem' },
      { src: '/admin/(.*)', dest: '/admin/index.html', status: 200 },
    ],
  }
  writeFileSync(resolve(outputDir, 'config.json'), JSON.stringify(config, null, 2))

  console.log('  ✓ Vercel output generated at .vercel/output/')
}

function generateVercelHandler(cwd: string): string {
  const routes = scanRoutes(cwd)

  const imports: string[] = []
  const routeEntries: string[] = []

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]
    const importName = `route_${i}`
    const apiPath = '/api' + route.path.replace(/\[(\w+)\]/g, ':$1')
    imports.push(`import * as ${importName} from '../../${route.file}';`)
    routeEntries.push(`  { path: '${apiPath}', module: ${importName} },`)
  }

  return `// Auto-generated Vercel serverless handler — manta build --preset vercel
${imports.join('\n')}

const routes = [
${routeEntries.join('\n')}
];

let container = null;

async function getContainer() {
  if (container) return container;
  const mod = await import('../../src/bootstrap-vercel.mjs');
  container = await mod.bootstrapContainer();
  return container;
}

export default async function handler(req, res) {
  const url = new URL(req.url, \`https://\${req.headers.host}\`);
  const method = req.method;
  const pathname = url.pathname;

  // Health check
  if (pathname === '/health/live' || pathname === '/api/health/live') {
    return res.json({ status: 'alive', uptime_ms: Math.round(process.uptime() * 1000) });
  }
  if (pathname === '/health/ready' || pathname === '/api/health/ready') {
    return res.json({ status: 'ready', uptime_ms: Math.round(process.uptime() * 1000) });
  }

  // Match route
  for (const route of routes) {
    const match = matchPath(route.path, pathname);
    if (!match) continue;

    const handlerFn = route.module[method] || route.module[method.toUpperCase()];
    if (!handlerFn) continue;

    try {
      const c = await getContainer();
      const scope = { resolve: (key) => c.resolve(key) };

      // Parse body
      let body = undefined;
      if (method !== 'GET' && method !== 'HEAD' && req.body) {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      }

      // Build MantaRequest-like object
      const mantaReq = new Request(url.toString(), { method, headers: Object.fromEntries(Object.entries(req.headers)) });
      Object.defineProperty(mantaReq, 'validatedBody', { value: body, enumerable: true });
      Object.defineProperty(mantaReq, 'params', { value: match.params, enumerable: true });
      Object.defineProperty(mantaReq, 'scope', { value: scope, enumerable: true });
      Object.defineProperty(mantaReq, 'requestId', { value: crypto.randomUUID(), enumerable: true });

      console.log('[manta]', method, pathname);
      const response = await handlerFn(mantaReq);

      res.status(response.status || 200);
      response.headers?.forEach((value, key) => res.setHeader(key, value));
      const responseBody = await response.text();
      return res.send(responseBody);
    } catch (err) {
      console.error('[manta] Error:', method, pathname, err);
      return res.status(500).json({ type: 'UNEXPECTED_STATE', message: 'An internal error occurred' });
    }
  }

  return res.status(404).json({ type: 'NOT_FOUND', message: 'Route not found' });
}

function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}
`
}

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
    id: file.replace(/\.(ts|js)$/, '').split('/').pop()!,
    file,
    events: [], // Would parse from file
  }))
}

function scanWorkflows(cwd: string): ManifestWorkflowEntry[] {
  return scanSimpleDir(cwd, 'src/workflows').map((file) => ({
    id: file.replace(/\.(ts|js)$/, '').split('/').pop()!,
    file,
    steps: [], // Would parse from file
  }))
}

function scanJobs(cwd: string): ManifestJobEntry[] {
  return scanSimpleDir(cwd, 'src/jobs').map((file) => ({
    id: file.replace(/\.(ts|js)$/, '').split('/').pop()!,
    file,
    schedule: '', // Would parse from file
  }))
}

function scanLinks(cwd: string): ManifestLinkEntry[] {
  return scanSimpleDir(cwd, 'src/links').map((file) => ({
    id: file.replace(/\.(ts|js)$/, '').split('/').pop()!,
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
