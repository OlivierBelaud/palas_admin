import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { resolveTable } from '../../utils/drizzle-read'

export default defineQuery({
  name: 'customer-group-list',
  description: 'List customer groups with customer counts',
  input: z.object({}),
  handler: async (_input, { db, schema }) => {
    // biome-ignore lint/suspicious/noExplicitAny: beta.9 exposes Drizzle at runtime without generated app-local types.
    const database = db as any
    // biome-ignore lint/suspicious/noExplicitAny: dynamic schema lookup returns generic table records.
    const groupTable = resolveTable(schema, 'customerGroup') as any
    // biome-ignore lint/suspicious/noExplicitAny: generated pivot table type is not exported to app code.
    const pivot = schema.customer_customer_group as any
    if (!pivot) throw new MantaError('UNEXPECTED_STATE', 'Drizzle table "customer_customer_group" is not available')

    return database
      .select({
        id: groupTable.id,
        name: groupTable.name,
        created_at: groupTable.created_at,
        customers: count(pivot.customer_id),
      })
      .from(groupTable)
      .leftJoin(pivot, and(eq(pivot.customer_group_id, groupTable.id), isNull(pivot.deleted_at)))
      .where(isNull(groupTable.deleted_at))
      .groupBy(groupTable.id, groupTable.name, groupTable.created_at)
      .orderBy(desc(groupTable.created_at))
      .limit(1000)
  },
})
