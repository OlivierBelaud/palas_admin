// SPEC TS-04 — validateGeneratedTypeScript tests
// Ref: TS-04

import { MantaError } from '@manta/core'
import { describe, expect, it } from 'vitest'
import { validateGeneratedTypeScript } from '../../src/bootstrap/validate-generated-ts'

describe('TS-04 — validateGeneratedTypeScript', () => {
  // -------------------------------------------------------------------
  // VGT-01 — Valid TS passes silently
  // -------------------------------------------------------------------
  it('VGT-01 — accepts valid TypeScript', () => {
    const source = 'export interface Foo { bar: string }\n'
    expect(() => validateGeneratedTypeScript(source, 'valid.d.ts')).not.toThrow()
  })

  // -------------------------------------------------------------------
  // VGT-02 — Invalid identifier throws
  // -------------------------------------------------------------------
  it('VGT-02 — rejects an invalid identifier', () => {
    const source = 'interface My Module { }\n'
    let err: unknown
    try {
      validateGeneratedTypeScript(source, 'bad.d.ts')
    } catch (e) {
      err = e
    }
    expect(MantaError.is(err)).toBe(true)
    expect((err as MantaError).type).toBe('INVALID_DATA')
  })

  // -------------------------------------------------------------------
  // VGT-03 — Unclosed brace throws
  // -------------------------------------------------------------------
  it('VGT-03 — rejects an unclosed brace', () => {
    const source = 'interface Foo {\n'
    expect(() => validateGeneratedTypeScript(source, 'broken.d.ts')).toThrow(MantaError)
  })

  // -------------------------------------------------------------------
  // VGT-04 — Error message includes line/col and snippet
  // -------------------------------------------------------------------
  it('VGT-04 — error message includes location and snippet', () => {
    const source = 'interface Foo { bar: }\n'
    let err: unknown
    try {
      validateGeneratedTypeScript(source, 'snip.d.ts')
    } catch (e) {
      err = e
    }
    expect(MantaError.is(err)).toBe(true)
    const message = (err as MantaError).message
    expect(message).toMatch(/snip\.d\.ts/)
    expect(message).toMatch(/line \d+:\d+/)
    expect(message).toMatch(/Near:/)
  })
})
