// Unit tests for the pure state reducers used by `useCommand`.
// See WORKFLOW_PROGRESS.md §7 (useCommand behavior).
//
// The hook itself is covered indirectly through these reducers plus the
// MantaClient envelope tests in client.test.ts. A full react-testing-library
// setup is intentionally deferred — it would require adding jsdom and
// @testing-library/react to the repo, which is scoped out of PR-5.

import { describe, expect, it } from 'vitest'
import type { MantaSDKError } from '../src/client'
import { type CommandState, idleState, mergePollSnapshot, readOnlyInitialState, stateFromRunResult } from '../src/hooks'
import type { WorkflowRunSnapshot } from '../src/workflow-types'

describe('useCommand — idleState / readOnlyInitialState', () => {
  it('W-SDK-01: idleState has status idle and nothing else set', () => {
    const s = idleState<unknown>()
    expect(s).toEqual({
      status: 'idle',
      runId: undefined,
      steps: undefined,
      progress: undefined,
      result: undefined,
      error: undefined,
    })
  })

  it('W-SDK-06: readOnlyInitialState stamps runId and enters running', () => {
    const s = readOnlyInitialState<unknown>('run-99')
    expect(s.status).toBe('running')
    expect(s.runId).toBe('run-99')
    expect(s.result).toBeUndefined()
    expect(s.error).toBeUndefined()
  })
})

describe('useCommand — stateFromRunResult', () => {
  it('W-SDK-02: inline succeeded envelope → state with result, no runId required', () => {
    const s = stateFromRunResult({ status: 'succeeded', result: { id: 'p-1' }, runId: 'run-1' })
    expect(s.status).toBe('succeeded')
    expect(s.result).toEqual({ id: 'p-1' })
    expect(s.runId).toBe('run-1')
    expect(s.error).toBeUndefined()
  })

  it('W-SDK-03: running envelope → state with runId and no result', () => {
    const s = stateFromRunResult({ status: 'running', runId: 'run-42' })
    expect(s.status).toBe('running')
    expect(s.runId).toBe('run-42')
    expect(s.result).toBeUndefined()
  })

  it('W-SDK-09: failed envelope → state carries MantaSDKError', () => {
    const err = { name: 'MantaSDKError', message: 'bad', type: 'INVALID_DATA', status: 400 } as MantaSDKError
    const s = stateFromRunResult({ status: 'failed', error: err })
    expect(s.status).toBe('failed')
    expect(s.error).toBe(err)
    expect(s.runId).toBeUndefined()
  })
})

describe('useCommand — mergePollSnapshot', () => {
  const running = (runId: string): CommandState<unknown> => ({
    status: 'running',
    runId,
    steps: undefined,
    progress: undefined,
    result: undefined,
    error: undefined,
  })

  it('W-SDK-04: polling tick populates steps + progress', () => {
    const snap: WorkflowRunSnapshot = {
      id: 'run-1',
      command_name: 'x',
      status: 'running',
      steps: [
        { name: 's1', status: 'succeeded' },
        { name: 's2', status: 'running' },
      ],
      inFlightProgress: { stepName: 's2', current: 3, total: 10, at: 123 },
    }
    const s = mergePollSnapshot(running('run-1'), snap)
    expect(s.status).toBe('running')
    expect(s.steps).toHaveLength(2)
    expect(s.progress).toEqual({ stepName: 's2', current: 3, total: 10, at: 123 })
  })

  it('W-SDK-05a: terminal snapshot (succeeded) sets result from output', () => {
    const snap: WorkflowRunSnapshot = {
      id: 'run-1',
      command_name: 'x',
      status: 'succeeded',
      steps: [],
      output: { ok: true },
    }
    const s = mergePollSnapshot(running('run-1'), snap)
    expect(s.status).toBe('succeeded')
    expect(s.result).toEqual({ ok: true })
  })

  it('W-SDK-05b: terminal snapshot (failed) sets error', () => {
    const snap: WorkflowRunSnapshot = {
      id: 'run-1',
      command_name: 'x',
      status: 'failed',
      steps: [],
      error: { message: 'boom', code: 'UNEXPECTED_STATE' },
    }
    const s = mergePollSnapshot(running('run-1'), snap)
    expect(s.status).toBe('failed')
    expect(s.error).toEqual({ message: 'boom', code: 'UNEXPECTED_STATE' })
  })

  it('W-SDK-05c: terminal snapshot (cancelled) flips status to cancelled', () => {
    const snap: WorkflowRunSnapshot = {
      id: 'run-1',
      command_name: 'x',
      status: 'cancelled',
      steps: [],
    }
    const s = mergePollSnapshot(running('run-1'), snap)
    expect(s.status).toBe('cancelled')
  })

  it('W-SDK-12a: snapshot with mismatched runId is ignored', () => {
    const prev = running('run-1')
    const snap: WorkflowRunSnapshot = {
      id: 'run-OTHER',
      command_name: 'x',
      status: 'succeeded',
      steps: [],
    }
    const s = mergePollSnapshot(prev, snap)
    expect(s).toBe(prev) // identity-preserved
  })

  it('W-SDK-12b: snapshot when prev has no runId is ignored', () => {
    const prev = idleState<unknown>()
    const snap: WorkflowRunSnapshot = {
      id: 'run-1',
      command_name: 'x',
      status: 'succeeded',
      steps: [],
    }
    const s = mergePollSnapshot(prev, snap)
    expect(s).toBe(prev)
  })

  it('W-SDK-12c: pending status is mapped to running', () => {
    const snap: WorkflowRunSnapshot = {
      id: 'run-1',
      command_name: 'x',
      status: 'pending',
      steps: [],
    }
    const s = mergePollSnapshot(running('run-1'), snap)
    expect(s.status).toBe('running')
  })

  it('W-SDK-12d: progress is preserved across a snapshot with no inFlightProgress', () => {
    const prev: CommandState<unknown> = {
      ...running('run-1'),
      progress: { stepName: 's1', current: 1, total: 10, at: 1 },
    }
    const snap: WorkflowRunSnapshot = {
      id: 'run-1',
      command_name: 'x',
      status: 'running',
      steps: [{ name: 's1', status: 'running' }],
      // no inFlightProgress in this tick
    }
    const s = mergePollSnapshot(prev, snap)
    expect(s.progress).toEqual({ stepName: 's1', current: 1, total: 10, at: 1 })
  })
})
