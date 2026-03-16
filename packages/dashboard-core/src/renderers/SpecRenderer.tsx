import React, { useMemo, useSyncExternalStore } from "react"
import { Outlet, useSearchParams } from "react-router-dom"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { Container, Heading, Text, Skeleton } from "@medusajs/ui"
import type { PageSpec } from "../pages/types"
import type { Resolver } from "../override/create-resolver"
import { buildQueryParams } from "../data/build-query-params"
import { getDataSource, subscribe, getOverridesVersion } from "../globals"
import { getRenderer } from "./index"

// ──────────────────────────────────────────────
// Build the full URL for a fetch request
// ──────────────────────────────────────────────

function buildFetchUrl(
  spec: PageSpec,
  state: Record<string, unknown>,
  searchParams: URLSearchParams,
  entityToEndpoint: (entity: string) => string
): string {
  const shim = { entityToEndpoint, baseUrl: "", getQueryKey: () => "", fetch: async () => ({}), mutate: async () => ({}) }
  const { endpoint, params: queryParams } = buildQueryParams(spec.query, state, shim as any)

  const url = new URL(endpoint, window.location.origin)
  const systemParams = new Set(["fields", "limit", "offset", "q", "order"])
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      if (systemParams.has(key)) {
        url.searchParams.set(key, String(value))
      } else {
        url.searchParams.append(`${key}[]`, String(value))
      }
    }
  }

  if (spec.type === "list") {
    const urlLimit = searchParams.get("limit")
    url.searchParams.set("limit", urlLimit || "15")
    const urlQ = searchParams.get("q") || ""
    const urlOffset = searchParams.get("offset") || ""
    const urlOrder = searchParams.get("order") || ""
    if (urlQ) url.searchParams.set("q", urlQ)
    if (urlOffset) url.searchParams.set("offset", urlOffset)
    if (urlOrder) url.searchParams.set("order", urlOrder)

    const reserved = new Set(["q", "offset", "order", "limit"])
    searchParams.forEach((value, key) => {
      if (!reserved.has(key) && value) {
        const values = value.split(",")
        for (const v of values) {
          url.searchParams.append(`${key}[]`, v)
        }
      }
    })
  }

  return url.toString()
}

// ──────────────────────────────────────────────
// SpecRenderer
// ──────────────────────────────────────────────

interface SpecRendererProps {
  spec: PageSpec
  resolver: Resolver
  params?: Record<string, string>
}

