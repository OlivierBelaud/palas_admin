// @manta/sdk — Frontend SDK for Manta applications
//
// Hooks:
//   useCommand('create-product')     — execute a command (mutation)
//   useQuery('list-products', {...}) — execute a named query (read)
//   useGraphQuery({entity, ...})     — execute a graph query (flexible)
//   useAuth()                        — login, logout, me
//
// Provider:
//   <MantaProvider context="admin"> — wraps app with SDK context
//
// Client (headless):
//   new MantaClient({ context: 'admin' }) — for non-React usage

export type { GraphQueryInput, MantaClientOptions } from './client'
// Client (headless — usable without React)
export { MantaClient, MantaSDKError } from './client'
// React hooks
export { useAuth, useCommand, useGraphQuery, useQuery } from './hooks'
export type { MantaProviderProps } from './provider'
// Provider
export { MantaProvider, useMantaClient } from './provider'

// Query helpers (for defineQuery input composition)
export { listParams, retrieveParams } from './query-helpers'
export type {
  ProgressSnapshot,
  RunResult,
  StepState,
  StepStatus,
  UseCommandResult,
  UseCommandStatus,
  WorkflowError,
  WorkflowRunSnapshot,
  WorkflowStatus,
} from './workflow-types'
// Workflow types — shared with the backend via HTTP (shapes match @manta/core)
export { isTerminalStatus } from './workflow-types'
