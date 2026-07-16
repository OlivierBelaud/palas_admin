const COLLECTION_HANDLE_PREFIX = 'palas-cat-'
const COLLECTION_TITLE_PREFIX = '[PALAS CAT]'
const UNCLASSIFIED_KEY = 'unclassified'
const SHOPIFY_API_VERSION = '2025-10'
const DEFAULT_STOREFRONT_PUBLICATION_ID = 'gid://shopify/Publication/253433971035'
const CATALOG_METAFIELD_DEFINITIONS = [
  ['managed', 'Palas catalog managed', 'boolean'],
  ['sync_key', 'Palas catalog sync key', 'single_line_text_field'],
  ['label_fr', 'Palas catalog French label', 'single_line_text_field'],
  ['label_en', 'Palas catalog English label', 'single_line_text_field'],
  ['parent_handle', 'Palas catalog parent handle', 'single_line_text_field'],
  ['position', 'Palas catalog position', 'number_integer'],
  ['canonical_path', 'Palas catalog canonical path', 'json'],
  ['translation_status', 'Palas catalog translation status', 'single_line_text_field'],
]

class CatalogShopifySyncError extends Error {}

function productGid(id) {
  return `gid://shopify/Product/${id}`
}

function chunks(items, size = 250) {
  const result = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function shopifyConfig() {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  if (!token) throw new CatalogShopifySyncError('SHOPIFY_ADMIN_ACCESS_TOKEN is not configured')
  return {
    endpoint: `https://${process.env.SHOPIFY_SHOP_DOMAIN ?? 'fancy-palas.myshopify.com'}/admin/api/${process.env.SHOPIFY_ADMIN_API_VERSION ?? SHOPIFY_API_VERSION}/graphql.json`,
    token,
    publicationId: process.env.SHOPIFY_CATALOG_PUBLICATION_ID ?? DEFAULT_STOREFRONT_PUBLICATION_ID,
  }
}

async function shopifyGraphql(query, variables = {}) {
  const { endpoint, token } = shopifyConfig()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new CatalogShopifySyncError(`Shopify HTTP ${response.status}`)
  if (body?.errors?.length) throw new CatalogShopifySyncError(body.errors.map((error) => error.message).join(' | '))
  if (!body?.data) throw new CatalogShopifySyncError('Shopify returned no data')
  return body.data
}

function assertNoUserErrors(payload, operation) {
  if (payload?.userErrors?.length) {
    throw new CatalogShopifySyncError(`${operation}: ${payload.userErrors.map((error) => error.message).join(' | ')}`)
  }
}

async function publishCollection(collectionId) {
  const { publicationId } = shopifyConfig()
  const data = await shopifyGraphql(
    `mutation CatalogCollectionPublish($id: ID!, $publicationId: ID!) {
      publishablePublish(id: $id, input: { publicationId: $publicationId }) {
        publishable { publishedOnPublication(publicationId: $publicationId) }
        userErrors { field message }
      }
    }`,
    { id: collectionId, publicationId },
  )
  assertNoUserErrors(data.publishablePublish, 'publishablePublish')
  if (!data.publishablePublish.publishable?.publishedOnPublication) {
    throw new CatalogShopifySyncError(`Collection was not published on ${publicationId}`)
  }
}

async function ensureCatalogMetafieldDefinitions() {
  const data = await shopifyGraphql(
    `query CatalogMetafieldDefinitions {
      metafieldDefinitions(first: 100, ownerType: COLLECTION, namespace: "palas_catalog") {
        nodes { key }
      }
    }`,
  )
  const existing = new Set(data.metafieldDefinitions.nodes.map((definition) => definition.key))
  for (const [key, name, type] of CATALOG_METAFIELD_DEFINITIONS) {
    if (existing.has(key)) continue
    const created = await shopifyGraphql(
      `mutation CatalogMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id key }
          userErrors { field message }
        }
      }`,
      {
        definition: {
          name,
          namespace: 'palas_catalog',
          key,
          type,
          ownerType: 'COLLECTION',
          access: { storefront: 'PUBLIC_READ' },
        },
      },
    )
    assertNoUserErrors(created.metafieldDefinitionCreate, 'metafieldDefinitionCreate')
  }
}

function collectionMetafields(spec) {
  return [
    { namespace: 'palas_catalog', key: 'managed', type: 'boolean', value: 'true' },
    { namespace: 'palas_catalog', key: 'sync_key', type: 'single_line_text_field', value: spec.syncKey },
    { namespace: 'palas_catalog', key: 'label_fr', type: 'single_line_text_field', value: spec.labelFr },
    { namespace: 'palas_catalog', key: 'label_en', type: 'single_line_text_field', value: spec.labelEn },
    ...(spec.parentHandle
      ? [
          {
            namespace: 'palas_catalog',
            key: 'parent_handle',
            type: 'single_line_text_field',
            value: spec.parentHandle,
          },
        ]
      : []),
    { namespace: 'palas_catalog', key: 'position', type: 'number_integer', value: String(spec.position) },
    {
      namespace: 'palas_catalog',
      key: 'canonical_path',
      type: 'json',
      value: JSON.stringify(spec.canonicalPath),
    },
    {
      namespace: 'palas_catalog',
      key: 'translation_status',
      type: 'single_line_text_field',
      value: spec.translationStatus,
    },
  ]
}

async function findCollection(handle, knownId) {
  const data = knownId
    ? await shopifyGraphql(`query CatalogCollection($id: ID!) { collection(id: $id) { id handle title } }`, {
        id: knownId,
      })
    : await shopifyGraphql(
        `query CatalogCollection($query: String!) {
          collections(first: 2, query: $query) { nodes { id handle title } }
        }`,
        { query: `handle:${handle}` },
      )
  const collection = knownId ? data.collection : data.collections.nodes.find((node) => node.handle === handle)
  if (collection && !collection.handle.startsWith(COLLECTION_HANDLE_PREFIX)) {
    throw new CatalogShopifySyncError(`Refusing to touch non-Palas collection ${collection.handle}`)
  }
  return collection ?? null
}

async function createCollection(spec) {
  const input = {
    handle: spec.handle,
    title: spec.title,
    descriptionHtml:
      '<p>Collection gérée automatiquement par le CRM Palas. Ne pas modifier ses produits manuellement.</p>',
    sortOrder: 'MANUAL',
    metafields: collectionMetafields(spec),
    image: spec.imageUrl ? { src: spec.imageUrl, altText: spec.title } : null,
  }
  const data = await shopifyGraphql(
    `mutation CatalogCollectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) { collection { id handle title } userErrors { field message } }
    }`,
    { input },
  )
  assertNoUserErrors(data.collectionCreate, 'collectionCreate')
  if (!data.collectionCreate.collection) throw new CatalogShopifySyncError('Shopify did not create the collection')
  return data.collectionCreate.collection
}

async function updateCollection(collectionId, spec) {
  const input = {
    id: collectionId,
    title: spec.title,
    descriptionHtml:
      '<p>Collection gérée automatiquement par le CRM Palas. Ne pas modifier ses produits manuellement.</p>',
    sortOrder: 'MANUAL',
    metafields: collectionMetafields(spec),
    ...(spec.imageUrl ? { image: { src: spec.imageUrl, altText: spec.title } } : {}),
  }
  const data = await shopifyGraphql(
    `mutation CatalogCollectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) { collection { id handle title } userErrors { field message } }
    }`,
    { input },
  )
  assertNoUserErrors(data.collectionUpdate, 'collectionUpdate')
}

async function readCollectionProductIds(collectionId) {
  const ids = []
  let cursor = null
  do {
    const data = await shopifyGraphql(
      `query CatalogCollectionProducts($id: ID!, $cursor: String) {
        collection(id: $id) {
          products(first: 250, after: $cursor) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: collectionId, cursor },
    )
    if (!data.collection) throw new CatalogShopifySyncError('Mirrored Shopify collection no longer exists')
    ids.push(...data.collection.products.nodes.map((product) => product.id))
    cursor = data.collection.products.pageInfo.hasNextPage ? data.collection.products.pageInfo.endCursor : null
  } while (cursor)
  return ids
}

async function addProducts(collectionId, productIds) {
  for (const batch of chunks(productIds)) {
    const data = await shopifyGraphql(
      `mutation CatalogCollectionAdd($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) { userErrors { field message } }
      }`,
      { id: collectionId, productIds: batch },
    )
    assertNoUserErrors(data.collectionAddProducts, 'collectionAddProducts')
  }
}

async function removeProducts(collectionId, productIds) {
  for (const batch of chunks(productIds)) {
    const data = await shopifyGraphql(
      `mutation CatalogCollectionRemove($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) { userErrors { field message } }
      }`,
      { id: collectionId, productIds: batch },
    )
    assertNoUserErrors(data.collectionRemoveProducts, 'collectionRemoveProducts')
  }
}

async function reorderProducts(collectionId, desiredIds) {
  for (const batch of chunks(desiredIds.map((id, index) => ({ id, newPosition: String(index) })))) {
    const data = await shopifyGraphql(
      `mutation CatalogCollectionReorder($id: ID!, $moves: [MoveInput!]!) {
        collectionReorderProducts(id: $id, moves: $moves) { job { id done } userErrors { field message } }
      }`,
      { id: collectionId, moves: batch },
    )
    assertNoUserErrors(data.collectionReorderProducts, 'collectionReorderProducts')
    const job = data.collectionReorderProducts.job
    if (job && !job.done) await waitForJob(job.id)
  }
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const data = await shopifyGraphql(`query CatalogSyncJob($id: ID!) { job(id: $id) { done } }`, {
      id: jobId,
    })
    if (data.job?.done) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new CatalogShopifySyncError('Shopify product reorder timed out')
}

async function upsertMirror(sql, spec) {
  const [mirror] = await sql`
    SELECT shopify_collection_id FROM catalog_shopify_mirrors WHERE sync_key = ${spec.syncKey}
  `
  try {
    let collection = await findCollection(spec.handle, mirror?.shopify_collection_id)
    if (!collection) collection = await createCollection(spec)
    else await updateCollection(collection.id, spec)
    await publishCollection(collection.id)

    const currentIds = await readCollectionProductIds(collection.id)
    const desiredIds = spec.productIds.map(productGid)
    const current = new Set(currentIds)
    const desired = new Set(desiredIds)
    const removedIds = currentIds.filter((id) => !desired.has(id))
    const addedIds = desiredIds.filter((id) => !current.has(id))
    const orderChanged =
      currentIds.length !== desiredIds.length || currentIds.some((id, index) => id !== desiredIds[index])
    await removeProducts(collection.id, removedIds)
    await addProducts(collection.id, addedIds)
    if (desiredIds.length > 1 && orderChanged) await reorderProducts(collection.id, desiredIds)

    await sql`
      INSERT INTO catalog_shopify_mirrors (
        sync_key, category_id, shopify_collection_id, handle, last_synced_at, last_error, updated_at
      ) VALUES (${spec.syncKey}, ${spec.categoryId}, ${collection.id}, ${spec.handle}, now(), NULL, now())
      ON CONFLICT (sync_key) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        shopify_collection_id = EXCLUDED.shopify_collection_id,
        handle = EXCLUDED.handle,
        last_synced_at = now(), last_error = NULL, updated_at = now()
    `
    return { syncKey: spec.syncKey, collectionId: collection.id, products: desiredIds.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Shopify sync error'
    await sql`
      INSERT INTO catalog_shopify_mirrors (sync_key, category_id, handle, last_error, updated_at)
      VALUES (${spec.syncKey}, ${spec.categoryId}, ${spec.handle}, ${message}, now())
      ON CONFLICT (sync_key) DO UPDATE SET last_error = ${message}, updated_at = now()
    `
    throw error
  }
}

async function readSnapshot(sql) {
  const categories = await sql`
    SELECT id, slug, title_fr, title_en, parent_id, position, representative_product_id
    FROM catalog_categories WHERE deleted_at IS NULL
    ORDER BY position, title_fr
  `
  const products = await sql`
    SELECT shopify_product_id, title, image_url, canonical_category_id, category_position
    FROM catalog_products WHERE online_store_published = true
    ORDER BY category_position, title
  `
  return { categories, products }
}

export function buildCatalogShopifySpecs(snapshot) {
  const { categories, products } = snapshot
  const byId = new Map(categories.map((category) => [category.id, category]))
  const children = new Map()
  for (const category of categories) {
    const key = category.parent_id ?? 'root'
    const siblings = children.get(key) ?? []
    siblings.push(category)
    children.set(key, siblings)
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.position - b.position || a.title_fr.localeCompare(b.title_fr))
  const descendants = (categoryId) => {
    const ids = []
    const visit = (id) => {
      ids.push(id)
      for (const child of children.get(id) ?? []) visit(child.id)
    }
    visit(categoryId)
    return ids
  }
  const breadcrumb = (category) => {
    const labels = []
    let current = category
    while (current) {
      labels.unshift(current.title_fr)
      current = current.parent_id ? byId.get(current.parent_id) : null
    }
    return labels.join(' › ')
  }
  const canonicalPath = (category) => {
    const handles = []
    let current = category
    while (current) {
      handles.unshift(`${COLLECTION_HANDLE_PREFIX}${current.slug}`)
      current = current.parent_id ? byId.get(current.parent_id) : null
    }
    return handles
  }
  const specs = categories.map((category) => {
    const branch = descendants(category.id)
    const rank = new Map(branch.map((id, index) => [id, index]))
    const categoryProducts = products
      .filter((product) => product.canonical_category_id && rank.has(product.canonical_category_id))
      .sort(
        (a, b) =>
          rank.get(a.canonical_category_id) - rank.get(b.canonical_category_id) ||
          a.category_position - b.category_position ||
          a.title.localeCompare(b.title),
      )
    const representative =
      categoryProducts.find((product) => product.shopify_product_id === category.representative_product_id) ??
      categoryProducts[0]
    return {
      syncKey: `category:${category.id}`,
      categoryId: category.id,
      handle: `${COLLECTION_HANDLE_PREFIX}${category.slug}`,
      title: `${COLLECTION_TITLE_PREFIX} ${breadcrumb(category)}`,
      labelFr: category.title_fr,
      labelEn: category.title_en?.trim() || category.title_fr,
      translationStatus: category.title_en?.trim() ? 'complete' : 'missing_en',
      parentHandle: category.parent_id ? `${COLLECTION_HANDLE_PREFIX}${byId.get(category.parent_id)?.slug}` : null,
      position: category.position,
      canonicalPath: canonicalPath(category),
      imageUrl: representative?.image_url ?? null,
      productIds: categoryProducts.map((product) => product.shopify_product_id),
    }
  })
  specs.push({
    syncKey: UNCLASSIFIED_KEY,
    categoryId: null,
    handle: `${COLLECTION_HANDLE_PREFIX}unclassified`,
    title: `${COLLECTION_TITLE_PREFIX} Non classés`,
    labelFr: 'Non classés',
    labelEn: 'Unclassified',
    translationStatus: 'complete',
    parentHandle: null,
    position: 999999,
    canonicalPath: [`${COLLECTION_HANDLE_PREFIX}unclassified`],
    imageUrl: null,
    productIds: products
      .filter((product) => !product.canonical_category_id)
      .map((product) => product.shopify_product_id),
  })
  return specs
}

export async function syncCatalogToShopify(sql, syncKeys = null) {
  await ensureCatalogMetafieldDefinitions()
  const specs = buildCatalogShopifySpecs(await readSnapshot(sql))
  const selected = syncKeys ? specs.filter((spec) => syncKeys.has(spec.syncKey)) : specs
  const results = []
  for (const spec of selected) results.push(await upsertMirror(sql, spec))
  return results
}

export async function catalogSyncKeys(
  sql,
  categoryIds,
  { includeAncestors = true, includeDescendants = false, unclassified = false } = {},
) {
  const categories = await sql`SELECT id, parent_id FROM catalog_categories WHERE deleted_at IS NULL`
  const byId = new Map(categories.map((category) => [category.id, category]))
  const ids = new Set(categoryIds.filter(Boolean))
  if (includeAncestors) {
    for (const categoryId of [...ids]) {
      let current = byId.get(categoryId)
      while (current?.parent_id) {
        ids.add(current.parent_id)
        current = byId.get(current.parent_id)
      }
    }
  }
  if (includeDescendants) {
    let changed = true
    while (changed) {
      changed = false
      for (const category of categories) {
        if (category.parent_id && ids.has(category.parent_id) && !ids.has(category.id)) {
          ids.add(category.id)
          changed = true
        }
      }
    }
  }
  const keys = new Set([...ids].map((id) => `category:${id}`))
  if (unclassified) keys.add(UNCLASSIFIED_KEY)
  return keys
}

export async function deleteCatalogMirror(sql, categoryId) {
  const syncKey = `category:${categoryId}`
  const [mirror] =
    await sql`SELECT shopify_collection_id, handle FROM catalog_shopify_mirrors WHERE sync_key = ${syncKey}`
  if (!mirror) return null
  const collection = await findCollection(mirror.handle, mirror.shopify_collection_id)
  if (collection) {
    const data = await shopifyGraphql(
      `mutation CatalogCollectionDelete($input: CollectionDeleteInput!) {
        collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
      }`,
      { input: { id: collection.id } },
    )
    assertNoUserErrors(data.collectionDelete, 'collectionDelete')
  }
  await sql`DELETE FROM catalog_shopify_mirrors WHERE sync_key = ${syncKey}`
  return collection?.id ?? null
}

export const catalogShopifyConstants = {
  COLLECTION_HANDLE_PREFIX,
  COLLECTION_TITLE_PREFIX,
  UNCLASSIFIED_KEY,
  DEFAULT_STOREFRONT_PUBLICATION_ID,
}
