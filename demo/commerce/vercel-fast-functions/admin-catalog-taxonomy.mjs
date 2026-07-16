import { readFile } from 'node:fs/promises'
import {
  catalogShopifyConstants,
  catalogSyncKeys,
  deleteCatalogMirror,
  syncCatalogToShopify,
} from './catalog-shopify-sync.mjs'
import { db, iso, json, requireAdmin, unauthorized } from './runtime.mjs'

const SHOPIFY_PRODUCTS_URL = 'https://fancy-palas.myshopify.com/products.json'
class CatalogTaxonomyError extends Error {}

async function readClassificationSeed() {
  const url = new URL('./catalog-classification-seed.json', import.meta.url)
  return JSON.parse(await readFile(url, 'utf8'))
}

function serializeCategory(row) {
  return {
    id: row.id,
    slug: row.slug,
    title_fr: row.title_fr,
    title_en: row.title_en,
    representative_product_id: row.representative_product_id,
    parent_id: row.parent_id,
    position: Number(row.position),
    status: row.status,
    direct_product_count: Number(row.direct_product_count),
    descendant_product_count: Number(row.descendant_product_count),
  }
}

async function readCatalogue(sql) {
  const categories = await sql.unsafe(`
    WITH RECURSIVE descendants AS (
      SELECT id AS ancestor_id, id AS descendant_id FROM catalog_categories WHERE deleted_at IS NULL
      UNION ALL
      SELECT d.ancestor_id, c.id
      FROM descendants d
      JOIN catalog_categories c ON c.parent_id = d.descendant_id AND c.deleted_at IS NULL
    ), direct_counts AS (
      SELECT canonical_category_id AS category_id, count(*)::int AS count
      FROM catalog_products WHERE online_store_published = true AND canonical_category_id IS NOT NULL
      GROUP BY canonical_category_id
    ), descendant_counts AS (
      SELECT d.ancestor_id AS category_id, count(p.shopify_product_id)::int AS count
      FROM descendants d
      LEFT JOIN catalog_products p ON p.canonical_category_id = d.descendant_id AND p.online_store_published = true
      GROUP BY d.ancestor_id
    )
    SELECT c.id, c.slug, c.title_fr, c.title_en, c.representative_product_id,
           c.parent_id, c.position, c.status,
           coalesce(dc.count, 0) AS direct_product_count,
           coalesce(tc.count, 0) AS descendant_product_count
    FROM catalog_categories c
    LEFT JOIN direct_counts dc ON dc.category_id = c.id
    LEFT JOIN descendant_counts tc ON tc.category_id = c.id
    WHERE c.deleted_at IS NULL
    ORDER BY c.parent_id NULLS FIRST, c.position, c.title_fr
  `)
  const products = await sql.unsafe(`
    SELECT shopify_product_id, handle, title, product_type, image_url, online_store_published,
           canonical_category_id, category_position, visual_group, visual_subtype, shopify_updated_at
    FROM catalog_products
    WHERE online_store_published = true
    ORDER BY canonical_category_id NULLS FIRST, category_position, title
  `)
  const classified = products.filter((product) => product.canonical_category_id).length
  return {
    categories: categories.map(serializeCategory),
    products: products.map((product) => ({
      ...product,
      category_position: Number(product.category_position),
      shopify_updated_at: product.shopify_updated_at ? iso(product.shopify_updated_at) : null,
    })),
    summary: {
      products: products.length,
      classified,
      unclassified: products.length - classified,
      categories: categories.length,
    },
  }
}

