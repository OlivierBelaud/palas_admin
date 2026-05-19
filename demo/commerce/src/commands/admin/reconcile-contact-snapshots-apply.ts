export default defineCommand({
  name: 'reconcileContactSnapshotsApply',
  description: 'Apply Contact locale normalization and local order aggregate reconciliation.',
  input: z.object({}),
  workflow: async (_input, { step }) => {
    return await (
      step.command as unknown as { reconcileContactSnapshots: (input: unknown) => Promise<unknown> }
    ).reconcileContactSnapshots({ dryRun: false })
  },
})
