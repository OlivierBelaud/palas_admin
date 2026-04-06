// Job: cleanup-draft-products — dispatches the cleanup command every minute

export default defineJob('cleanup-draft-products', '* * * * *', async ({ command }) => {
  return await command.cleanupDraftProducts({})
})
