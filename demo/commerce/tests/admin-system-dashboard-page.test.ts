import { describe, expect, it } from 'vitest'
import {
  auditSuccessMessage,
  MANUAL_SYSTEM_AUDIT_INPUT,
  RUN_SYSTEM_AUDITS_COMMAND,
  SYSTEM_DASHBOARD_ENDPOINT,
} from '../src/spa/admin/pages/page'

describe('system dashboard manual audits', () => {
  it('keeps dashboard reload separate from the cron audit command', () => {
    expect(SYSTEM_DASHBOARD_ENDPOINT).toBe('/api/cart-tracking/admin-system-dashboard')
    expect(RUN_SYSTEM_AUDITS_COMMAND).toBe('runSystemAudits')
    expect(MANUAL_SYSTEM_AUDIT_INPUT).toEqual({ trigger: 'manual' })
  })

  it('summarizes completed manual audit runs', () => {
    expect(
      auditSuccessMessage({
        run_id: 'audit_123',
        summary: { overall_status: 'warning' },
        findings: [{ id: 'f1' }, { id: 'f2' }],
      }),
    ).toBe('Audit manuel terminé · 2 findings · run audit_123')
  })
})
