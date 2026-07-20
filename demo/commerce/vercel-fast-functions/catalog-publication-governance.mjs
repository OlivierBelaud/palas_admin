import { createHash } from 'node:crypto'

export const CATALOG_COLLECTION_HANDLE_PREFIX = 'palas-cat-'
export const CATALOG_PUBLICATION_ERROR_CODES = Object.freeze({
  blocked: 'CATALOG_PUBLICATION_BLOCKED',
  authorityConflict: 'CATALOG_AUTHORITY_CONFLICT',
  providerFailure: 'SHOPIFY_PROVIDER_FAILURE',
  busy: 'CATALOG_PUBLICATION_BUSY',
  claimLost: 'CATALOG_PUBLICATION_CLAIM_LOST',
  desiredStateChanged: 'CATALOG_DESIRED_STATE_CHANGED',
})

export function catalogProductGid(id) {
  return `gid://shopify/Product/${id}`
}

export const catalogFieldOwnership = Object.freeze({
  admin: Object.freeze([
    'collection.title',
    'collection.description_html',
    'collection.image',
    'collection.products',
    'collection.product_order',
    'collection.publication_target',
    'metafields.palas_catalog.*',
  ]),
  shopify: Object.freeze([
    'product.title',
    'product.handle',
    'product.media',
    'product.price',
    'product.inventory',
    'product.publication',
  ]),
})

export class CatalogPublicationBlockedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CatalogPublicationBlockedError'
    this.code = CATALOG_PUBLICATION_ERROR_CODES.blocked
  }
}

export class CatalogAuthorityConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CatalogAuthorityConflictError'
    this.code = CATALOG_PUBLICATION_ERROR_CODES.authorityConflict
  }
}

export class CatalogPublicationBusyError extends Error {
  constructor(syncKey) {
    super(`Catalog publication already in progress for ${syncKey}`)
    this.name = 'CatalogPublicationBusyError'
    this.code = CATALOG_PUBLICATION_ERROR_CODES.busy
  }
}

export class CatalogPublicationClaimLostError extends Error {
  constructor(syncKey) {
    super(`Catalog publication claim lost for ${syncKey}`)
    this.name = 'CatalogPublicationClaimLostError'
    this.code = CATALOG_PUBLICATION_ERROR_CODES.claimLost
  }
}

export class CatalogDesiredStateChangedError extends Error {
  constructor(syncKey) {
    super(`Catalog desired state changed while publishing ${syncKey}`)
    this.name = 'CatalogDesiredStateChangedError'
    this.code = CATALOG_PUBLICATION_ERROR_CODES.desiredStateChanged
  }
}

export function catalogPublicationPolicy(env = process.env) {
  const runtime = env.VERCEL_ENV || env.NODE_ENV || 'development'
  if (runtime !== 'production') {
    return {
      allowed: false,
      runtime,
      target: 'shopify-production',
      reason: `Catalog publication is blocked in ${runtime}; only the production runtime may write to Shopify`,
    }
  }
  if (env.SHOPIFY_CATALOG_WRITES_ENABLED !== 'true') {
    return {
      allowed: false,
      runtime,
      target: 'shopify-production',
      reason: 'Catalog publication requires SHOPIFY_CATALOG_WRITES_ENABLED=true',
    }
  }
  return { allowed: true, runtime, target: 'shopify-production', reason: null }
}

export function assertCatalogPublicationAllowed(env = process.env) {
  const policy = catalogPublicationPolicy(env)
  if (!policy.allowed) throw new CatalogPublicationBlockedError(policy.reason)
  return policy
}

export function assertCatalogRemoteAuthority(remote, spec) {
  if (!remote) return
  if (
    !remote.handle?.startsWith(CATALOG_COLLECTION_HANDLE_PREFIX) ||
    remote.handle !== spec.handle ||
    remote.managed !== true ||
    remote.syncKey !== spec.syncKey
  ) {
    throw new CatalogAuthorityConflictError(
      `Catalog authority conflict for ${spec.syncKey}: refusing to modify Shopify collection ${remote.handle || remote.id}`,
    )
  }
}

export function catalogClaimIsAvailable(mirror, now = Date.now()) {
  if (!mirror?.claim_token || !mirror.claim_expires_at) return true
  return new Date(mirror.claim_expires_at).getTime() <= now
}

export function catalogDesiredRevisionIsCurrent(desiredRevision, currentRevision) {
  return Number(desiredRevision) === Number(currentRevision)
}

export function shouldReplayCatalogPublication(mirror, desiredFingerprint, { force = false } = {}) {
  return Boolean(
    !force &&
      mirror?.publication_status === 'synced' &&
      mirror.published_fingerprint === desiredFingerprint &&
      mirror.shopify_collection_id,
  )
}

export function catalogSpecFingerprint(spec) {
  const ownedProjection = {
    syncKey: spec.syncKey,
    handle: spec.handle,
    title: spec.title,
    labelFr: spec.labelFr,
    labelEn: spec.labelEn,
    translationStatus: spec.translationStatus,
    parentHandle: spec.parentHandle,
    position: spec.position,
    canonicalPath: spec.canonicalPath,
    directProductIds: spec.directProductIds,
    imageUrl: spec.imageUrl,
    productIds: spec.productIds,
    publicationId: spec.publicationId ?? null,
  }
  return createHash('sha256').update(JSON.stringify(ownedProjection)).digest('hex')
}

export function planCatalogPublication(remote, spec, { desiredFingerprint = catalogSpecFingerprint(spec) } = {}) {
  assertCatalogRemoteAuthority(remote, spec)
  const desiredIds = spec.productIds.map(catalogProductGid)
  const currentIds = remote?.productIds ?? []
  const current = new Set(currentIds)
  const desired = new Set(desiredIds)
  return {
    action: remote ? 'update' : 'create',
    authority: 'confirmed',
    desiredFingerprint,
    desiredProductIds: desiredIds,
    reconciliation: {
      add: desiredIds.filter((id) => !current.has(id)),
      remove: currentIds.filter((id) => !desired.has(id)),
      reorder: currentIds.length !== desiredIds.length || currentIds.some((id, index) => id !== desiredIds[index]),
    },
  }
}

export async function observeCatalogProvider(read) {
  try {
    return { ok: true, data: await read(), error: null }
  } catch (error) {
    return {
      ok: false,
      data: [],
      error: error instanceof Error ? error.message : 'Shopify catalog provider unavailable',
    }
  }
}
