import { z } from 'zod'
import { PageElementSchema } from '../blocks/index'

// QueryDef — declarative data query

export const QueryDefSchema = z.object({
  entity: z.string(),
  id: z.object({ $state: z.string() }).optional(),
  list: z.boolean().optional(),
  expand: z.record(z.string(), z.unknown()).optional(),
  fields: z.string().optional(),
  pageSize: z.number().optional(),
  filters: z.union([z.record(z.string(), z.unknown()), z.object({ $state: z.string() })]).optional(),
  sort: z.union([z.object({ field: z.string(), direction: z.string() }), z.object({ $state: z.string() })]).optional(),
  search: z.union([z.string(), z.object({ $state: z.string() })]).optional(),
  limit: z.union([z.number(), z.object({ $state: z.string() })]).optional(),
  offset: z.union([z.number(), z.object({ $state: z.string() })]).optional(),
})

export type QueryDef = z.infer<typeof QueryDefSchema>

// DataComponent — named instance of a block

export const DataComponentSchema = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.unknown()),
})

export type DataComponent = z.infer<typeof DataComponentSchema>

// Breadcrumb — declarative breadcrumb config

export const BreadcrumbDefSchema = z.object({
  label: z.string(),
  field: z.string().optional(),
})

export type BreadcrumbDef = z.infer<typeof BreadcrumbDefSchema>

// PageSpec — page definition

export const PageSpecSchema = z.object({
  id: z.string(),
  type: z.enum(['list', 'detail']),
  layout: z.enum(['single-column', 'two-column']),
  route: z.string().optional(),
  query: QueryDefSchema,
  breadcrumb: BreadcrumbDefSchema.optional(),
  main: z.array(PageElementSchema).min(1),
  sidebar: z.array(PageElementSchema).optional(),
})

export type PageSpec = z.infer<typeof PageSpecSchema>
