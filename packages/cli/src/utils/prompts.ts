// CLI prompts — interactive user prompts (rename detection, confirmations)

import { createInterface } from 'node:readline'

/**
 * Ask a yes/no question. Returns true if user answers 'y' or 'Y'.
 * In non-interactive mode, returns defaultValue.
 */
export async function confirm(question: string, defaultValue: boolean = false): Promise<boolean> {
  // Non-interactive check
  if (!process.stdin.isTTY || process.env['CI'] === 'true' || process.env['MANTA_NON_INTERACTIVE'] === 'true') {
    return defaultValue
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]'
    rl.question(`${question} ${suffix} `, (answer) => {
      rl.close()
      const trimmed = answer.trim().toLowerCase()
      if (trimmed === '') resolve(defaultValue)
      else resolve(trimmed === 'y' || trimmed === 'yes')
    })
  })
}
