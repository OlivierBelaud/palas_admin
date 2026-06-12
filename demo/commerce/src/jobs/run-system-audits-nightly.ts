// Cron — nightly Palas system audit.
//
// Runs at 00:00 UTC. The dashboard reads the latest completed run, so the
// first admin opening the CRM in the morning sees yesterday night's verdict
// without triggering expensive checks synchronously.

interface AuditResult {
  run_id: string
  summary: { overall_status: string }
  findings: unknown[]
}

const EMPTY: AuditResult = {
  run_id: '',
  summary: { overall_status: 'unknown' },
  findings: [],
}

export default defineJob('run-system-audits-nightly', '0 0 * * *', async ({ command, log }) => {
  if (process.env.NODE_ENV !== 'production') {
    log.info(`[run-system-audits-nightly] skipped (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, prod-only)`)
    return EMPTY
  }
  const result = (await command.runSystemAudits({ trigger: 'nightly' })) as AuditResult
  log.info(
    `[run-system-audits-nightly] run=${result.run_id} status=${result.summary.overall_status} findings=${result.findings.length}`,
  )
  return result
})
