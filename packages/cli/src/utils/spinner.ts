// CLI spinner — loading indicators

export interface Spinner {
  start(msg: string): void
  stop(msg?: string): void
  fail(msg: string): void
}

export function createSpinner(): Spinner {
  return {
    start(msg: string) {
      process.stdout.write(`⏳ ${msg}...`)
    },
    stop(msg?: string) {
      if (msg) {
        process.stdout.write(`\r✓ ${msg}\n`)
      } else {
        process.stdout.write('\n')
      }
    },
    fail(msg: string) {
      process.stdout.write(`\r❌ ${msg}\n`)
    },
  }
}
