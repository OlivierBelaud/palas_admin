import { type RawDb, runSystemAudit } from '../../utils/system-audit'

export default defineCommand({
  name: 'runSystemAudits',
  description: 'Run the Palas system health audits and persist the resulting findings.',
  input: z.object({
    trigger: z.enum(['nightly', 'manual']).default('manual'),
  }),
  workflow: async (input, { step, log }) => {
    const result = await step.action('run-system-audits', {
      invoke: async (_i: unknown, ctx) => {
        const db = ctx.app.resolve('IDatabasePort') as RawDb | undefined
        if (!db) throw new MantaError('UNEXPECTED_STATE', 'No database configured')
        return runSystemAudit(db, input.trigger)
      },
      compensate: async () => {},
    })({})

    log.info(
      `[run-system-audits] trigger=${input.trigger} run=${result.run_id} status=${result.summary.overall_status} findings=${result.findings.length}`,
    )
    return result
  },
})
