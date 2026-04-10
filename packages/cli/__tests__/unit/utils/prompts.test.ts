// Section E1 — prompts utility
// Ref: CLI_SPEC §2.2 flow step 6, CLI_TESTS_SPEC §E1

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isNonInteractive } from '../../../src/commands/db/generate'

describe('E1 — prompts / interactivity detection', () => {
  let origCI: string | undefined
  let origManta: string | undefined

  beforeEach(() => {
    origCI = process.env.CI
    origManta = process.env.MANTA_NON_INTERACTIVE
  })

  afterEach(() => {
    if (origCI !== undefined) process.env.CI = origCI
    else delete process.env.CI
    if (origManta !== undefined) process.env.MANTA_NON_INTERACTIVE = origManta
    else delete process.env.MANTA_NON_INTERACTIVE
  })

  // -------------------------------------------------------------------
  // PROMPT-01 — CI=true → non-interactive
  // -------------------------------------------------------------------
  it('PROMPT-01 — CI=true makes isNonInteractive return true', () => {
    process.env.CI = 'true'
    expect(isNonInteractive()).toBe(true)
  })

  // -------------------------------------------------------------------
  // PROMPT-02 — MANTA_NON_INTERACTIVE=true → non-interactive
  // -------------------------------------------------------------------
  it('PROMPT-02 — MANTA_NON_INTERACTIVE=true makes isNonInteractive true', () => {
    delete process.env.CI
    process.env.MANTA_NON_INTERACTIVE = 'true'
    expect(isNonInteractive()).toBe(true)
  })

  // -------------------------------------------------------------------
  // PROMPT-03 — non-TTY → non-interactive
  // -------------------------------------------------------------------
  it('PROMPT-03 — non-TTY stdin makes isNonInteractive true', () => {
    delete process.env.CI
    delete process.env.MANTA_NON_INTERACTIVE
    // In test environment, stdin is typically not a TTY
    // so isNonInteractive should return true
    expect(isNonInteractive()).toBe(true)
  })
})
