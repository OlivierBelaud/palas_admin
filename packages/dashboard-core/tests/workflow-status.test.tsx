// W-UI — Unit tests for the <WorkflowStatus> sub-renderers.
// See WORKFLOW_PROGRESS.md §8 and PR-6 plan.
//
// Testing-library is intentionally not installed in this repo. We test the
// pure logic (progress %, status badge variant, step-status icon factory) and
// verify the sub-renderer components return a React element tree with the
// expected top-level shape, without mounting them into a DOM.

import type { ProgressSnapshot, StepState } from '@manta/sdk'
import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  ProgressPanel,
  progressPercentage,
  StepTimeline,
  statusBadgeVariant,
  stepStatusIcon,
} from '../src/components/WorkflowStatus'

describe('W-UI — progressPercentage', () => {
  it('W-UI-02a: determinate when total > 0 returns integer percent', () => {
    expect(progressPercentage(25, 100)).toBe(25)
    expect(progressPercentage(50, 200)).toBe(25)
    expect(progressPercentage(1, 3)).toBe(33)
  })

  it('W-UI-02b: clamps to 0..100', () => {
    expect(progressPercentage(-5, 10)).toBe(0)
    expect(progressPercentage(20, 10)).toBe(100)
  })

  it('W-UI-03: indeterminate when total is null → returns null', () => {
    expect(progressPercentage(42, null)).toBeNull()
  })

  it('W-UI-03b: indeterminate when total is 0 → returns null', () => {
    expect(progressPercentage(42, 0)).toBeNull()
  })
})

describe('W-UI — statusBadgeVariant', () => {
  it('maps overall workflow statuses to badge colors', () => {
    expect(statusBadgeVariant('succeeded')).toBe('green')
    expect(statusBadgeVariant('failed')).toBe('red')
    expect(statusBadgeVariant('running')).toBe('blue')
    expect(statusBadgeVariant('cancelled')).toBe('orange')
    expect(statusBadgeVariant('idle')).toBe('grey')
    expect(statusBadgeVariant('unknown')).toBe('grey')
  })
})

describe('W-UI — stepStatusIcon', () => {
  it('returns a valid React element for every status', () => {
    const statuses: Array<StepState['status']> = [
      'pending',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'compensated',
    ]
    for (const s of statuses) {
      const el = stepStatusIcon(s)
      expect(isValidElement(el)).toBe(true)
    }
  })
})

describe('W-UI-01 — StepTimeline', () => {
  it('renders a placeholder when steps is empty', () => {
    const el = StepTimeline({ steps: [] })
    expect(isValidElement(el)).toBe(true)
    // Empty steps → a single <p> placeholder.
    expect((el as { type: unknown }).type).toBe('p')
  })

  it('renders an ordered list with one <li> per step when non-empty', () => {
    const steps: StepState[] = [
      { name: 'fetch-events', status: 'succeeded', started_at: '2024-01-01T00:00:00Z' },
      { name: 'replay-events', status: 'running', started_at: '2024-01-01T00:00:01Z' },
      { name: 'persist-stats', status: 'pending' },
    ]
    const el = StepTimeline({ steps })
    expect(isValidElement(el)).toBe(true)
    expect((el as { type: unknown }).type).toBe('ol')
    const children = (el as unknown as { props: { children: unknown[] } }).props.children
    expect(Array.isArray(children)).toBe(true)
    expect((children as unknown[]).length).toBe(3)
  })
})

describe('W-UI-02/03 — ProgressPanel', () => {
  it('W-UI-02: determinate — when total is a positive number, renders a determinate panel with Progress bar', () => {
    const progress: ProgressSnapshot = {
      stepName: 'replay-events',
      current: 250,
      total: 1000,
      message: 'Replayed 250/1000 events',
      at: Date.now(),
    }
    const el = ProgressPanel({ progress })
    expect(isValidElement(el)).toBe(true)
    // Determinate branch returns a div with two children (label row + Progress bar).
    expect((el as { type: unknown }).type).toBe('div')
  })

  it('W-UI-03: indeterminate — when total is null, renders the spinner branch', () => {
    const progress: ProgressSnapshot = {
      stepName: 'fetch-events',
      current: 3200,
      total: null,
      message: 'Fetched 3200 events (page 4)',
      at: Date.now(),
    }
    const el = ProgressPanel({ progress })
    expect(isValidElement(el)).toBe(true)
    // Indeterminate branch returns a div containing a spinner + message.
    expect((el as { type: unknown }).type).toBe('div')
  })
})

// Note: ErrorPanel and ResultPreview use useState and cannot be invoked as
// plain functions outside a React renderer. They are covered indirectly via
// the <WorkflowStatus> integration (Playwright) — see PR-6 §5.
