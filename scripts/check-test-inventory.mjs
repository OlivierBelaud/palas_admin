import { globSync } from 'node:fs'

const unitTests = globSync('**/*.{test,spec}.{ts,tsx}', {
  cwd: 'demo/commerce',
  exclude: ['node_modules/**', '.manta/**', '.vercel/**'],
}).sort()
const runtimeTests = globSync('**/*.spec.ts', { cwd: 'tests/runtime' })

if (unitTests.length < 71) {
  throw new Error(`Vitest inventory regressed: expected at least 71 files, found ${unitTests.length}`)
}
if (runtimeTests.length < 1) {
  throw new Error('Playwright runtime inventory is empty')
}
console.log(`Vitest inventory: ${unitTests.length} files (baseline: 71 files / 485 tests)`)
console.log(`Playwright runtime inventory: ${runtimeTests.length} file(s), explicitly separate from Vitest`)
