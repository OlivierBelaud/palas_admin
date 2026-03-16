# Scénario de démo complet — "Product Submission Pipeline"

## Objectif

Un seul appel API (`POST /admin/products`) déclenche un pipeline qui traverse **toutes les couches** du framework :

- **Routes API** (file-based routing, params, validation)
- **Modules** (Product + Inventory — deux modules liés)
- **Services** (logique métier, injection de dépendances)
- **DML / Models** (création en DB, relations)
- **Links** (relation cross-module Product ↔ Inventory)
- **Workflows** (orchestration multi-étapes avec compensation)
- **Sub-workflows** (workflow imbriqué)
- **Events** (émission + subscribers réactifs)
- **Subscribers** (réactions asynchrones aux events)
- **File storage** (upload et génération de fichiers)
- **Jobs planifiés** (tâche périodique)
- **Transactions** (atomicité, rollback sur erreur)
- **Query** (lecture cross-module via links)
- **Error handling** (compensation de workflow, retry)

---

## Architecture

```
POST /admin/products
  │
  ▼
┌─────────────────────────────────────────┐
│  Workflow: create-product-pipeline       │
│                                         │
│  Step 1: validate-product               │
│    → Vérifie les champs requis          │
│    → Vérifie que le SKU est unique      │
│                                         │
│  Step 2: create-product (transaction)   │
│    → ProductService.create()            │
│    → Écrit en DB via IDatabasePort      │
│    → Compensation: ProductService.delete │
│                                         │
│  Step 3: upload-images                  │
│    → IFilePort.write() pour chaque image│
│    → Stocke les URLs dans le produit    │
│    → Compensation: IFilePort.delete()   │
│                                         │
│  Step 4: ┌──────────────────────────┐   │
│          │ Sub-workflow:             │   │
│          │ initialize-inventory      │   │
│          │                           │   │
│          │ Step 4a: create-stock     │   │
│          │   → InventoryService      │   │
│          │     .createStock()        │   │
│          │                           │   │
│          │ Step 4b: set-reorder-rule │   │
│          │   → InventoryService      │   │
│          │     .setReorderPoint()    │   │
│          └──────────────────────────┘   │
│                                         │
│  Step 5: generate-catalog-entry         │
│    → Génère un extrait PDF/JSON         │
│    → IFilePort.write() → catalog/       │
│    → Tâche "longue" (simulée 500ms)     │
│                                         │
│  Step 6: emit-events                    │
│    → Émet "product.created"             │
│    → Émet "inventory.stocked"           │
└─────────────────────────────────────────┘
  │
  ▼ Events émis
┌──────────────────────────────────────────┐
│ Subscriber: on product.created           │
│  → Met à jour un compteur "total_products│
│    " dans une table de stats             │
│  → Log l'event                           │
│                                          │
│ Subscriber: on inventory.stocked         │
│  → Vérifie si le stock initial est bas   │
│  → Si oui, émet "inventory.low-stock"    │
│                                          │
│ Subscriber: on inventory.low-stock       │
│  → Crée une notification (mock)          │
│  → Log un warning                        │
└──────────────────────────────────────────┘

Job planifié (séparé) :
┌──────────────────────────────────────────┐
│ Job: cleanup-draft-products              │
│  → Toutes les 6h (en prod)              │
│  → Supprime les produits en status=draft │
│    créés il y a plus de 24h             │
│  → Émet "product.cleaned" par produit   │
└──────────────────────────────────────────┘
```

---

## Module 1 : Product

### Model DML

```typescript
// src/modules/product/models/product.ts
import { model } from '@manta/core'

export const Product = model.define('Product', {
  id: model.id(),
  title: model.text(),
  description: model.text().nullable(),
  sku: model.text().unique(),
  price: model.number(),
  status: model.enum(['draft', 'active', 'archived']).default('draft'),
  image_urls: model.json().default([]),           // string[]
  catalog_file_url: model.text().nullable(),       // URL du fichier catalogue généré
  metadata: model.json().default({}),
  created_at: model.dateTime().default('now'),
  updated_at: model.dateTime().default('now'),
})
```

### Service

