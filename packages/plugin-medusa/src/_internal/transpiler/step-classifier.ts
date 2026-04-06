// Step classifier — categorizes Medusa steps as CRUD or action for typed step mapping.
//
// CRUD steps map to step.create/update/delete with auto-compensation.
// Action steps map to step.action with explicit compensation.

import type { CapturedStep } from './transpile'

export type StepCategory = 'create' | 'update' | 'delete' | 'action'

export interface ClassifiedStep {
  name: string
  category: StepCategory
  /** Entity name for CRUD steps (e.g. 'product', 'order') */
  entity?: string
  /** Original Medusa step */
  original: CapturedStep
}

// Known CRUD create step patterns
const CREATE_PATTERNS = [
  /^create-(.+?)(?:-step)?$/,
  /^create-(.+?)s?$/,
  /^add-(.+?)(?:-step)?$/,
  /^insert-(.+?)(?:-step)?$/,
]

// Known CRUD update step patterns
const UPDATE_PATTERNS = [/^update-(.+?)(?:-step)?$/, /^set-(.+?)(?:-step)?$/, /^change-(.+?)(?:-step)?$/]

// Known CRUD delete step patterns (soft-delete)
const DELETE_PATTERNS = [
  /^delete-(.+?)(?:-step)?$/,
  /^remove-(.+?)(?:-step)?$/,
  /^soft-delete-(.+?)(?:-step)?$/,
  /^cancel-(.+?)(?:-step)?$/,
]

// Steps that are ALWAYS action (never CRUD) — external API calls, custom logic
const FORCE_ACTION_STEPS = new Set([
  'authorize-payment-session-step',
  'capture-payment-step',
  'refund-payment-step',
  'cancel-payment-step',
  'create-payment-session',
  'validate-cart-payments',
  'send-notification',
  'emit-event',
  'dismiss-remote-links',
  'create-remote-links',
  'validate-shipping-options',
  'validate-deleted-payment-sessions',
  'compensate-payment-if-needed',
  'refund-payments-step',
  'validate-payments-refund-step',
  'create-payment-account-holder',
  'complete-cart-after-payment-step',
  'validate-refund-payment-exceeds-captured-amount',
  'add-region-payment-providers-step',
])

function extractEntity(name: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = name.match(pattern)
    if (match?.[1]) {
      // Clean up: remove trailing 's' for plurals, normalize
      let entity = match[1].replace(/-/g, '_')
      if (entity.endsWith('s') && !entity.endsWith('ss')) {
        entity = entity.slice(0, -1)
      }
      return entity
    }
  }
  return undefined
}

/**
 * Classify a Medusa step as CRUD or action.
 */
export function classifyStep(step: CapturedStep): ClassifiedStep {
  const name = step.name

  // Force action for known non-CRUD steps
  if (FORCE_ACTION_STEPS.has(name)) {
    return { name, category: 'action', original: step }
  }

  // Try create patterns
  const createEntity = extractEntity(name, CREATE_PATTERNS)
  if (createEntity) {
    return { name, category: 'create', entity: createEntity, original: step }
  }

  // Try update patterns
  const updateEntity = extractEntity(name, UPDATE_PATTERNS)
  if (updateEntity) {
    return { name, category: 'update', entity: updateEntity, original: step }
  }

  // Try delete patterns
  const deleteEntity = extractEntity(name, DELETE_PATTERNS)
  if (deleteEntity) {
    return { name, category: 'delete', entity: deleteEntity, original: step }
  }

  // Default: action (custom step — requires explicit compensation)
  return { name, category: 'action', original: step }
}

/**
 * Classify all captured steps.
 */
export function classifyAllSteps(steps: Map<string, CapturedStep>): Map<string, ClassifiedStep> {
  const classified = new Map<string, ClassifiedStep>()
  for (const [name, step] of steps) {
    classified.set(name, classifyStep(step))
  }
  return classified
}

/**
 * Get classification stats.
 */
export function classificationStats(classified: Map<string, ClassifiedStep>): {
  create: number
  update: number
  delete: number
  action: number
  total: number
} {
  let create = 0
  let update = 0
  let del = 0
  let action = 0

  for (const step of classified.values()) {
    switch (step.category) {
      case 'create':
        create++
        break
      case 'update':
        update++
        break
      case 'delete':
        del++
        break
      case 'action':
        action++
        break
    }
  }

  return { create, update, delete: del, action, total: classified.size }
}
