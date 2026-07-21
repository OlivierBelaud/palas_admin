import { readFileSync } from 'node:fs'

const resultPath = process.argv[2]
if (!resultPath) throw new Error('Vitest result path is required')

const result = JSON.parse(readFileSync(resultPath, 'utf8'))
const totalTests = result.numTotalTests
if (!Number.isInteger(totalTests)) {
  throw new Error('Vitest JSON result does not contain an integer numTotalTests')
}
if (totalTests < 485) {
  throw new Error(`Vitest test-count baseline regressed: expected at least 485 tests, found ${totalTests}`)
}

console.log(`Vitest result: ${totalTests} tests executed (baseline: 485)`)
