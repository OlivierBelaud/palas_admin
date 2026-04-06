import { ActivityCardRenderer } from './blocks/activity-card'
import { EntityTableRenderer } from './blocks/entity-table'
import { InfoCardRenderer } from './blocks/info-card'
import { JsonCardRenderer } from './blocks/json-card'
import { MediaCardRenderer } from './blocks/media-card'
import { PageHeaderRenderer } from './blocks/page-header'
import { ReactBridgeRenderer } from './blocks/react-bridge'
import { RelationListRenderer } from './blocks/relation-list'
import { RelationTableRenderer } from './blocks/relation-table'
import type { BlockRenderer } from './blocks/shared'
import { StatsCardRenderer } from './blocks/stats-card'
import { TreeListRenderer } from './blocks/tree-list'

export type { BlockRenderer, BlockRendererProps } from './blocks/shared'
export { formatValue } from './blocks/shared'

// ──────────────────────────────────────────────
// Renderer registry
// ──────────────────────────────────────────────

const rendererRegistry: Record<string, BlockRenderer> = {}

export function registerRenderer(type: string, renderer: BlockRenderer) {
  rendererRegistry[type] = renderer
}

export function getRenderer(type: string): BlockRenderer | undefined {
  return rendererRegistry[type]
}

// ──────────────────────────────────────────────
// Register all block renderers
// ──────────────────────────────────────────────

registerRenderer('PageHeader', PageHeaderRenderer)
registerRenderer('InfoCard', InfoCardRenderer)
registerRenderer('EntityTable', EntityTableRenderer)
registerRenderer('RelationTable', RelationTableRenderer)
registerRenderer('RelationList', RelationListRenderer)
registerRenderer('MediaCard', MediaCardRenderer)
registerRenderer('JsonCard', JsonCardRenderer)
registerRenderer('ActivityCard', ActivityCardRenderer)
registerRenderer('StatsCard', StatsCardRenderer)
registerRenderer('TreeList', TreeListRenderer)
registerRenderer('ReactBridge', ReactBridgeRenderer)
