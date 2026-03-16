# Plan : @manta/adapter-nextjs + demo/nextjs

> Date : 2026-03-16
> Statut : En attente de validation

## Contexte

On veut un 3e mode de deployment pour Manta : **Next.js**. Aujourd'hui on a :
- `demo/manta` — Nitro standalone (serverless Vercel)
- `demo/medusa` — Medusa V2 avec dashboard

L'objectif est **"installe la lib, ca fonctionne"** : zero bootstrap manual, admin monte automatiquement, auto-discovery des modules/workflows/subscribers.

## Constat technique

### Les route handlers sont deja Web API natifs

Les handlers dans `src/api/*/route.ts` utilisent exclusivement `Request` / `Response` (Web API). Exemple :

```typescript
export async function GET(req: MantaRequest) {
  const service = req.scope.resolve<any>('productService')
  return Response.json({ products })
}
```

Aucune dependance a H3. Les proprietes framework (`validatedBody`, `params`, `scope`, `requestId`) sont ajoutees via `Object.defineProperty()` sur le `Request` natif.

### H3 est une couche de traduction inutile

Le flux actuel dans `adapter-nitro` :

```
HTTP → H3Event → [pipeline 12 steps H3] → new Request() → handler(Request) → Response → H3 send()
```

H3 recoit un event, le pipeline lit/ecrit les headers via H3, puis reconstruit un `Request` Web API pour appeler le handler, puis reconvertit la `Response` en reponse H3. **Double conversion inutile.**

### Next.js Route Handlers sont Web API natifs

Next.js App Router utilise nativement `Request` → `Response`. Le pipeline peut s'executer directement sans couche de traduction.

### Nitro V3 va aussi passer en Web API natif

La prochaine version de Nitro abandonne H3 au profit du Web API natif. Notre refactor s'aligne avec cette direction.

---

## Phase 1 : Ce qu'on fait maintenant

### 1.1 Nouveau package : `packages/adapter-nextjs/`

```
packages/adapter-nextjs/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Barrel exports
    ├── with-manta.ts         # withManta(nextConfig) — wrapper next.config
    ├── handler.ts            # GET/POST/PUT/DELETE/PATCH pour route catch-all
    ├── pipeline.ts           # 12-step pipeline Web API natif (zero H3)
    ├── bootstrap.ts          # Lazy container bootstrap (singleton)
    ├── admin-page.tsx        # Composant client-only pour MantaDashboard
    ├── route-matcher.ts      # URL pattern matching + params extraction
    └── types.ts              # MantaRequest re-export
```

#### `with-manta.ts`

Wrapper `next.config.ts`. Configure :
- `transpilePackages` : tous les packages workspace Manta
- `serverExternalPackages` : `postgres`, `pino`, `pino-pretty`
- Webpack aliases vers les packages workspace

L'utilisateur ecrit :
```typescript
// next.config.ts
import { withManta } from '@manta/adapter-nextjs'
export default withManta({})
```

#### `handler.ts`

Exporte directement `GET`, `POST`, `PUT`, `DELETE`, `PATCH`. En interne :
1. Lazy bootstrap du container (une seule fois, singleton)
2. Auto-discovery via `discoverResources()` + `discoverRoutes()` du CLI
3. Route matching contre les routes decouvertes
4. Pipeline 12 steps Web API natif
5. Return `Response`

L'utilisateur ecrit :
```typescript
// src/app/api/[...path]/route.ts
export { GET, POST, PUT, DELETE, PATCH } from '@manta/adapter-nextjs/handler'
```

#### `pipeline.ts`

Reimplementation du pipeline 12 steps directement sur `Request`/`Response` :