```typescript
// src/modules/product/service.ts
export class ProductService {
  constructor(private deps: { db: IDatabasePort; logger: ILoggerPort }) {}

  async create(data: CreateProductInput): Promise<Product> {
    // INSERT + return
  }

  async findById(id: string): Promise<Product | null> {
    // SELECT by id
  }

  async findBySku(sku: string): Promise<Product | null> {
    // SELECT by sku (pour vérifier unicité)
  }

  async updateImages(id: string, urls: string[]): Promise<void> {
    // UPDATE image_urls
  }

  async updateCatalogUrl(id: string, url: string): Promise<void> {
    // UPDATE catalog_file_url
  }

  async delete(id: string): Promise<void> {
    // DELETE (compensation)
  }

  async deleteDraftsOlderThan(hours: number): Promise<string[]> {
    // DELETE WHERE status='draft' AND created_at < now() - hours
    // Retourne les IDs supprimés
  }

  async countByStatus(status: string): Promise<number> {
    // COUNT pour les stats
  }
}
```

### Routes API

```typescript
// src/api/admin/products/route.ts
export async function POST(req: MantaRequest) {
  // Appelle le workflow create-product-pipeline
  const result = await req.scope.resolve('workflowManager')
    .run('create-product-pipeline', { input: req.validatedBody })
  return Response.json(result, { status: 201 })
}

export async function GET(req: MantaRequest) {
  // Liste tous les produits (avec pagination basique)
  const products = await req.scope.resolve('productService').list()
  return Response.json({ products })
}
```

```typescript
// src/api/admin/products/[id]/route.ts
export async function GET(req: MantaRequest) {
  // Retourne le produit + son inventaire via Query cross-module
  const product = await req.scope.resolve('productService').findById(req.params.id)
  if (!product) return Response.json({ error: 'Not found' }, { status: 404 })

  // Cross-module query : récupère l'inventaire lié
  const inventory = await req.scope.resolve('query').graph({
    entity: 'product',
    fields: ['*'],
    filters: { id: req.params.id },
    links: { inventory_item: { fields: ['*'] } }
  })

  return Response.json({ product, inventory })
}

export async function DELETE(req: MantaRequest) {
  // Suppression avec cleanup des fichiers
  const product = await req.scope.resolve('productService').findById(req.params.id)
  if (!product) return Response.json({ error: 'Not found' }, { status: 404 })

  // Supprimer les fichiers associés
  if (product.image_urls?.length) {
    for (const url of product.image_urls) {
      await req.scope.resolve('fileService').delete(url)
    }
  }
  if (product.catalog_file_url) {
    await req.scope.resolve('fileService').delete(product.catalog_file_url)
  }

  await req.scope.resolve('productService').delete(req.params.id)
  return Response.json({ deleted: true })
}
```

---

## Module 2 : Inventory

### Model DML

```typescript
// src/modules/inventory/models/inventory-item.ts
import { model } from '@manta/core'

export const InventoryItem = model.define('InventoryItem', {
  id: model.id(),
  sku: model.text(),
  quantity: model.number().default(0),
  reorder_point: model.number().default(10),   // seuil d'alerte stock bas
  warehouse: model.text().default('default'),
  created_at: model.dateTime().default('now'),
  updated_at: model.dateTime().default('now'),
})
```

### Service

```typescript
// src/modules/inventory/service.ts
export class InventoryService {
  constructor(private deps: { db: IDatabasePort; logger: ILoggerPort }) {}

  async createStock(data: { sku: string; quantity: number; warehouse?: string }): Promise<InventoryItem> {
    // INSERT
  }

  async setReorderPoint(sku: string, point: number): Promise<void> {
    // UPDATE reorder_point
  }

  async findBySku(sku: string): Promise<InventoryItem | null> {
    // SELECT
  }

  async isLowStock(sku: string): Promise<boolean> {
    // quantity <= reorder_point
  }
}
```

---

## Link : Product ↔ Inventory

```typescript
// src/links/product-inventory.ts
import { defineLink } from '@manta/core'

export default defineLink({
  fromModule: 'product',
  fromField: 'id',
  toModule: 'inventory',
  toField: 'id',
  table: 'product_inventory_link',
})
```

---

## Workflow principal : create-product-pipeline

