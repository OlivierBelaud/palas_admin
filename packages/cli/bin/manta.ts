#!/usr/bin/env node
// @manta/cli — Binary entry point
// Parses argv with Commander and dispatches to command functions

import { createProgram } from '../src/cli.js'

const program = createProgram()

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`❌ ${message}`)
  process.exit(1)
})
