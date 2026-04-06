import type { INavItem } from '@manta/dashboard-core'
import { DashboardApp, UserMenu } from '@manta/dashboard-core'
import { MantaProvider } from '@manta/sdk'
import { Avatar } from '@manta/ui'
import {
  BarChart3,
  Building2,
  DollarSign,
  FileText,
  LayoutGrid,
  Receipt,
  Rocket,
  Settings,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Users,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ApiOverrideStore } from './api-override-store'
import { MantaAuthAdapter } from './manta-auth-adapter'
import { MantaDataSource } from './manta-data-source'
import { fetchRegistry, type RegistryResponse } from './registry-client'

// ──────────────────────────────────────────────
// Icon name → React element mapping
// ──────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactElement> = {
  Tag: <Tag className="h-4 w-4" />,
  ShoppingCart: <ShoppingCart className="h-4 w-4" />,
  Buildings: <Building2 className="h-4 w-4" />,
  Building2: <Building2 className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  ReceiptPercent: <Receipt className="h-4 w-4" />,
  Receipt: <Receipt className="h-4 w-4" />,
  CurrencyDollar: <DollarSign className="h-4 w-4" />,
  DollarSign: <DollarSign className="h-4 w-4" />,
  CogSixTooth: <Settings className="h-4 w-4" />,
  Settings: <Settings className="h-4 w-4" />,
  SquaresPlus: <LayoutGrid className="h-4 w-4" />,
  LayoutGrid: <LayoutGrid className="h-4 w-4" />,
  BuildingStorefront: <Store className="h-4 w-4" />,
  Store: <Store className="h-4 w-4" />,
  Sparkles: <Sparkles className="h-4 w-4" />,
  ChartBar: <BarChart3 className="h-4 w-4" />,
  BarChart3: <BarChart3 className="h-4 w-4" />,
  DocumentText: <FileText className="h-4 w-4" />,
  FileText: <FileText className="h-4 w-4" />,
  RocketLaunch: <Rocket className="h-4 w-4" />,
  Rocket: <Rocket className="h-4 w-4" />,
}

function resolveIcon(name?: string): React.ReactElement {
  if (!name) return <LayoutGrid className="h-4 w-4" />
  return ICON_MAP[name] || <LayoutGrid className="h-4 w-4" />
}

/**
 * Convert registry navigation (icon as string) to DashboardApp navigation (icon as ReactElement)
 */
function resolveNavigation(
  items: Array<{ icon?: string; label: string; to: string; items?: Array<{ label: string; to: string }> }>,
): Omit<INavItem, 'pathname'>[] {
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
    <div className="flex w-full items-center gap-x-3 px-3" style={{ height: 49 }}>
      <Avatar variant="squared" size="xsmall" fallback={fallback} />
      <span className="text-sm font-semibold tracking-tight">{title}</span>
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
  customRoutes?: import('react-router-dom').RouteObject[]
  /** Inline registry data (skips fetch from /api/admin/registry) */
  registry?: RegistryResponse
  /** Page specs from definePage()/defineForm() — file-based routing */
  pageSpecs?: import('@manta/dashboard-core').DashboardAppProps['pageSpecs']
  /** Custom blocks from the SPA's blocks/ folder */
  customBlocks?: Record<string, React.ComponentType<any>>
  /** SPA configuration from defineSpa() */
  spaConfig?: import('@manta/dashboard-core').SpaDef | null
  /** Command schemas from codegen (for form validation) */
  commandSchemas?: Record<string, unknown[]>
}

/**
 * MantaDashboard — generic dashboard distribution.
 * Zero knowledge of Medusa. Pages come from the registry at runtime.
 * Shell is empty if no plugins declare admin UI.
 */
export function MantaDashboard({
  apiUrl,
  basename,
  title = 'Manta',
  customRoutes,
  registry: inlineRegistry,
  pageSpecs,
  customBlocks,
  spaConfig,
  commandSchemas,
}: MantaDashboardProps) {
  const [dataSource] = useState(() => {
    const ds = new MantaDataSource({ baseUrl: apiUrl })
    return ds
  })
  const [authAdapter] = useState(() => new MantaAuthAdapter({ baseUrl: apiUrl }))
  const [overrideStore] = useState(() => new ApiOverrideStore({ apiUrl }))

  // Wire token refresh: dataSource delegates 401 handling to authAdapter
  useState(() => {
    dataSource.setOnUnauthorized(() => authAdapter.refreshAccessToken())
  })

  // When spaConfig is provided, we don't need the registry to start — navigation comes from config
  const hasStaticConfig = !!spaConfig
  const emptyRegistry: RegistryResponse = { pages: {}, components: {}, navigation: [] }
  const [registry, setRegistry] = useState<RegistryResponse | null>(
    inlineRegistry ?? (hasStaticConfig ? emptyRegistry : null),
  )
  const [loading, setLoading] = useState(!inlineRegistry && !hasStaticConfig)
  const [aiEnabled, setAiEnabled] = useState(spaConfig?.ai ?? false)
  // Track auth state to re-fetch registry after login
  const isAuthenticated = authAdapter.isAuthenticated()

  useEffect(() => {
    // Skip fetch if inline registry was provided
    if (inlineRegistry) return
    // Don't fetch registry until user is authenticated (it requires auth)
    if (!isAuthenticated) return
    // With spaConfig we already have navigation, but still fetch registry for AI + entity maps

    let cancelled = false

    async function load() {
      try {
        await overrideStore.initialize()
        const reg = await fetchRegistry(apiUrl)

        // Populate entity maps from registry
        if (reg.endpoints) {
          dataSource.setEntityMaps(reg.endpoints, reg.queryKeys || {})
        }
        // Enable AI if backend has it configured
        if (reg.ai?.enabled) {
          setAiEnabled(true)
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
    return () => {
      cancelled = true
    }
  }, [apiUrl, inlineRegistry, isAuthenticated])

  // Navigation: spaConfig takes priority over registry
  const navigation = useMemo(() => {
    if (spaConfig?.navigation) {
      return resolveNavigation(spaConfig.navigation)
    }
    return registry ? resolveNavigation(registry.navigation) : []
  }, [registry, spaConfig])
  const defaultRoute = spaConfig?.defaultRedirect || navigation[0]?.to || '/'
  const defaults = useMemo(
    () => (registry ? { pages: registry.pages, components: registry.components } : { pages: {}, components: {} }),
    [registry],
  )
  const displayTitle = spaConfig?.title || title
  const headerSlot = useMemo(() => <MantaHeader title={displayTitle} />, [displayTitle])
  const userMenuSlot = useMemo(() => <UserMenu />, [])
  const loginProps = useMemo(
    () => ({
      subtitle: 'Sign in to your account',
      defaultRedirect: defaultRoute,
    }),
    [defaultRoute],
  )

  if (loading || !registry) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <MantaProvider
      baseUrl={apiUrl}
      context="admin"
      getToken={() => localStorage.getItem('manta-auth-token')}
      onUnauthorized={() => authAdapter.refreshAccessToken()}
    >
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
        pageSpecs={pageSpecs}
        customBlocks={customBlocks}
        commandSchemas={commandSchemas}
        aiEnabled={aiEnabled}
      />
    </MantaProvider>
  )
}

export default MantaDashboard

export { ApiOverrideStore } from './api-override-store'
export { MantaAuthAdapter } from './manta-auth-adapter'
// Re-export implementations
export { MantaDataSource } from './manta-data-source'
export type { RegistryResponse } from './registry-client'
export { fetchRegistry } from './registry-client'
