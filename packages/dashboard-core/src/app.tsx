import { useCallback, useMemo, useRef, useSyncExternalStore } from "react"
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Outlet,
  useParams,
  useLocation,
} from "react-router-dom"
import type { RouteObject } from "react-router-dom"
import type { QueryClient } from "@tanstack/react-query"
import { MainLayout } from "./shell/main-layout"
import type { MainLayoutProps } from "./shell/main-layout"
import { ProtectedRoute } from "./shell/auth-guard"
import { LoginPage } from "./shell/login-page"
import type { LoginPageProps } from "./shell/login-page"
import { SpecRenderer } from "./renderers/SpecRenderer"
import { createResolver } from "./override/create-resolver"
import { defineConfig } from "./override/define-config"
import type { DashboardConfig } from "./override/define-config"
import { buildRouteMap } from "./shell/route-builder"
import { buildBreadcrumbHandle } from "./shell/page-breadcrumb"
import { ErrorBoundary } from "./shell/error-boundary"
import { Providers } from "./providers/providers"
import { DashboardContext } from "./context"
import type { DashboardContextValue } from "./context"
import type { DataSource } from "./interfaces/data-source"
import type { AuthAdapter } from "./interfaces/auth-adapter"
import type { OverrideStore } from "./interfaces/override-store"
import type { Resolver } from "./override/create-resolver"
import type { PageSpec, DataComponent } from "./pages/types"
import type { ExtensionAPI } from "./providers/extension-provider"
import type { INavItem } from "./shell/nav-item"
import { createQueryClient } from "./lib/query-client"
import { ReactNode } from "react"
import { setDashboardAdapters, getOverrideStore, subscribe, getOverridesVersion } from "./globals"

// Import renderers to trigger registration
import "./renderers/index"

export interface DashboardAppProps {
  dataSource: DataSource
  authAdapter: AuthAdapter
  overrideStore: OverrideStore
  defaults: { pages: Record<string, PageSpec>; components: Record<string, DataComponent> }
  navigation: Omit<INavItem, "pathname">[]
  formRoutes?: Record<string, RouteObject[]>
  config?: Partial<DashboardConfig>
  basename?: string
  /** Login page props */
  loginProps?: LoginPageProps
  /** Header slot for MainLayout */
  headerSlot?: ReactNode
  /** User menu slot for MainLayout */
  userMenuSlot?: ReactNode
  /** Icon map for navigation override rendering */
  iconMap?: Record<string, React.ReactElement>
  /** Extension API for plugins */
  extensionApi?: ExtensionAPI
  /** Default redirect from / */
  defaultRedirect?: string
  /** QueryClient (created if not provided) */
  queryClient?: QueryClient
  /** Extra provider wrapper (e.g. for Medusa's ExtensionContext) */
  extraProviders?: (props: { children: ReactNode }) => ReactNode
  /** Custom React routes injected into the main layout */
  customRoutes?: RouteObject[]
}

// Page wrapper
function PageWrapper({
  spec,
  resolver,
}: {
  spec: PageSpec
  resolver: Resolver
}) {
  const params = useParams()
  return (
    <SpecRenderer
      spec={spec}
      resolver={resolver}
      params={params as Record<string, string>}
    />
  )
}

// Custom page wrapper
function CustomPageWrapper({
  resolver,
}: {
  resolver: Resolver
}) {
  const location = useLocation()
  const _v = useSyncExternalStore(subscribe, getOverridesVersion)

  const customPages = getOverrideStore().getCustomPages()
  const pageId = Object.keys(customPages).find((id) => {
    const page = customPages[id]
    return page.route && location.pathname === page.route
  })

  if (!pageId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-ui-fg-muted">Page not found</p>
      </div>
    )
  }

  const spec = customPages[pageId]
  return <SpecRenderer spec={spec} resolver={resolver} params={{}} />
}

const defaultApi: ExtensionAPI = {
  getWidgets: () => [],
  getMenu: () => [],
}

