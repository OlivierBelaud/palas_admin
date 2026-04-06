// Primitives — defineSpa(), definePage() & defineForm()

// Blocks — autonomous components with internal queries
export { resolveBlock } from './blocks/block-registry'
export { DataTableBlock } from './blocks/DataTable'
export { InfoCardBlock } from './blocks/InfoCard'
export { MediaCardBlock } from './blocks/MediaCard'
export { PageHeaderBlock } from './blocks/PageHeader'
export type { RelationTableBlockProps } from './blocks/RelationTable'
export { RelationTableBlock } from './blocks/RelationTable'
export { StatsCardBlock } from './blocks/StatsCard'
export { useBlockQuery } from './blocks/use-block-query'
export type {
  BlockDef,
  FieldDef,
  FieldType,
  FormDef,
  GraphQueryDef,
  HeaderAction,
  HeaderDef,
  NamedQueryDef,
  NavItemDef,
  PageDef,
  SpaDef,
  StepDef,
} from './primitives'
export {
  defineForm,
  definePage,
  defineSpa,
  isGraphQuery,
  isNamedQuery,
} from './primitives'

// Interfaces

// AI
export { AiChat, AiPanel, AiProvider, SparklesIcon, useAi } from './ai'
export type { DashboardAppProps } from './app'
// App
export { DashboardApp } from './app'
export { blocksCatalog } from './blocks'
// Components
export { Form } from './components/common/form'
export { Skeleton } from './components/common/skeleton'
export type {
  BulkAction,
  BulkActionBarProps,
  ConfirmDialogProps,
  EditableColumn,
  EditableTableProps,
  EntitySelectColumn,
  EntitySelectProps,
  FocusModalProps,
  FormStep,
  MultiStepFormProps,
} from './components/patterns'
// Patterns — high-level composable components for admin UIs
export {
  BulkActionBar,
  ConfirmDialog,
  EditableTable,
  EntitySelect,
  FocusModal,
  MultiStepForm,
  useFocusModal,
} from './components/patterns'
export type { DashboardContextValue } from './context'
// Context
export { DashboardContext, useDashboardContext } from './context'
// Data
export { buildQueryParams, resolveDataPath, resolveStateRef } from './data'
// Hooks
export { useDocumentDirection } from './hooks/use-document-direction'
export type { AdminUser, AuthAdapter } from './interfaces/auth-adapter'
export type { DataSource } from './interfaces/data-source'
export type { CustomNavItem, NavigationItem, OverrideStore, Overrides } from './interfaces/override-store'
export { isFetchError } from './lib/is-fetch-error'
// Lib
export { createQueryClient } from './lib/query-client'
export { queryKeysFactory } from './lib/query-key-factory'
export type { DashboardConfig, NavItem, NavigationConfig, Resolver } from './override'
// Override
export { createResolver, defineConfig } from './override'
// Override stores
export { LocalStorageOverrideStore } from './override-stores/local-storage-store'
// Pages / Blocks
export type { BreadcrumbDef, DataComponent, PageSpec, QueryDef } from './pages/types'
export type { ExtensionAPI, MenuItem } from './providers/extension-provider'
export { ExtensionProvider, useExtension } from './providers/extension-provider'
export { SearchProvider, useSearch } from './providers/search-provider'
export { SidebarProvider, useSidebar } from './providers/sidebar-provider'
// Providers
export { ThemeProvider, useTheme } from './providers/theme-provider'
export type { BlockRendererProps } from './renderers'
// Renderers
export { getRenderer, registerRenderer } from './renderers'
export type { FormRendererProps } from './renderers/FormRenderer'
export { FormRenderer } from './renderers/FormRenderer'
export type { PageRendererProps } from './renderers/PageRenderer'
export { PageRenderer } from './renderers/PageRenderer'
export { SpecRenderer } from './renderers/SpecRenderer'
export type { INavItem, LoginPageProps, MainLayoutProps, RouteEntry, RouteResolution, UserMenuProps } from './shell'
// Shell
export {
  buildBreadcrumbHandle,
  buildRouteMap,
  LoginPage,
  MainLayout,
  NavItem as NavItemComponent,
  ProtectedRoute,
  resolveRoute,
  Shell,
  UserMenu,
} from './shell'
