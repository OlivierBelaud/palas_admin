# Manta Dashboard — JSON-Render Specification

## Overview

Le JSON-Render est le coeur du dashboard. C'est un systeme declaratif ou les pages sont des specs JSON composees de blocs. Le meme moteur fonctionne dans les deux modes (Medusa / Manta).

---

## PageSpec

Chaque page est un objet `PageSpec` :

```typescript
interface PageSpec {
  /** Identifiant unique. Convention: "entity/type" ex: "products/list" */
  id: string

  /** Type de page */
  type: "list" | "detail"

  /** Layout */
  layout: "single-column" | "two-column"

  /** Route path (pour le router) */
  route: string

  /** Query pour fetcher les donnees */
  query: QueryDef

  /** Breadcrumb */
  breadcrumb: {
    label: string       // Label statique ou i18n key
    field?: string      // Champ dynamique pour detail (ex: "title")
  }

  /** Blocs a rendre dans la zone principale */
  main: string[]        // IDs de DataComponent

  /** Blocs a rendre dans la sidebar (layout two-column uniquement) */
  sidebar?: string[]
}
```

### QueryDef

```typescript
interface QueryDef {
  /** Nom de l'entite (ex: "product", "order") */
  entity: string

  /** True pour les listing pages */
  list?: boolean

  /** ID de l'entite (detail pages). Peut etre une $state ref */
  id?: string | { $state: string }

  /** Champs a inclure dans la reponse */
  fields?: string

  /** Relations a expand */
  expand?: Record<string, {
    fields?: string[]
    expand?: Record<string, unknown>
  }>

  /** Nombre d'items par page (listing) */
  pageSize?: number

  /** Filtres statiques (ex: { status: "draft" }) */
  filters?: Record<string, unknown> | { $state: string }

  /** Tri */
  sort?: { field: string; direction: "asc" | "desc" } | { $state: string }
}
```

### $state — References dynamiques

Les `$state` refs permettent de referencer des valeurs du contexte runtime :

```typescript
{ $state: "/route/params/id" }    // → params.id du router
{ $state: "/auth/user/id" }       // → ID de l'utilisateur courant
{ $state: "/store/id" }           // → ID du store
```

Resolution via JSON Pointer : `/route/params/id` → `state.route.params.id`

---

## DataComponent

Un composant est une instance typee d'un bloc :

```typescript
interface DataComponent {
  /** ID unique du composant */
  id: string

  /** Type de bloc (doit correspondre a un renderer enregistre) */
  type: BlockType

  /** Props specifiques au type de bloc */
  props: Record<string, unknown>
}

type BlockType =
  | "EntityTable"
  | "InfoCard"
  | "RelationTable"
  | "RelationList"
  | "MediaCard"
  | "JsonCard"
  | "ActivityCard"
  | "StatsCard"
  | "TreeList"
  | "ReactBridge"
```

---

## Les 10 Block Types

### 1. EntityTable

Table de listing avec recherche, tri, pagination, filtres, actions par ligne.

```typescript
{
  type: "EntityTable",
  props: {
    /** Titre affiche au-dessus de la table */
    title: string

    /** Colonnes */
    columns: Column[]

    /** Actions dans le header (ex: bouton "Create") */
    actions?: BlockAction[]

    /** Actions par ligne (dropdown "...") */
    rowActions?: {
      groups: Array<{
        actions: BlockAction[]
      }>
    }

    /** Champ utilise pour le lien de chaque ligne */
    rowLink?: string  // ex: "/products/:id"

    /** Activer la recherche */
    searchable?: boolean

    /** Filtres disponibles */
    filters?: FilterDef[]

    /** Prefix ID dans l'URL */
    prefix?: string
  }
}
```

#### Column

```typescript
interface Column {
  /** Cle d'acces dans les donnees (dot notation supportee) */
  key: string

  /** Label affiche dans le header */
  label: string

  /** Format d'affichage */
  format?: "text" | "badge" | "date" | "currency" | "count" | "boolean" | "number" | "percentage"

  /** Triable */
  sortable?: boolean

  /** Largeur (CSS) */
  width?: string
}
```

### 2. InfoCard

Carte d'information avec des champs clef-valeur et des actions.

```typescript
{
  type: "InfoCard",
  props: {
    title: string
    fields: Field[]
    actions?: BlockAction[]

    /** Condition d'affichage */
    when?: WhenCondition
  }
}
```

#### Field

