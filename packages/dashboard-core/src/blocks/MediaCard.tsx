// MediaCard block — autonomous version that owns its query.
// Wraps the legacy MediaCardRenderer.

import React from 'react'
import { Skeleton } from '../components/common/skeleton'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import { MediaCardRenderer } from '../renderers/blocks/media-card'
import { useBlockQuery } from './use-block-query'

export interface MediaCardBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title?: string
  field?: string
  actions?: Array<{ label: string; to?: string }>
}

export function MediaCardBlock({ query, ...props }: MediaCardBlockProps) {
  const { data, isLoading } = useBlockQuery(query)

  if (isLoading) return React.createElement(Skeleton, { className: 'h-40 w-full' })

  // Derive field from graph query relation if not provided
  const field = props.field ?? (query && 'graph' in query ? query.graph.relations?.[0] : undefined) ?? 'images'

  return React.createElement(MediaCardRenderer, {
    component: {
      id: '',
      type: 'MediaCard',
      props: { ...props, title: props.title ?? 'Media', field },
    },
    data: data as Record<string, unknown>,
  })
}