async function syncShopifyProducts(sql) {
  const products = []
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${SHOPIFY_PRODUCTS_URL}?limit=250&page=${page}`)
    if (!response.ok) throw new CatalogTaxonomyError(`Shopify products request failed (${response.status})`)
    const batch = (await response.json()).products ?? []
    products.push(...batch)
    if (batch.length < 250) break
  }

  await sql.begin(async (tx) => {
    await tx`UPDATE catalog_products SET online_store_published = false, updated_at = now()`
    for (const product of products) {
      const imageUrl = product.images?.[0]?.src ?? product.image?.src ?? null
      await tx`
        INSERT INTO catalog_products (
          shopify_product_id, handle, title, product_type, image_url, online_store_published,
          shopify_updated_at, updated_at
        ) VALUES (
          ${String(product.id)}, ${product.handle}, ${product.title}, ${product.product_type || null},
          ${imageUrl}, true, ${product.updated_at || null}, now()
        )
        ON CONFLICT (shopify_product_id) DO UPDATE SET
          handle = EXCLUDED.handle,
          title = EXCLUDED.title,
          product_type = EXCLUDED.product_type,
          image_url = EXCLUDED.image_url,
          online_store_published = true,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          updated_at = now()
      `
    }

    const classifications = await readClassificationSeed()
    for (const classification of classifications) {
      await tx`
        UPDATE catalog_products product
        SET canonical_category_id = category.id,
            category_position = ${classification.category_position},
            visual_group = ${classification.visual_group},
            visual_subtype = ${classification.visual_subtype},
            updated_at = now()
        FROM catalog_categories category
        WHERE product.shopify_product_id = ${classification.shopify_product_id}
          AND category.slug = ${classification.category_slug}
          AND product.canonical_category_id IS NULL
      `
    }
    await tx`
      WITH RECURSIVE descendants AS (
        SELECT id AS ancestor_id, id AS descendant_id FROM catalog_categories WHERE deleted_at IS NULL
        UNION ALL
        SELECT descendants.ancestor_id, child.id
        FROM descendants
        JOIN catalog_categories child ON child.parent_id = descendants.descendant_id AND child.deleted_at IS NULL
      )
      UPDATE catalog_categories category
      SET representative_product_id = NULL, updated_at = now()
      WHERE representative_product_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM catalog_products product
          JOIN descendants ON descendants.descendant_id = product.canonical_category_id
          WHERE descendants.ancestor_id = category.id
            AND product.shopify_product_id = category.representative_product_id
            AND product.online_store_published = true
        )
    `
  })
  return products.length
}

async function mutate(sql, input) {
  if (input.action === 'sync_products') return { synced: await syncShopifyProducts(sql) }
  if (input.action === 'sync_shopify_collections') return { requested: 'all' }

  if (input.action === 'create_category') {
    const title = String(input.title_fr ?? '').trim()
    if (!title) throw new CatalogTaxonomyError('Nom français requis')
    const requestedSlug = String(input.slug ?? '')
      .trim()
      .toLowerCase()
    const baseSlug = (requestedSlug || title.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (!baseSlug) throw new CatalogTaxonomyError('Impossible de générer le slug de cette catégorie')
    let slug = baseSlug
    for (let suffix = 2; ; suffix += 1) {
      const [existing] = await sql`SELECT id FROM catalog_categories WHERE slug = ${slug}`
      if (!existing) break
      slug = `${baseSlug}-${suffix}`
    }
    const parentId = input.parent_id || null
    const [position] = await sql`
      SELECT coalesce(max(position), -1) + 1 AS value
      FROM catalog_categories WHERE parent_id IS NOT DISTINCT FROM ${parentId} AND deleted_at IS NULL
    `
    const [created] = await sql`
      INSERT INTO catalog_categories (slug, title_fr, title_en, parent_id, position, status)
      VALUES (${slug}, ${title}, ${input.title_en || null}, ${parentId}, ${Number(position.value)}, 'active')
      RETURNING id
    `
    return { id: created.id, parent_id: parentId }
  }

  if (input.action === 'update_category') {
    const categoryId = String(input.category_id ?? '')
    const titleFr = String(input.title_fr ?? '').trim()
    const titleEn = String(input.title_en ?? '').trim() || null
    const representativeProductId = input.representative_product_id ? String(input.representative_product_id) : null
    if (!categoryId || !titleFr) throw new CatalogTaxonomyError('Catégorie et nom français requis')
    if (representativeProductId) {
      const [representative] = await sql`
        WITH RECURSIVE descendants AS (
          SELECT id FROM catalog_categories WHERE id = ${categoryId} AND deleted_at IS NULL
          UNION ALL
          SELECT child.id FROM catalog_categories child
          JOIN descendants parent ON child.parent_id = parent.id
          WHERE child.deleted_at IS NULL
        )
        SELECT product.shopify_product_id FROM catalog_products product
        JOIN descendants ON descendants.id = product.canonical_category_id
        WHERE product.shopify_product_id = ${representativeProductId}
          AND product.online_store_published = true
      `
      if (!representative) {
        throw new CatalogTaxonomyError(
          'Le produit représentatif doit appartenir à cette catégorie ou à une sous-catégorie',
        )
      }
    }
    const [updated] = await sql`
      UPDATE catalog_categories
      SET title_fr = ${titleFr}, title_en = ${titleEn},
          representative_product_id = ${representativeProductId}, updated_at = now()
      WHERE id = ${categoryId} AND deleted_at IS NULL
      RETURNING id
    `
    if (!updated) throw new CatalogTaxonomyError('Catégorie introuvable')
    return { id: updated.id }
  }

  if (input.action === 'delete_category') {
    const categoryId = String(input.category_id ?? '')
    const [category] = await sql`
      SELECT parent_id FROM catalog_categories WHERE id = ${categoryId} AND deleted_at IS NULL
    `
    if (!category) throw new CatalogTaxonomyError('Catégorie introuvable')
    const [usage] = await sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM catalog_categories WHERE id = ${categoryId} AND deleted_at IS NULL
        UNION ALL
        SELECT child.id FROM catalog_categories child
        JOIN descendants parent ON child.parent_id = parent.id
        WHERE child.deleted_at IS NULL
      )
      SELECT
        (SELECT count(*)::int FROM catalog_categories WHERE parent_id = ${categoryId} AND deleted_at IS NULL) AS children,
        (SELECT count(*)::int FROM catalog_products product
          JOIN descendants ON descendants.id = product.canonical_category_id
          WHERE product.online_store_published = true) AS products
    `
    if (!usage) throw new CatalogTaxonomyError('Catégorie introuvable')
    if (Number(usage.children) > 0) throw new CatalogTaxonomyError('Supprimez d’abord les sous-catégories')
    if (Number(usage.products) > 0) throw new CatalogTaxonomyError('La catégorie doit être vide avant sa suppression')
    const [deleted] = await sql`
      UPDATE catalog_categories SET deleted_at = now(), updated_at = now()
      WHERE id = ${categoryId} AND deleted_at IS NULL
      RETURNING id
    `
    if (!deleted) throw new CatalogTaxonomyError('Catégorie introuvable')
    return { id: deleted.id, parent_id: category.parent_id }
  }

  if (input.action === 'reorder_categories') {
    const parentId = input.parent_id || null
    const categoryIds = Array.isArray(input.category_ids) ? input.category_ids.map(String) : []
    if (categoryIds.length === 0) throw new CatalogTaxonomyError('Catégories requises')
    const siblings = await sql`
      SELECT id::text FROM catalog_categories
      WHERE parent_id IS NOT DISTINCT FROM ${parentId} AND deleted_at IS NULL
      ORDER BY position, title_fr
    `
    const siblingIds = siblings.map((category) => category.id)
    if (siblingIds.length !== categoryIds.length || siblingIds.some((id) => !categoryIds.includes(id))) {
      throw new CatalogTaxonomyError('Le tri doit contenir toutes les catégories du même niveau')
    }
    await sql.begin(async (tx) => {
      for (const [position, categoryId] of categoryIds.entries()) {
        await tx`
          UPDATE catalog_categories SET position = ${position}, updated_at = now()
          WHERE id = ${categoryId} AND parent_id IS NOT DISTINCT FROM ${parentId}
        `
      }
    })
    return { reordered: categoryIds.length, parent_id: parentId, category_ids: categoryIds }
  }

  if (input.action === 'assign_product') {
    const productId = String(input.product_id ?? '')
    const categoryId = input.category_id || null
    const [existing] = await sql`
      SELECT canonical_category_id FROM catalog_products WHERE shopify_product_id = ${productId}
    `
    if (!existing) throw new CatalogTaxonomyError('Produit introuvable')
    let position = 0
    if (categoryId) {
      const [row] = await sql`
        SELECT coalesce(max(category_position), -1) + 1 AS value
        FROM catalog_products WHERE canonical_category_id = ${categoryId}
      `
      position = Number(row.value)
    }
    await sql`
      UPDATE catalog_products SET canonical_category_id = ${categoryId}, category_position = ${position}, updated_at = now()
      WHERE shopify_product_id = ${productId}
    `
    await sql`
      WITH RECURSIVE descendants AS (
        SELECT id AS ancestor_id, id AS descendant_id FROM catalog_categories WHERE deleted_at IS NULL
        UNION ALL
        SELECT descendants.ancestor_id, child.id
        FROM descendants
        JOIN catalog_categories child ON child.parent_id = descendants.descendant_id AND child.deleted_at IS NULL
      )
      UPDATE catalog_categories
      SET representative_product_id = NULL, updated_at = now()
      WHERE representative_product_id = ${productId}
        AND NOT EXISTS (
          SELECT 1 FROM descendants
          WHERE descendants.ancestor_id = catalog_categories.id
            AND descendants.descendant_id = ${categoryId}
        )
    `
    return {
      product_id: productId,
      old_category_id: existing.canonical_category_id,
      category_id: categoryId,
    }
  }

  if (input.action === 'reorder_products') {
    const categoryId = String(input.category_id ?? '')
    const productIds = Array.isArray(input.product_ids) ? input.product_ids.map(String) : []
    if (!categoryId || productIds.length === 0) throw new CatalogTaxonomyError('Catégorie et produits requis')
    await sql.begin(async (tx) => {
      for (const [position, productId] of productIds.entries()) {
        await tx`
          UPDATE catalog_products SET category_position = ${position}, updated_at = now()
          WHERE shopify_product_id = ${productId} AND canonical_category_id = ${categoryId}
        `
      }
    })
    return { reordered: productIds.length, category_id: categoryId }
  }

  throw new CatalogTaxonomyError('Action inconnue')
}

