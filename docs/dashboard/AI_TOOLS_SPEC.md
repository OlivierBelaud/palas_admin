# Manta Dashboard — AI Tools Specification

## Overview

L'AI Panel permet a l'utilisateur de modifier le dashboard en langage naturel.
L'IA recoit le contexte (page courante, blocs, schemas) et dispose de tools pour agir.

Ce systeme est identique dans les deux modes (Medusa / Manta).
La seule difference : ou les modifications sont persistees (localStorage vs DB).

---

## Tools disponibles

### 1. modify_component

Modifie un composant existant (ex: changer les colonnes d'une table).

```typescript
{
  name: "modify_component",
  description: "Modify an existing dashboard component (table columns, card fields, etc.)",
  parameters: {
    component_id: string,     // ID du composant a modifier
    component: DataComponent, // Le composant complet (remplacement total)
  }
}
```

**Effet** : `overrideStore.setComponentOverride(component_id, component)`

### 2. create_page

Cree une nouvelle page avec ses composants et son entree de navigation.

```typescript
{
  name: "create_page",
  description: "Create a new custom dashboard page",
  parameters: {
    page: PageSpec,             // Spec de la page
    components: DataComponent[], // Composants references par la page
    nav_item: {                 // Entree dans la navigation
      label: string,
      icon?: string,
      to: string,
    }
  }
}
```

**Effet** : `overrideStore.addCustomPage(page, components, nav_item)`

### 3. modify_page

Modifie la structure d'une page existante (ex: ajouter un bloc en sidebar).

```typescript
{
  name: "modify_page",
  description: "Modify an existing page structure (add/remove/reorder blocks)",
  parameters: {
    page_id: string,           // ID de la page a modifier
    page: Partial<PageSpec>,   // Modifications partielles (deep merge)
  }
}
```

**Effet** : `overrideStore.setPageOverride(page_id, page)`

### 4. delete_page

Supprime une page custom (creee par l'AI).

```typescript
{
  name: "delete_page",
  description: "Delete a custom page created by AI",
  parameters: {
    page_id: string,
  }
}
```

**Effet** : `overrideStore.removeCustomPage(page_id)`

Note : ne peut PAS supprimer les pages declarees par les plugins ou le core. Seulement les pages custom.

### 5. set_navigation

Remplace l'arbre de navigation entier.

```typescript
{
  name: "set_navigation",
  description: "Replace the entire sidebar navigation tree",
  parameters: {
    items: NavItem[],
  }
}
```

**Effet** : `overrideStore.setNavigationOverride(items)`

### 6. reset_navigation

Remet la navigation par defaut.

```typescript
{
  name: "reset_navigation",
  description: "Reset navigation to default (remove all customizations)",
  parameters: {}
}
```

**Effet** : `overrideStore.resetNavigationOverride()`

### 7. reset_component

Remet un composant a son etat par defaut (supprime l'override).

```typescript
{
  name: "reset_component",
  description: "Reset a component to its default state (remove AI override)",
  parameters: {
    component_id: string,
  }
}
```

**Effet** : `overrideStore.removeComponentOverride(component_id)`

### 8. reset_all

Supprime tous les overrides de l'utilisateur.

```typescript
{
  name: "reset_all",
  description: "Remove all user customizations and return to defaults",
  parameters: {}
}
```

**Effet** : `overrideStore.resetAll()`

---

## System Prompt

L'AI recoit un system prompt qui contient :

```
You are a dashboard customization assistant for [App Name].

You can modify the admin dashboard by creating pages, modifying components,
and reorganizing navigation.

## Current Context

Page: [current page ID]
Route: [current route]

## Available Block Types

[Zod schemas for all 10 block types]

## Current Page Spec

[JSON of the current PageSpec]

## Current Components

[JSON of all components on the current page]

## Available Entities

[List of entities from the registry with their fields]

## Rules

1. When modifying a component, return the COMPLETE component (not a partial)
2. Column keys must match actual data fields from the entity
3. Use dot notation for nested fields (ex: "collection.title")
4. Use $count for array counts, $sum:field for sums
5. Available formats: text, badge, date, currency, count, boolean, number, percentage
6. Available icons: PencilSquare, Trash, Plus, Photo, EllipsisHorizontal
7. For new pages, generate a unique ID with prefix "custom/"
8. For new page routes, use prefix "/custom/"
```

### Contexte dynamique

Le system prompt est reconstruit a chaque changement de page :
- La page courante et ses composants sont injectes
- Les entites disponibles (from registry) sont listees
- L'historique de conversation est preserve

---

## Interaction avec l'OverrideStore

### Mode Medusa (localStorage)

```
AI Tool call
   → overrideStore.setComponentOverride()
   → localStorage.setItem("manta-ai-overrides", ...)
   → notify() → useSyncExternalStore re-render
```

Immediat, synchrone, pas de latence.

### Mode Manta (API + DB)

```
AI Tool call
   → overrideStore.setComponentOverride()
   → cache local mis a jour
   → notify() → useSyncExternalStore re-render (immediat)
   → scheduleSave() (debounced 1s)
   → PUT /admin/api/config/overrides (async, background)
   → DB write
```

L'UI se met a jour immediatement (cache local).
La persistance en DB est asynchrone et decouplée.

### Resilience

Si le PUT echoue :
1. L'override reste dans le cache local
2. Le prochain PUT renvoie tout le state
3. Si l'user refresh avant le save : les modifications sont perdues (acceptable pour l'instant)

Amelioration future : queue de retry + indicateur "unsaved changes" dans l'UI.

---

## Scopes et partage (Manta uniquement)

### Scope utilisateur (defaut)

Chaque modification AI est sauvee pour l'utilisateur courant uniquement.
Les autres utilisateurs ne voient pas ses customisations.

### Partage avec l'equipe

L'utilisateur peut partager une customisation :

```
User: "Share this table configuration with my team"
AI: Calls share_override tool
   → POST /admin/api/config/overrides/:id/share { scope: "team" }
```

### Templates

Un admin peut promouvoir une customisation en template global :

```
Admin: "Make this page layout the default for everyone"
AI: Calls promote_override tool
   → PUT /admin/api/config/overrides/:id { scope: "global" }
```

### Resolution

```
User override > Team override > Global override > Plugin default > Core default
```

---

## Securite

- Les tools AI ne peuvent PAS executer de code arbitraire
- Les tools sont limites a la manipulation de JSON (PageSpecs, DataComponents, NavItems)
- Les actions destructives (delete_page, reset_all) demandent confirmation dans l'UI
- L'AI ne peut PAS acceder aux donnees metier (pas de SQL, pas de fetch data)
- L'AI ne peut PAS modifier les routes API ni le backend
- Les overrides sont valides cote serveur (schema Zod) avant persistance
- Les scopes sont verifies : un user ne peut pas ecrire un override global sans etre admin
