// InfoCard block — autonomous version that owns its query.
// Wraps the legacy InfoCardRenderer.

import React from 'react'
import { Skeleton } from '../components/common/skeleton'
import type { GraphQueryDef, NamedQueryDef } from '../primitives'
import { InfoCardRenderer } from '../renderers/blocks/info-card'
import { useBlockQuery } from './use-block-query'

export interface InfoCardBlockProps {
  query?: GraphQueryDef | NamedQueryDef
  title: string
  titleField?: string
  statusField?: string
  fields?: Array<{ key: string; label: string; display?: string }>
  actions?: Array<{ label: string; to?: string; action?: string; destructive?: boolean }>
  actionGroups?: Array<{ actions: Array<{ label: string; to?: string; action?: string; destructive?: boolean }> }>
}

export function InfoCardBlock({ query, ...props }: InfoCardBlockProps) {
  const { data, isLoading } = useBlockQuery(query)

  if (isLoading) return React.createElement(Skeleton, { className: 'h-40 w-full' })

  // Derive fields from query.graph.fields if not explicitly provided
  const fields =
    props.fields ??
    (query && 'graph' in query
      ? query.graph.fields?.map((f) => ({
          key: f,
          label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        }))
      : undefined) ??
    []

  return React.createElement(InfoCardRenderer, {
    component: { id: '', type: 'InfoCard', props: { ...props, fields } },
    data: data as Record<string, unknown>,
  })
}
