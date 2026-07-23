import { randomUUID } from 'node:crypto'
import {
  CATALOG_COLLECTION_HANDLE_PREFIX,
  CATALOG_PUBLICATION_ERROR_CODES,
  CatalogAuthorityConflictError,
  CatalogDesiredStateChangedError,
  CatalogPublicationBusyError,
  CatalogPublicationClaimLostError,
  assertCatalogPublicationAllowed,
  assertCatalogRemoteAuthority,
  catalogDesiredRevisionIsCurrent,
  catalogSpecFingerprint,
  catalogProductGid,
  shouldReplayCatalogPublication,
  planCatalogPublication,
} from './catalog-publication-governance.mjs'
import { SHOPIFY_ADMIN_DEFAULTS, resolveShopifyAdminConfig, shopifyAdminGraphql } from './shopify-admin-transport.mjs'

const COLLECTION_TITLE_PREFIX = '[PALAS CAT]'
const UNCLASSIFIED_KEY = 'unclassified'
const DEFAULT_STOREFRONT_PUBLICATION_ID = 'gid://shopify/Publication/234170581339'
const PUBLICATION_CLAIM_HEARTBEAT_MS = 60_000
const SHOPIFY_REQUEST_TIMEOUT_MS = 30_000
const CATALOG_METAFIELD_DEFINITIONS = [
  ['managed', 'Palas catalog managed', 'boolean'],
  ['sync_key', 'Palas catalog sync key', 'single_line_text_field'],
  ['label_fr', 'Palas catalog French label', 'single_line_text_field'],
  ['label_en', 'Palas catalog English label', 'single_line_text_field'],
  ['parent_handle', 'Palas catalog parent handle', 'single_line_text_field'],
  ['position', 'Palas catalog position', 'number_integer'],
  ['canonical_path', 'Palas catalog canonical path', 'json'],
  ['direct_product_ids', 'Palas catalog direct product IDs', 'json'],
  ['translation_status', 'Palas catalog translation status', 'single_line_text_field'],
]
const PINNED_CATALOG_METAFIELDS = new Set([
  'label_fr',
  'label_en',
  'parent_handle',
  'position',
  'canonical_path',
  'direct_product_ids',
  'translation_status',
])

class CatalogShopifySyncError extends Error {}

