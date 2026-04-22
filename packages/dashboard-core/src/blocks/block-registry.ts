// Block registry — maps block type names to their autonomous React components.
// Used by PageRenderer to resolve blocks from definePage() specs.

import type { ComponentType } from 'react'
import { CardBlock } from './Card'
import { DataListBlock } from './DataList'
import { DataTableBlock } from './DataTable'
import { InfoCardBlock } from './InfoCard'
import { MediaCardBlock } from './MediaCard'
import { PageHeaderBlock } from './PageHeader'
import { RelationTableBlock } from './RelationTable'
import { StatsCardBlock } from './StatsCard'

const frameworkBlocks: Record<string, ComponentType<any>> = {
  Card: CardBlock,
  DataList: DataListBlock,
  DataTable: DataTableBlock,
  EntityTable: DataTableBlock, // alias for backward compat
  InfoCard: InfoCardBlock,
  MediaCard: MediaCardBlock,
  PageHeader: PageHeaderBlock,
  RelationTable: RelationTableBlock,
  StatsCard: StatsCardBlock,
}

/**
 * Resolve a block component by type name.
 * Priority: custom blocks (from app's blocks/ folder) > framework blocks.
 */
export function resolveBlock(
  type: string,
  customBlocks?: Record<string, ComponentType<any>>,
): ComponentType<any> | undefined {
  return customBlocks?.[type] ?? frameworkBlocks[type]
}
