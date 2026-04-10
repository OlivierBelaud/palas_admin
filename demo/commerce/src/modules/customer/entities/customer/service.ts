export default defineService('customer', ({ db }) => ({
  setHasAccount: async (id: string, hasAccount: boolean) => {
    await db.update({ id, has_account: hasAccount })
  },
}))