export function SpecRenderer({ spec, resolver, params }: SpecRendererProps) {
  const dataSource = getDataSource()

  // Subscribe to runtime override changes — stable module-level functions
  const _overrideVersion = useSyncExternalStore(subscribe, getOverridesVersion)

  // Re-resolve the page spec to pick up runtime overrides
  const resolvedSpec = useMemo(() => {
    const overridden = resolver.resolvePageSpec(spec.id)
    return overridden || spec
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, resolver, _overrideVersion])

  const [searchParams] = useSearchParams()

  const state: Record<string, unknown> = {
    route: { params: params || {} },
  }

  // Stable search params key for useQuery
  const searchParamsKey = useMemo(() => {
    const entries: Record<string, string> = {}
    searchParams.forEach((v, k) => { entries[k] = v })
    return JSON.stringify(entries)
  }, [searchParams])

  // Build query key
  const entityKey = dataSource.getQueryKey(resolvedSpec.query.entity)
  const resolvedId = resolvedSpec.query.id
    ? typeof resolvedSpec.query.id === "object" && "$state" in resolvedSpec.query.id
      ? (params || {})[resolvedSpec.query.id.$state.split("/").pop() || "id"]
      : String(resolvedSpec.query.id)
    : undefined

  const specFiltersKey = useMemo(
    () => resolvedSpec.query.filters ? JSON.stringify(resolvedSpec.query.filters) : "",
    [resolvedSpec.query.filters]
  )

  const queryKey = useMemo(() => {
    if (resolvedSpec.type === "detail" && resolvedId) {
      return [entityKey, "detail", resolvedId]
    }
    return [entityKey, "list", { search: searchParamsKey, pageId: resolvedSpec.id, filters: specFiltersKey }]
  }, [entityKey, resolvedSpec.type, resolvedSpec.id, resolvedId, searchParamsKey, specFiltersKey])

  const fetchUrl = useMemo(
    () => buildFetchUrl(resolvedSpec, state, searchParams, dataSource.entityToEndpoint.bind(dataSource)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedSpec, JSON.stringify(params), searchParamsKey]
  )

  const { data: rawData, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(fetchUrl, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json()
    },
    // Keep previous data visible while refetching — no skeleton flash
    placeholderData: keepPreviousData,
  })

  // Parse response into data/items
  const { data, items } = useMemo(() => {
    if (!rawData) return { data: {} as Record<string, unknown>, items: [] as unknown[] }

    if (resolvedSpec.type === "list") {
      const keys = Object.keys(rawData).filter((k) => Array.isArray(rawData[k]))
      return {
        data: rawData as Record<string, unknown>,
        items: keys.length > 0 ? rawData[keys[0]] : [],
      }
    }

    const keys = Object.keys(rawData).filter(
      (k) => typeof rawData[k] === "object" && !Array.isArray(rawData[k])
    )
    return {
      data: keys.length > 0 ? rawData[keys[0]] : rawData,
      items: [] as unknown[],
    }
  }, [rawData, resolvedSpec.type])

  // Only show skeleton on very first load (no data yet)
  if (isLoading && !rawData) {
    return React.createElement("div", { className: "flex flex-col gap-y-3" },
      React.createElement(Container, { className: "p-6" },
        React.createElement("div", { className: "flex flex-col gap-y-3" },
          React.createElement(Skeleton, { className: "h-6 w-48" }),
          React.createElement(Skeleton, { className: "h-4 w-full" }),
          React.createElement(Skeleton, { className: "h-4 w-3/4" }),
          React.createElement(Skeleton, { className: "h-4 w-1/2" })
        )
      )
    )
  }

  if (error) {
    return React.createElement(Container, {
      className: "p-6 border-ui-tag-red-border bg-ui-tag-red-bg",
    },
      React.createElement(Heading, { level: "h2" }, "Error loading data"),
      React.createElement(Text, {
        size: "small",
        className: "text-ui-fg-error mt-1",
      }, (error as Error).message)
    )
  }

  function renderElement(ref: string) {
    const component = resolver.resolveComponent(ref)
    if (!component) {
      return React.createElement(Container, {
        key: ref,
        className: "p-6 text-center text-ui-fg-muted",
      }, `Component not found: ${ref}`)
    }

    const Renderer = getRenderer(component.type)
    if (!Renderer) {
      return React.createElement(Container, {
        key: ref,
        className: "p-6 text-center text-ui-fg-muted",
      }, `No renderer for type: ${component.type}`)
    }

    const componentData = resolvedSpec.type === "list"
      ? { ...data, items }
      : data

    return React.createElement(Renderer, {
      key: ref,
      component,
      data: componentData as Record<string, unknown>,
    })
  }

  function renderElements(elements: Array<string | { ref: string }>) {
    return elements.map((el) => {
      const ref = typeof el === "string" ? el : el.ref
      return renderElement(ref)
    })
  }

  // Always render Outlet — detail pages use it for form modals, list pages for create modals
  const outlet = (resolvedSpec.type === "detail" || resolvedSpec.type === "list")
    ? React.createElement(Outlet, null)
    : null

  if (resolvedSpec.layout === "two-column") {
    return React.createElement(React.Fragment, null,
      React.createElement("div", {
        className: "flex w-full flex-col items-start gap-x-4 gap-y-3 xl:grid xl:grid-cols-[minmax(0,_1fr)_440px]",
      },
        React.createElement("div", {
          className: "flex flex-col gap-y-3",
        }, renderElements(resolvedSpec.main)),
        resolvedSpec.sidebar
          ? React.createElement("div", {
              className: "flex flex-col gap-y-3",
            }, renderElements(resolvedSpec.sidebar))
          : null
      ),
      outlet
    )
  }

  return React.createElement(React.Fragment, null,
    React.createElement("div", {
      className: "flex flex-col gap-y-3",
    }, renderElements(resolvedSpec.main)),
    outlet
  )
}
