import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const selfRedirects = new Map([
  ['^/login/?$', '/login'],
  ['^/reset-password/?$', '/reset-password'],
  ['^/accept-invite/?$', '/accept-invite'],
])

const legacyAdminPaths = [
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
  { src: '^/admin/?$', status: 307, headers: { Location: '/' } },
]

const legacyAdminVercelRedirects = [
  { source: '/admin/login', destination: '/login', permanent: false },
  { source: '/admin/reset-password', destination: '/reset-password', permanent: false },
  { source: '/admin/accept-invite', destination: '/accept-invite', permanent: false },
  { source: '/admin', destination: '/', permanent: false },
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
  const redirects = Array.isArray(config.redirects) ? config.redirects : []
  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : []

  config.redirects = [
    ...legacyAdminVercelRedirects,
    ...redirects.filter((redirect) => {
      if (!redirect?.source || !redirect?.destination) return false
      if (redirect.source === redirect.destination) return false
      if (redirect.source === '/') return false
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

function patchOutputConfig() {
  const path = '.vercel/output/config.json'
  if (!existsSync(path)) return

  const config = readJson(path)
  const routes = Array.isArray(config.routes) ? config.routes : []
  const filteredRoutes = routes.filter((route) => {
    if (!route?.src) return true
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

patchVercelJson()
patchOutputConfig()
