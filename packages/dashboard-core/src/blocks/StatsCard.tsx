// StatsCard block — autonomous version that owns its query.
// Wraps the legacy StatsCardRenderer.

import React from 'react'
import { Skeleton } from '../components/common/skeleton'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import { StatsCardRenderer } from '../renderers/blocks/stats-card'
import { useBlockQuery } from './use-block-query'

export interface StatsCardBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title?: string
  metrics: Array<{ key: string; label: string; format?: string }>
}

export function StatsCardBlock({ query, ...props }: StatsCardBlockProps) {
  const { data, isLoading } = useBlockQuery(query)

  if (isLoading) return React.createElement(Skeleton, { className: 'h-32 w-full' })

  return React.createElement(StatsCardRenderer, {
    component: {
      id: '',
      type: 'StatsCard',
      props: { ...props, title: props.title ?? 'Stats' },
    },
    data: data as Record<string, unknown>,
  })
}
