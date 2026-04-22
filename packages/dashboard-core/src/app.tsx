import type { QueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useParams } from 'react-router-dom'
import type { DashboardContextValue } from './context'
import { DashboardContext, useDashboardContext } from './context'
import type { AuthAdapter } from './interfaces/auth-adapter'
import type { DataSource } from './interfaces/data-source'
import type { OverrideStore } from './interfaces/override-store'
import { createQueryClient } from './lib/query-client'
import type { Resolver } from './override/create-resolver'
import { createResolver } from './override/create-resolver'
import type { DashboardConfig } from './override/define-config'
import { defineConfig } from './override/define-config'
import type { DataComponent, PageSpec } from './pages/types'
import { WorkflowStatusPage } from './pages/workflow-status-page'
import type { FormDef, PageDef } from './primitives'
import type { ExtensionAPI } from './providers/extension-provider'
import { Providers } from './providers/providers'
import { FormRenderer } from './renderers/FormRenderer'
import { PageRenderer } from './renderers/PageRenderer'
import { SpecRenderer } from './renderers/SpecRenderer'
import { ProtectedRoute } from './shell/auth-guard'
import { ErrorBoundary } from './shell/error-boundary'
import type { LoginPageProps } from './shell/login-page'
import { LoginPage } from './shell/login-page'
import { MainLayout } from './shell/main-layout'
import type { INavItem } from './shell/nav-item'
import { buildBreadcrumbHandle } from './shell/page-breadcrumb'
import { buildRouteMap } from './shell/route-builder'
import { ActiveRunsBridge } from './workflow'

// Import renderers to trigger registration
import './renderers/index'

export interface DashboardAppProps {
  dataSource: DataSource
  authAdapter: AuthAdapter
  overrideStore: OverrideStore
  defaults: { pages: Record<string, PageSpec>; components: Record<string, DataComponent> }
  navigation: Omit<INavItem, 'pathname'>[]
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
  /** Page specs from definePage()/defineForm() — file-based routing */
  pageSpecs?: Array<{ route: string; spec: PageDef | FormDef; isForm?: boolean }>
  /** Custom blocks from the SPA's blocks/ folder */
  customBlocks?: Record<string, React.ComponentType<any>>
  /** Command schemas from codegen (for form validation) */
  commandSchemas?: Record<string, unknown[]>
  /** Initial value for the AI feature flag */
  aiEnabled?: boolean
}

// Page wrapper
function PageWrapper({ spec, resolver }: { spec: PageSpec; resolver: Resolver }) {
  const params = useParams()
  return <SpecRenderer spec={spec} resolver={resolver} params={params as Record<string, string>} />
}

