#!/usr/bin/env node
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { createProgram } = await jiti.import('../src/cli.ts')

const program = createProgram()

program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`\u274c ${message}`)
  process.exit(1)
})
