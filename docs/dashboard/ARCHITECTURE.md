# Manta Dashboard — Architecture

## Vision

Le dashboard Manta est un **admin UI universel** piloté par JSON. Il fonctionne dans deux contextes :

- **Medusa** : en remplacement du dashboard natif Medusa (preuve de concept actuelle)
- **Manta** : comme dashboard natif du framework Manta (cible finale)

Un seul moteur de rendu. Deux adapters. Zero duplication.

---

## Les 3 packages

```
@manta/dashboard-core          ← Moteur pur (0 opinion sur le backend)
@manta/dashboard-medusa        ← Adapter pour Medusa vanilla
@manta/dashboard-manta         ← Adapter pour le framework Manta
```

### Principe de responsabilite

| Responsabilite | Core | Medusa adapter | Manta adapter |
|---|---|---|---|
| JSON-Render engine | X | | |
| 10 block types + Zod schemas | X | | |
| SpecRenderer | X | | |
| Block renderers | X | | |
| Override resolver (priorite) | X | | |
| Shell (layout, sidebar, topbar, breadcrumbs) | X | | |
| AI Panel + chat | X | | |
| Navigation dynamique | X | | |
| DataSource interface | X | | |
| AuthAdapter interface | X | | |
| OverrideStore interface | X | | |
| Entity endpoint map (statique) | | X | |
| Medusa JS SDK (session auth) | | X | |
| 54 PageSpecs pre-cables | | X | |
| DataComponents pre-cables | | X | |
| 120+ form modals (lazy import) | | X | |
| Navigation statique commerce | | X | |
| Query key mapping Medusa | | X | |
| Registry client (discovery) | | | X |
| JWT Bearer auth | | | X |
| API-backed OverrideStore | | | X |
| Dynamic route mounting | | | X |

### Ce que l'utilisateur installe

```bash
# Utilisateur Medusa — ne voit jamais Manta
npm install @manta/dashboard-medusa
# tire @manta/dashboard-core comme peer dep

# Utilisateur Manta — ne voit jamais les routes Medusa
npm install @manta/dashboard-manta
# tire @manta/dashboard-core comme peer dep

# Utilisateur Manta + plugin commerce
npm install @manta/dashboard-manta @manta/plugin-medusa-commerce
# le plugin declare ses pages dans admin/ → Manta les decouvre via registry
# PAS besoin de @manta/dashboard-medusa
```

---

## Package 1 : @manta/dashboard-core

### Structure

```
packages/dashboard-core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    ← re-exports publics
    │
    ├── blocks/
    │   ├── index.ts                ← Zod schemas pour les 10 block types
    │   └── types.ts                ← BlockType union, WhenCondition, BlockAction, Column, Field
    │
    ├── renderers/
    │   ├── registry.ts             ← registerRenderer(), getRenderer()
    │   ├── SpecRenderer.tsx        ← Moteur principal (PageSpec → UI)
    │   ├── EntityTableRenderer.tsx
    │   ├── InfoCardRenderer.tsx
    │   ├── RelationTableRenderer.tsx
    │   ├── RelationListRenderer.tsx
    │   ├── MediaCardRenderer.tsx
    │   ├── JsonCardRenderer.tsx
    │   ├── ActivityCardRenderer.tsx
    │   ├── StatsCardRenderer.tsx
    │   ├── TreeListRenderer.tsx
    │   └── ReactBridgeRenderer.tsx
    │
    ├── pages/
    │   └── types.ts                ← PageSpec, QueryDef, DataComponent, PageType, LayoutType
    │
    ├── data/
    │   └── index.ts                ← resolveDataPath(), resolveStateRef(), buildQueryParams()
    │
    ├── override/
    │   ├── types.ts                ← OverrideStore interface, Overrides type
    │   ├── resolver.ts             ← createResolver() — resolution par priorite
    │   └── runtime-store.ts        ← InMemoryOverrideStore (pub/sub, cache local)
    │
    ├── shell/
    │   ├── Shell.tsx               ← Layout principal (navbar, sidebar, topbar, progress)
    │   ├── MainLayout.tsx          ← Sidebar avec navigation dynamique
    │   ├── Topbar.tsx
    │   ├── Breadcrumbs.tsx
    │   ├── NavItem.tsx
    │   ├── UserMenu.tsx
    │   └── SidebarProvider.tsx
    │
    ├── ai/
    │   ├── AiProvider.tsx          ← Context (panel state, messages)
    │   ├── AiPanel.tsx             ← UI sidebar/fullscreen
    │   └── AiChat.tsx              ← Chat + tool invocation handling
    │
    ├── providers/
    │   ├── DataSourceProvider.tsx   ← React Context pour DataSource
    │   ├── AuthProvider.tsx         ← React Context pour AuthAdapter
    │   └── DashboardProvider.tsx    ← Provider compose (DataSource + Auth + Override + AI)
    │
    └── interfaces/
        ├── data-source.ts          ← DataSource interface
        ├── auth-adapter.ts         ← AuthAdapter interface
        └── override-store.ts       ← OverrideStore interface (re-export de override/types)
```

