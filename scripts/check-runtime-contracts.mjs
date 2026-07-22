import { globSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const expectedTargetStatuses = {
  'static-edge': 'supported',
  'persistent-node': 'supported',
  'vercel-serverless-node': 'supported',
  'backend-edge': 'unsupported',
}
const allowedStatuses = new Set(['supported', 'unsupported', 'production-required'])

export function checkRuntimeContracts({ workspaceRoot = '.', target } = {}) {
  const fromRoot = (path) => resolve(workspaceRoot, path)
  const contract = readJson(fromRoot('demo/commerce/runtime-contracts.json'))
  const vercel = readJson(fromRoot('demo/commerce/vercel.json'))
  const fastFunctions = readJson(fromRoot('demo/commerce/vercel-fast-functions.manifest.json'))

  if (contract.schemaVersion !== 1) throw new Error(`Unsupported runtime contract schema: ${contract.schemaVersion}`)
  const actualTargetStatuses = Object.fromEntries(
    Object.entries(contract.targets).map(([name, spec]) => [name, spec.status]),
  )
  if (!isDeepStrictEqual(actualTargetStatuses, expectedTargetStatuses)) {
    throw new Error(
      `Runtime target mapping drift: expected ${JSON.stringify(expectedTargetStatuses)}, got ${JSON.stringify(actualTargetStatuses)}`,
    )
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

  const routeFiles = globSync('demo/commerce/src/**/api/**/route.ts', { cwd: workspaceRoot })
  if (routeFiles.length < contract.inventory.minimumApplicationRoutes) {
    throw new Error(`Application route inventory regressed: ${routeFiles.length} < ${contract.inventory.minimumApplicationRoutes}`)
  }

  const jobNames = globSync('demo/commerce/src/jobs/*.ts', { cwd: workspaceRoot })
    .map((path) => basename(path, '.ts'))
    .sort()
  const cronNames = (vercel.crons ?? [])
    .map((cron) => String(cron.path).replace(/^\/api\/crons\//, ''))
    .sort()
  if (jobNames.length !== contract.inventory.expectedJobs) {
    throw new Error(`Job inventory drift: ${jobNames.length} != ${contract.inventory.expectedJobs}`)
  }
  if (!isDeepStrictEqual(jobNames, cronNames)) {
    const missing = jobNames.filter((name) => !cronNames.includes(name))
    const stale = cronNames.filter((name) => !jobNames.includes(name))
    throw new Error(
      `Job/cron drift (missing crons: ${missing.join(', ') || 'none'}; stale crons: ${stale.join(', ') || 'none'})`,
    )
  }

  if (target !== undefined) {
    const spec = contract.targets[target]
    if (!spec) throw new Error(`Unknown runtime target: ${target || '(missing)'}`)
    if (spec.status === 'unsupported') throw new Error(`${target} is unsupported: ${spec.reason}`)
  }

  console.log(
    `Runtime contracts: ${Object.keys(contract.targets).length} targets, ${routeFiles.length} app routes, ${jobNames.length} jobs, ${fastFunctions.functions.length} fast routes`,
  )
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const targetArgument = process.argv.indexOf('--target')
  checkRuntimeContracts({ target: targetArgument >= 0 ? (process.argv[targetArgument + 1] ?? '') : undefined })
}
