import { Card } from '@manta/ui'
import React, { useMemo } from 'react'
import { Outlet } from 'react-router-dom'
import { Skeleton } from '../components/common/skeleton'
import { useDashboardContext } from '../context'
import type { Resolver } from '../override/create-resolver'
import type { PageSpec } from '../pages/types'
import { useSpecQuery } from './hooks/useSpecQuery'
import { getRenderer } from './index'

// ──────────────────────────────────────────────
// SpecRenderer
// ──────────────────────────────────────────────

interface SpecRendererProps {
  spec: PageSpec
  resolver: Resolver
  params?: Record<string, string>
}

export function SpecRenderer({ spec, resolver, params }: SpecRendererProps) {
  const { dataSource, overridesVersion: _overrideVersion } = useDashboardContext()

  // Re-resolve the page spec to pick up runtime overrides
  const resolvedSpec = useMemo(() => {
    const overridden = resolver.resolvePageSpec(spec.id)
    return overridden || spec
  }, [spec, resolver, _overrideVersion])

  // Delegate all data fetching to the hook
  const { data, items, rawData, isLoading, error } = useSpecQuery({
    resolvedSpec,
    params,
    dataSource,
  })

  // Only show skeleton on very first load (no data yet)
  if (isLoading && !rawData) {
    return React.createElement(
      'div',
      { className: 'flex flex-col gap-y-3' },
      React.createElement(
        Card,
        { className: 'p-6' },
        React.createElement(
          'div',
          { className: 'flex flex-col gap-y-3' },
          React.createElement(Skeleton, { className: 'h-6 w-48' }),
          React.createElement(Skeleton, { className: 'h-4 w-full' }),
          React.createElement(Skeleton, { className: 'h-4 w-3/4' }),
          React.createElement(Skeleton, { className: 'h-4 w-1/2' }),
        ),
      ),
    )
  }

  if (error) {
    return React.createElement(
      Card,
      {
        className: 'p-6 border-destructive/50 bg-destructive/10',
      },
      React.createElement('h2', { className: 'text-lg font-semibold' }, 'Error loading data'),
      React.createElement(
        'p',
        {
          className: 'text-sm text-destructive mt-1',
        },
        error.message,
      ),
    )
  }

  function renderElement(ref: string) {
    const component = resolver.resolveComponent(ref)
    if (!component) {
      return React.createElement(
        Card,
        {
          key: ref,
          className: 'p-6 text-center text-muted-foreground',
        },
        `Component not found: ${ref}`,
      )
    }

    const Renderer = getRenderer(component.type)
    if (!Renderer) {
      return React.createElement(
        Card,
        {
          key: ref,
          className: 'p-6 text-center text-muted-foreground',
        },
        `No renderer for type: ${component.type}`,
      )
    }

    const componentData = resolvedSpec.type === 'list' ? { ...data, items } : data

    return React.createElement(Renderer, {
      key: ref,
      component,
      data: componentData as Record<string, unknown>,
    })
  }

  function renderElements(elements: Array<string | { ref: string }>) {
    return elements.map((el) => {
      const ref = typeof el === 'string' ? el : el.ref
      return renderElement(ref)
    })
  }

  // Always render Outlet — detail pages use it for form modals, list pages for create modals
  const outlet =
    resolvedSpec.type === 'detail' || resolvedSpec.type === 'list' ? React.createElement(Outlet, null) : null

  if (resolvedSpec.layout === 'two-column') {
    // Split main elements: PageHeader spans full width, rest goes in left column
    const fullWidthElements: Array<string | { ref: string }> = []
    const columnElements: Array<string | { ref: string }> = []
    for (const el of resolvedSpec.main) {
      const ref = typeof el === 'string' ? el : el.ref
      const comp = resolver.resolveComponent(ref)
      if (comp?.type === 'PageHeader') {
        fullWidthElements.push(el)
      } else {
        columnElements.push(el)
      }
    }

    return React.createElement(
      React.Fragment,
      null,
      // PageHeader(s) — full width, above the grid
      fullWidthElements.length > 0 ? renderElements(fullWidthElements) : null,
      // Two-column grid
      React.createElement(
        'div',
        {
          className: 'flex w-full flex-col items-start gap-x-4 gap-y-3 xl:grid xl:grid-cols-[minmax(0,_1fr)_440px]',
        },
        React.createElement(
          'div',
          {
            className: 'flex flex-col gap-y-3',
          },
          renderElements(columnElements),
        ),
        resolvedSpec.sidebar
          ? React.createElement(
              'div',
              {
                className: 'flex flex-col gap-y-3',
              },
              renderElements(resolvedSpec.sidebar),
            )
          : null,
      ),
      outlet,
    )
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      {
        className: 'flex flex-col gap-y-3',
      },
      renderElements(resolvedSpec.main),
    ),
    outlet,
  )
}
