export type CatalogEnvironment = Record<string, string | undefined>
export const CATALOG_COLLECTION_HANDLE_PREFIX: 'palas-cat-'
export const CATALOG_PUBLICATION_ERROR_CODES: Readonly<{
  blocked: 'CATALOG_PUBLICATION_BLOCKED'
  authorityConflict: 'CATALOG_AUTHORITY_CONFLICT'
  providerFailure: 'SHOPIFY_PROVIDER_FAILURE'
  busy: 'CATALOG_PUBLICATION_BUSY'
  claimLost: 'CATALOG_PUBLICATION_CLAIM_LOST'
  desiredStateChanged: 'CATALOG_DESIRED_STATE_CHANGED'
}>
export function catalogProductGid(id: string): string

export type CatalogSpec = {
  syncKey: string
  categoryId: string | null
  handle: string
  title: string
  labelFr: string
  labelEn: string
  translationStatus: string
  parentHandle: string | null
  position: number
  canonicalPath: string[]
  directProductIds: string[]
  imageUrl: string | null
  productIds: string[]
  publicationId?: string
}

export type CatalogRemote = {
  id: string
  handle: string
  managed: boolean
  syncKey: string | null
  productIds?: string[]
}

export type CatalogAuthoritySpec = Pick<CatalogSpec, 'handle' | 'syncKey'>

export const catalogFieldOwnership: Readonly<{
  admin: readonly string[]
  shopify: readonly string[]
}>

export class CatalogPublicationBlockedError extends Error {
  code: 'CATALOG_PUBLICATION_BLOCKED'
}

export class CatalogAuthorityConflictError extends Error {
  code: 'CATALOG_AUTHORITY_CONFLICT'
}

export class CatalogPublicationBusyError extends Error {
  code: 'CATALOG_PUBLICATION_BUSY'
  constructor(syncKey: string)
}

export class CatalogPublicationClaimLostError extends Error {
  code: 'CATALOG_PUBLICATION_CLAIM_LOST'
  constructor(syncKey: string)
}

export class CatalogDesiredStateChangedError extends Error {
  code: 'CATALOG_DESIRED_STATE_CHANGED'
  constructor(syncKey: string)
}

export function catalogPublicationPolicy(env?: CatalogEnvironment): {
  allowed: boolean
  runtime: string
  target: 'shopify-production'
  reason: string | null
}

export function assertCatalogPublicationAllowed(env?: CatalogEnvironment): ReturnType<typeof catalogPublicationPolicy>
export function assertCatalogRemoteAuthority(remote: CatalogRemote | null, spec: CatalogAuthoritySpec): void
export function catalogClaimIsAvailable(
  mirror: { claim_token?: string | null; claim_expires_at?: string | Date | null } | null,
  now?: number,
): boolean
export function catalogDesiredRevisionIsCurrent(
  desiredRevision: number | string,
  currentRevision: number | string,
): boolean
export function shouldReplayCatalogPublication(
  mirror: {
    publication_status?: string | null
    published_fingerprint?: string | null
    shopify_collection_id?: string | null
  } | null,
  desiredFingerprint: string,
  options?: { force?: boolean },
): boolean
export function catalogSpecFingerprint(spec: CatalogSpec): string
export function planCatalogPublication(
  remote: CatalogRemote | null,
  spec: CatalogSpec,
  options?: { desiredFingerprint?: string },
): {
  action: 'create' | 'update'
  authority: 'confirmed'
  desiredFingerprint: string
  desiredProductIds: string[]
  reconciliation: {
    add: string[]
    remove: string[]
    reorder: boolean
  }
}
export function observeCatalogProvider<T>(read: () => Promise<T[]>): Promise<{
  ok: boolean
  data: T[]
  error: string | null
}>
