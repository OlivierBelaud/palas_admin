// Interfaces
export type { DataSource } from "./interfaces/data-source"
export type { AuthAdapter, AdminUser } from "./interfaces/auth-adapter"
export type { OverrideStore, Overrides, CustomNavItem, NavigationItem } from "./interfaces/override-store"

// Context
export { DashboardContext, useDashboardContext } from "./context"
export type { DashboardContextValue } from "./context"

// App
export { DashboardApp } from "./app"
export type { DashboardAppProps } from "./app"

// Override
export { defineConfig, createResolver } from "./override"
export type { DashboardConfig, NavItem, NavigationConfig, Resolver } from "./override"

// Override stores
export { LocalStorageOverrideStore } from "./override-stores/local-storage-store"

// Shell
export { MainLayout, Shell, LoginPage, ProtectedRoute, NavItem as NavItemComponent, UserMenu, buildRouteMap, resolveRoute, buildBreadcrumbHandle } from "./shell"
export type { MainLayoutProps, LoginPageProps, INavItem, UserMenuProps, RouteEntry, RouteResolution } from "./shell"

// Data
export { resolveDataPath, resolveStateRef, buildQueryParams } from "./data"

// Pages / Blocks
export type { PageSpec, DataComponent, QueryDef, BreadcrumbDef } from "./pages/types"
export { blocksCatalog } from "./blocks"

// Renderers
export { registerRenderer, getRenderer } from "./renderers"
export type { BlockRendererProps } from "./renderers"
export { SpecRenderer } from "./renderers/SpecRenderer"

// AI
export { AiProvider, useAi, AiPanel, AiChat, SparklesIcon } from "./ai"

// Providers
export { ThemeProvider, useTheme } from "./providers/theme-provider"
export { SidebarProvider, useSidebar } from "./providers/sidebar-provider"
export { SearchProvider, useSearch } from "./providers/search-provider"
export { ExtensionProvider, useExtension } from "./providers/extension-provider"
export type { ExtensionAPI, MenuItem } from "./providers/extension-provider"

// Lib
export { createQueryClient } from "./lib/query-client"
export { queryKeysFactory } from "./lib/query-key-factory"
export { isFetchError } from "./lib/is-fetch-error"

// Hooks
export { useDocumentDirection } from "./hooks/use-document-direction"

// Components
export { Form } from "./components/common/form"
export { Skeleton } from "./components/common/skeleton"