async function syncAfterMutation(sql, input, result) {
  if (input.action === 'sync_shopify_collections') return syncCatalogToShopify(sql)
  if (input.action === 'sync_products') {
    return syncCatalogToShopify(sql, new Set([catalogShopifyConstants.UNCLASSIFIED_KEY]))
  }
  if (input.action === 'delete_category') {
    await deleteCatalogMirror(sql, result.id)
    if (!result.parent_id) return []
    const keys = await catalogSyncKeys(sql, [result.parent_id])
    return syncCatalogToShopify(sql, keys)
  }
  if (input.action === 'assign_product') {
    const keys = await catalogSyncKeys(sql, [result.old_category_id, result.category_id], {
      unclassified: true,
    })
    return syncCatalogToShopify(sql, keys)
  }
  if (input.action === 'update_category') {
    const keys = await catalogSyncKeys(sql, [result.id], { includeDescendants: true })
    return syncCatalogToShopify(sql, keys)
  }
  if (input.action === 'create_category') {
    const keys = await catalogSyncKeys(sql, [result.id])
    return syncCatalogToShopify(sql, keys)
  }
  if (input.action === 'reorder_products') {
    const keys = await catalogSyncKeys(sql, [result.category_id])
    return syncCatalogToShopify(sql, keys)
  }
  if (input.action === 'reorder_categories') {
    const keys = await catalogSyncKeys(sql, result.category_ids)
    return syncCatalogToShopify(sql, keys)
  }
  return []
}

export default {
  async fetch(req) {
    if (!requireAdmin(req)) return unauthorized()
    const sql = db()
    try {
      if (req.method === 'GET') return json({ data: await readCatalogue(sql) })
      if (req.method !== 'POST') return json({ message: 'Method not allowed' }, { status: 405 })
      const input = await req.json()
      const result = await mutate(sql, input)
      let shopifySync
      try {
        const collections = await syncAfterMutation(sql, input, result)
        shopifySync = { ok: true, collections: collections.length }
      } catch (error) {
        shopifySync = {
          ok: false,
          error: error instanceof Error ? error.message : 'Shopify collection sync failed',
        }
      }
      return json({ data: { result, shopify_sync: shopifySync, ...(await readCatalogue(sql)) } })
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : 'Catalogue action failed' }, { status: 400 })
    }
  },
}
