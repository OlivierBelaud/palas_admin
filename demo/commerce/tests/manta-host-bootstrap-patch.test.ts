import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const hostRoot = dirname(dirname(require.resolve('@mantajs/host-nitro')))
const templatePath = join(hostRoot, 'templates/server/manta-bootstrap.ts')

let harnessSequence = 0

async function importHarness(source: string, bootstrapApp: () => Promise<{ adapter: object; app: object }>) {
  const namespace = `__adminBootstrapHarness${harnessSequence++}`
  Object.assign(globalThis, {
    [namespace]: {
      bootstrapApp,
      loadEnv: () => {},
      config: {},
      manifest: { moduleExports: {}, preloadedResources: {}, preloadedPluginResources: [] },
    },
  })
  const instrumented = source
    .replace(
      "import { bootstrapApp } from '@mantajs/cli/bootstrap'",
      `const { bootstrapApp } = globalThis.${namespace}`,
    )
    .replace("import { loadEnv } from '@mantajs/cli/env'", `const { loadEnv } = globalThis.${namespace}`)
    .replace(
      "import mantaConfigModule from './manta.config.js'",
      `const mantaConfigModule = globalThis.${namespace}.config`,
    )
    .replace("manifest = await import('./manifest.js')", `manifest = globalThis.${namespace}.manifest`)
  const javascript = ts.transpileModule(instrumented, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}#${namespace}`)
  return { module, cleanup: () => Reflect.deleteProperty(globalThis, namespace) }
}

describe('Manta host bootstrap compatibility patch', () => {
  it('shares bootstrap, evicts a rejected attempt, then reuses warm success', async () => {
    const source = readFileSync(templatePath, 'utf8')
    const injectedFailure = new Error('temporary bootstrap failure')
    const adapter = { id: 'adapter' }
    const app = { id: 'app' }
    let invocations = 0
    const harness = await importHarness(source, async () => {
      invocations += 1
      if (invocations === 1) throw injectedFailure
      return { adapter, app }
    })

    try {
      await expect(
        Promise.allSettled([harness.module.getMantaAdapter(), harness.module.getMantaApp()]),
      ).resolves.toEqual([
        { status: 'rejected', reason: injectedFailure },
        { status: 'rejected', reason: injectedFailure },
      ])
      expect(invocations).toBe(1)

      await expect(Promise.all([harness.module.getMantaAdapter(), harness.module.getMantaApp()])).resolves.toEqual([
        adapter,
        app,
      ])
      expect(invocations).toBe(2)

      await expect(Promise.all([harness.module.getMantaAdapter(), harness.module.getMantaApp()])).resolves.toEqual([
        adapter,
        app,
      ])
      expect(invocations).toBe(2)
    } finally {
      harness.cleanup()
    }
  })
})