### Interfaces publiques

#### DataSource

```typescript
// interfaces/data-source.ts

export interface DataSource {
  /**
   * Fetch entity data (list or detail).
   * Le SpecRenderer appelle cette methode au lieu de fetch() en dur.
   */
  fetch(endpoint: string, params?: Record<string, unknown>): Promise<unknown>

  /**
   * Execute une mutation (POST, PUT, DELETE).
   */
  mutate(endpoint: string, method: string, body?: unknown): Promise<unknown>

  /**
   * Convertit un nom d'entite en endpoint API.
   * Ex: "product" → "/admin/products" (Medusa) ou "/admin/api/products" (Manta)
   */
  entityToEndpoint(entity: string): string

  /**
   * Retourne la query key pour React Query.
   * Doit matcher les keys utilisees par les forms pour l'invalidation.
   * Ex: "product" → "products" (Medusa) ou "product" (Manta)
   */
  getQueryKey(entity: string): string
}
```

#### AuthAdapter

```typescript
// interfaces/auth-adapter.ts

export interface AuthAdapter {
  /** Login avec credentials */
  login(credentials: Record<string, unknown>): Promise<void>

  /** Logout */
  logout(): Promise<void>

  /** Recupere l'utilisateur courant */
  getCurrentUser(): Promise<AdminUser>

  /** Verifie si l'utilisateur est authentifie */
  isAuthenticated(): boolean

  /** Headers a ajouter a chaque requete (ex: Authorization: Bearer xxx) */
  getAuthHeaders(): Record<string, string>

  /** Reset password */
  resetPassword?(email: string): Promise<void>
}

export interface AdminUser {
  id: string
  email: string
  first_name?: string
  last_name?: string
  avatar_url?: string
  role?: string
  metadata?: Record<string, unknown>
}
```

#### OverrideStore

```typescript
// interfaces/override-store.ts

export interface OverrideStore {
  /** Recupere tous les overrides (cache local) */
  getOverrides(): Overrides

  /** Override un composant existant */
  setComponentOverride(id: string, component: DataComponent): void

  /** Cree une page custom (AI) */
  addCustomPage(
    page: PageSpec,
    components: DataComponent[],
    navItem?: NavItem
  ): void

  /** Supprime une page custom */
  removeCustomPage(pageId: string): void

  /** Override la navigation entiere */
  setNavigationOverride(nav: NavItem[]): void

  /** Reset la navigation */
  resetNavigationOverride(): void

  /** Subscribe aux changements (pour useSyncExternalStore) */
  subscribe(listener: () => void): () => void

  /** Version number (pour snapshot dans useSyncExternalStore) */
  getVersion(): number

  /** Initialisation (fetch depuis backend si necessaire) */
  initialize?(): Promise<void>

  /** Sauvegarde (flush vers backend si necessaire) */
  flush?(): Promise<void>
}

export interface Overrides {
  components: Record<string, DataComponent>
  pages: Record<string, Partial<PageSpec>>
  customPages: Record<string, PageSpec>
  customComponents: Record<string, DataComponent>
  customNavItems: NavItem[]
  navigation: NavItem[] | null
}
```

