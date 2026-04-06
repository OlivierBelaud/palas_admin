# Manta + Next.js — AI Agent Instructions

You are working in a **Next.js App Router project with Manta mounted inline**. The frontend is Next.js (React 19, App Router, TypeScript). The backend is Manta — a filesystem-first framework with integrated database, CQRS, auth, and admin dashboard. **They run in the same process**: Next owns the HTTP server; Manta lives inside a catch-all route handler.

## Stack

- **Runtime**: Next.js 15 App Router
- **Backend**: Manta (auto-discovered from `src/modules/`, `src/commands/`, `src/queries/`, …)
- **Database**: PostgreSQL (managed by Manta through its adapters)
- **API**: Auto-generated from Manta commands, queries, auth, and the query graph
- **Admin**: `@manta/dashboard` mounted as a Next client component (no separate Vite server)

## How they are wired together

The entire integration is 3 files in the Next project:

```typescript
// next.config.ts
import { withManta } from '@manta/adapter-nextjs'
export default withManta({})
```

```typescript
// app/api/[...manta]/route.ts
export { GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD } from '@manta/adapter-nextjs/handler'
```

```typescript
// app/admin/[[...slug]]/page.tsx
export { default } from '@manta/adapter-nextjs/admin'
```

- The API catch-all forwards every `/api/*` request to Manta's internal HTTP pipeline. All Manta-generated routes (commands, queries, graph, auth, openapi) are reachable this way.
- The admin catch-all mounts the Manta dashboard as a client component. Next bundles `@manta/dashboard` itself via `transpilePackages` (configured by `withManta`). `react-router-dom` inside the dashboard handles sub-routes.
- `withManta()` sets `transpilePackages` + `serverExternalPackages` so the raw-TS `@manta/*` workspace packages and native deps (postgres, pino, drizzle-orm) play nice with Next.

## Project layout

```
my-app/
├── app/                        Next.js App Router (frontend + API mount points)
│   ├── layout.tsx
│   ├── page.tsx                your public home
│   ├── api/[...manta]/route.ts 1 line: re-export from @manta/adapter-nextjs/handler
│   ├── admin/[[...slug]]/page.tsx 1 line: re-export from @manta/adapter-nextjs/admin
│   └── (your other Next pages)
│
├── lib/                        shared client-side code (hooks, utilities, types)
│
├── src/                        Manta backend (filesystem-first, auto-discovered)
│   ├── modules/{mod}/entities/{entity}/{model,service}.ts
│   ├── commands/{context}/{name}.ts
│   ├── queries/{context}/{name,graph}.ts
│   ├── subscribers/{name}.ts
│   ├── jobs/{name}.ts
│   ├── links/{name}.ts
│   ├── agents/{name}.ts
│   └── middleware/{context}.ts
│
├── manta.config.ts             defineConfig — database, ports, presets
├── next.config.ts              withManta({})
├── tsconfig.json
└── AGENT.md                    this file
```

## Development workflow

```bash
pnpm dev          # runs next dev — that's it. No separate Manta process.
pnpm generate     # regenerate .manta/generated.d.ts (types for defineModel, field, etc.)
pnpm db:generate  # create SQL migration from model changes
pnpm db:migrate   # apply migrations to the database
```

Manta boots lazily inside the Next.js server on the first API request (singleton pattern in `@manta/adapter-nextjs/bootstrap`). Subsequent requests reuse the cached app. Hot reload works normally — Next reloads on file changes, and Manta re-boots on module edits.

## Consuming Manta from Next

### From client components (most common)

Use `@manta/sdk` hooks — they call the relative `/api/*` endpoints via `fetch`:

```typescript
'use client'
import { useQuery, useCommand, useGraphQuery } from '@manta/sdk'

const { data } = useQuery('list-products', { status: 'active' })
const createProduct = useCommand('create-product')
const { data: products } = useGraphQuery({ entity: 'product', relations: ['inventory_item'] })
```

### From React Server Components

Two options:

1. **HTTP round-trip** (simplest): `fetch('/api/public/my-query', ...)` from the RSC. Works everywhere, no singleton coupling.
2. **Direct app access** (zero-latency): import `getMantaApp` from `@manta/adapter-nextjs` and call `app.queryService.graph(...)` / `app.commandRegistry.execute(...)` directly. Bypasses HTTP entirely. Use when you need sub-millisecond latency for SSR.

```typescript
// app/products/page.tsx — RSC
import { getMantaApp } from '@manta/adapter-nextjs'

export default async function ProductsPage() {
  const app = await getMantaApp()
  const products = await app.queryService.graph({ entity: 'product', pagination: { take: 20 } })
  return <ProductList products={products} />
}
```

### From Next API routes (for frontend-specific endpoints)

Don't. If you need a new endpoint, create a `defineCommand` or `defineQuery` in `src/`. The only Next API route you should own is the `[...manta]` catch-all. This keeps auth, validation, and auto-docs uniform.

## Critical rules

1. **No Next API routes beyond the catch-all** — Commands and queries ARE the API. Every endpoint goes through `src/commands/` or `src/queries/`. The `/api/[...manta]` catch-all covers everything.
2. **`app/` is for pages only** (including RSC and client components). Backend logic lives in `src/`.
3. **`src/spa/admin/pages/` is NOT used in the Next preset** — unlike the Nitro preset, where it feeds a Vite-built SPA. Custom admin pages in Next are inserted via `<MantaDashboard pageSpecs={...} customBlocks={...}>` props if you need them. For most projects the auto-generated dashboard is enough.
4. **Always use `@manta/sdk` hooks in client components** — never hand-roll `fetch('/api/...')`. The SDK handles auth tokens, error normalisation, and React Query integration.
5. **RSC → `getMantaApp()` path is optional** — prefer it for SSR data fetching, but `fetch('/api/...')` also works and is simpler for static rendering.
6. **Manta rules still apply** — the 14 primitives below (`defineModel`, `defineCommand`, `defineQuery`, `defineWorkflow`, …) govern the backend exactly as in a standalone Manta project. Entity names PascalCase, 1 entity = 1 service, compensation automatic, etc.

## Deployment

Manta-on-Next is a normal Next app. Deploy to Vercel, Node servers, or any runtime that supports Next 15 + server functions. Make sure `DATABASE_URL` is set in the environment. Manta's cold-start overhead is ~100-200ms on first request (singleton bootstrap).

---

_The sections below are the canonical Manta primitives reference. Everything after this line is identical to the standalone Manta AGENT.md and applies to the `src/` backend in this project._
