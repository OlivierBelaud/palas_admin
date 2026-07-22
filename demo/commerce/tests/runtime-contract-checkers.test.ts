import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error JavaScript contract checker is exercised directly by this test.
import { checkRuntimeContracts } from '../../../scripts/check-runtime-contracts.mjs'
// @ts-expect-error JavaScript contract checker is exercised directly by this test.
import { checkVercelOutput } from '../../../scripts/check-vercel-output.mjs'

const temporaryRoots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('runtime contract checker', () => {
  it('accepts only the exact supported runtime target mapping', () => {
    const root = createRuntimeFixture()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(() => checkRuntimeContracts({ workspaceRoot: root })).not.toThrow()
  })

  it.each([
    ['changes a required status', (targets: Record<string, unknown>) => {
      targets['backend-edge'] = { status: 'supported' }
    }],
    ['adds an undeclared target', (targets: Record<string, unknown>) => {
      targets['experimental-edge'] = { status: 'unsupported' }
    }],
    ['removes a required target', (targets: Record<string, unknown>) => {
      delete targets['static-edge']
    }],
  ])('rejects target mapping mutation that %s', (_description, mutate) => {
    const root = createRuntimeFixture()
    const contractPath = join(root, 'demo/commerce/runtime-contracts.json')
    const contract = readJson(contractPath)
    mutate(contract.targets)
    writeJson(contractPath, contract)

    expect(() => checkRuntimeContracts({ workspaceRoot: root })).toThrow('Runtime target mapping drift')
  })
})

describe('Vercel output checker', () => {
  it('accepts a concrete Nitro server entrypoint without importing it as a fetch handler', async () => {
    const root = createVercelFixture()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(checkVercelOutput(root)).resolves.toBeUndefined()
  })

  it.each([
    ['uses a non-Node launcher', { launcherType: 'Edge' }, 'explicit Node launcher'],
    ['omits its handler', { handler: undefined }, 'configured handler'],
    ['points to a missing entrypoint', { handler: 'missing.mjs' }, 'configured handler missing.mjs'],
  ])('rejects __server when it %s', async (_description, mutation, message) => {
    const root = createVercelFixture()
    const configPath = join(root, 'demo/commerce/.vercel/output/functions/__server.func/.vc-config.json')
    const config = { ...readJson(configPath), ...mutation }
    if ('handler' in mutation && mutation.handler === undefined) delete config.handler
    writeJson(configPath, config)

    await expect(checkVercelOutput(root)).rejects.toThrow(message)
  })
})

function createRuntimeFixture() {
  const root = createTemporaryRoot()
  writeJson(join(root, 'demo/commerce/runtime-contracts.json'), {
    schemaVersion: 1,
    targets: expectedTargets(),
    inventory: { minimumApplicationRoutes: 1, expectedJobs: 1, minimumFastFunctionRoutes: 1 },
    adapters: { database: { status: 'supported' } },
  })
  writeJson(join(root, 'demo/commerce/vercel.json'), {
    crons: [{ path: '/api/crons/reconcile', schedule: '0 * * * *' }],
  })
  writeJson(join(root, 'demo/commerce/vercel-fast-functions.manifest.json'), {
    runtime: 'nodejs24.x',
    functions: [{ route: 'admin-test', source: 'admin-test.mjs' }],
  })
  write(join(root, 'demo/commerce/src/example/api/ping/route.ts'), '')
  write(join(root, 'demo/commerce/src/jobs/reconcile.ts'), '')
  return root
}

function createVercelFixture() {
  const root = createRuntimeFixture()
  const commerce = join(root, 'demo/commerce')
  writeJson(join(commerce, 'vercel-fast-functions.manifest.json'), {
    runtime: 'nodejs24.x',
    regions: ['fra1'],
    functions: [{ route: 'admin-test', source: 'admin-test.mjs' }],
  })
  write(join(commerce, 'vercel-fast-functions/admin-test.mjs'), '')

  const serverDir = join(commerce, '.vercel/output/functions/__server.func')
  writeJson(join(serverDir, '.vc-config.json'), functionConfig())
  write(join(serverDir, 'index.mjs'), 'export default function nitroServer() {}\n')

  const fastDir = join(commerce, '.vercel/output/functions/admin-test.func')
  writeJson(join(fastDir, '.vc-config.json'), functionConfig())
  write(join(fastDir, 'index.mjs'), 'export default { fetch() { return new Response("ok") } }\n')
  write(join(fastDir, 'runtime.mjs'), '')
  writeJson(join(fastDir, 'node_modules/postgres/package.json'), { name: 'postgres' })
  writeJson(join(commerce, '.vercel/output/config.json'), {
    routes: [{ dest: '/index.html' }, { dest: '/__server' }],
  })
  return root
}

function functionConfig() {
  return { handler: 'index.mjs', launcherType: 'Nodejs', runtime: 'nodejs24.x', regions: ['fra1'] }
}

function expectedTargets() {
  return {
    'static-edge': { status: 'supported' },
    'persistent-node': { status: 'supported' },
    'vercel-serverless-node': { status: 'supported' },
    'backend-edge': { status: 'unsupported', reason: 'Node-only dependencies' },
  }
}

function createTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'admin-runtime-contract-'))
  temporaryRoots.push(root)
  return root
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path: string, value: unknown) {
  write(path, `${JSON.stringify(value)}\n`)
}

function write(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}
