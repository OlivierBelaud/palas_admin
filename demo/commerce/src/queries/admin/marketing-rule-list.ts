import { desc, isNull } from 'drizzle-orm'
import { resolveTable } from '../../utils/drizzle-read'

export default defineQuery({
  name: 'marketing-rule-list',
  description: 'List Palas-owned marketing rules stored outside Shopify.',
  input: z.object({}),
  handler: async (_input, { db, schema }) => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic app schema in Mantajs beta.
    const database = db as any
    // biome-ignore lint/suspicious/noExplicitAny: dynamic table lookup.
    const table = resolveTable(schema, 'marketingRule') as any
    return database.select().from(table).where(isNull(table.deleted_at)).orderBy(desc(table.created_at)).limit(500)
  },
})