### DashboardProvider (composition)

```typescript
// providers/DashboardProvider.tsx

export interface DashboardConfig {
  /** URL de l'API backend */
  apiUrl: string

  /** DataSource implementation */
  dataSource: DataSource

  /** Auth adapter implementation */
  auth: AuthAdapter

  /** Override store implementation */
  overrideStore: OverrideStore

  /** Pages par defaut (statiques ou vides) */
  pages?: Record<string, PageSpec>

  /** Composants par defaut */
  components?: Record<string, DataComponent>

  /** Navigation par defaut */
  navigation?: NavItem[]

  /** Theme (couleurs, logo, titre) */
  theme?: {
    title?: string
    logo?: string
    colors?: Record<string, string>
  }

  /** AI config */
  ai?: {
    enabled?: boolean
    endpoint?: string
    model?: string
  }
}

export function DashboardProvider({
  config,
  children,
}: {
  config: DashboardConfig
  children: React.ReactNode
}) {
  // Compose tous les providers
  return (
    <DataSourceContext.Provider value={config.dataSource}>
      <AuthContext.Provider value={config.auth}>
        <OverrideContext.Provider value={config.overrideStore}>
          <AiProvider config={config.ai}>
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
          </AiProvider>
        </OverrideContext.Provider>
      </AuthContext.Provider>
    </DataSourceContext.Provider>
  )
}
```

---

## Package 2 : @manta/dashboard-medusa

### Structure

```
packages/dashboard-medusa/
├── package.json
├── tsconfig.json
└── src/
    ├── index.tsx                   ← <MedusaDashboard /> export principal
    │
    ├── adapter/
    │   ├── data-source.ts          ← MedusaDataSource implements DataSource
    │   ├── auth.ts                 ← MedusaAuth implements AuthAdapter
    │   └── override-store.ts       ← LocalStorageOverrideStore implements OverrideStore
    │
    ├── pages/
    │   └── index.ts                ← 54 PageSpecs statiques (products, orders, etc.)
    │
    ├── components/
    │   └── index.ts                ← Tous les DataComponents pre-cables
    │
    ├── navigation/
    │   └── index.ts                ← Arbre de nav commerce statique
    │
    ├── forms/
    │   └── index.ts                ← Lazy imports des 120+ form modals @medusajs/dashboard
    │
    └── query-keys.ts               ← entityQueryKeyMap (product → "products", etc.)
```

### MedusaDataSource

```typescript
// adapter/data-source.ts

import type { DataSource } from "@manta/dashboard-core"

const entityEndpointMap: Record<string, string> = {
  product: "/admin/products",
  order: "/admin/orders",
  customer: "/admin/customers",
  // ... les 40+ mappings actuels
}

export class MedusaDataSource implements DataSource {
  constructor(private baseUrl: string) {}

  async fetch(endpoint: string, params?: Record<string, unknown>) {
    const url = new URL(endpoint, this.baseUrl)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v))
      }
    }
    const res = await fetch(url.toString(), {
      credentials: "include",      // ← session cookie Medusa
      headers: { "Content-Type": "application/json" },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async mutate(endpoint: string, method: string, body?: unknown) {
    const res = await fetch(new URL(endpoint, this.baseUrl).toString(), {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return method === "DELETE" ? undefined : res.json()
  }

  entityToEndpoint(entity: string): string {
    return entityEndpointMap[entity] || `/admin/${entity.replace(/_/g, "-")}s`
  }

  getQueryKey(entity: string): string {
    return entityQueryKeyMap[entity] || entity
  }
}
```

### MedusaAuth

```typescript
// adapter/auth.ts

import Medusa from "@medusajs/js-sdk"
import type { AuthAdapter } from "@manta/dashboard-core"

export class MedusaAuth implements AuthAdapter {
  private sdk: InstanceType<typeof Medusa>
  private user: AdminUser | null = null

  constructor(baseUrl: string) {
    this.sdk = new Medusa({ baseUrl, auth: { type: "session" } })
  }

  async login(credentials: Record<string, unknown>) {
    await this.sdk.auth.login("user", "emailpass", credentials)
  }

  async logout() {
    await this.sdk.auth.logout()
    this.user = null
  }

  async getCurrentUser() {
    if (!this.user) {
      const res = await this.sdk.admin.user.me()
      this.user = res.user
    }
    return this.user
  }

  isAuthenticated() {
    return this.user !== null
  }

  getAuthHeaders() {
    return {} // session cookies gerees automatiquement
  }
}
```