function chunks(items, size = 250) {
  const result = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function shopifyConfig(env = process.env) {
  assertCatalogPublicationAllowed(env)
  const transport = resolveShopifyAdminConfig({}, env)
  const publicationId = env.SHOPIFY_CATALOG_PUBLICATION_ID || DEFAULT_STOREFRONT_PUBLICATION_ID
  if (transport.domain !== SHOPIFY_ADMIN_DEFAULTS.domain || publicationId !== DEFAULT_STOREFRONT_PUBLICATION_ID) {
    throw new CatalogShopifySyncError(
      `Catalog production target is not approved (${transport.domain}, ${publicationId})`,
    )
  }
  return { ...transport, publicationId, env }
}

async function shopifyGraphql(config, query, variables = {}) {
  return await shopifyAdminGraphql(query, variables, {
    domain: config.domain,
    token: config.token,
    apiVersion: config.apiVersion,
    timeoutMs: SHOPIFY_REQUEST_TIMEOUT_MS,
    env: config.env,
  })
}

function assertNoUserErrors(payload, operation) {
  if (payload?.userErrors?.length) {
    throw new CatalogShopifySyncError(`${operation}: ${payload.userErrors.map((error) => error.message).join(' | ')}`)
  }
}

async function publishCollection(config, collectionId) {
  const { publicationId } = config
  const data = await shopifyGraphql(
    config,
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

async function ensureCatalogMetafieldDefinitions(config, heartbeat) {
  await heartbeat()
  const data = await shopifyGraphql(
    config,
    `query CatalogMetafieldDefinitions {
      metafieldDefinitions(first: 100, ownerType: COLLECTION, namespace: "palas_catalog") {
        nodes { id key pinnedPosition }
      }
    }`,
  )
  const existing = new Map(data.metafieldDefinitions.nodes.map((definition) => [definition.key, definition]))
  for (const [key, name, type] of CATALOG_METAFIELD_DEFINITIONS) {
    await heartbeat()
    let definition = existing.get(key)
    if (!definition) {
      const created = await shopifyGraphql(
        config,
        `mutation CatalogMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id key pinnedPosition }
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
      definition = created.metafieldDefinitionCreate.createdDefinition
    }
    if (PINNED_CATALOG_METAFIELDS.has(key) && !definition.pinnedPosition) {
      await heartbeat()
      const pinned = await shopifyGraphql(
        config,
        `mutation CatalogMetafieldDefinitionPin($definitionId: ID!) {
          metafieldDefinitionPin(definitionId: $definitionId) {
            pinnedDefinition { id key pinnedPosition }
            userErrors { field message }
          }
        }`,
        { definitionId: definition.id },
      )
      assertNoUserErrors(pinned.metafieldDefinitionPin, 'metafieldDefinitionPin')
    }
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
      key: 'direct_product_ids',
      type: 'json',
      value: JSON.stringify(spec.directProductIds.map(catalogProductGid)),
    },
    {
      namespace: 'palas_catalog',
      key: 'translation_status',
      type: 'single_line_text_field',
      value: spec.translationStatus,
    },
  ]
}

async function findCollection(config, spec, knownId) {
  const data = knownId
    ? await shopifyGraphql(
        config,
        `query CatalogCollection($id: ID!) {
          collection(id: $id) {
            id handle title
            managed: metafield(namespace: "palas_catalog", key: "managed") { value }
            syncKey: metafield(namespace: "palas_catalog", key: "sync_key") { value }
          }
        }`,
        { id: knownId },
      )
    : await shopifyGraphql(
        config,
        `query CatalogCollection($query: String!) {
          collections(first: 2, query: $query) {
            nodes {
              id handle title
              managed: metafield(namespace: "palas_catalog", key: "managed") { value }
              syncKey: metafield(namespace: "palas_catalog", key: "sync_key") { value }
            }
          }
        }`,
        { query: `handle:${spec.handle}` },
      )
  const collection = knownId ? data.collection : data.collections.nodes.find((node) => node.handle === spec.handle)
  if (!collection) return null
  const remote = {
    ...collection,
    managed: collection.managed?.value === 'true',
    syncKey: collection.syncKey?.value ?? null,
  }
  assertCatalogRemoteAuthority(remote, spec)
  return remote
}

async function createCollection(config, spec) {
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
    config,
    `mutation CatalogCollectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) { collection { id handle title } userErrors { field message } }
    }`,
    { input },
  )
  assertNoUserErrors(data.collectionCreate, 'collectionCreate')
  if (!data.collectionCreate.collection) throw new CatalogShopifySyncError('Shopify did not create the collection')
  return data.collectionCreate.collection
}

async function updateCollection(config, collectionId, spec) {
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
    config,
    `mutation CatalogCollectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) { collection { id handle title } userErrors { field message } }
    }`,
    { input },
  )
  assertNoUserErrors(data.collectionUpdate, 'collectionUpdate')
}

async function readCollectionProductIds(config, collectionId, heartbeat) {
  const ids = []
  let cursor = null
  do {
    await heartbeat()
    const data = await shopifyGraphql(
      config,
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

async function addProducts(config, collectionId, productIds, heartbeat) {
  for (const batch of chunks(productIds)) {
    await heartbeat()
    const data = await shopifyGraphql(
      config,
      `mutation CatalogCollectionAdd($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) { userErrors { field message } }
      }`,
      { id: collectionId, productIds: batch },
    )
    assertNoUserErrors(data.collectionAddProducts, 'collectionAddProducts')
  }
}

async function removeProducts(config, collectionId, productIds, heartbeat) {
  for (const batch of chunks(productIds)) {
    await heartbeat()
    const data = await shopifyGraphql(
      config,
      `mutation CatalogCollectionRemove($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) { userErrors { field message } }
      }`,
      { id: collectionId, productIds: batch },
    )
    assertNoUserErrors(data.collectionRemoveProducts, 'collectionRemoveProducts')
  }
}

async function reorderProducts(config, collectionId, desiredIds, heartbeat) {
  for (const batch of chunks(desiredIds.map((id, index) => ({ id, newPosition: String(index) })))) {
    await heartbeat()
    const data = await shopifyGraphql(
      config,
      `mutation CatalogCollectionReorder($id: ID!, $moves: [MoveInput!]!) {
        collectionReorderProducts(id: $id, moves: $moves) { job { id done } userErrors { field message } }
      }`,
      { id: collectionId, moves: batch },
    )
    assertNoUserErrors(data.collectionReorderProducts, 'collectionReorderProducts')
    const job = data.collectionReorderProducts.job
    if (job && !job.done) await waitForJob(config, job.id, heartbeat)
  }
}

async function waitForJob(config, jobId, heartbeat) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await heartbeat()
    const data = await shopifyGraphql(config, `query CatalogSyncJob($id: ID!) { job(id: $id) { done } }`, { id: jobId })
    if (data.job?.done) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new CatalogShopifySyncError('Shopify product reorder timed out')
}

async function beginPublicationAttempt(sql, context, { force = false } = {}) {
  const claimToken = randomUUID()
  return sql.begin(async (tx) => {
    const [state] = await tx`
      SELECT revision FROM catalog_publication_state WHERE singleton = true FOR SHARE
    `
    if (!catalogDesiredRevisionIsCurrent(context.desiredRevision, state?.revision)) {
      throw new CatalogDesiredStateChangedError(context.spec.syncKey)
    }
    await tx`
      INSERT INTO catalog_shopify_mirrors (
        sync_key, category_id, handle, publication_status, updated_at
      ) VALUES (
        ${context.spec.syncKey}, ${context.spec.categoryId}, ${context.spec.handle}, 'never', now()
      )
      ON CONFLICT (sync_key) DO NOTHING
    `
    const [mirror] = await tx`
      SELECT
        shopify_collection_id, published_fingerprint, publication_status,
        claim_token, claim_expires_at,
        (claim_token IS NULL OR claim_expires_at IS NULL OR claim_expires_at <= now()) AS claim_available
      FROM catalog_shopify_mirrors
      WHERE sync_key = ${context.spec.syncKey}
      FOR UPDATE
    `
    if (!mirror) throw new CatalogAuthorityConflictError(`Catalog mirror missing for ${context.spec.syncKey}`)
    if (!mirror.claim_available) {
      throw new CatalogPublicationBusyError(context.spec.syncKey)
    }
    if (shouldReplayCatalogPublication(mirror, context.desiredFingerprint, { force })) {
      return {
        ...context,
        replayed: true,
        collectionId: mirror.shopify_collection_id,
      }
    }
    await tx`
      UPDATE catalog_publication_attempts
      SET status = 'superseded',
          error_code = 'CATALOG_PUBLICATION_LEASE_EXPIRED',
          error_message = 'Superseded by a successor after the publication lease expired',
          completed_at = now()
      WHERE sync_key = ${context.spec.syncKey} AND status = 'pending'
    `
    await tx`
      UPDATE catalog_shopify_mirrors
      SET category_id = ${context.spec.categoryId},
          handle = ${context.spec.handle},
          desired_fingerprint = ${context.desiredFingerprint},
          desired_revision = ${context.desiredRevision},
          publication_status = 'pending',
          claim_token = ${claimToken},
          claim_expires_at = now() + interval '5 minutes',
          last_attempted_at = now(),
          last_error = NULL,
          updated_at = now()
      WHERE sync_key = ${context.spec.syncKey}
    `
    const [attempt] = await tx`
      INSERT INTO catalog_publication_attempts (
        sync_key, target, publication_id, desired_fingerprint, desired_revision, status
      )
      VALUES (
        ${context.spec.syncKey}, 'shopify-production', ${context.publicationId},
        ${context.desiredFingerprint}, ${context.desiredRevision}, 'pending'
      )
      RETURNING id
    `
    return {
      ...context,
      id: attempt.id,
      claimToken,
      collectionId: mirror.shopify_collection_id ?? null,
      nextHeartbeatAt: 0,
      replayed: false,
    }
  })
}

async function heartbeatPublicationClaim(sql, attempt, { force = false } = {}) {
  if (attempt.replayed || (!force && Date.now() < attempt.nextHeartbeatAt)) return
  const [claim] = await sql`
    UPDATE catalog_shopify_mirrors
    SET claim_expires_at = now() + interval '5 minutes', updated_at = now()
    WHERE sync_key = ${attempt.spec.syncKey} AND claim_token = ${attempt.claimToken}
    RETURNING sync_key
  `
  if (!claim) throw new CatalogPublicationClaimLostError(attempt.spec.syncKey)
  attempt.nextHeartbeatAt = Date.now() + PUBLICATION_CLAIM_HEARTBEAT_MS
}

async function completePublicationAttempt(sql, attempt, collectionId) {
  await sql.begin(async (tx) => {
    const [state] = await tx`
      SELECT revision FROM catalog_publication_state WHERE singleton = true FOR SHARE
    `
    if (!catalogDesiredRevisionIsCurrent(attempt.desiredRevision, state?.revision)) {
      throw new CatalogDesiredStateChangedError(attempt.spec.syncKey)
    }
    const [mirror] = await tx`
      UPDATE catalog_shopify_mirrors
      SET category_id = ${attempt.spec.categoryId},
          shopify_collection_id = ${collectionId},
          handle = ${attempt.spec.handle},
          desired_fingerprint = ${attempt.desiredFingerprint},
          published_fingerprint = ${attempt.desiredFingerprint},
          desired_revision = ${attempt.desiredRevision},
          published_revision = ${attempt.desiredRevision},
          publication_status = 'synced',
          last_synced_at = now(),
          last_attempted_at = now(),
          last_error = NULL,
          claim_token = NULL,
          claim_expires_at = NULL,
          updated_at = now()
      WHERE sync_key = ${attempt.spec.syncKey} AND claim_token = ${attempt.claimToken}
      RETURNING sync_key
    `
    if (!mirror) throw new CatalogPublicationClaimLostError(attempt.spec.syncKey)
    const [completedAttempt] = await tx`
      UPDATE catalog_publication_attempts
      SET status = 'published', provider_collection_id = ${collectionId}, completed_at = now()
      WHERE id = ${attempt.id} AND status = 'pending'
      RETURNING id
    `
    if (!completedAttempt) throw new CatalogPublicationClaimLostError(attempt.spec.syncKey)
  })
}

async function failPublicationAttempt(sql, attempt, error) {
  const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown Shopify sync error'
  const code = typeof error?.code === 'string' ? error.code : CATALOG_PUBLICATION_ERROR_CODES.providerFailure
  const status = code === CATALOG_PUBLICATION_ERROR_CODES.authorityConflict ? 'conflict' : 'failed'
  await sql.begin(async (tx) => {
    await tx`
      UPDATE catalog_shopify_mirrors
      SET desired_fingerprint = ${attempt.desiredFingerprint},
          publication_status = ${status},
          last_error = ${message},
          claim_token = NULL,
          claim_expires_at = NULL,
          updated_at = now()
      WHERE sync_key = ${attempt.spec.syncKey} AND claim_token = ${attempt.claimToken}
    `
    await tx`
      UPDATE catalog_publication_attempts
      SET status = ${status}, error_code = ${code}, error_message = ${message}, completed_at = now()
      WHERE id = ${attempt.id} AND status = 'pending'
    `
  })
}

async function completeMirrorDeletion(sql, attempt, collectionId) {
  await sql.begin(async (tx) => {
    const [state] = await tx`
      SELECT revision FROM catalog_publication_state WHERE singleton = true FOR SHARE
    `
    if (!catalogDesiredRevisionIsCurrent(attempt.desiredRevision, state?.revision)) {
      throw new CatalogDesiredStateChangedError(attempt.spec.syncKey)
    }
    const deleted = await tx`
      DELETE FROM catalog_shopify_mirrors
      WHERE sync_key = ${attempt.spec.syncKey} AND claim_token = ${attempt.claimToken}
      RETURNING sync_key
    `
    if (!deleted[0]) throw new CatalogPublicationClaimLostError(attempt.spec.syncKey)
    const [completedAttempt] = await tx`
      UPDATE catalog_publication_attempts
      SET status = 'published', provider_collection_id = ${collectionId}, completed_at = now()
      WHERE id = ${attempt.id} AND status = 'pending'
      RETURNING id
    `
    if (!completedAttempt) throw new CatalogPublicationClaimLostError(attempt.spec.syncKey)
  })
}

async function upsertMirror(sql, config, spec, desiredRevision, { force = false, ensureDefinitions } = {}) {
  const { publicationId } = config
  const desiredFingerprint = catalogSpecFingerprint({ ...spec, publicationId })
  const attempt = await beginPublicationAttempt(
    sql,
    { spec, desiredFingerprint, desiredRevision, publicationId },
    { force },
  )
  if (attempt.replayed) {
    return {
      syncKey: spec.syncKey,
      collectionId: attempt.collectionId,
      products: spec.productIds.length,
      replayed: true,
    }
  }
  const heartbeat = () => heartbeatPublicationClaim(sql, attempt)
  try {
    await heartbeatPublicationClaim(sql, attempt, { force: true })
    await ensureDefinitions(heartbeat)
    await heartbeat()
    let collection = await findCollection(config, spec, attempt.collectionId)
    await heartbeat()
    if (!collection) {
      const created = await createCollection(config, spec)
      collection = await findCollection(config, spec, created.id)
      if (!collection) throw new CatalogShopifySyncError('Created Shopify collection could not be verified')
    } else {
      await updateCollection(config, collection.id, spec)
    }
    await heartbeat()
    await publishCollection(config, collection.id)

    const currentIds = await readCollectionProductIds(config, collection.id, heartbeat)
    const plan = planCatalogPublication(
      { ...collection, productIds: currentIds },
      { ...spec, publicationId },
      { desiredFingerprint },
    )
    await removeProducts(config, collection.id, plan.reconciliation.remove, heartbeat)
    await addProducts(config, collection.id, plan.reconciliation.add, heartbeat)
    if (plan.desiredProductIds.length > 1 && plan.reconciliation.reorder) {
      await reorderProducts(config, collection.id, plan.desiredProductIds, heartbeat)
    }

    await heartbeatPublicationClaim(sql, attempt, { force: true })
    await completePublicationAttempt(sql, attempt, collection.id)
    return { syncKey: spec.syncKey, collectionId: collection.id, products: plan.desiredProductIds.length }
  } catch (error) {
    await failPublicationAttempt(sql, attempt, error)
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

async function readVersionedSnapshot(sql) {
  return sql.begin(async (tx) => {
    const [state] = await tx`
      SELECT revision FROM catalog_publication_state WHERE singleton = true FOR SHARE
    `
    const snapshot = await readSnapshot(tx)
    return { ...snapshot, revision: Number(state?.revision ?? 0) }
  })
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
      handles.unshift(`${CATALOG_COLLECTION_HANDLE_PREFIX}${current.slug}`)
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
    const directProducts = products
      .filter((product) => product.canonical_category_id === category.id)
      .sort((a, b) => a.category_position - b.category_position || a.title.localeCompare(b.title))
    const representative =
      categoryProducts.find((product) => product.shopify_product_id === category.representative_product_id) ??
      categoryProducts[0]
    return {
      syncKey: `category:${category.id}`,
      categoryId: category.id,
      handle: `${CATALOG_COLLECTION_HANDLE_PREFIX}${category.slug}`,
      title: `${COLLECTION_TITLE_PREFIX} ${breadcrumb(category)}`,
      labelFr: category.title_fr,
      labelEn: category.title_en?.trim() || category.title_fr,
      translationStatus: category.title_en?.trim() ? 'complete' : 'missing_en',
      parentHandle: category.parent_id
        ? `${CATALOG_COLLECTION_HANDLE_PREFIX}${byId.get(category.parent_id)?.slug}`
        : null,
      position: category.position,
      canonicalPath: canonicalPath(category),
      directProductIds: directProducts.map((product) => product.shopify_product_id),
      imageUrl: representative?.image_url ?? null,
      productIds: categoryProducts.map((product) => product.shopify_product_id),
    }
  })
  specs.push({
    syncKey: UNCLASSIFIED_KEY,
    categoryId: null,
    handle: `${CATALOG_COLLECTION_HANDLE_PREFIX}unclassified`,
    title: `${COLLECTION_TITLE_PREFIX} Non classés`,
    labelFr: 'Non classés',
    labelEn: 'Unclassified',
    translationStatus: 'complete',
    parentHandle: null,
    position: 999999,
    canonicalPath: [`${CATALOG_COLLECTION_HANDLE_PREFIX}unclassified`],
    directProductIds: products
      .filter((product) => !product.canonical_category_id)
      .map((product) => product.shopify_product_id),
    imageUrl: null,
    productIds: products
      .filter((product) => !product.canonical_category_id)
      .map((product) => product.shopify_product_id),
  })
  return specs
}

export async function syncCatalogToShopify(sql, syncKeys = null, { env = process.env, force = false } = {}) {
  const config = shopifyConfig(env)
  const initialSnapshot = await readVersionedSnapshot(sql)
  const initialSpecs = buildCatalogShopifySpecs(initialSnapshot)
  const selectedKeys = syncKeys ? [...syncKeys] : initialSpecs.map((spec) => spec.syncKey)
  let definitionsPromise
  const ensureDefinitions = (heartbeat) => {
    definitionsPromise ??= ensureCatalogMetafieldDefinitions(config, heartbeat)
    return definitionsPromise
  }
  const results = []
  if (!syncKeys) {
    const retired = await sql`
      SELECT category_id FROM catalog_shopify_mirrors
      WHERE retirement_pending = true AND category_id IS NOT NULL
      ORDER BY updated_at
    `
    for (const mirror of retired) {
      await deleteCatalogMirror(sql, mirror.category_id, { env })
    }
  }
  for (const syncKey of selectedKeys) {
    let completed = false
    for (let retry = 0; retry < 5 && !completed; retry += 1) {
      const snapshot = await readVersionedSnapshot(sql)
      const spec = buildCatalogShopifySpecs(snapshot).find((candidate) => candidate.syncKey === syncKey)
      if (!spec) {
        const [retired] = await sql`
          SELECT category_id FROM catalog_shopify_mirrors
          WHERE sync_key = ${syncKey} AND retirement_pending = true
        `
        if (retired?.category_id) await deleteCatalogMirror(sql, retired.category_id, { env })
        completed = true
        continue
      }
      try {
        results.push(await upsertMirror(sql, config, spec, snapshot.revision, { force, ensureDefinitions }))
        completed = true
      } catch (error) {
        if (error?.code !== CATALOG_PUBLICATION_ERROR_CODES.desiredStateChanged || retry === 4) throw error
      }
    }
  }
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

export async function deleteCatalogMirror(sql, categoryId, { env = process.env } = {}) {
  const config = shopifyConfig(env)
  const syncKey = `category:${categoryId}`
  const [mirror] =
    await sql`SELECT shopify_collection_id, handle FROM catalog_shopify_mirrors WHERE sync_key = ${syncKey}`
  if (!mirror) return null
  const [state] = await sql`
    SELECT revision FROM catalog_publication_state WHERE singleton = true
  `
  const desiredRevision = Number(state?.revision ?? 0)
  const { publicationId } = config
  const spec = {
    syncKey,
    categoryId,
    handle: mirror.handle,
    title: '__delete__',
    labelFr: '',
    labelEn: '',
    translationStatus: 'retired',
    parentHandle: null,
    position: 0,
    canonicalPath: [],
    directProductIds: [],
    imageUrl: null,
    productIds: [],
  }
  const desiredFingerprint = catalogSpecFingerprint({ ...spec, publicationId })
  const attempt = await beginPublicationAttempt(
    sql,
    { spec, desiredFingerprint, desiredRevision, publicationId },
    { force: true },
  )
  try {
    await heartbeatPublicationClaim(sql, attempt, { force: true })
    const collection = await findCollection(config, spec, attempt.collectionId)
    if (collection) {
      await heartbeatPublicationClaim(sql, attempt, { force: true })
      const data = await shopifyGraphql(
        config,
        `mutation CatalogCollectionDelete($input: CollectionDeleteInput!) {
          collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
        }`,
        { input: { id: collection.id } },
      )
      assertNoUserErrors(data.collectionDelete, 'collectionDelete')
    }
    await heartbeatPublicationClaim(sql, attempt, { force: true })
    await completeMirrorDeletion(sql, attempt, collection?.id ?? attempt.collectionId)
    return collection?.id ?? null
  } catch (error) {
    await failPublicationAttempt(sql, attempt, error)
    throw error
  }
}

export const catalogShopifyConstants = {
  COLLECTION_HANDLE_PREFIX: CATALOG_COLLECTION_HANDLE_PREFIX,
  COLLECTION_TITLE_PREFIX,
  UNCLASSIFIED_KEY,
  DEFAULT_STOREFRONT_PUBLICATION_ID,
}
