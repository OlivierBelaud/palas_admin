import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const functionRegions = ['fra1']
const require = createRequire(import.meta.url)

const selfRedirects = new Map([
  ['^/login/?$', '/login'],
  ['^/reset-password/?$', '/reset-password'],
  ['^/accept-invite/?$', '/accept-invite'],
])

const legacyAdminPaths = [
  'dashboard',
  'paniers',
  'paniers-abandonnes',
  'paniers-abandonnes/emails',
  'paniers-abandonnes/checks',
  'orders',
  'clients',
  'charts-lab',
  'visitor-lifecycle',
  'visitor-stats',
  'tracking-health',
  'settings',
  'settings/users',
]

const legacyAdminOutputRedirects = [
  { src: '^/admin/login/?$', status: 307, headers: { Location: '/login' } },
  { src: '^/admin/reset-password/?$', status: 307, headers: { Location: '/reset-password' } },
  { src: '^/admin/accept-invite/?$', status: 307, headers: { Location: '/accept-invite' } },
  ...legacyAdminPaths.map((path) => ({
    src: `^/admin/${path}/?$`,
    status: 307,
    headers: { Location: `/${path}` },
  })),
  { src: '^/admin/?$', status: 307, headers: { Location: '/dashboard' } },
]

const legacyAdminVercelRedirects = [
  { source: '/admin/login', destination: '/login', permanent: false },
  { source: '/admin/reset-password', destination: '/reset-password', permanent: false },
  { source: '/admin/accept-invite', destination: '/accept-invite', permanent: false },
  { source: '/admin', destination: '/dashboard', permanent: false },
  { source: '/admin/:path*', destination: '/:path*', permanent: false },
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, json) {
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
}

function patchVercelJson() {
  const path = 'vercel.json'
  if (!existsSync(path)) return

  const config = readJson(path)
  config.regions = functionRegions
  const redirects = Array.isArray(config.redirects) ? config.redirects : []
  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : []

  config.redirects = [
    ...legacyAdminVercelRedirects,
    ...redirects.filter((redirect) => {
      if (!redirect?.source || !redirect?.destination) return false
      if (redirect.source === '/' && redirect.destination === '/paniers') return false
      if (redirect.source === redirect.destination) return false
      if (redirect.source === '/admin' || redirect.source === '/admin/:path*') return false
      if (String(redirect.destination).startsWith('/admin')) return false
      return !legacyAdminVercelRedirects.some((legacy) => legacy.source === redirect.source)
    }),
  ]

  config.rewrites = rewrites.filter((rewrite) => {
    if (!rewrite?.source || !rewrite?.destination) return false
    if (rewrite.source === '/admin' || rewrite.source === '/admin/:path*') return false
    return !String(rewrite.destination).startsWith('/admin')
  })

  if (!config.rewrites.some((rewrite) => rewrite.source === '/')) {
    config.rewrites.push({ source: '/', destination: '/index.html' })
  }
  if (!config.rewrites.some((rewrite) => rewrite.source === '/((?!api/).*)')) {
    config.rewrites.push({ source: '/((?!api/).*)', destination: '/index.html' })
  }

  writeJson(path, config)
}

function patchFunctionConfigs(dir = '.vercel/output/functions') {
  if (!existsSync(dir)) return

  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`
    if (statSync(path).isDirectory()) patchFunctionConfigs(path)
    if (entry !== '.vc-config.json') continue

    const config = readJson(path)
    config.regions = functionRegions
    writeJson(path, config)
  }
}

function patchOutputConfig() {
  const path = '.vercel/output/config.json'
  if (!existsSync(path)) return

  const config = readJson(path)
  const routes = Array.isArray(config.routes) ? config.routes : []
  const filteredRoutes = routes.filter((route) => {
    if (!route?.src) return true
    if (route.src === '^/$' && route.headers?.Location === '/paniers') return false
    if (selfRedirects.get(route.src) === route.headers?.Location) return false
    if (String(route.headers?.Location ?? '').startsWith('/admin')) return false
    return !String(route.src).startsWith('^/admin')
  })
  const frameworkRoutes = filteredRoutes.filter((route) => {
    if (route.handle === 'filesystem') return false
    if (route.src === '^/(?!api(?:/|$)).*') return false
    return route.src !== '/(.*)'
  })

  config.routes = [
    ...legacyAdminOutputRedirects,
    ...frameworkRoutes,
    { handle: 'filesystem' },
    { src: '^/(?!api(?:/|$)).*', dest: '/index.html', status: 200 },
    { src: '/(.*)', dest: '/__server' },
  ]
  writeJson(path, config)
}

function installFastFunction({ source, route }) {
  const sourceDir = 'vercel-fast-functions'
  const functionDir = `.vercel/output/functions/${route}.func`
  rmSync(functionDir, { recursive: true, force: true })
  mkdirSync(functionDir, { recursive: true })

  cpSync(`${sourceDir}/${source}`, `${functionDir}/index.mjs`)
  cpSync(`${sourceDir}/runtime.mjs`, `${functionDir}/runtime.mjs`)
  writeJson(`${functionDir}/.vc-config.json`, {
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    runtime: 'nodejs24.x',
    regions: functionRegions,
  })

  const postgresDir = resolvePackageRoot('postgres')
  mkdirSync(`${functionDir}/node_modules`, { recursive: true })
  cpSync(postgresDir, `${functionDir}/node_modules/postgres`, { recursive: true })
}

function resolvePackageRoot(packageName) {
  let dir = dirname(require.resolve(packageName))
  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, 'package.json')
    if (existsSync(packageJsonPath)) {
      const packageJson = readJson(packageJsonPath)
      if (packageJson.name === packageName) return dir
    }
    dir = dirname(dir)
  }
  throw new Error(`Unable to resolve package root for ${packageName}`)
}

function installFastFunctions() {
  installFastFunction({
    source: 'admin-system-dashboard.mjs',
    route: 'api/cart-tracking/admin-system-dashboard',
  })
  installFastFunction({
    source: 'admin-tracking-health.mjs',
    route: 'api/cart-tracking/admin-tracking-health',
  })
}

patchVercelJson()
patchOutputConfig()
patchFunctionConfigs()
installFastFunctions()
