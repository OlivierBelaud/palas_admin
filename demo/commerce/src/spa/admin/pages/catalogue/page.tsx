import { useDashboardContext } from '@mantajs/dashboard'
import { Alert, Badge, Button, Input } from '@mantajs/ui'
import { ChevronDown, ChevronRight, GripVertical, Plus, RefreshCw, Search } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildCategoryTree,
  type CatalogCategory,
  type CatalogProduct,
  type CategoryNode,
  categoryBreadcrumb,
  categoryProductCandidates,
  categoryRepresentativeProduct,
  descendantIds,
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

function TreeItem({
  node,
  selected,
  expanded,
  onSelect,
  onToggle,
  depth = 0,
}: {
  node: CategoryNode
  selected: string
  expanded: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  depth?: number
}) {
  const isOpen = expanded.has(node.id)
  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm ${selected === node.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
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
      </div>
      {isOpen
        ? node.children.map((child) => (
            <TreeItem
              depth={depth + 1}
              expanded={expanded}
              key={child.id}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
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
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newSlug, setNewSlug] = useState('')

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
        const body = (await dataSource.mutate(ENDPOINT, 'POST', input)) as { data?: CatalogueData }
        if (body.data) setData(body.data)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Action catalogue impossible')
      } finally {
        setBusy(false)
      }
    },
    [dataSource],
  )

  const tree = useMemo(() => buildCategoryTree(data?.categories ?? []), [data?.categories])
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

  async function reorder(targetId: string) {
    if (!data || !draggedId || draggedId === targetId || !selectedCategory || includeDescendants) return
    const direct = products.filter((product) => product.canonical_category_id === selectedCategory.id)
    const from = direct.findIndex((product) => product.shopify_product_id === draggedId)
    const to = direct.findIndex((product) => product.shopify_product_id === targetId)
    if (from < 0 || to < 0) return
    const next = [...direct]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setDraggedId(null)
    await mutate({
      action: 'reorder_products',
      category_id: selectedCategory.id,
      product_ids: next.map((product) => product.shopify_product_id),
    })
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault()
    await mutate({
      action: 'create_category',
      title_fr: newTitle,
      slug: newSlug,
      parent_id: selectedCategory?.id ?? null,
    })
    setNewTitle('')
    setNewSlug('')
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
        <Button isLoading={busy} onClick={() => mutate({ action: 'sync_products' })} type="button">
          <RefreshCw size={16} /> Synchroniser les produits
        </Button>
      </div>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

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
                selected={selected}
              />
            ))}
          </div>
          <form className="mt-auto flex flex-col gap-2 border-t pt-3" onSubmit={createCategory}>
            <div className="text-xs text-muted-foreground">
              Nouvelle sous-catégorie de « {selectedCategory?.title_fr ?? 'racine'} »
            </div>
            <Input
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Nom français"
              required
              value={newTitle}
            />
            <Input
              onChange={(event) => setNewSlug(event.target.value)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="slug-technique"
              required
              value={newSlug}
            />
            <Button disabled={busy} type="submit">
              <Plus size={15} /> Ajouter
            </Button>
          </form>
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
          {selectedCategory && !includeDescendants ? (
            <p className="text-xs text-muted-foreground">
              Glissez les lignes avec la poignée pour définir leur ordre d’affichage dans cette catégorie.
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
                  className="grid grid-cols-[28px_56px_minmax(180px,1fr)_minmax(180px,280px)] items-center gap-3 border-b p-2 last:border-b-0"
                  draggable={Boolean(
                    selectedCategory && !includeDescendants && product.canonical_category_id === selectedCategory.id,
                  )}
                  key={product.shopify_product_id}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => setDraggedId(product.shopify_product_id)}
                  onDrop={() => void reorder(product.shopify_product_id)}
                >
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
                    {(data?.categories ?? []).map((category) => (
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