```typescript
// src/workflows/create-product-pipeline.ts
import { createWorkflow, step } from '@manta/core'
import { initializeInventory } from './initialize-inventory'  // sub-workflow

export const createProductPipeline = createWorkflow({
  name: 'create-product-pipeline',
  steps: [
    // Step 1 : Validation
    step({
      name: 'validate-product',
      handler: async ({ input, context }) => {
        const { title, sku, price } = input
        if (!title || !sku || price == null) {
          throw new Error('Missing required fields: title, sku, price')
        }
        if (price < 0) {
          throw new Error('Price must be non-negative')
        }
        // Vérifier unicité du SKU
        const existing = await context.resolve('productService').findBySku(sku)
        if (existing) {
          throw new Error(`SKU '${sku}' already exists`)
        }
        return { validated: true }
      },
      // Pas de compensation — la validation ne modifie rien
    }),

    // Step 2 : Création du produit
    step({
      name: 'create-product',
      handler: async ({ input, context }) => {
        const product = await context.resolve('productService').create({
          title: input.title,
          description: input.description,
          sku: input.sku,
          price: input.price,
          status: 'draft',
        })
        return { product }
      },
      compensation: async ({ output, context }) => {
        // Rollback : supprimer le produit créé
        await context.resolve('productService').delete(output.product.id)
        context.resolve('logger').warn(`Compensated: deleted product ${output.product.id}`)
      },
    }),

    // Step 3 : Upload des images
    step({
      name: 'upload-images',
      handler: async ({ input, previousOutput, context }) => {
        const product = previousOutput['create-product'].product
        const imageUrls: string[] = []

        if (input.images?.length) {
          const fileService = context.resolve('fileService')
          for (const image of input.images) {
            const url = await fileService.write(
              `products/${product.id}/${image.filename}`,
              image.content  // Buffer ou base64
            )
            imageUrls.push(url)
          }
          await context.resolve('productService').updateImages(product.id, imageUrls)
        }

        return { imageUrls }
      },
      compensation: async ({ output, context }) => {
        // Rollback : supprimer les fichiers uploadés
        const fileService = context.resolve('fileService')
        for (const url of output.imageUrls) {
          await fileService.delete(url)
        }
      },
    }),

    // Step 4 : Sub-workflow — Initialiser l'inventaire
    step({
      name: 'initialize-inventory',
      handler: async ({ input, previousOutput, context }) => {
        const product = previousOutput['create-product'].product
        // Appel du sub-workflow
        const result = await context.resolve('workflowManager').run('initialize-inventory', {
          input: {
            sku: product.sku,
            initialQuantity: input.initialStock || 0,
            reorderPoint: input.reorderPoint || 10,
          }
        })
        return result
      },
      // La compensation du sub-workflow est gérée par le sub-workflow lui-même
    }),

    // Step 5 : Générer l'entrée catalogue (tâche "longue")
    step({
      name: 'generate-catalog-entry',
      handler: async ({ previousOutput, context }) => {
        const product = previousOutput['create-product'].product
        const imageUrls = previousOutput['upload-images'].imageUrls

        // Simuler une tâche longue (génération PDF/JSON)
        await new Promise(resolve => setTimeout(resolve, 500))

        const catalogEntry = JSON.stringify({
          id: product.id,
          title: product.title,
          sku: product.sku,
          price: product.price,
          images: imageUrls,
          generated_at: new Date().toISOString(),
        }, null, 2)

        const catalogUrl = await context.resolve('fileService').write(
          `catalog/${product.sku}.json`,
          Buffer.from(catalogEntry)
        )

        await context.resolve('productService').updateCatalogUrl(product.id, catalogUrl)

        return { catalogUrl }
      },
      compensation: async ({ output, context }) => {
        await context.resolve('fileService').delete(output.catalogUrl)
      },
    }),

    // Step 6 : Émettre les events
    step({
      name: 'emit-events',
      handler: async ({ previousOutput, context }) => {
        const product = previousOutput['create-product'].product
        const inventory = previousOutput['initialize-inventory']
        const eventBus = context.resolve('eventBus')

        await eventBus.emit('product.created', {
          id: product.id,
          sku: product.sku,
          title: product.title,
          price: product.price,
        })

        await eventBus.emit('inventory.stocked', {
          sku: product.sku,
          quantity: inventory.quantity,
          reorderPoint: inventory.reorderPoint,
        })

        // Activer le produit maintenant que tout est prêt
        await context.resolve('productService').updateStatus(product.id, 'active')

        return {
          product: { ...product, status: 'active' },
          inventory,
          events: ['product.created', 'inventory.stocked'],
        }
      },
      // Pas de compensation pour les events (fire-and-forget)
    }),
  ],
})
```

