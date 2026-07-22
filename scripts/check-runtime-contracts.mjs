import { globSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

const contract = readJson('demo/commerce/runtime-contracts.json')
const vercel = readJson('demo/commerce/vercel.json')
const fastFunctions = readJson('demo/commerce/vercel-fast-functions.manifest.json')
const allowedStatuses = new Set(['supported', 'unsupported', 'production-required'])

if (contract.schemaVersion !== 1) throw new Error(`Unsupported runtime contract schema: ${contract.schemaVersion}`)
for (const [target, spec] of Object.entries(contract.targets)) {
  if (!allowedStatuses.has(spec.status)) throw new Error(`Invalid runtime status for ${target}: ${spec.status}`)
}
for (const [adapter, spec] of Object.entries(contract.adapters)) {
  if (!allowedStatuses.has(spec.status)) throw new Error(`Invalid adapter status for ${adapter}: ${spec.status}`)
}

if (fastFunctions.runtime !== 'nodejs24.x') {
  throw new Error(`Fast functions must remain explicitly Node-only, got ${fastFunctions.runtime}`)
}
if (fastFunctions.functions.length < contract.inventory.minimumFastFunctionRoutes) {
  throw new Error(
    `Fast-function inventory regressed: ${fastFunctions.functions.length} < ${contract.inventory.minimumFastFunctionRoutes}`,
  )
}

const routeFiles = globSync('demo/commerce/src/**/api/**/route.ts')
if (routeFiles.length < contract.inventory.minimumApplicationRoutes) {
  throw new Error(`Application route inventory regressed: ${routeFiles.length} < ${contract.inventory.minimumApplicationRoutes}`)
}

const jobNames = globSync('demo/commerce/src/jobs/*.ts')
  .map((path) => basename(path, '.ts'))
  .sort()
const cronNames = (vercel.crons ?? [])
  .map((cron) => String(cron.path).replace(/^\/api\/crons\//, ''))
  .sort()
if (jobNames.length !== contract.inventory.expectedJobs) {
  throw new Error(`Job inventory drift: ${jobNames.length} != ${contract.inventory.expectedJobs}`)
}
if (JSON.stringify(jobNames) !== JSON.stringify(cronNames)) {
  const missing = jobNames.filter((name) => !cronNames.includes(name))
  const stale = cronNames.filter((name) => !jobNames.includes(name))
  throw new Error(`Job/cron drift (missing crons: ${missing.join(', ') || 'none'}; stale crons: ${stale.join(', ') || 'none'})`)
}

const targetArgument = process.argv.indexOf('--target')
if (targetArgument >= 0) {
  const target = process.argv[targetArgument + 1]
  const spec = contract.targets[target]
  if (!spec) throw new Error(`Unknown runtime target: ${target ?? '(missing)'}`)
  if (spec.status === 'unsupported') throw new Error(`${target} is unsupported: ${spec.reason}`)
}

console.log(
  `Runtime contracts: ${Object.keys(contract.targets).length} targets, ${routeFiles.length} app routes, ${jobNames.length} jobs, ${fastFunctions.functions.length} fast routes`,
)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