| Step | Nitro (H3) | Next.js (Web API) |
|------|-----------|-------------------|
| 1 RequestID | `getRequestHeader(event)` | `req.headers.get('x-request-id')` |
| 2 CORS | `setResponseHeader(event)` | `new Headers()` merge |
| 3 Rate limit | no-op | no-op |
| 4 Scope | DI scope | DI scope (identique) |
| 5 Body | `readBody(event)` | `req.clone().json()` |
| 6 Auth | `getRequestHeader(event, 'authorization')` | `req.headers.get('authorization')` |
| 7 Publishable key | no-op | no-op |
| 8 Validation | Zod parse | Zod parse (identique) |
| 9 Custom middleware | no-op | no-op |
| 10 RBAC | namespace check | namespace check (identique) |
| 11 Handler | `handler(enrichedRequest)` | `handler(enrichedRequest)` (identique) |
| 12 Error | `mapErrorToResponse()` | `mapErrorToResponse()` (identique) |

Steps 3, 4, 6, 7, 8, 9, 10, 11 sont **identiques** — logique pure.
Steps 1, 2, 5, 12 sont triviales a reimplementer en Web API.

`ERROR_STATUS_MAP` et `mapErrorToResponse()` sont copies depuis `adapter-nitro/pipeline.ts` (voir Phase 2 pour extraction).

#### `bootstrap.ts`

Pattern lazy singleton identique a `server-bootstrap.ts` du CLI :
- `discoverResources(cwd)` pour trouver modules, workflows, subscribers
- `discoverRoutes(cwd)` pour trouver les route handlers
- Registration des adapters selon les env vars (`DATABASE_URL` → DrizzlePg/Neon, sinon InMemory)
- `tryInstantiateService()` pour instancier les modules
- `WorkflowManager` pour les workflows
- EventBus subscribe pour les subscribers

**Pas de NitroAdapter** — Next.js gere le HTTP directement.

#### `admin-page.tsx`

Composant client-only qui monte `MantaDashboard` :

```typescript
'use client'
import dynamic from 'next/dynamic'

const Dashboard = dynamic(
  () => import('@manta/dashboard').then(m => ({ default: m.MantaDashboard })),
  { ssr: false }
)

export default function MantaAdminPage() {
  return <Dashboard apiUrl={window.location.origin} basename="/admin" />
}
```

L'utilisateur ecrit :
```typescript
// src/app/admin/[[...slug]]/page.tsx
export { default } from '@manta/adapter-nextjs/admin'
```

Le `[[...slug]]` (optional catch-all) capture toutes les sous-routes `/admin/*` pour que react-router gere le routing interne du SPA.

### 1.2 Demo : `demo/nextjs/`

```
demo/nextjs/
├── package.json
├── next.config.ts                    # 2 lignes
├── tsconfig.json
├── .env.local                        # DATABASE_URL
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout standard Next.js
│   │   ├── page.tsx                  # Redirect vers /admin
│   │   ├── api/[...path]/
│   │   │   └── route.ts             # 1 ligne : re-export handler
│   │   └── admin/[[...slug]]/
│   │       └── page.tsx              # 1 ligne : re-export admin
│   │
│   ├── modules/                      # IDENTIQUE a demo/manta/src/modules/
│   │   ├── product/
│   │   ├── inventory/
│   │   ├── file/
│   │   └── stats/
│   ├── workflows/                    # IDENTIQUE a demo/manta/src/workflows/
│   │   ├── create-product-pipeline.ts
│   │   └── initialize-inventory.ts
│   ├── subscribers/                  # IDENTIQUE a demo/manta/src/subscribers/
│   │   ├── product-created.ts
│   │   ├── inventory-stocked.ts
│   │   └── low-stock-alert.ts
│   └── api/                          # IDENTIQUE a demo/manta/src/api/
│       └── admin/
│           ├── products/route.ts
│           ├── products/[id]/route.ts
│           ├── registry/route.ts
│           └── test/route.ts
```

**3 fichiers de wiring** (le minimum absolu impose par Next.js App Router) :

