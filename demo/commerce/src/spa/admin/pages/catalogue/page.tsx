import { useDashboardContext } from '@mantajs/dashboard'
import { Alert, Badge, Button, Input } from '@mantajs/ui'
import { ChevronDown, ChevronRight, GripVertical, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildCategoryTree,
  type CatalogCategory,
  type CatalogProduct,
  type CategoryNode,
  categoryBreadcrumb,
  categoryProductCandidates,
  categoryRepresentativeProduct,
  descendantIds,
  flattenCategoryTree,
  moveItem,
} from '../../catalog-taxonomy'

const ENDPOINT = '/api/admin/catalog-taxonomy'
const ALL = '__all__'
const UNCLASSIFIED = '__unclassified__'
class CataloguePageError extends Error {}

type CatalogueData = {
  categories: CatalogCategory[]
  products: CatalogProduct[]
  summary: { products: number; classified: number; unclassified: number; categories: number }
}

type CatalogueMutationData = CatalogueData & {
  shopify_sync?: { ok: boolean; collections?: number; error?: string }
}

function TreeItem({
  node,
  selected,
  expanded,
  onSelect,
  onToggle,
  onCategoryDragStart,
  onCategoryDragOver,
  onCategoryDrop,
  onCategoryDragEnd,
  categoryDropTarget,
  addingParentId,
  newTitle,
  onAdd,
  onCancelAdd,
  onCreate,
  onNewTitle,
  depth = 0,
}: {
  node: CategoryNode
  selected: string
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onCategoryDragStart: (id: string) => void
  onCategoryDragOver: (id: string, placement: 'before' | 'after') => void
  onCategoryDrop: (id: string, placement: 'before' | 'after') => void
  onCategoryDragEnd: () => void
  categoryDropTarget: { id: string; placement: 'before' | 'after'; valid: boolean } | null
  addingParentId: string | null
  newTitle: string
  onAdd: (id: string) => void
  onCancelAdd: () => void
  onCreate: (event: React.FormEvent, parentId: string) => void
  onNewTitle: (value: string) => void
  depth?: number
}) {
  const isOpen = expanded.has(node.id)
  return (
    <div>
      <div
        className={`relative flex items-center gap-1 rounded px-2 py-1.5 text-sm ${selected === node.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        draggable
        onDragEnd={onCategoryDragEnd}
        onDragOver={(event) => {
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          onCategoryDragOver(node.id, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after')
        }}
        onDragStart={() => onCategoryDragStart(node.id)}
        onDrop={() => onCategoryDrop(node.id, categoryDropTarget?.placement ?? 'before')}
        role="treeitem"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        tabIndex={0}
      >
        {categoryDropTarget?.id === node.id ? (
          <span
            className={`pointer-events-none absolute left-2 right-1 z-10 h-0.5 rounded ${categoryDropTarget.valid ? 'bg-blue-500' : 'bg-red-500'} ${categoryDropTarget.placement === 'before' ? '-top-px' : '-bottom-px'}`}
          />
        ) : null}
        <GripVertical className="shrink-0 cursor-grab opacity-50" size={13} />
        <button
          aria-label={isOpen ? 'Replier' : 'Déplier'}
          className="flex size-5 shrink-0 items-center justify-center"
          disabled={node.children.length === 0}
          onClick={() => onToggle(node.id)}
          type="button"
        >
          {node.children.length > 0 ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </button>
        <button
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          onClick={() => onSelect(node.id)}
          type="button"
        >
          <span className="truncate">{node.title_fr}</span>
          <span className="text-xs opacity-70">
            {node.direct_product_count}/{node.descendant_product_count}
          </span>
        </button>
        <button
          aria-label={`Ajouter une sous-catégorie à ${node.title_fr}`}
          className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-background/30"
          onClick={(event) => {
            event.stopPropagation()
            onAdd(node.id)
          }}
          title="Ajouter une sous-catégorie"
          type="button"
        >
          <Plus size={14} />
        </button>
      </div>
      {addingParentId === node.id ? (
        <form
          className="flex gap-2 py-2 pr-2"
          onSubmit={(event) => onCreate(event, node.id)}
          style={{ paddingLeft: `${36 + depth * 16}px` }}
        >
          <Input
            autoFocus
            className="h-8 min-w-0"
            onChange={(event) => onNewTitle(event.target.value)}
            placeholder="Nom de la catégorie"
            required
            value={newTitle}
          />
          <Button disabled={!newTitle.trim()} type="submit">
            Ajouter
          </Button>
          <button className="px-1 text-xs text-muted-foreground" onClick={onCancelAdd} type="button">
            Annuler
          </button>
        </form>
      ) : null}
      {isOpen
        ? node.children.map((child) => (
            <TreeItem
              depth={depth + 1}
              expanded={expanded}
              key={child.id}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
              onCategoryDragStart={onCategoryDragStart}
              onCategoryDragOver={onCategoryDragOver}
              onCategoryDrop={onCategoryDrop}
              onCategoryDragEnd={onCategoryDragEnd}
              categoryDropTarget={categoryDropTarget}
              addingParentId={addingParentId}
              newTitle={newTitle}
              onAdd={onAdd}
              onCancelAdd={onCancelAdd}
              onCreate={onCreate}
              onNewTitle={onNewTitle}
              selected={selected}
            />
          ))
        : null}
    </div>
  )
}

export default function CataloguePage() {
  const { dataSource } = useDashboardContext()
  const [data, setData] = useState<CatalogueData | null>(null)
  const [selected, setSelected] = useState(ALL)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [includeDescendants, setIncludeDescendants] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const initialProductSyncStarted = useRef(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null)
  const [productDropTarget, setProductDropTarget] = useState<{
    id: string
    placement: 'before' | 'after'
    valid: boolean
  } | null>(null)
  const [categoryDropTarget, setCategoryDropTarget] = useState<{
    id: string
    placement: 'before' | 'after'
    valid: boolean
  } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [addingParentId, setAddingParentId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = (await dataSource.fetch(ENDPOINT)) as { data?: CatalogueData }
      if (!body.data) throw new CataloguePageError('Réponse catalogue vide')
      setData(body.data)
      if (expanded.size === 0)
        setExpanded(
          new Set(
            body.data.categories.filter((category) => category.parent_id === null).map((category) => category.id),
          ),
        )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de charger le catalogue')
    } finally {
      setLoading(false)
    }
  }, [dataSource, expanded.size])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = useCallback(
    async (input: Record<string, unknown>) => {
      setBusy(true)
      setError(null)
      try {
        const body = (await dataSource.mutate(ENDPOINT, 'POST', input)) as { data?: CatalogueMutationData }
        if (body.data) {
          setData(body.data)
          if (body.data.shopify_sync?.ok) {
            setSyncMessage(`${body.data.shopify_sync.collections ?? 0} collection(s) Shopify PALAS synchronisée(s).`)
          } else if (body.data.shopify_sync?.error) {
            setError(`Le catalogue CRM a été enregistré, mais Shopify n’a pas suivi : ${body.data.shopify_sync.error}`)
          }
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Action catalogue impossible')
      } finally {
        setBusy(false)
      }
    },
    [dataSource],
  )

  useEffect(() => {
    if (!data || initialProductSyncStarted.current) return
    initialProductSyncStarted.current = true
    void mutate({ action: 'sync_products' })
  }, [data, mutate])

  const tree = useMemo(() => buildCategoryTree(data?.categories ?? []), [data?.categories])
  const orderedCategories = useMemo(() => flattenCategoryTree(tree), [tree])
  const selectedCategory = data?.categories.find((category) => category.id === selected)
  const products = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLocaleLowerCase('fr')
    let categoryIds: Set<string> | null = null
    if (selected !== ALL && selected !== UNCLASSIFIED) {
      categoryIds = includeDescendants ? descendantIds(selected, data.categories) : new Set([selected])
    }
    return data.products.filter((product) => {
      if (selected === UNCLASSIFIED && product.canonical_category_id !== null) return false
      if (categoryIds && (!product.canonical_category_id || !categoryIds.has(product.canonical_category_id)))
        return false
      return (
        !query ||
        `${product.title} ${product.product_type ?? ''} ${product.visual_group ?? ''}`
          .toLocaleLowerCase('fr')
          .includes(query)
      )
    })
  }, [data, includeDescendants, search, selected])

  async function reorder(targetId: string, placement: 'before' | 'after') {
    if (!data || !draggedId || draggedId === targetId) return
    const dragged = data.products.find((product) => product.shopify_product_id === draggedId)
    const target = data.products.find((product) => product.shopify_product_id === targetId)
    if (!dragged?.canonical_category_id || dragged.canonical_category_id !== target?.canonical_category_id) {
      setError('Un produit peut être réordonné uniquement parmi les produits de sa catégorie canonique.')
      setDraggedId(null)
      setProductDropTarget(null)
      return
    }
    const direct = data.products
      .filter((product) => product.canonical_category_id === dragged.canonical_category_id)
      .sort((a, b) => a.category_position - b.category_position || a.title.localeCompare(b.title))
    const next = moveItem(direct, draggedId, targetId, placement, (product) => product.shopify_product_id)
    setDraggedId(null)
    setProductDropTarget(null)
    await mutate({
      action: 'reorder_products',
      category_id: dragged.canonical_category_id,
      product_ids: next.map((product) => product.shopify_product_id),
    })
  }

  async function reorderCategories(targetId: string, placement: 'before' | 'after') {
    if (!data || !draggedCategoryId || draggedCategoryId === targetId) return
    const dragged = data.categories.find((category) => category.id === draggedCategoryId)
    const target = data.categories.find((category) => category.id === targetId)
    if (!dragged || !target || dragged.parent_id !== target.parent_id) {
      setError('Une catégorie peut être déplacée uniquement parmi les catégories du même niveau.')
      setDraggedCategoryId(null)
      setCategoryDropTarget(null)
      return
    }
    const siblings = data.categories
      .filter((category) => category.parent_id === target.parent_id)
      .sort((a, b) => a.position - b.position || a.title_fr.localeCompare(b.title_fr))
    const next = moveItem(siblings, dragged.id, target.id, placement, (category) => category.id)
    setDraggedCategoryId(null)
    setCategoryDropTarget(null)
    await mutate({
      action: 'reorder_categories',
      parent_id: target.parent_id,
      category_ids: next.map((category) => category.id),
    })
  }

  async function createCategory(event: React.FormEvent, parentId: string) {
    event.preventDefault()
    await mutate({
      action: 'create_category',
      title_fr: newTitle,
      parent_id: parentId,
    })
    setNewTitle('')
    setAddingParentId(null)
    setExpanded((current) => new Set(current).add(parentId))
  }

  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCategory) return
    const form = new FormData(event.currentTarget)
    await mutate({
      action: 'update_category',
      category_id: selectedCategory.id,
      title_fr: form.get('title_fr'),
      title_en: form.get('title_en'),
      representative_product_id: form.get('representative_product_id') || null,
    })
  }

  async function deleteCategory() {
    if (!selectedCategory) return
    const hasChildren = data?.categories.some((category) => category.parent_id === selectedCategory.id)
    if (hasChildren || selectedCategory.descendant_product_count > 0) return
    if (!window.confirm(`Supprimer définitivement la catégorie « ${selectedCategory.title_fr} » ?`)) return
    await mutate({ action: 'delete_category', category_id: selectedCategory.id })
    setSelected(selectedCategory.parent_id ?? ALL)
  }

  const categoryProducts = selectedCategory
    ? categoryProductCandidates(selectedCategory, data?.categories ?? [], data?.products ?? [])
    : []
  const representativeProduct = selectedCategory
    ? categoryRepresentativeProduct(selectedCategory, data?.categories ?? [], data?.products ?? [])
    : undefined

  const pageTitle =
    selected === ALL
      ? 'Tous les bijoux'
      : selected === UNCLASSIFIED
        ? 'Produits non classés'
        : (selectedCategory?.title_fr ?? 'Catalogue')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Architecture du catalogue</h1>
          <p className="text-sm text-muted-foreground">
            Une catégorie canonique par produit définit son breadcrumb. Shopify reste en lecture seule.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button isLoading={busy} onClick={() => mutate({ action: 'sync_products' })} type="button" variant="outline">
            <RefreshCw size={16} /> Actualiser les produits
          </Button>
          <Button isLoading={busy} onClick={() => mutate({ action: 'sync_shopify_collections' })} type="button">
            <RefreshCw size={16} /> Reconstruire les collections Shopify
          </Button>
        </div>
      </div>

      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {syncMessage && !error ? <Alert>{syncMessage}</Alert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Produits publiés', data?.summary.products ?? '—'],
          ['Classés', data?.summary.classified ?? '—'],
          ['Non classés', data?.summary.unclassified ?? '—'],
          ['Catégories', data?.summary.categories ?? '—'],
        ].map(([label, value]) => (
          <div className="rounded-md border bg-card p-4" key={label}>
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid min-h-[640px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Arborescence <span className="normal-case">(direct / total)</span>
          </div>
          <button
            className={`rounded px-3 py-2 text-left text-sm ${selected === ALL ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            onClick={() => setSelected(ALL)}
            type="button"
          >
            Tous les bijoux <span className="float-right opacity-70">{data?.summary.products ?? 0}</span>
          </button>
          <button
            className={`rounded px-3 py-2 text-left text-sm ${selected === UNCLASSIFIED ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            onClick={() => setSelected(UNCLASSIFIED)}
            type="button"
          >
            Non classés <span className="float-right opacity-70">{data?.summary.unclassified ?? 0}</span>
          </button>
          <div className="border-t pt-2">
            {tree.map((node) => (
              <TreeItem
                expanded={expanded}
                key={node.id}
                node={node}
                onSelect={setSelected}
                onToggle={(id) =>
                  setExpanded((current) => {
                    const next = new Set(current)
                    next.has(id) ? next.delete(id) : next.add(id)
                    return next
                  })
                }
                onCategoryDragStart={setDraggedCategoryId}
                onCategoryDragOver={(id, placement) => {
                  const dragged = data?.categories.find((category) => category.id === draggedCategoryId)
                  const target = data?.categories.find((category) => category.id === id)
                  setCategoryDropTarget({
                    id,
                    placement,
                    valid: Boolean(dragged && target && dragged.parent_id === target.parent_id),
                  })
                }}
                onCategoryDrop={(id, placement) => void reorderCategories(id, placement)}
                onCategoryDragEnd={() => {
                  setDraggedCategoryId(null)
                  setCategoryDropTarget(null)
                }}
                categoryDropTarget={categoryDropTarget}
                addingParentId={addingParentId}
                newTitle={newTitle}
                onAdd={(id) => {
                  setAddingParentId(id)
                  setNewTitle('')
                }}
                onCancelAdd={() => {
                  setAddingParentId(null)
                  setNewTitle('')
                }}
                onCreate={(event, parentId) => void createCategory(event, parentId)}
                onNewTitle={setNewTitle}
                selected={selected}
              />
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-3 rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">
                {selectedCategory ? categoryBreadcrumb(selectedCategory.id, data?.categories ?? []) : 'Catalogue Palas'}
              </div>
              <h2 className="text-xl font-semibold">
                {pageTitle} <span className="text-sm font-normal text-muted-foreground">({products.length})</span>
              </h2>
            </div>
            {selectedCategory ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={includeDescendants}
                  onChange={(event) => setIncludeDescendants(event.target.checked)}
                  type="checkbox"
                />{' '}
                Inclure les sous-catégories
              </label>
            ) : null}
          </div>
          {selectedCategory ? (
            <form
              className="grid gap-4 rounded-md border bg-muted/30 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]"
              key={`${selectedCategory.id}:${selectedCategory.title_fr}:${selectedCategory.title_en ?? ''}:${selectedCategory.representative_product_id ?? ''}`}
              onSubmit={saveCategory}
            >
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium" htmlFor="category-title-fr">
                  Nom français
                </label>
                <Input defaultValue={selectedCategory.title_fr} id="category-title-fr" name="title_fr" required />
                <label className="mt-1 text-xs font-medium" htmlFor="category-title-en">
                  Nom anglais
                </label>
                <Input defaultValue={selectedCategory.title_en ?? ''} id="category-title-en" name="title_en" />
                <div className="text-xs text-muted-foreground">Slug stable : {selectedCategory.slug}</div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium" htmlFor="representative-product">
                  Produit représentatif
                </label>
                <select
                  className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
                  defaultValue={selectedCategory.representative_product_id ?? ''}
                  id="representative-product"
                  name="representative_product_id"
                >
                  <option value="">Automatique — premier produit ordonné</option>
                  {categoryProducts.map((product) => (
                    <option key={product.shopify_product_id} value={product.shopify_product_id}>
                      {product.title}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Les produits de cette catégorie et de toutes ses sous-catégories sont disponibles.
                </p>
                <Button className="mt-auto self-start" disabled={busy} type="submit">
                  Enregistrer la catégorie
                </Button>
                <Button
                  className="self-start"
                  disabled={
                    busy ||
                    selectedCategory.descendant_product_count > 0 ||
                    Boolean(data?.categories.some((category) => category.parent_id === selectedCategory.id))
                  }
                  onClick={() => void deleteCategory()}
                  type="button"
                  variant="destructive"
                >
                  <Trash2 size={15} /> Supprimer la catégorie
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium">Aperçu actuel</span>
                {representativeProduct?.image_url ? (
                  <img
                    alt={representativeProduct.title}
                    className="aspect-square w-full rounded-md border object-cover"
                    src={representativeProduct.image_url}
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-md border bg-muted text-center text-xs text-muted-foreground">
                    Aucun produit
                  </div>
                )}
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {representativeProduct?.title ?? '—'}
                </span>
              </div>
            </form>
          ) : null}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-muted-foreground" size={16} />
            <Input
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Chercher un produit, un type ou un groupe visuel…"
              value={search}
            />
          </div>
          {selectedCategory ? (
            <p className="text-xs text-muted-foreground">
              Glissez les produits directement classés ici avec la poignée pour définir leur ordre d’affichage.
            </p>
          ) : null}

          <ul className="overflow-hidden rounded-md border">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Chargement du catalogue…</div>
            ) : products.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Aucun produit dans cette vue.</div>
            ) : (
              products.map((product) => (
                <li
                  className="relative grid grid-cols-[28px_56px_minmax(180px,1fr)_minmax(180px,280px)] items-center gap-3 border-b p-2 last:border-b-0"
                  draggable={Boolean(product.canonical_category_id)}
                  key={product.shopify_product_id}
                  onDragEnd={() => {
                    setDraggedId(null)
                    setProductDropTarget(null)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    const bounds = event.currentTarget.getBoundingClientRect()
                    setProductDropTarget({
                      id: product.shopify_product_id,
                      placement: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                      valid: Boolean(
                        draggedId &&
                          data?.products.find((candidate) => candidate.shopify_product_id === draggedId)
                            ?.canonical_category_id === product.canonical_category_id,
                      ),
                    })
                  }}
                  onDragStart={() => setDraggedId(product.shopify_product_id)}
                  onDrop={() => void reorder(product.shopify_product_id, productDropTarget?.placement ?? 'before')}
                >
                  {productDropTarget?.id === product.shopify_product_id ? (
                    <span
                      className={`pointer-events-none absolute left-0 right-0 z-10 h-0.5 rounded ${productDropTarget.valid ? 'bg-blue-500' : 'bg-red-500'} ${productDropTarget.placement === 'before' ? '-top-px' : '-bottom-px'}`}
                    />
                  ) : null}
                  <GripVertical className="cursor-grab text-muted-foreground" size={17} />
                  {product.image_url ? (
                    <img alt="" className="size-14 rounded object-cover" loading="lazy" src={product.image_url} />
                  ) : (
                    <div className="size-14 rounded bg-muted" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{product.title}</div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      <Badge variant="outline">{product.product_type || 'Type Shopify vide'}</Badge>
                      {product.visual_group ? <Badge variant="blue">{product.visual_group}</Badge> : null}
                    </div>
                    <div className="truncate pt-1 text-xs text-muted-foreground">
                      {categoryBreadcrumb(product.canonical_category_id, data?.categories ?? [])}
                    </div>
                  </div>
                  <select
                    className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
                    disabled={busy}
                    onChange={(event) =>
                      void mutate({
                        action: 'assign_product',
                        product_id: product.shopify_product_id,
                        category_id: event.target.value || null,
                      })
                    }
                    value={product.canonical_category_id ?? ''}
                  >
                    <option value="">Non classé</option>
                    {orderedCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {categoryBreadcrumb(category.id, data?.categories ?? [])}
                      </option>
                    ))}
                  </select>
                </li>
              ))
            )}
          </ul>
        </main>
      </div>
    </div>
  )
}
