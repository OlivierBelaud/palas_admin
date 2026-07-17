import { spawn } from 'node:child_process'

const mantaCli = new URL('../node_modules/@mantajs/cli/bin/manta.mjs', import.meta.url)
const registerLoader = new URL('./register-typescript-imports.mjs', import.meta.url)
const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node scripts/run-manta-strict.mjs <manta command> [...args]')
  process.exit(2)
}

const child = spawn(
  process.execPath,
  [`--import=${registerLoader.href}`, mantaCli.pathname, ...args],
  {
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  },
)

let output = ''

for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    const text = chunk.toString()
    output += text
    const destination = stream === child.stdout ? process.stdout : process.stderr
    destination.write(chunk)
  })
}

child.on('error', (error) => {
  console.error(`[manta-strict] Unable to start Manta: ${error.message}`)
  process.exit(1)
})

child.on('close', (code, signal) => {
  if (signal) {
    console.error(`[manta-strict] Manta terminated by signal ${signal}`)
    process.exit(1)
  }

  if (output.includes('[codegen] Warning: failed to import command')) {
    console.error('[manta-strict] CodeGen skipped at least one command; refusing to publish an incomplete build.')
    process.exit(1)
  }

  process.exit(code ?? 1)
})