```typescript
// next.config.ts — 2 lignes
import { withManta } from '@manta/adapter-nextjs'
export default withManta({})

// src/app/api/[...path]/route.ts — 1 ligne
export { GET, POST, PUT, DELETE, PATCH } from '@manta/adapter-nextjs/handler'

// src/app/admin/[[...slug]]/page.tsx — 1 ligne
export { default } from '@manta/adapter-nextjs/admin'
```

Le code metier (modules, workflows, subscribers, routes API) est **100% portable** depuis la demo Nitro sans modification.

---

## Phase 2 : Refactors identifies (hors scope immediat)

### 2.1 Extraction du pipeline dans `@manta/core`

**Probleme** : `ERROR_STATUS_MAP`, `mapErrorToResponse()`, et toute la logique pure du pipeline (auth verification, RBAC check, validation) est dupliquee entre `adapter-nitro` et `adapter-nextjs`.

**Solution** : Extraire dans `@manta/core/pipeline` ou creer `@manta/http-pipeline` :

```typescript
// @manta/core/pipeline
export function runPipeline(req: Request, options: PipelineOptions): Promise<Response>
export { ERROR_STATUS_MAP, mapErrorToResponse }
```

Les adapteurs deviennent des wrappers minces :
- `adapter-nitro` : H3Event → Request → `runPipeline()` → Response → H3 send
- `adapter-nextjs` : Request → `runPipeline()` → Response (zero conversion)
- Futur `adapter-hono`, `adapter-bun`, etc. : meme pattern

### 2.2 Suppression de H3 dans adapter-nitro

**Probleme** : H3 est une couche de traduction inutile. Les handlers ne l'utilisent pas. Le pipeline fait Request → H3 → Request → Response → H3 → Response.

**Solution** : Quand Nitro V3 sort (Web API natif), `adapter-nitro` peut utiliser le pipeline partage directement. En attendant, on peut deja :
1. Extraire le pipeline pur dans core
2. Adapter `NitroAdapter` pour deleguer au pipeline partage
3. Ne garder que la glue H3 (lecture headers event, envoi reponse)

### 2.3 Manifest build-time pour production

**Probleme** : `discoverResources()` et `discoverRoutes()` font du filesystem scan (`readdirSync`, `existsSync`). Ca marche en dev et au `next build` (qui tourne sur la machine), mais c'est fragile.

**Solution future** : Un webpack plugin dans `withManta()` qui genere un manifest statique au build. Les imports sont resolus statiquement par webpack, plus de scan filesystem au runtime. Deja prevu dans SPEC-074 (`manta build` genere `.manta/manifest/`).

### 2.4 `MantaRequest` devrait etre dans `@manta/core`

Actuellement defini dans `@manta/cli/src/server-bootstrap.ts`. Devrait etre dans `@manta/core/types` puisque c'est le contrat entre le framework et les handlers — utilise par tous les adapteurs.

---

## Verification

1. `cd demo/nextjs && pnpm install && pnpm dev`
2. `curl http://localhost:3000/api/admin/products` → 200 + JSON
3. `curl http://localhost:3000/api/health/live` → 200
4. Ouvrir `http://localhost:3000/admin` → dashboard se charge
5. Navigation SPA dans le dashboard fonctionne
6. Creer un produit via dashboard → POST fonctionne

## Fichiers de reference

| Fichier | Role |
|---------|------|
| `packages/cli/src/server-bootstrap.ts` | Bootstrap existant a reproduire |
| `packages/cli/src/resource-loader.ts` | `discoverResources()` — reutilise |
| `packages/cli/src/route-discovery.ts` | `discoverRoutes()` — reutilise |
| `packages/adapter-nitro/src/pipeline.ts` | `mapErrorToResponse()` a copier |
| `packages/adapter-nitro/src/adapter.ts` | Pipeline 12 steps comme reference |
| `packages/dashboard/src/index.tsx` | Props de MantaDashboard |
| `demo/manta/src/` | Modules/workflows/subscribers a copier |