```typescript
interface Field {
  /** Cle d'acces dans les donnees */
  key: string

  /** Label affiche */
  label: string

  /** Type d'affichage */
  type: "text" | "badge" | "date" | "currency" | "boolean" | "number" | "percentage" | "json"

  /** Condition d'affichage du champ */
  when?: WhenCondition
}
```

### 3. RelationTable

Sous-table pour afficher une relation (ex: variantes d'un produit).

```typescript
{
  type: "RelationTable",
  props: {
    title: string

    /** Chemin vers la relation dans les donnees (dot notation) */
    dataPath: string  // ex: "variants"

    columns: Column[]
    actions?: BlockAction[]
    rowActions?: { groups: Array<{ actions: BlockAction[] }> }
    rowLink?: string

    /** Condition d'affichage */
    when?: WhenCondition
  }
}
```

### 4. RelationList

Liste simple pour une relation (sans table).

```typescript
{
  type: "RelationList",
  props: {
    title: string
    dataPath: string
    displayField: string  // Champ a afficher pour chaque item
    linkField?: string    // Champ pour le lien
    linkPattern?: string  // Pattern de lien (ex: "/customers/:id")
    actions?: BlockAction[]
    when?: WhenCondition
  }
}
```

### 5. MediaCard

Carte pour afficher des images/medias.

```typescript
{
  type: "MediaCard",
  props: {
    title: string
    /** Chemin vers le champ image (ou tableau d'images) */
    dataPath: string      // ex: "thumbnail" ou "images"
    actions?: BlockAction[]
    when?: WhenCondition
  }
}
```

### 6. JsonCard

Carte affichant un blob JSON editable.

```typescript
{
  type: "JsonCard",
  props: {
    title: string
    dataPath: string      // ex: "metadata"
    editable?: boolean
    actions?: BlockAction[]
    when?: WhenCondition
  }
}
```

### 7. ActivityCard

Timeline d'activite/historique.

```typescript
{
  type: "ActivityCard",
  props: {
    title: string
    dataPath: string      // ex: "activity_log"
    timestampField: string
    descriptionField: string
    actorField?: string
    when?: WhenCondition
  }
}
```

### 8. StatsCard

Metriques clefs avec formatage.

```typescript
{
  type: "StatsCard",
  props: {
    title: string
    stats: Array<{
      label: string
      key: string           // Chemin dans les donnees
      format?: "number" | "currency" | "percentage" | "count"
    }>
    when?: WhenCondition
  }
}
```

### 9. TreeList

Affichage hierarchique (ex: categories).

```typescript
{
  type: "TreeList",
  props: {
    title: string
    dataPath: string          // ex: "category_children"
    labelField: string        // ex: "name"
    childrenField: string     // ex: "category_children"
    linkPattern?: string
    actions?: BlockAction[]
    when?: WhenCondition
  }
}
```

### 10. ReactBridge

Pont vers un composant React natif (pour les cas complexes non couverts par JSON-Render).

```typescript
{
  type: "ReactBridge",
  props: {
    /** Identifiant du composant React enregistre */
    componentId: string

    /** Props a passer au composant */
    componentProps?: Record<string, unknown>

    /** Chemin de donnees a passer */
    dataPath?: string

    when?: WhenCondition
  }
}
```

---

## Structures partagees

### WhenCondition — Affichage conditionnel

```typescript
type WhenCondition =
  | { field: string; equals: unknown }
  | { field: string; notEquals: unknown }
  | { field: string; exists: true }
  | { field: string; notExists: true }
  | { field: string; gt: number }
  | { field: string; lt: number }
  | { field: string; in: unknown[] }
  | { all: WhenCondition[] }
  | { any: WhenCondition[] }
```

Exemples :
```typescript
// Afficher seulement si le produit a un thumbnail
{ field: "thumbnail", exists: true }

// Afficher si le statut est draft OU pending
{ any: [
  { field: "status", equals: "draft" },
  { field: "status", equals: "pending" }
]}

// Afficher si quantite > 0 ET statut = published
{ all: [
  { field: "inventory_quantity", gt: 0 },
  { field: "status", equals: "published" }
]}
```

### BlockAction

```typescript
interface BlockAction {
  /** Label du bouton */
  label: string

  /** Icone (@medusajs/icons name) */
  icon?: string

  /** Lien de navigation (supporte :param) */
  to?: string

  /** Action speciale ("delete", "archive", etc.) */
  action?: string

  /** Type d'entite pour les actions CRUD */
  entity?: string

  /** Style destructif (rouge) */
  destructive?: boolean
}
```

### FilterDef

```typescript
interface FilterDef {
  /** Cle du parametre de filtre */
  key: string

  /** Label affiche */
  label: string

  /** Type de filtre */
  type: "select" | "multi-select" | "date-range" | "boolean"

  /** Options pour select/multi-select */
  options?: Array<{ label: string; value: string }>
}
```

---

## Resolution de donnees

### resolveDataPath(data, path)

Acces par dot notation aux donnees, avec operateurs speciaux :

```typescript
resolveDataPath(product, "title")                    // → "T-Shirt"
resolveDataPath(product, "variants.$count")           // → 3
resolveDataPath(product, "variants.0.title")          // → "Small"
resolveDataPath(product, "options.$sum:stock")         // → 150
resolveDataPath(product, "collection.title")           // → "Summer 2024"
```

### resolveStateRef(ref, state)

Resolution des $state references :

```typescript
const state = {
  route: { params: { id: "prod_123" } },
  auth: { user: { id: "user_456" } },
}

resolveStateRef({ $state: "/route/params/id" }, state)  // → "prod_123"
resolveStateRef("static_value", state)                   // → "static_value"
resolveStateRef(null, state)                              // → null
```

---

## Override & Resolution

### Priorite de resolution

```
1. Runtime overrides (AI modifications)
2. Custom pages (AI-created pages)
3. Config overrides (defineConfig dans l'app)
4. Plugin defaults (pages declarees par les plugins)
5. Core defaults (pages built-in)
```

### Comment l'AI modifie une page

L'AI recoit le schema des blocs (Zod) et peut :

1. **Modifier un composant** : changer les colonnes d'une table, ajouter un champ a une InfoCard
2. **Creer une page** : nouvelle PageSpec + DataComponents + NavItem
3. **Reorganiser la navigation** : reordonner, masquer, regrouper les elements

Chaque modification est un JSON stocke dans l'OverrideStore.

### Merge strategy

Les overrides sont **fusionnes** avec les defaults :

```typescript
// Override partiel d'une page
{
  pages: {
    "products/list": {
      main: ["products-table", "products-stats"]  // ajoute products-stats
    }
  }
}

// Override d'un composant
{
  components: {
    "products-table": {
      type: "EntityTable",
      props: {
        // Remplace TOUT le props du composant
        title: "My Products",
        columns: [...]  // nouvelle liste de colonnes
      }
    }
  }
}
```

Pages = merge partiel (deep merge). Composants = remplacement total.

---

## Exemple complet : Page "Products List"

### PageSpec

```json
{
  "id": "products/list",
  "type": "list",
  "layout": "single-column",
  "route": "/products",
  "query": {
    "entity": "product",
    "list": true,
    "pageSize": 20,
    "fields": "*variants,*collection,*sales_channels"
  },
  "breadcrumb": { "label": "Products" },
  "main": ["products-table"]
}
```

### DataComponent

```json
{
  "id": "products-table",
  "type": "EntityTable",
  "props": {
    "title": "Products",
    "columns": [
      { "key": "title", "label": "Title", "sortable": true },
      { "key": "collection.title", "label": "Collection" },
      { "key": "sales_channels", "label": "Availability", "format": "count" },
      { "key": "variants", "label": "Variants", "format": "count" },
      { "key": "status", "label": "Status", "format": "badge", "sortable": true }
    ],
    "actions": [
      { "label": "Create", "icon": "Plus", "to": "/products/create" }
    ],
    "rowActions": {
      "groups": [
        {
          "actions": [
            { "label": "Edit", "icon": "PencilSquare", "to": "/products/:id/edit" }
          ]
        },
        {
          "actions": [
            { "label": "Delete", "icon": "Trash", "action": "delete", "entity": "products", "destructive": true }
          ]
        }
      ]
    },
    "rowLink": "/products/:id",
    "searchable": true
  }
}
```

### Ce que l'AI peut faire

Utilisateur : "Ajoute une colonne prix a la table des produits"

L'AI genere un override :
```json
{
  "components": {
    "products-table": {
      "type": "EntityTable",
      "props": {
        "title": "Products",
        "columns": [
          { "key": "title", "label": "Title", "sortable": true },
          { "key": "collection.title", "label": "Collection" },
          { "key": "variants.0.prices.0.amount", "label": "Price", "format": "currency" },
          { "key": "sales_channels", "label": "Availability", "format": "count" },
          { "key": "variants", "label": "Variants", "format": "count" },
          { "key": "status", "label": "Status", "format": "badge", "sortable": true }
        ]
      }
    }
  }
}
```

Le resolver detecte l'override, le SpecRenderer re-resolve le composant, et la table affiche maintenant une colonne prix.
