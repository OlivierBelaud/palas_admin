Lis `docs/DEMO_SCENARIO_SPEC.md`. C'est le scénario complet "Product Submission Pipeline" qui exerce toutes les couches du framework.

## Contexte

Le framework est maintenant complet :
- 783 tests pass, 0 fail, 0 stub
- ResourceLoader scanne dynamiquement les modules/subscribers/workflows/jobs/links
- Lazy boot steps 9-18 implémentés (chargement dynamique)
- Pipeline HTTP avec auth, validation Zod, scope, RBAC
- WorkflowManager réel avec exécution séquentielle et compensation saga
- createService() génère 8 méthodes CRUD
- defineLink() crée les tables de jointure
- EventBus avec subscribers + makeIdempotent
- IFilePort InMemory (write, read, delete, exists, list)
- Service decorators (@InjectManager, @EmitEvents)

Tout est en place pour que le scénario de démo fonctionne sans aucun hack ni hardcode.

## Ce que tu dois faire

Implémente tout dans `demo/` en suivant `docs/DEMO_SCENARIO_SPEC.md` :

### 1. Module Product (compléter l'existant)

Le module Product existe déjà dans `demo/src/modules/product/`. Il faut :
- Enrichir le model DML avec les champs manquants (sku, status, image_urls, catalog_file_url, metadata)
- Compléter le service avec les méthodes manquantes (findBySku, updateImages, updateCatalogUrl, updateStatus, deleteDraftsOlderThan, countByStatus)
- Adapter les routes existantes pour appeler le workflow au lieu du service directement

### 2. Module Inventory (nouveau)

Crée `demo/src/modules/inventory/` :
- `models/inventory-item.ts` — DML avec sku, quantity, reorder_point, warehouse
- `service.ts` — InventoryService (createStock, setReorderPoint, findBySku, isLowStock, delete)
- `index.ts` — Module() export

### 3. Link Product ↔ Inventory

Crée `demo/src/links/product-inventory.ts` avec defineLink()

### 4. Workflow principal : create-product-pipeline

Crée `demo/src/workflows/create-product-pipeline.ts` — 6 steps :
1. validate-product (champs requis, SKU unique, prix ≥ 0)
2. create-product (avec compensation: delete)
3. upload-images (avec compensation: delete files)
4. initialize-inventory (appelle le sub-workflow)
5. generate-catalog-entry (tâche longue 500ms, génère JSON dans catalog/)
6. emit-events (product.created + inventory.stocked, puis status → active)

### 5. Sub-workflow : initialize-inventory

Crée `demo/src/workflows/initialize-inventory.ts` — 2 steps :
1. create-stock (avec compensation: delete)
2. set-reorder-rule

### 6. Subscribers

Crée dans `demo/src/subscribers/` :
- `product-created.ts` — log + incrémenter stats
- `inventory-stocked.ts` — vérifier low stock → émettre inventory.low-stock si besoin
- `low-stock-alert.ts` — écrire une notification dans un fichier

### 7. Job planifié

Crée `demo/src/jobs/cleanup-draft-products.ts` — supprime les drafts > 24h

### 8. StatsService

Crée un service minimal pour stocker/incrémenter des compteurs (peut être in-memory ou en DB).

### 9. Script de test e2e

Crée `demo/scripts/full-pipeline-test.ts` — exactement comme dans DEMO_SCENARIO_SPEC.md :
- Test 1 : workflow complet (produit + images + inventaire + catalogue)
- Test 2 : low stock trigger (chaîne d'events)
- Test 3 : validation errors (champs manquants, prix négatif, SKU dupliqué)
- Test 4 : compensation (vérifier le cleanup)
- Test 5 : job cleanup des drafts
- Test 6 : query cross-module (Product + Inventory via link)

### 10. Test Vitest e2e

Crée `demo/__tests__/full-pipeline.integration.test.ts` qui :
1. Spawn `manta dev` dans le dossier demo
2. Attend "Server ready"
3. Exécute le pipeline complet via fetch() HTTP
4. Vérifie chaque réponse et side-effect
5. SIGINT → shutdown

## Règles

1. **Utilise les vrais composants du framework** — createWorkflow, step, Module, defineLink, defineConfig, etc. Pas de hack, pas de contournement.

2. **Si quelque chose ne marche pas** (une API du framework ne fait pas ce que la spec dit), **corrige le framework dans packages/core/** et ajoute le test correspondant. Ne contourne pas.

3. **Les 783 tests existants doivent continuer à passer.** Vérifie avec `pnpm test` régulièrement.

4. **Le test ultime** : `manta exec demo/scripts/full-pipeline-test.ts` → toutes les assertions passent.

## Ordre d'implémentation

```
1. Module Inventory (model + service + index)
2. Link product-inventory
3. StatsService
4. Enrichir module Product (model + service)
5. Sub-workflow initialize-inventory
6. Workflow create-product-pipeline
7. Subscribers (3 fichiers)
8. Job cleanup-draft-products
9. Adapter les routes API pour appeler le workflow
10. Script full-pipeline-test.ts
11. Test Vitest e2e

→ Après chaque étape : pnpm test (ne rien casser)
→ Après étape 9 : manta dev dans demo/ doit démarrer
→ Après étape 10 : manta exec demo/scripts/full-pipeline-test.ts doit passer
→ Après étape 11 : pnpm test:all doit passer
```

## Vérification finale

```bash
# Le framework
pnpm test          # 783+ pass, 0 fail

# Le scénario complet via script
cd demo && manta exec scripts/full-pipeline-test.ts
# → Toutes les assertions passent

# Le scénario complet via HTTP
pnpm test:all      # Inclut le test e2e Vitest
# → 0 fail

# Test manuel rapide
cd demo && manta dev
# Autre terminal :
curl -X POST http://localhost:9000/admin/products \
  -H "Content-Type: application/json" \
  -d '{"title":"Widget","sku":"W-001","price":29.99,"initialStock":100}'
# → 201, produit créé, inventaire initialisé, catalogue généré, events émis
```
