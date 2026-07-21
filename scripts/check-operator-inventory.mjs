import { readdirSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

const scriptsDir = 'demo/commerce/scripts'
const supportFiles = new Set([
  'apply-ci-migrations.ts',
  'bootstrap-ci-schema.ts',
  'patch-root-spa-vercel.mjs',
  'patch-root-spa-vercel.test.ts',
  'prepare-root-spa-public.mjs',
  'prepare-runtime-manifest.ts',
])
const inventory = JSON.parse(readFileSync(`${scriptsDir}/operator-scripts.json`, 'utf8')).classifications
const operatorFiles = readdirSync(scriptsDir)
  .filter((name) => /\.(?:ts|mjs)$/.test(name) && !supportFiles.has(name))
  .sort()
const inventoryFiles = Object.keys(inventory).sort()

if (!isDeepStrictEqual(operatorFiles, inventoryFiles)) {
  const missing = operatorFiles.filter((name) => !inventory[name])
  const stale = inventoryFiles.filter((name) => !operatorFiles.includes(name))
  throw new Error(`Operator inventory drift (missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'})`)
}

const allowed = new Set(['read-only', 'dry-run', 'mutation'])
for (const [name, entry] of Object.entries(inventory)) {
  if (!allowed.has(entry.class)) throw new Error(`${name}: invalid class ${entry.class}`)
  if (!entry.guard?.trim()) throw new Error(`${name}: missing operator guard`)
  if (entry.class === 'dry-run') {
    if (!entry.optInToken) throw new Error(`${name}: dry-run classification requires optInToken`)
    const source = readFileSync(`${scriptsDir}/${name}`, 'utf8')
    if (!source.includes(entry.optInToken)) throw new Error(`${name}: opt-in token ${entry.optInToken} not found in source`)
  }
}

const totals = operatorFiles.reduce((acc, name) => {
  acc[inventory[name].class] += 1
  return acc
}, { 'read-only': 0, 'dry-run': 0, mutation: 0 })
console.log(`Operator scripts: ${operatorFiles.length} inventoried (${totals['read-only']} read-only, ${totals['dry-run']} dry-run, ${totals.mutation} mutation)`)