### LocalStorageOverrideStore

```typescript
// adapter/override-store.ts
// C'est essentiellement le runtime-overrides.ts actuel, renomme et typé via l'interface.

import type { OverrideStore, Overrides } from "@manta/dashboard-core"

const STORAGE_KEY = "manta-ai-overrides"

export class LocalStorageOverrideStore implements OverrideStore {
  private version = 0
  private listeners = new Set<() => void>()

  // ... implementation identique a l'actuelle runtime-overrides.ts
  // getOverrides(), setComponentOverride(), addCustomPage(), etc.
  // Lit/ecrit dans localStorage[STORAGE_KEY]
}
```

### Point d'entree

```typescript
// index.tsx

import { DashboardProvider, Shell } from "@manta/dashboard-core"
import { MedusaDataSource } from "./adapter/data-source"
import { MedusaAuth } from "./adapter/auth"
import { LocalStorageOverrideStore } from "./adapter/override-store"
import { pages } from "./pages"
import { components } from "./components"
import { navigation } from "./navigation"

export function MedusaDashboard({ apiUrl }: { apiUrl: string }) {
  const config = {
    apiUrl,
    dataSource: new MedusaDataSource(apiUrl),
    auth: new MedusaAuth(apiUrl),
    overrideStore: new LocalStorageOverrideStore(),
    pages,
    components,
    navigation,
  }

  return (
    <DashboardProvider config={config}>
      <Shell />
    </DashboardProvider>
  )
}
```

### package.json

```json
{
  "name": "@manta/dashboard-medusa",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.tsx",
  "dependencies": {
    "@medusajs/js-sdk": "^2.0.0"
  },
  "peerDependencies": {
    "@manta/dashboard-core": "workspace:*",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

---

## Package 3 : @manta/dashboard-manta

### Structure

```
packages/dashboard-manta/
├── package.json
├── tsconfig.json
└── src/
    ├── index.tsx                   ← <MantaDashboard /> export principal
    │
    ├── adapter/
    │   ├── data-source.ts          ← MantaDataSource implements DataSource
    │   ├── auth.ts                 ← MantaAuth implements AuthAdapter (JWT)
    │   ├── override-store.ts       ← ApiOverrideStore implements OverrideStore
    │   └── registry.ts             ← RegistryClient (discovery au boot)
    │
    └── types.ts                    ← RegistryResponse, MantaConfig
```

### RegistryClient (discovery)

```typescript
// adapter/registry.ts

export interface RegistryResponse {
  /** Modules declares par tous les plugins + app locale */
  modules: Array<{
    name: string
    entity: string
    endpoints: {
      list: string
      detail: string
      create?: string
      update?: string
      delete?: string
    }
  }>

  /** Pages declarees par les plugins/modules (format PageSpec) */
  pages: Record<string, PageSpec>

  /** Composants declares par les plugins/modules */
  components: Record<string, DataComponent>

  /** Navigation agrégée de tous les plugins */
  navigation: NavItem[]

  /** Forms declares (chemin d'import dynamique) */
  forms: Record<string, { url: string; type: "react" | "json-render" }>
}

export class RegistryClient {
  constructor(private apiUrl: string, private authHeaders: () => Record<string, string>) {}

