import { describe, expect, it } from 'vitest'
import { transpileAllWorkflows } from '../src/_internal/transpiler/transpile'

describe('Transpiler — unmatched analysis', () => {
  it('lists all unmatched steps with their workflow context', () => {
    const result = transpileAllWorkflows()

    const unmatchedContext: Array<{ step: string; workflows: string[] }> = []
    for (const stepName of result.stats.unmatchedSteps) {
      const workflows: string[] = []
      for (const [name, wf] of result.workflows) {
        if (wf.dag.some((n) => n.action === stepName)) workflows.push(name)
      }
      unmatchedContext.push({ step: stepName, workflows })
    }

    console.log(`\n=== ${unmatchedContext.length} UNMATCHED STEPS ===\n`)
    for (const { step, workflows } of unmatchedContext.sort((a, b) => a.step.localeCompare(b.step))) {
      console.log(`${step}`)
      console.log(`  used in: ${workflows.join(', ')}`)
    }

    // Check if they exist under similar names
    const allSteps = result.steps
    const paymentSteps = [...allSteps.keys()].filter(
      (k) => k.includes('payment') || k.includes('authorize') || k.includes('capture'),
    )
    console.log('\nCaptured payment-related steps:', paymentSteps.join(', '))

    expect(unmatchedContext.length).toBeLessThanOrEqual(10)
  })
})
