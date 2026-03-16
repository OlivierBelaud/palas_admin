// SPEC-070 — Load .env files with priority ordering
// .env → .env.local → .env.{NODE_ENV} → .env.{NODE_ENV}.local
// Existing process.env values are NOT overwritten

import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

interface EnvLoadResult {
  loaded: string[]
  warnings: string[]
}

/**
 * Load .env files following priority ordering.
 * Later files override earlier files, but existing process.env is never overwritten.
 */
export function loadEnv(cwd: string = process.cwd()): EnvLoadResult {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development'
  const filesToLoad = [
    '.env',
    '.env.local',
    `.env.${nodeEnv}`,
    `.env.${nodeEnv}.local`,
  ]

  const loaded: string[] = []
  const warnings: string[] = []
  const envValues: Record<string, string> = {}

  for (const file of filesToLoad) {
    const filePath = resolve(cwd, file)
    if (!existsSync(filePath)) {
      continue
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const parsed = parseEnvFile(content)
      Object.assign(envValues, parsed)
      loaded.push(file)
    } catch {
      warnings.push(`Failed to read ${file}`)
    }
  }

  // Apply to process.env without overwriting existing values
  for (const [key, value] of Object.entries(envValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  if (loaded.length === 0) {
    warnings.push('No .env file found. Using environment variables only.')
  }

  return { loaded, warnings }
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}