  async fetch(): Promise<RegistryResponse> {
    const res = await fetch(`${this.apiUrl}/admin/api/registry`, {
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
    })
    if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`)
    return res.json()
  }
}
```

### MantaDataSource

```typescript
// adapter/data-source.ts

import type { DataSource } from "@manta/dashboard-core"
import type { RegistryResponse } from "./registry"

export class MantaDataSource implements DataSource {
  private endpointMap: Record<string, string> = {}

  constructor(
    private apiUrl: string,
    private getHeaders: () => Record<string, string>
  ) {}

  /** Appele apres le fetch du registry pour construire la endpoint map */
  loadFromRegistry(registry: RegistryResponse) {
    for (const mod of registry.modules) {
      this.endpointMap[mod.entity] = mod.endpoints.list
    }
  }

  async fetch(endpoint: string, params?: Record<string, unknown>) {
    const url = new URL(endpoint, this.apiUrl)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v))
      }
    }
    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        ...this.getHeaders(),  // ← JWT Bearer
      },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async mutate(endpoint: string, method: string, body?: unknown) {
    const res = await fetch(new URL(endpoint, this.apiUrl).toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.getHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return method === "DELETE" ? undefined : res.json()
  }

  entityToEndpoint(entity: string): string {
    return this.endpointMap[entity] || `/admin/api/${entity.replace(/_/g, "-")}s`
  }

  getQueryKey(entity: string): string {
    return entity // Manta utilise le nom d'entite directement
  }
}
```

### MantaAuth (JWT)

```typescript
// adapter/auth.ts

import type { AuthAdapter, AdminUser } from "@manta/dashboard-core"

export class MantaAuth implements AuthAdapter {
  private token: string | null = null
  private user: AdminUser | null = null

  constructor(private apiUrl: string) {
    // Recupere le token du localStorage au boot
    this.token = localStorage.getItem("manta-auth-token")
  }

  async login(credentials: Record<string, unknown>) {
    const res = await fetch(`${this.apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    })
    if (!res.ok) throw new Error("Login failed")
    const data = await res.json()
    this.token = data.token
    localStorage.setItem("manta-auth-token", data.token)
  }

  async logout() {
    if (this.token) {
      await fetch(`${this.apiUrl}/auth/logout`, {
        method: "POST",
        headers: this.getAuthHeaders(),
      }).catch(() => {})
    }
    this.token = null
    this.user = null
    localStorage.removeItem("manta-auth-token")
  }

  async getCurrentUser() {
    if (!this.user) {
      const res = await fetch(`${this.apiUrl}/admin/api/me`, {
        headers: this.getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch user")
      const data = await res.json()
      this.user = data.user
    }
    return this.user!
  }

  isAuthenticated() {
    return this.token !== null
  }

  getAuthHeaders() {
    if (!this.token) return {}
    return { Authorization: `Bearer ${this.token}` }
  }
}
```

### ApiOverrideStore (persistance DB)

```typescript
// adapter/override-store.ts

import type { OverrideStore, Overrides } from "@manta/dashboard-core"

/**
 * Override store qui sync avec le backend Manta.
 * Cache local + debounced save vers l'API.
 * Au login, fetch initial. Ensuite, chaque modification est sauvee.
 */
export class ApiOverrideStore implements OverrideStore {
  private overrides: Overrides = emptyOverrides()
  private version = 0
  private listeners = new Set<() => void>()
  private saveTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    private apiUrl: string,
    private getHeaders: () => Record<string, string>
  ) {}

  /** Fetch initial depuis le backend */
  async initialize() {
    const res = await fetch(`${this.apiUrl}/admin/api/config/overrides`, {
      headers: this.getHeaders(),
    })
    if (res.ok) {
      this.overrides = await res.json()
      this.notify()
    }
  }

  /** Debounced save vers le backend */
  private scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => this.flush(), 1000)
  }

  async flush() {
    await fetch(`${this.apiUrl}/admin/api/config/overrides`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...this.getHeaders(),
      },
      body: JSON.stringify(this.overrides),
    })
  }

  // ... memes methodes que LocalStorageOverrideStore
  // mais appelle scheduleSave() au lieu de localStorage.setItem()

  getOverrides() { return this.overrides }

  setComponentOverride(id: string, component: DataComponent) {
    this.overrides.components[id] = component
    this.notify()
    this.scheduleSave()
  }

  // etc. pour addCustomPage, removeCustomPage, setNavigationOverride...

  private notify() {
    this.version++
    this.listeners.forEach((l) => l())
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion() { return this.version }
}

