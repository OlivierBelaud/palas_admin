import { bootstrapApp } from '@mantajs/cli/bootstrap'
import { loadConfig } from '@mantajs/cli/config'
import { createJiti } from '@mantajs/cli/jiti'

const cwd = process.cwd()
const jiti = createJiti(cwd)
const importFn = (path: string) => jiti.import(path) as Promise<Record<string, unknown>>
const config = await loadConfig(cwd, { importFn })
const app = await bootstrapApp({ config, cwd, mode: 'dev', importFn })
await app.shutdown()
