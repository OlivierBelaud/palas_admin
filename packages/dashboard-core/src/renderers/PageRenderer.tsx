// PageRenderer — renders a definePage() spec.
// Each block is autonomous (owns its query). The renderer handles layout and prefetching.

import type { ComponentType } from 'react'
import React, { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { resolveBlock } from '../blocks/block-registry'
import { PageHeaderBlock } from '../blocks/PageHeader'
import { Skeleton } from '../components/common/skeleton'
import type { BlockDef, PageDef } from '../primitives'
import { usePrefetchQueries } from './hooks/usePrefetchQueries'

export interface PageRendererProps {
  spec: PageDef
  customBlocks?: Record<string, ComponentType<any>>
}

function renderBlock(block: BlockDef, index: number, customBlocks?: Record<string, ComponentType<any>>) {
  const BlockComponent = resolveBlock(block.type, customBlocks)
  if (!BlockComponent) {
    return React.createElement(
      'div',
      { key: index, className: 'rounded-lg border border-dashed border-border p-4 text-muted-foreground text-sm' },
      `Unknown block type: ${block.type}`,
    )
  }

  // Extract query and type, pass the rest as props
  const { type: _type, ...blockProps } = block
  return React.createElement(BlockComponent, { key: index, ...blockProps })
}

export function PageRenderer({ spec, customBlocks }: PageRendererProps) {
  const params = useParams()

  // Collect all blocks for prefetching
  const allBlocks = useMemo(() => {
    const blocks = [...spec.main]
    if (spec.sidebar) blocks.push(...spec.sidebar)
    return blocks
  }, [spec])

  // Prefetch consolidated queries into TanStack Query cache
  usePrefetchQueries(allBlocks, params as Record<string, string>)

  const hasSidebar = !!spec.sidebar && spec.sidebar.length > 0

  // Render header if defined
  const header = spec.header
    ? React.createElement(PageHeaderBlock, {
        ...spec.header,
        // If header needs data (titleField, statusField), it needs a query from first block
        query:
          spec.header.titleField || spec.header.descriptionField || spec.header.statusField
            ? spec.main[0]?.query
            : undefined,
      })
    : null

  // Render main blocks
  const mainContent = spec.main.map((block, i) => renderBlock(block, i, customBlocks))

  // Render sidebar blocks
  const sidebarContent = spec.sidebar?.map((block, i) => renderBlock(block, i, customBlocks))

  if (hasSidebar) {
    // Two-column layout
    return React.createElement(
      'div',
      { className: 'flex flex-col gap-y-2' },
      // Header full width
      header,
      // Two-column grid
      React.createElement(
        'div',
        { className: 'flex flex-col gap-x-8 gap-y-4 xl:flex-row xl:items-start' },
        // Main column
        React.createElement('div', { className: 'flex w-full flex-col gap-y-3' }, ...mainContent),
        // Sidebar column
        React.createElement(
          'div',
          { className: 'flex w-full xl:max-w-[440px] flex-col gap-y-3' },
          ...(sidebarContent ?? []),
        ),
      ),
    )
  }

  // Single-column layout
  return React.createElement(
    'div',
    { className: 'flex flex-col gap-y-2' },
    header,
    React.createElement('div', { className: 'flex w-full flex-col gap-y-3' }, ...mainContent),
  )
}