function emptyOverrides(): Overrides {
  return {
    components: {},
    pages: {},
    customPages: {},
    customComponents: {},
    customNavItems: [],
    navigation: null,
  }
}
```

### Point d'entree — Boot dynamique

```typescript
// index.tsx

import { DashboardProvider, Shell } from "@manta/dashboard-core"
import { MantaDataSource } from "./adapter/data-source"
import { MantaAuth } from "./adapter/auth"
import { ApiOverrideStore } from "./adapter/override-store"
import { RegistryClient } from "./adapter/registry"

export function MantaDashboard({ apiUrl }: { apiUrl: string }) {
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<DashboardConfig | null>(null)

  useEffect(() => {
    async function boot() {
      // 1. Auth
      const auth = new MantaAuth(apiUrl)
      if (!auth.isAuthenticated()) return // show login

      // 2. Registry discovery
      const registry = await new RegistryClient(
        apiUrl,
        () => auth.getAuthHeaders()
      ).fetch()

      // 3. DataSource
      const dataSource = new MantaDataSource(apiUrl, () => auth.getAuthHeaders())
      dataSource.loadFromRegistry(registry)

      // 4. Override store
      const overrideStore = new ApiOverrideStore(apiUrl, () => auth.getAuthHeaders())
      await overrideStore.initialize()

      // 5. Assemble config
      setConfig({
        apiUrl,
        dataSource,
        auth,
        overrideStore,
        pages: registry.pages,
        components: registry.components,
        navigation: registry.navigation,
      })
      setReady(true)
    }
    boot()
  }, [apiUrl])

  if (!ready || !config) return <LoginOrLoading />

  return (
    <DashboardProvider config={config}>
      <Shell />
    </DashboardProvider>
  )
}
```

### package.json

```json
{
  "name": "@manta/dashboard-manta",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.tsx",
  "peerDependencies": {
    "@manta/dashboard-core": "workspace:*",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

**Note** : zero dependance externe (pas de SDK Medusa). Que du `fetch()` natif + JWT.

---

## Flux de donnees

### Mode Medusa

```
[Medusa Backend]
      |
      | session cookie (credentials: "include")
      |
[MedusaDataSource]
      |
      | entityEndpointMap statique
      | product → /admin/products
      |
[SpecRenderer]
      |
      | PageSpec statique (import)
      | DataComponent statique (import)
      |
[Block Renderers]
      |
[UI]
```

### Mode Manta

```
[Manta Backend]
      |
      | JWT Bearer token
      |
[MantaAuth] ← login → token → localStorage
      |
[RegistryClient]
      |
      | GET /admin/api/registry
      | → pages, components, navigation, modules
      |
[MantaDataSource]
      |
      | endpointMap dynamique (from registry)
      | product → /admin/api/products
      |
[SpecRenderer]
      |
      | PageSpec dynamique (from registry)
      | DataComponent dynamique (from registry)
      |
[Block Renderers]
      |
[UI]
```

### Persistance des overrides

```
Mode Medusa:
  AI Panel → setComponentOverride() → localStorage → pub/sub → re-render

Mode Manta:
  AI Panel → setComponentOverride() → cache local → pub/sub → re-render
                                     → debounced PUT /admin/api/config/overrides
                                     → DB (module-admin-config)
                                     → au login: GET → hydrate cache
```

---

## Diagramme des dependances

```
@manta/dashboard-core
    ↑ peer dep          ↑ peer dep
    |                   |
@manta/dashboard-medusa   @manta/dashboard-manta
    |                         |
    | dep                     | (zero dep externe)
    |                         |
@medusajs/js-sdk         (fetch natif)
```

```
@manta/plugin-medusa-commerce
    |
    ├── modules/ (backend)
    └── admin/
        ├── pages.json       ← PageSpecs au format @manta/dashboard-core
        ├── components.json  ← DataComponents au format @manta/dashboard-core
        ├── navigation.json
        └── forms/           ← React components
```

Le plugin n'a PAS de dependance sur `@manta/dashboard-medusa`.
Ses pages sont au format `@manta/dashboard-core` et sont decouvertes par le registry Manta.