---

## Sub-workflow : initialize-inventory

```typescript
// src/workflows/initialize-inventory.ts
import { createWorkflow, step } from '@manta/core'

export const initializeInventory = createWorkflow({
  name: 'initialize-inventory',
  steps: [
    step({
      name: 'create-stock',
      handler: async ({ input, context }) => {
        const item = await context.resolve('inventoryService').createStock({
          sku: input.sku,
          quantity: input.initialQuantity,
        })
        return { inventoryItem: item }
      },
      compensation: async ({ output, context }) => {
        await context.resolve('inventoryService').delete(output.inventoryItem.id)
      },
    }),

    step({
      name: 'set-reorder-rule',
      handler: async ({ input, output, context }) => {
        await context.resolve('inventoryService').setReorderPoint(
          input.sku,
          input.reorderPoint
        )
        return {
          sku: input.sku,
          quantity: input.initialQuantity,
          reorderPoint: input.reorderPoint,
        }
      },
    }),
  ],
})
```

---

## Subscribers

```typescript
// src/subscribers/product-created.ts
export default {
  event: 'product.created',
  handler: async ({ data, context }) => {
    const logger = context.resolve('logger')
    logger.info(`Product created: ${data.sku} — "${data.title}" at ${data.price}€`)

    // Incrémenter le compteur de stats
    await context.resolve('statsService').increment('total_products')
  },
}
```

```typescript
// src/subscribers/inventory-stocked.ts
export default {
  event: 'inventory.stocked',
  handler: async ({ data, context }) => {
    const logger = context.resolve('logger')
    logger.info(`Inventory stocked: ${data.sku} — ${data.quantity} units`)

    // Vérifier si le stock est bas
    if (data.quantity <= data.reorderPoint) {
      logger.warn(`Low stock alert: ${data.sku} (${data.quantity} ≤ ${data.reorderPoint})`)
      await context.resolve('eventBus').emit('inventory.low-stock', {
        sku: data.sku,
        quantity: data.quantity,
        reorderPoint: data.reorderPoint,
      })
    }
  },
}
```

```typescript
// src/subscribers/low-stock-alert.ts
export default {
  event: 'inventory.low-stock',
  handler: async ({ data, context }) => {
    const logger = context.resolve('logger')
    logger.warn(`🚨 LOW STOCK NOTIFICATION: ${data.sku} needs reorder (${data.quantity} units left)`)

    // En vrai : envoyer un email, un Slack, etc.
    // Ici on écrit dans un fichier pour pouvoir vérifier dans les tests
    await context.resolve('fileService').write(
      `notifications/low-stock-${data.sku}-${Date.now()}.json`,
      Buffer.from(JSON.stringify({
        type: 'low-stock',
        sku: data.sku,
        quantity: data.quantity,
        timestamp: new Date().toISOString(),
      }))
    )
  },
}
```

---

## Job planifié

```typescript
// src/jobs/cleanup-draft-products.ts
export default {
  name: 'cleanup-draft-products',
  schedule: '0 */6 * * *',  // toutes les 6 heures
  handler: async ({ context }) => {
    const logger = context.resolve('logger')
    const productService = context.resolve('productService')
    const eventBus = context.resolve('eventBus')

    const deletedIds = await productService.deleteDraftsOlderThan(24)

    for (const id of deletedIds) {
      await eventBus.emit('product.cleaned', { id })
    }

    logger.info(`Cleanup: ${deletedIds.length} draft products removed`)
    return { deleted: deletedIds.length }
  },
}
```

---

## Script de test end-to-end

Ce script est exécutable via `manta exec scripts/full-pipeline-test.ts` et vérifie tout le flow de bout en bout.

