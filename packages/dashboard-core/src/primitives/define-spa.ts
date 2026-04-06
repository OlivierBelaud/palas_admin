// defineSpa() — SPA configuration primitive.
// Defines navigation, settings, title, logo, favicon, etc.
// Auto-discovered from src/spa/{name}/config.ts.

// ── Navigation ────────────────────────────────────────

export interface NavItemDef {
  /** Lucide icon name (e.g. 'Users', 'Tag', 'ShoppingCart') */
  icon?: string
  /** Display label */
  label: string
  /** Route path */
  to: string
  /** Nested sub-items */
  items?: Array<{ label: string; to: string }>
}

// ── SPA Config ────────────────────────────────────────

export interface SpaDef {
  /** App title shown in the sidebar header */
  title?: string
  /** Path to a logo image (displayed in sidebar header) */
  logo?: string
  /** Path to favicon */
  favicon?: string
  /** Primary brand color (CSS color value) */
  primaryColor?: string

  /** Main navigation — sidebar top section */
  navigation: NavItemDef[]

  /** Settings navigation — sidebar bottom section (gear icon) */
  settings?: NavItemDef[]

  /** Default redirect from / (defaults to first navigation item) */
  defaultRedirect?: string

  /** Enable AI panel (requires ANTHROPIC_API_KEY or OPENAI_API_KEY in .env) */
  ai?: boolean
}

/**
 * Define a SPA's configuration.
 *
 * Auto-discovered from `src/spa/{name}/config.ts`.
 * Defines navigation, branding, and settings for the admin shell.
 *
 * @example
 * ```typescript
 * // src/spa/admin/config.ts
 * import { defineSpa } from '@manta/dashboard-core'
 *
 * export default defineSpa({
 *   title: 'Commerce Admin',
 *   navigation: [
 *     { icon: 'Users', label: 'Customers', to: '/customers', items: [
 *       { label: 'Groups', to: '/customer-groups' },
 *     ]},
 *     { icon: 'Tag', label: 'Products', to: '/products' },
 *   ],
 *   settings: [
 *     { icon: 'Store', label: 'Store Details', to: '/settings/store' },
 *   ],
 * })
 * ```
 */
export function defineSpa(config: SpaDef): SpaDef {
  return config
}