export function DashboardApp({
  dataSource,
  authAdapter,
  overrideStore,
  defaults,
  navigation,
  formRoutes = {},
  config = {},
  basename,
  loginProps,
  headerSlot,
  userMenuSlot,
  iconMap,
  extensionApi,
  defaultRedirect = "orders",
  queryClient: externalQueryClient,
  extraProviders: ExtraProviders,
  customRoutes = [],
}: DashboardAppProps) {
  // Set module-level singletons — stable references for SpecRenderer etc.
  setDashboardAdapters(dataSource, authAdapter, overrideStore)

  const queryClient = useMemo(
    () => externalQueryClient || createQueryClient(),
    [externalQueryClient]
  )

  const contextValue: DashboardContextValue = useMemo(
    () => ({ dataSource, authAdapter, overrideStore }),
    [dataSource, authAdapter, overrideStore]
  )

  // Stable config ref — config is {} by default which creates new ref each render
  const configRef = useRef(config)
  const defaultsRef = useRef(defaults)

  const resolver = useMemo(
    () => createResolver(defineConfig(configRef.current), defaultsRef.current, overrideStore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrideStore]
  )

  const routeMap = useMemo(() => buildRouteMap(resolver), [resolver])

  const router = useMemo(() => {
    const validEntries = routeMap
      .filter((entry) => entry.pageId && resolver.resolvePageSpec(entry.pageId))
      .map((entry) => {
        const spec = resolver.resolvePageSpec(entry.pageId!)!
        return { entry, spec }
      })

    const listingByPath = new Map<string, { entry: typeof validEntries[0]["entry"]; spec: PageSpec }>()
    for (const { entry, spec } of validEntries) {
      if (spec.type === "list") {
        listingByPath.set(entry.path, { entry, spec })
      }
    }

    const nestedDetailPaths = new Set<string>()
    const childRoutes: Array<Record<string, unknown>> = []

    for (const { entry, spec } of validEntries) {
      if (spec.type !== "list") continue

      const listingPath = entry.path.replace(/^\//, "")
      const handle = buildBreadcrumbHandle(spec)

      const detailChildren: Array<Record<string, unknown>> = []
      for (const { entry: dEntry, spec: dSpec } of validEntries) {
        if (dSpec.type !== "detail") continue
        const dPath = dEntry.path
        if (dPath.startsWith(entry.path + "/")) {
          const remainder = dPath.slice(entry.path.length + 1)
          if (remainder.startsWith(":") && !remainder.includes("/")) {
            nestedDetailPaths.add(dPath)
            const dHandle = buildBreadcrumbHandle(dSpec)
            const detailFormRoutes = formRoutes[dPath] || []
            detailChildren.push({
              path: remainder,
              handle: dHandle,
              element: <PageWrapper spec={dSpec} resolver={resolver} />,
              ...(detailFormRoutes.length > 0 ? { children: detailFormRoutes } : {}),
            })
          }
        }
      }

      // Find custom routes that belong under this listing path
      const matchingCustomRoutes = customRoutes.filter((cr) => {
        const crPath = typeof cr.path === "string" ? cr.path : ""
        return crPath.startsWith(listingPath + "/")
      }).map((cr) => ({
        ...cr,
        path: typeof cr.path === "string" ? cr.path.slice(listingPath.length + 1) : cr.path,
      }))

      // Always use Outlet + index pattern so child routes (detail, create, custom) render as overlays
      childRoutes.push({
        path: listingPath,
        handle,
        element: <Outlet />,
        errorElement: <ErrorBoundary />,
        children: [
          {
            index: true,
            element: <PageWrapper spec={spec} resolver={resolver} />,
          },
          ...detailChildren,
          ...matchingCustomRoutes,
        ],
      })
    }

    for (const { entry, spec } of validEntries) {
      if (spec.type === "list") continue
      if (nestedDetailPaths.has(entry.path)) continue
      const handle = buildBreadcrumbHandle(spec)
      const detailFormRoutes = formRoutes[entry.path] || []
      childRoutes.push({
        path: entry.path.replace(/^\//, ""),
        handle,
        errorElement: <ErrorBoundary />,
        element: <PageWrapper spec={spec} resolver={resolver} />,
        ...(detailFormRoutes.length > 0 ? { children: detailFormRoutes } : {}),
      })
    }

    return createBrowserRouter(
      [
        {
          path: "/login",
          element: <LoginPage {...loginProps} />,
        },
        {
          path: "/",
          element: <ProtectedRoute />,
          errorElement: <ErrorBoundary />,
          children: [
            {
              element: (
                <MainLayout
                  navigation={navigation}
                  headerSlot={headerSlot}
                  userMenuSlot={userMenuSlot}
                  iconMap={iconMap}
                />
              ),
              errorElement: <ErrorBoundary />,
              children: [
                {
                  index: true,
                  element: <Navigate to={defaultRedirect} replace />,
                },
                ...childRoutes,
                ...customRoutes,
                {
                  path: "*",
                  element: <CustomPageWrapper resolver={resolver} />,
                },
              ],
            },
          ],
        },
        {
          path: "*",
          element: <Navigate to={`/${defaultRedirect}`} replace />,
        },
      ],
      { basename }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver, routeMap])

  const api = useMemo(() => extensionApi || defaultApi, [extensionApi])

  if (ExtraProviders) {
    return (
      <DashboardContext.Provider value={contextValue}>
        <Providers api={api} queryClient={queryClient}>
          <ExtraProviders>
            <RouterProvider router={router} />
          </ExtraProviders>
        </Providers>
      </DashboardContext.Provider>
    )
  }

  return (
    <DashboardContext.Provider value={contextValue}>
      <Providers api={api} queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>
    </DashboardContext.Provider>
  )
}
