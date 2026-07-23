import { globSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import ts from 'typescript'

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

  const jobs = globSync('demo/commerce/src/jobs/*.ts', { cwd: workspaceRoot })
    .map((path) => readJobContract(fromRoot(path), basename(path, '.ts')))
    .sort(compareByName)
  const crons = (vercel.crons ?? []).map(readCronContract).sort(compareByName)
  const jobNames = jobs.map(({ name }) => name)
  const cronNames = crons.map(({ name }) => name)
  if (jobs.length !== contract.inventory.expectedJobs) {
    throw new Error(`Job inventory drift: ${jobs.length} != ${contract.inventory.expectedJobs}`)
  }
  if (!isDeepStrictEqual(jobNames, cronNames)) {
    const missing = jobNames.filter((name) => !cronNames.includes(name))
    const stale = cronNames.filter((name) => !jobNames.includes(name))
    throw new Error(
      `Job/cron drift (missing crons: ${missing.join(', ') || 'none'}; stale crons: ${stale.join(', ') || 'none'})`,
    )
  }
  for (const job of jobs) {
    const cron = crons.find(({ name }) => name === job.name)
    if (job.schedule !== cron.schedule) {
      throw new Error(
        `Cron contract drift for ${job.name}: defineJob schedule ${JSON.stringify(job.schedule)} != Vercel schedule ${JSON.stringify(cron.schedule)}`,
      )
    }
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

function readJobContract(path, filename) {
  const source = readFileSync(path, 'utf8')
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const exportAssignment = sourceFile.statements.find(ts.isExportAssignment)
  const declaration = exportAssignment?.expression
  if (
    !declaration ||
    !ts.isCallExpression(declaration) ||
    !ts.isIdentifier(declaration.expression) ||
    declaration.expression.text !== 'defineJob'
  ) {
    throw new Error(`Job contract unreadable for ${filename}: expected an export default defineJob(...) declaration`)
  }
  const [nameNode, scheduleNode] = declaration.arguments
  if (!nameNode || !scheduleNode || !ts.isStringLiteralLike(nameNode) || !ts.isStringLiteralLike(scheduleNode)) {
    throw new Error(`Job contract unreadable for ${filename}: defineJob name and schedule must be string literals`)
  }
  const name = nameNode.text
  const schedule = scheduleNode.text
  if (name !== filename) {
    throw new Error(`Job contract drift for ${filename}: defineJob name ${JSON.stringify(name)} must match its filename`)
  }
  return { name, schedule }
}

function readCronContract(cron) {
  const path = String(cron.path)
  const match = path.match(/^\/api\/crons\/([^/]+)$/)
  if (!match) {
    throw new Error(`Invalid Vercel cron route ${JSON.stringify(path)}: expected /api/crons/<job-name>`)
  }
  if (typeof cron.schedule !== 'string' || cron.schedule.length === 0) {
    throw new Error(`Invalid Vercel cron schedule for ${match[1]}: expected a non-empty string`)
  }
  return { name: match[1], schedule: cron.schedule }
}

function compareByName(left, right) {
  return left.name.localeCompare(right.name)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const targetArgument = process.argv.indexOf('--target')
  checkRuntimeContracts({ target: targetArgument >= 0 ? (process.argv[targetArgument + 1] ?? '') : undefined })
}
