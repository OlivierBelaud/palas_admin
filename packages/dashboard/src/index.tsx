import React, { useEffect, useMemo, useState } from "react"
import {
  DashboardApp,
  UserMenu,
} from "@manta/dashboard-core"
import { Avatar, Text } from "@medusajs/ui"
import {
  Tag,
  ShoppingCart,
  Buildings,
  Users,
  ReceiptPercent,
  CurrencyDollar,
  CogSixTooth,
  SquaresPlus,
  BuildingStorefront,
  Sparkles,
  ChartBar,
  DocumentText,
  RocketLaunch,
} from "@medusajs/icons"
import { MantaDataSource } from "./manta-data-source"
import { MantaAuthAdapter } from "./manta-auth-adapter"
import { ApiOverrideStore } from "./api-override-store"
import { fetchRegistry, type RegistryResponse } from "./registry-client"
import type { INavItem } from "@manta/dashboard-core"

// ──────────────────────────────────────────────
// Icon name → React element mapping
// ──────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactElement> = {
  Tag: <Tag />,
  ShoppingCart: <ShoppingCart />,
  Buildings: <Buildings />,
  Users: <Users />,
  ReceiptPercent: <ReceiptPercent />,
  CurrencyDollar: <CurrencyDollar />,
  CogSixTooth: <CogSixTooth />,
  SquaresPlus: <SquaresPlus />,
  BuildingStorefront: <BuildingStorefront />,
  Sparkles: <Sparkles />,
  ChartBar: <ChartBar />,
  DocumentText: <DocumentText />,
  RocketLaunch: <RocketLaunch />,
}

function resolveIcon(name?: string): React.ReactElement {
  if (!name) return <SquaresPlus />
  return ICON_MAP[name] || <SquaresPlus />
}

/**
 * Convert registry navigation (icon as string) to DashboardApp navigation (icon as ReactElement)
 */
function resolveNavigation(
  items: Array<{ icon?: string; label: string; to: string; items?: Array<{ label: string; to: string }> }>
): Omit<INavItem, "pathname">[] {
  return items.map((item) => ({
    icon: resolveIcon(item.icon),
    label: item.label,
    to: item.to,
    items: item.items || [],
  }))
}

// ──────────────────────────────────────────────
// Manta header — app name in sidebar top
// ──────────────────────────────────────────────

function MantaHeader({ title }: { title: string }) {
  const fallback = title.slice(0, 1).toUpperCase()

  return (
    <div className="w-full p-3">
      <div className="flex items-center gap-x-3 rounded-md p-0.5 pe-2">
        <Avatar variant="squared" size="xsmall" fallback={fallback} />
        <div className="block overflow-hidden text-start">
          <Text size="small" weight="plus" leading="compact" className="truncate">
            {title}
          </Text>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// MantaDashboard
// ──────────────────────────────────────────────

export interface MantaDashboardProps {
  /** Manta backend API URL (required) */
  apiUrl: string
  /** Base path for the router */
  basename?: string
  /** App title shown in sidebar header */
  title?: string
  /** Custom React routes (e.g. create forms, modals) */
  customRoutes?: import("react-router-dom").RouteObject[]
}

/**
 * MantaDashboard — generic dashboard distribution.
 * Zero knowledge of Medusa. Pages come from the registry at runtime.
 * Shell is empty if no plugins declare admin UI.
 */
export function MantaDashboard({ apiUrl, basename, title = "Manta", customRoutes }: MantaDashboardProps) {
  const [dataSource] = useState(() => new MantaDataSource({ baseUrl: apiUrl }))
  const [authAdapter] = useState(() => new MantaAuthAdapter({ baseUrl: apiUrl }))
  const [overrideStore] = useState(() => new ApiOverrideStore({ apiUrl }))

  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        await overrideStore.initialize()
        const reg = await fetchRegistry(apiUrl)

        // Populate entity maps from registry
        if (reg.endpoints) {
          dataSource.setEntityMaps(reg.endpoints, reg.queryKeys || {})
        }

        if (!cancelled) {
          setRegistry(reg)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          // Fallback: empty registry
          setRegistry({ pages: {}, components: {}, navigation: [] })
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [apiUrl])

  const navigation = useMemo(() => registry ? resolveNavigation(registry.navigation) : [], [registry])
  const defaultRoute = navigation[0]?.to || "/"
  const defaults = useMemo(() => registry ? { pages: registry.pages, components: registry.components } : { pages: {}, components: {} }, [registry])
  const headerSlot = useMemo(() => <MantaHeader title={title} />, [title])
  const userMenuSlot = useMemo(() => <UserMenu />, [])
  const loginProps = useMemo(() => ({
    subtitle: "Sign in to your account",
    defaultRedirect: defaultRoute,
  }), [defaultRoute])

  if (loading || !registry) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-ui-fg-muted">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <DashboardApp
      dataSource={dataSource}
      authAdapter={authAdapter}
      overrideStore={overrideStore}
      defaults={defaults}
      navigation={navigation}
      headerSlot={headerSlot}
      userMenuSlot={userMenuSlot}
      iconMap={ICON_MAP}
      loginProps={loginProps}
      defaultRedirect={defaultRoute}
      basename={basename}
      customRoutes={customRoutes}
    />
  )
}

export default MantaDashboard

// Re-export implementations
export { MantaDataSource } from "./manta-data-source"
export { MantaAuthAdapter } from "./manta-auth-adapter"
export { ApiOverrideStore } from "./api-override-store"
export { fetchRegistry } from "./registry-client"
export type { RegistryResponse } from "./registry-client"
