import { z } from 'zod'

// WhenCondition — conditional rendering

type WhenConditionInput = z.input<typeof WhenConditionSchema>

const BaseConditionSchema = z.object({
  field: z.string(),
  equals: z.unknown().optional(),
  notEquals: z.unknown().optional(),
  in: z.array(z.unknown()).optional(),
  notIn: z.array(z.unknown()).optional(),
  exists: z.boolean().optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
})

export const WhenConditionSchema: z.ZodType<unknown> = z.union([
  BaseConditionSchema.refine((data) => data.field !== undefined, {
    message: 'field is required for non-combinator conditions',
  }),
  z.object({
    all: z.lazy(() => z.array(WhenConditionSchema).min(1)),
  }),
  z.object({
    any: z.lazy(() => z.array(WhenConditionSchema).min(1)),
  }),
])

export type WhenCondition = z.infer<typeof WhenConditionSchema>

// PageElement — ref with optional when

export const PageElementSchema = z.union([
  z.string(),
  z.object({
    ref: z.string(),
    when: WhenConditionSchema.optional(),
  }),
])

export type PageElement = z.infer<typeof PageElementSchema>

// BlockAction — action with optional when

export const BlockActionSchema = z.object({
  label: z.string(),
  icon: z.string().optional(),
  action: z.string().optional(),
  to: z.string().optional(),
  workflow: z.string().optional(),
  destructive: z.boolean().optional(),
  when: WhenConditionSchema.optional(),
  entity: z.string().optional(),
})

export type BlockAction = z.infer<typeof BlockActionSchema>

// Column definition (shared)

const ColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string().optional(),
  sortable: z.boolean().optional(),
})

// Field definition (shared)

const FieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string().optional(),
  display: z.enum(['text', 'badge', 'date', 'currency', 'boolean']).optional(),
})

// Display definition (shared)

const DisplaySchema = z.object({
  primary: z.string(),
  secondary: z.string().optional(),
  image: z.string().optional(),
})

// Summary definition (for RelationTable)

const SummarySchema = z.object({
  label: z.string(),
  value: z.object({
    key: z.string(),
    type: z.string().optional(),
  }),
})

// Status definition (for RelationTable)

const StatusRefSchema = z.object({
  field: z.string(),
  label: z.string().optional(),
})

// Block schemas

export const EntityTableSchema = z.object({
  columns: z.array(ColumnSchema).min(1),
  searchable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  pagination: z.boolean().optional(),
  navigateTo: z.string().optional(),
  actions: z.array(BlockActionSchema).optional(),
})

const ActionGroupSchema = z.object({
  actions: z.array(BlockActionSchema).min(1),
})

export const InfoCardSchema = z.object({
  title: z.string(),
  titleField: z.string().optional(),
  statusField: z.string().optional(),
  fields: z.array(FieldSchema).min(1),
  actions: z.array(BlockActionSchema).optional(),
  actionGroups: z.array(ActionGroupSchema).optional(),
})

export const RelationTableSchema = z.object({
  title: z.string(),
  relation: z.string(),
  columns: z.array(ColumnSchema).min(1),
  navigateTo: z.string().optional(),
  actions: z.array(BlockActionSchema).optional(),
  status: StatusRefSchema.optional(),
  summaries: z.array(SummarySchema).optional(),
  footerActions: z.array(BlockActionSchema).optional(),
  pagination: z.boolean().optional(),
})

export const RelationListSchema = z.object({
  title: z.string(),
  relation: z.string(),
  display: DisplaySchema,
  navigateTo: z.string().optional(),
  actions: z.array(BlockActionSchema).optional(),
})

export const MediaCardSchema = z.object({
  title: z.string(),
  field: z.string(),
  actions: z.array(BlockActionSchema).optional(),
})

export const JsonCardSchema = z.object({
  title: z.string(),
  field: z.string(),
  editable: z.boolean().default(false),
  actions: z.array(BlockActionSchema).optional(),
})

export const ActivityCardSchema = z.object({
  title: z.string(),
  relation: z.string(),
  actions: z.array(BlockActionSchema).optional(),
})

const MetricSchema = z.object({
  label: z.string(),
  key: z.string(),
  format: z.enum(['number', 'currency', 'percentage', 'duration']).optional(),
})

export const StatsCardSchema = z.object({
  title: z.string(),
  metrics: z.array(MetricSchema).min(1),
  actions: z.array(BlockActionSchema).optional(),
})

export const TreeListSchema = z.object({
  title: z.string(),
  relation: z.string(),
  display: DisplaySchema,
  childrenKey: z.string(),
  navigateTo: z.string().optional(),
  actions: z.array(BlockActionSchema).optional(),
})

export const ReactBridgeSchema = z.object({
  component: z.string(),
  props: z.record(z.string(), z.unknown()).optional(),
  fallback: z.string().optional(),
})

// Blocks catalog

export const blocksCatalog: Record<string, z.ZodType> = {
  EntityTable: EntityTableSchema,
  InfoCard: InfoCardSchema,
  RelationTable: RelationTableSchema,
  RelationList: RelationListSchema,
  MediaCard: MediaCardSchema,
  JsonCard: JsonCardSchema,
  ActivityCard: ActivityCardSchema,
  StatsCard: StatsCardSchema,
  TreeList: TreeListSchema,
  ReactBridge: ReactBridgeSchema,
}

// Types

export type EntityTable = z.infer<typeof EntityTableSchema>
export type InfoCard = z.infer<typeof InfoCardSchema>
export type RelationTable = z.infer<typeof RelationTableSchema>
export type RelationList = z.infer<typeof RelationListSchema>
export type MediaCard = z.infer<typeof MediaCardSchema>
export type JsonCard = z.infer<typeof JsonCardSchema>
export type ActivityCard = z.infer<typeof ActivityCardSchema>
export type StatsCard = z.infer<typeof StatsCardSchema>
export type TreeList = z.infer<typeof TreeListSchema>
export type ReactBridge = z.infer<typeof ReactBridgeSchema>
