import { and, eq, isNull } from 'drizzle-orm'
import { resolveTable } from '../../utils/drizzle-read'

export default defineQuery({
  name: 'group-detail',
  description: 'Get customer group details with linked customer IDs',
  input: z.object({
    id: z.string(),
  }),
  handler: async (input, { db, schema }) => {
    const database = db as any
    const groupTable = resolveTable(schema, 'customerGroup') as any
    const customerTable = resolveTable(schema, 'customer') as any
    const pivot = schema.customer_customer_group as any
    if (!pivot) throw new MantaError('UNEXPECTED_STATE', 'Drizzle table "customer_customer_group" is not available')

    const [group] = (await database
      .select()
      .from(groupTable)
      .where(and(eq(groupTable.id, input.id), isNull(groupTable.deleted_at)))
      .limit(1)) as Array<Record<string, unknown>>
    if (!group) return null

    const customers = (await database
      .select({ id: customerTable.id })
      .from(pivot)
      .innerJoin(customerTable, eq(customerTable.id, pivot.customer_id))
      .where(
        and(eq(pivot.customer_group_id, input.id), isNull(pivot.deleted_at), isNull(customerTable.deleted_at)),
      )) as Array<{
      id: string
    }>

    return { ...group, customer_ids: customers.map((c) => c.id) }
  },
})
