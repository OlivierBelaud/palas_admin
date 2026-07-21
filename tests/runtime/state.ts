import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const RUNTIME_STATE_PATH = resolve('tests/runtime/.state.json')
export const RUNTIME_AUTH_PATH = resolve('tests/runtime/.auth.json')

export interface RuntimeState {
  baseUrl: string
  databaseUrl: string
  cacheUrl: string
  cacheToken: string
  bootstrapAdmin: {
    email: string
    password: string
    inviteToken: string
  }
  pid?: number
  cachePid?: number
  dbName?: string
  dbRole?: string
}

export function readRuntimeState(): RuntimeState {
  return JSON.parse(readFileSync(RUNTIME_STATE_PATH, 'utf8')) as RuntimeState
}

export function writeRuntimeState(state: RuntimeState): void {
  writeFileSync(RUNTIME_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
}
