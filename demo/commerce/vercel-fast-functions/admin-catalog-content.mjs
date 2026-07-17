import { db, json, requireAdmin, unauthorized } from './runtime.mjs'

class CatalogContentError extends Error {}

const SHOPIFY_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-10'
const SHOPIFY_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN || 'fancy-palas.myshopify.com'

async function ensureSchema(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS catalog_homepage_tiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shopify_collection_id text NOT NULL,
      label_fr text,
      label_en text,
      image_source text NOT NULL DEFAULT 'collection'
        CHECK (image_source IN ('collection', 'product')),
      shopify_product_id text,
      image_url text,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS catalog_menu_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id uuid REFERENCES catalog_menu_items(id) ON DELETE RESTRICT,
      shopify_collection_id text,
      label_fr text NOT NULL,
      label_en text,
      url text,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
}

async function shopify(query, variables = {}) {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  if (!token) throw new CatalogContentError('SHOPIFY_ADMIN_ACCESS_TOKEN absent')
  const response = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json()
  if (!response.ok || body.errors?.length) {
    throw new CatalogContentError(body.errors?.map((error) => error.message).join(', ') || `Shopify HTTP ${response.status}`)
  }
  return body.data
}

async function readCollections() {
  const collections = []
  let after = null
  do {
    const data = await shopify(
      `query CatalogContentCollections($after: String) {
        collections(first: 100, after: $after, sortKey: TITLE) {
          nodes {
            id handle title
            image { url altText width height }
            products(first: 50, sortKey: MANUAL) {
              nodes { id handle title featuredImage { url altText width height } }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    )
    collections.push(...data.collections.nodes)
    after = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null
  } while (after)
  return collections
}

async function readContent(sql) {
  const [tiles, menuItems, collections] = await Promise.all([
    sql`SELECT * FROM catalog_homepage_tiles ORDER BY position, created_at`,
    sql`SELECT * FROM catalog_menu_items ORDER BY parent_id NULLS FIRST, position, created_at`,
    readCollections(),
  ])
  return {
    collections,
    homepage: tiles.map((tile) => ({ ...tile, position: Number(tile.position) })),
    menu: menuItems.map((item) => ({ ...item, position: Number(item.position) })),
  }
}

async function nextPosition(sql, table, parentId = null) {
  if (table === 'homepage') {
    const [row] = await sql`SELECT coalesce(max(position), -1) + 1 AS value FROM catalog_homepage_tiles`
    return Number(row.value)
  }
  const [row] = await sql`
    SELECT coalesce(max(position), -1) + 1 AS value
    FROM catalog_menu_items WHERE parent_id IS NOT DISTINCT FROM ${parentId}
  `
  return Number(row.value)
}

async function mutate(sql, input) {
  if (input.action === 'save_homepage_tile') {
    const collectionId = String(input.shopify_collection_id || '')
    if (!collectionId) throw new CatalogContentError('Collection requise')
    const id = input.id || null
    const position = id ? Number(input.position || 0) : await nextPosition(sql, 'homepage')
    if (id) {
      await sql`
        UPDATE catalog_homepage_tiles SET
          shopify_collection_id = ${collectionId},
          label_fr = ${input.label_fr || null},
          label_en = ${input.label_en || null},
          image_source = ${input.image_source === 'product' ? 'product' : 'collection'},
          shopify_product_id = ${input.shopify_product_id || null},
          image_url = ${input.image_url || null},
          position = ${position},
          updated_at = now()
        WHERE id = ${id}
      `
      return { id }
    }
    const [created] = await sql`
      INSERT INTO catalog_homepage_tiles (
        shopify_collection_id, label_fr, label_en, image_source,
        shopify_product_id, image_url, position
      ) VALUES (
        ${collectionId}, ${input.label_fr || null}, ${input.label_en || null},
        ${input.image_source === 'product' ? 'product' : 'collection'},
        ${input.shopify_product_id || null}, ${input.image_url || null}, ${position}
      ) RETURNING id
    `
    return { id: created.id }
  }

  if (input.action === 'delete_homepage_tile') {
    await sql`DELETE FROM catalog_homepage_tiles WHERE id = ${input.id}`
    return { id: input.id }
  }

  if (input.action === 'reorder_homepage') {
    const ids = Array.isArray(input.ids) ? input.ids : []
    await sql.begin(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx`UPDATE catalog_homepage_tiles SET position = ${position}, updated_at = now() WHERE id = ${id}`
      }
    })
    return { reordered: ids.length }
  }

  if (input.action === 'save_menu_item') {
    const labelFr = String(input.label_fr || '').trim()
    if (!labelFr) throw new CatalogContentError('Libellé français requis')
    const id = input.id || null
    const parentId = input.parent_id || null
    const position = id ? Number(input.position || 0) : await nextPosition(sql, 'menu', parentId)
    if (id) {
      await sql`
        UPDATE catalog_menu_items SET
          parent_id = ${parentId},
          shopify_collection_id = ${input.shopify_collection_id || null},
          label_fr = ${labelFr},
          label_en = ${input.label_en || null},
          url = ${input.url || null},
          position = ${position},
          updated_at = now()
        WHERE id = ${id}
      `
      return { id }
    }
    const [created] = await sql`
      INSERT INTO catalog_menu_items (
        parent_id, shopify_collection_id, label_fr, label_en, url, position
      ) VALUES (
        ${parentId}, ${input.shopify_collection_id || null}, ${labelFr},
        ${input.label_en || null}, ${input.url || null}, ${position}
      ) RETURNING id
    `
    return { id: created.id }
  }

  if (input.action === 'delete_menu_item') {
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM catalog_menu_items WHERE parent_id = ${input.id}`
    if (Number(count) > 0) throw new CatalogContentError('Supprimez d’abord les sous-entrées')
    await sql`DELETE FROM catalog_menu_items WHERE id = ${input.id}`
    return { id: input.id }
  }

  throw new CatalogContentError('Action inconnue')
}

export default {
  async fetch(req) {
    if (!requireAdmin(req)) return unauthorized()
    const sql = db()
    try {
      await ensureSchema(sql)
      if (req.method === 'GET') return json({ data: await readContent(sql) })
      if (req.method !== 'POST') return json({ message: 'Method not allowed' }, { status: 405 })
      const result = await mutate(sql, await req.json())
      return json({ data: { result, ...(await readContent(sql)) } })
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : 'Catalog content action failed' }, { status: 400 })
    }
  },
}