// Custom page wrapper
function CustomPageWrapper({ resolver }: { resolver: Resolver }) {
  const location = useLocation()
  const { overrideStore, overridesVersion: _v } = useDashboardContext()

  const customPages = overrideStore.getCustomPages()
  const pageId = Object.keys(customPages).find((id) => {
    const page = customPages[id]
    return page.route && location.pathname === page.route
  })

  if (!pageId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Page not found</p>
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
  defaultRedirect = 'orders',
  queryClient: externalQueryClient,
  extraProviders: ExtraProviders,
  customRoutes = [],
  pageSpecs = [],
  customBlocks,
  commandSchemas,
  aiEnabled: initialAiEnabled = false,
}: DashboardAppProps) {
  const queryClient = useMemo(() => externalQueryClient || createQueryClient(), [externalQueryClient])

  // AI feature flag state
  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled)

  // Default navigation state (set by MainLayout, read by AI chat)
  // biome-ignore lint/suspicious/noExplicitAny: navigation items are dynamic
  const [defaultNavigation, setDefaultNavigation] = useState<any[]>([])

  // Subscribe to override store version for reactivity
  const subscribeToStore = useCallback((cb: () => void) => overrideStore.subscribe(cb), [overrideStore])
  const getStoreVersion = useCallback(() => overrideStore.getVersion(), [overrideStore])
  const overridesVersion = useSyncExternalStore(subscribeToStore, getStoreVersion)

  const contextValue: DashboardContextValue = useMemo(
    () => ({
      dataSource,
      authAdapter,
      overrideStore,
      overridesVersion,
      aiEnabled,
      setAiEnabled,
      defaultNavigation,
      setDefaultNavigation,
    }),
    [dataSource, authAdapter, overrideStore, overridesVersion, aiEnabled, defaultNavigation],
  )

  // Stable config ref — config is {} by default which creates new ref each render
  const configRef = useRef(config)
  const defaultsRef = useRef(defaults)

  const resolver = useMemo(
    () => createResolver(defineConfig(configRef.current), defaultsRef.current, overrideStore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overrideStore],
  )

  const routeMap = useMemo(() => buildRouteMap(resolver), [resolver])

  const router = useMemo(() => {
    const validEntries = routeMap
      .filter((entry) => entry.pageId && resolver.resolvePageSpec(entry.pageId))
      .map((entry) => {
        const spec = resolver.resolvePageSpec(entry.pageId!)!
        return { entry, spec }
      })

    const listingByPath = new Map<string, { entry: (typeof validEntries)[0]['entry']; spec: PageSpec }>()
    for (const { entry, spec } of validEntries) {
      if (spec.type === 'list') {
        listingByPath.set(entry.path, { entry, spec })
      }
    }

    const nestedDetailPaths = new Set<string>()
    const childRoutes: Array<Record<string, unknown>> = []

    for (const { entry, spec } of validEntries) {
      if (spec.type !== 'list') continue

      const listingPath = entry.path.replace(/^\//, '')
      const handle = buildBreadcrumbHandle(spec)

      const detailChildren: Array<Record<string, unknown>> = []
      for (const { entry: dEntry, spec: dSpec } of validEntries) {
        if (dSpec.type !== 'detail') continue
        const dPath = dEntry.path
        if (dPath.startsWith(`${entry.path}/`)) {
          const remainder = dPath.slice(entry.path.length + 1)
          if (remainder.startsWith(':') && !remainder.includes('/')) {
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
      const matchingCustomRoutes = customRoutes
        .filter((cr) => {
          const crPath = typeof cr.path === 'string' ? cr.path : ''
          return crPath.startsWith(`${listingPath}/`)
        })
        .map((cr) => ({
          ...cr,
          path: typeof cr.path === 'string' ? cr.path.slice(listingPath.length + 1) : cr.path,
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
      if (spec.type === 'list') continue
      if (nestedDetailPaths.has(entry.path)) continue
      const handle = buildBreadcrumbHandle(spec)
      const detailFormRoutes = formRoutes[entry.path] || []
      childRoutes.push({
        path: entry.path.replace(/^\//, ''),
        handle,
        errorElement: <ErrorBoundary />,
        element: <PageWrapper spec={spec} resolver={resolver} />,
        ...(detailFormRoutes.length > 0 ? { children: detailFormRoutes } : {}),
      })
    }

    // Build routes from definePage/defineForm specs
    // Strategy: identify list pages, nest detail + form pages under them (same as registry system)
    const specRoutes: RouteObject[] = []

    const isForm = (ps: (typeof pageSpecs)[0]) => ps.isForm || 'command' in ps.spec
    const pages = pageSpecs.filter((ps) => !isForm(ps))
    const forms = pageSpecs.filter((ps) => isForm(ps))

    // Sort pages by route depth (shallowest first) so list pages come before detail
    const sortedPages = [...pages].sort((a, b) => a.route.split('/').length - b.route.split('/').length)

    // Track which pages are nested under a parent list page
    const nestedPaths = new Set<string>()

    for (const page of sortedPages) {
      const routePath = page.route.replace(/^\//, '')

      // Find detail pages that are direct children (e.g., /customers/:id under /customers)
      const detailChildren: RouteObject[] = []
      for (const detail of sortedPages) {
        if (detail === page) continue
        if (!detail.route.startsWith(`${page.route}/`)) continue
        const remainder = detail.route.slice(page.route.length + 1)
        // Only nest direct :param children (e.g., :id but not :id/something)
        if (!remainder.startsWith(':') || remainder.includes('/')) continue

        nestedPaths.add(detail.route)

        // Find forms under this detail page (e.g., /customers/:id/edit)
        const detailForms = forms
          .filter((f) => {
            const parentPath = f.route.replace(/\/[^/]+$/, '')
            return parentPath === detail.route
          })
          .map((f) => ({
            path: f.route.slice(detail.route.length + 1),
            element: (
              <FormRenderer
                spec={f.spec as FormDef}
                customBlocks={customBlocks}
                commandSchemas={commandSchemas as any}
              />
            ),
            errorElement: <ErrorBoundary />,
          }))

        detailChildren.push({
          path: remainder,
          element:
            detailForms.length > 0 ? (
              <div>
                <PageRenderer spec={detail.spec as PageDef} customBlocks={customBlocks} />
                <Outlet />
              </div>
            ) : (
              <PageRenderer spec={detail.spec as PageDef} customBlocks={customBlocks} />
            ),
          errorElement: <ErrorBoundary />,
          ...(detailForms.length > 0 ? { children: detailForms } : {}),
        })
      }

      // Find forms directly under this page (e.g., /customers/create)
      const pageForms = forms
        .filter((f) => {
          const parentPath = f.route.replace(/\/[^/]+$/, '')
          return parentPath === page.route
        })
        .map((f) => ({
          path: f.route.slice(page.route.length + 1),
          element: (
            <FormRenderer spec={f.spec as FormDef} customBlocks={customBlocks} commandSchemas={commandSchemas as any} />
          ),
          errorElement: <ErrorBoundary />,
        }))

      // Skip pages that were nested under a parent
      if (nestedPaths.has(page.route)) continue

      const hasChildren = detailChildren.length > 0 || pageForms.length > 0

      if (hasChildren) {
        // Listing and detail pages are mutually exclusive (Outlet switches between them)
        // Forms are children of their parent page and render as FocusModal overlays
        specRoutes.push({
          path: routePath,
          element: <Outlet />,
          errorElement: <ErrorBoundary />,
          children: [
            {
              index: true,
              element: <PageRenderer spec={page.spec as PageDef} customBlocks={customBlocks} />,
            },
            ...detailChildren,
            ...pageForms,
          ],
        })
      } else {
        specRoutes.push({
          path: routePath,
          element: <PageRenderer spec={page.spec as PageDef} customBlocks={customBlocks} />,
          errorElement: <ErrorBoundary />,
        })
      }
    }

    return createBrowserRouter(
      [
        {
          path: '/login',
          element: <LoginPage {...loginProps} />,
        },
        {
          path: '/',
          element: <ProtectedRoute />,
          errorElement: <ErrorBoundary />,
          children: [
            {
              element: (
                <>
                  <ActiveRunsBridge />
                  <MainLayout
                    navigation={navigation}
                    headerSlot={headerSlot}
                    userMenuSlot={userMenuSlot}
                    iconMap={iconMap}
                  />
                </>
              ),
              errorElement: <ErrorBoundary />,
              children: [
                {
                  index: true,
                  element: <Navigate to={defaultRedirect} replace />,
                },
                {
                  path: '_runs/:runId',
                  element: <WorkflowStatusPage />,
                  errorElement: <ErrorBoundary />,
                },
                ...childRoutes,
                ...specRoutes,
                ...customRoutes,
                {
                  path: '*',
                  element: <CustomPageWrapper resolver={resolver} />,
                },
              ],
            },
          ],
        },
        {
          path: '*',
          element: <Navigate to={`/${defaultRedirect}`} replace />,
        },
      ],
      { basename },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resolver,
    routeMap,
    basename,
    commandSchemas,
    customBlocks,
    customRoutes,
    defaultRedirect,
    formRoutes,
    headerSlot,
    iconMap,
    loginProps,
    navigation,
    pageSpecs.filter,
    userMenuSlot,
  ])

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
