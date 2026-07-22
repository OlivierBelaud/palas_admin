import { existsSync, globSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const outputRoot = 'demo/commerce/.vercel/output'
const manifest = readJson('demo/commerce/vercel-fast-functions.manifest.json')
const customRoutes = manifest.functions.map((spec) => spec.route)
const expectedFunctions = ['__server', ...customRoutes]
const sourceDir = 'demo/commerce/vercel-fast-functions'

const deployableSources = globSync('admin-*.mjs', { cwd: sourceDir }).sort()
const manifestSources = [...new Set(manifest.functions.map((spec) => spec.source))].sort()
if (customRoutes.length < 20) {
  throw new Error(`Vercel fast-function inventory regressed: expected at least 20 routes, found ${customRoutes.length}`)
}
if (!isDeepStrictEqual(deployableSources, manifestSources)) {
  const missing = deployableSources.filter((source) => !manifestSources.includes(source))
  const stale = manifestSources.filter((source) => !deployableSources.includes(source))
  throw new Error(`Vercel source inventory drift (missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'})`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const actualFunctions = globSync('**/*.func', { cwd: `${outputRoot}/functions` })
  .map((route) => route.replace(/\.func$/, ''))
  .sort()
const sortedExpectedFunctions = [...expectedFunctions].sort()
if (!isDeepStrictEqual(actualFunctions, sortedExpectedFunctions)) {
  const missing = sortedExpectedFunctions.filter((route) => !actualFunctions.includes(route))
  const unexpected = actualFunctions.filter((route) => !sortedExpectedFunctions.includes(route))
  throw new Error(`Vercel function inventory drift (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`)
}

for (const route of expectedFunctions) {
  const dir = `${outputRoot}/functions/${route}.func`
  const configPath = `${dir}/.vc-config.json`
  let config
  try {
    config = readJson(configPath)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing Vercel function output: ${route}`)
    throw error
  }
  if (config.runtime !== manifest.runtime) throw new Error(`${route} must use ${manifest.runtime}, got ${config.runtime}`)
  if (!isDeepStrictEqual(config.regions, manifest.regions)) {
    throw new Error(`${route} must be pinned to ${manifest.regions.join(', ')}`)
  }

  if (route === '__server') continue
  if (config.handler !== 'index.mjs' || config.launcherType !== 'Nodejs') {
    throw new Error(`${route} must use the explicit Node launcher and index.mjs handler`)
  }
  const spec = manifest.functions.find((candidate) => candidate.route === route)
  const requiredFiles = [
    'index.mjs',
    'runtime.mjs',
    'node_modules/postgres/package.json',
    ...(spec?.extraSources ?? []),
  ]
  for (const file of requiredFiles) {
    if (!existsSync(`${dir}/${file}`)) throw new Error(`${route} is missing packaged runtime dependency ${file}`)
  }

  const handlerModule = await import(`${pathToFileURL(`${dir}/index.mjs`).href}?contract=${encodeURIComponent(route)}`)
  if (typeof handlerModule.default?.fetch !== 'function') {
    throw new Error(`${route} packaged handler does not export default.fetch`)
  }
}

const outputConfig = readJson(`${outputRoot}/config.json`)
if (outputConfig.crons) throw new Error('Vercel output must not install cron jobs')
if (!outputConfig.routes?.some((route) => route.dest === '/__server')) {
  throw new Error('Vercel output is missing the server fallback route')
}
if (!outputConfig.routes?.some((route) => route.dest === '/index.html')) {
  throw new Error('Vercel output is missing the SPA fallback route')
}

console.log(`Vercel output: ${expectedFunctions.length} functions (${customRoutes.length} explicit fast routes + server)`)
