export type CatalogCategory = {
  id: string
  slug: string
  title_fr: string
  title_en: string | null
  representative_product_id: string | null
  parent_id: string | null
  position: number
  status: 'draft' | 'active' | 'archived'
  direct_product_count: number
  descendant_product_count: number
}

export type CatalogProduct = {
  shopify_product_id: string
  handle: string
  title: string
  product_type: string | null
  image_url: string | null
  canonical_category_id: string | null
  category_position: number
  visual_group: string | null
  visual_subtype: string | null
}

export type CategoryNode = CatalogCategory & { children: CategoryNode[] }

export function buildCategoryTree(categories: CatalogCategory[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(
    categories.map((category) => [category.id, { ...category, children: [] as CategoryNode[] }]),
  )
  const roots: CategoryNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (items: CategoryNode[]) => {
    items.sort((a, b) => a.position - b.position || a.title_fr.localeCompare(b.title_fr))
    for (const item of items) sort(item.children)
  }
  sort(roots)
  return roots
}

export function categoryBreadcrumb(categoryId: string | null, categories: CatalogCategory[]) {
  if (!categoryId) return 'Non classé'
  const byId = new Map(categories.map((category) => [category.id, category]))
  const labels: string[] = []
  const visited = new Set<string>()
  let current = byId.get(categoryId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    labels.unshift(current.title_fr)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return labels.join(' › ')
}

export function descendantIds(categoryId: string, categories: CatalogCategory[]) {
  const result = new Set([categoryId])
  let changed = true
  while (changed) {
    changed = false
    for (const category of categories) {
      if (category.parent_id && result.has(category.parent_id) && !result.has(category.id)) {
        result.add(category.id)
        changed = true
      }
    }
  }
  return result
}

export function categoryRepresentativeProduct(
  category: CatalogCategory,
  categories: CatalogCategory[],
  products: CatalogProduct[],
) {
  const candidates = categoryProductCandidates(category, categories, products)
  return (
    candidates.find((product) => product.shopify_product_id === category.representative_product_id) ?? candidates[0]
  )
}

export function categoryProductCandidates(
  category: CatalogCategory,
  categories: CatalogCategory[],
  products: CatalogProduct[],
) {
  const byParent = new Map<string, CatalogCategory[]>()
  for (const child of categories) {
    if (!child.parent_id) continue
    const siblings = byParent.get(child.parent_id) ?? []
    siblings.push(child)
    byParent.set(child.parent_id, siblings)
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.position - b.position || a.title_fr.localeCompare(b.title_fr))
  }
  const categoryOrder: string[] = []
  const visit = (categoryId: string) => {
    categoryOrder.push(categoryId)
    for (const child of byParent.get(categoryId) ?? []) visit(child.id)
  }
  visit(category.id)
  const rank = new Map(categoryOrder.map((id, index) => [id, index]))
  return products
    .filter((product) => product.canonical_category_id && rank.has(product.canonical_category_id))
    .sort((a, b) => {
      const categoryRank =
        (rank.get(a.canonical_category_id ?? '') ?? 0) - (rank.get(b.canonical_category_id ?? '') ?? 0)
      return categoryRank || a.category_position - b.category_position || a.title.localeCompare(b.title)
    })
}