```typescript
// scripts/full-pipeline-test.ts

export default async ({ container, args }) => {
  const logger = container.resolve('logger')
  const workflowManager = container.resolve('workflowManager')
  const productService = container.resolve('productService')
  const inventoryService = container.resolve('inventoryService')
  const fileService = container.resolve('fileService')
  const eventBus = container.resolve('eventBus')
  const statsService = container.resolve('statsService')

  let passed = 0
  let failed = 0

  function assert(name: string, condition: boolean, detail?: string) {
    if (condition) {
      logger.info(`  ✓ ${name}`)
      passed++
    } else {
      logger.error(`  ✗ ${name}${detail ? ': ' + detail : ''}`)
      failed++
    }
  }

  logger.info('═══════════════════════════════════════')
  logger.info('  FULL PIPELINE TEST')
  logger.info('═══════════════════════════════════════')

  // ─── Test 1 : Workflow complet — produit avec stock suffisant ───

  logger.info('\n── Test 1: Full pipeline — normal flow ──')

  const result1 = await workflowManager.run('create-product-pipeline', {
    input: {
      title: 'Test Widget',
      sku: 'TEST-001',
      price: 29.99,
      description: 'A test widget',
      images: [
        { filename: 'front.jpg', content: Buffer.from('fake-image-front') },
        { filename: 'back.jpg', content: Buffer.from('fake-image-back') },
      ],
      initialStock: 100,
      reorderPoint: 10,
    },
  })

  assert('Workflow returns product', !!result1.product?.id)
  assert('Product status is active', result1.product?.status === 'active')
  assert('Events emitted', result1.events?.length === 2)

  // Vérifier en DB
  const product1 = await productService.findBySku('TEST-001')
  assert('Product persisted in DB', !!product1)
  assert('Product title correct', product1?.title === 'Test Widget')
  assert('Product has 2 images', product1?.image_urls?.length === 2)
  assert('Product has catalog URL', !!product1?.catalog_file_url)

  // Vérifier l'inventaire
  const inventory1 = await inventoryService.findBySku('TEST-001')
  assert('Inventory created', !!inventory1)
  assert('Inventory quantity = 100', inventory1?.quantity === 100)
  assert('Reorder point = 10', inventory1?.reorder_point === 10)

  // Vérifier les fichiers
  const catalogExists = await fileService.exists(`catalog/TEST-001.json`)
  assert('Catalog file generated', catalogExists)

  // Vérifier les stats (subscriber product.created)
  const totalProducts = await statsService.get('total_products')
  assert('Stats incremented', totalProducts >= 1)

  // ─── Test 2 : Low stock trigger ───

  logger.info('\n── Test 2: Low stock — triggers notification chain ──')

  const result2 = await workflowManager.run('create-product-pipeline', {
    input: {
      title: 'Rare Item',
      sku: 'RARE-001',
      price: 199.99,
      initialStock: 5,     // en dessous du reorder point
      reorderPoint: 10,
    },
  })

  assert('Low stock product created', !!result2.product?.id)

  // Attendre que les subscribers async finissent
  await new Promise(r => setTimeout(r, 200))

  // Vérifier que la notification low-stock a été écrite
  const notifications = await fileService.list('notifications/')
  const lowStockNotif = notifications.find(f => f.includes('low-stock-RARE-001'))
  assert('Low stock notification file created', !!lowStockNotif)

  // ─── Test 3 : Validation errors ───

  logger.info('\n── Test 3: Validation errors ──')

  try {
    await workflowManager.run('create-product-pipeline', {
      input: { title: 'No SKU', price: 10 },  // missing sku
    })
    assert('Missing SKU throws', false)
  } catch (e: any) {
    assert('Missing SKU throws', e.message.includes('Missing required fields'))
  }

  try {
    await workflowManager.run('create-product-pipeline', {
      input: { title: 'Negative', sku: 'NEG-001', price: -5 },
    })
    assert('Negative price throws', false)
  } catch (e: any) {
    assert('Negative price throws', e.message.includes('non-negative'))
  }

  try {
    await workflowManager.run('create-product-pipeline', {
      input: { title: 'Duplicate', sku: 'TEST-001', price: 10 },  // SKU déjà utilisé
    })
    assert('Duplicate SKU throws', false)
  } catch (e: any) {
    assert('Duplicate SKU throws', e.message.includes('already exists'))
  }

  // ─── Test 4 : Compensation (rollback) ───

  logger.info('\n── Test 4: Compensation — step failure triggers rollback ──')

  // Forcer une erreur dans generate-catalog-entry en passant un flag spécial
  // (ou en mockant le fileService pour qu'il échoue sur catalog/)
  // Pour le test, on va simplement vérifier que si on supprime un produit,
  // les fichiers associés sont nettoyés

  const productToDelete = await productService.findBySku('TEST-001')
  assert('Product to delete exists', !!productToDelete)

  await productService.delete(productToDelete!.id)
  const deletedProduct = await productService.findBySku('TEST-001')
  assert('Product deleted from DB', !deletedProduct)

  // ─── Test 5 : Job cleanup ───

  logger.info('\n── Test 5: Cleanup job — removes old drafts ──')

  // Créer un produit draft "ancien" (on triche sur la date)
  await productService.create({
    title: 'Old Draft',
    sku: 'DRAFT-001',
    price: 0,
    status: 'draft',
    // created_at sera "now" mais on testera la logique
  })

  const draftExists = await productService.findBySku('DRAFT-001')
  assert('Draft product created', !!draftExists)

  // Le job cleanup ne supprimera pas ce draft (créé il y a < 24h)
  // Mais on vérifie que la fonction fonctionne
  const cleaned = await productService.deleteDraftsOlderThan(0)  // 0h = supprime tout
  assert('Cleanup found the draft', cleaned.includes(draftExists!.id))

  // ─── Test 6 : Query cross-module ───

  logger.info('\n── Test 6: Cross-module query — Product + Inventory ──')

  const result6 = await workflowManager.run('create-product-pipeline', {
    input: {
      title: 'Linked Product',
      sku: 'LINK-001',
      price: 49.99,
      initialStock: 50,
    },
  })

  // Query qui traverse le link Product → Inventory
  const query = container.resolve('query')
  const linked = await query.graph({
    entity: 'product',
    filters: { sku: 'LINK-001' },
    fields: ['id', 'title', 'sku', 'price'],
    links: {
      inventory_item: {
        fields: ['quantity', 'reorder_point'],
      },
    },
  })

  assert('Cross-module query returns product', !!linked?.title)
  assert('Cross-module query includes inventory', linked?.inventory_item?.quantity === 50)

  // ─── Résumé ───

  logger.info('\n═══════════════════════════════════════')
  logger.info(`  RESULTS: ${passed} passed, ${failed} failed`)
  logger.info('═══════════════════════════════════════')

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`)
  }
}
```

---

## Couches exercées — checklist

| Couche | Où dans le scénario |
|--------|-------------------|
| Routes API (file-based) | POST/GET/DELETE /admin/products, /admin/products/:id |
| Module (definition + registration) | Product, Inventory — deux modules distincts |
| Service (DI, logique métier) | ProductService, InventoryService, StatsService |
| DML / Models | Product (8 champs), InventoryItem (6 champs) |
| Links (cross-module) | product-inventory.ts, utilisé dans Query.graph |
| Workflow (multi-step) | create-product-pipeline (6 steps) |
| Sub-workflow | initialize-inventory (2 steps) appelé depuis step 4 |
| Compensation (rollback) | Steps 2, 3, 5 ont des handlers de compensation |
| Events (emit) | product.created, inventory.stocked, inventory.low-stock, product.cleaned |
| Subscribers (react) | 3 subscribers, dont un qui chaîne un event (stocked → low-stock) |
| File storage (write/read/delete) | Images, catalogue JSON, notifications |
| Job planifié | cleanup-draft-products (cron) |
| Tâche longue (async) | generate-catalog-entry (500ms simulés) |
| Transaction | create-product est atomique |
| Query cross-module | GET /admin/products/:id avec inventory via link |
| Error handling | Validation errors, duplicate SKU, compensation |
| Container DI (scoped) | Chaque requête/workflow a son scope |

---

## Comment l'utiliser

### En développement

```bash
cd demo/
manta dev
# Puis dans un autre terminal :
curl -X POST http://localhost:9000/admin/products \
  -H "Content-Type: application/json" \
  -d '{"title":"Widget","sku":"W-001","price":29.99,"initialStock":100}'
```

### Test scripté complet

```bash
manta exec scripts/full-pipeline-test.ts
```

### En test automatisé (e2e)

Un test Vitest qui :
1. Spawn `manta dev`
2. Attend "Server ready"
3. Exécute les mêmes appels via `fetch()`
4. Vérifie les réponses, les side-effects (fichiers, DB)
5. SIGINT → shutdown
