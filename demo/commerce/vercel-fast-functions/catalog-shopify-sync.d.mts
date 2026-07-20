import type { CatalogEnvironment, CatalogSpec } from './catalog-publication-governance.mjs'

export function buildCatalogShopifySpecs(snapshot: {
  categories: Array<Record<string, unknown>>
  products: Array<Record<string, unknown>>
}): CatalogSpec[]

export function syncCatalogToShopify(
  sql: unknown,
  syncKeys?: Set<string> | null,
  options?: { env?: CatalogEnvironment; force?: boolean },
): Promise<Array<{ syncKey: string; collectionId: string; products: number; replayed?: boolean }>>

export function catalogSyncKeys(
  sql: unknown,
  categoryIds: Array<string | null | undefined>,
  options?: { includeAncestors?: boolean; includeDescendants?: boolean; unclassified?: boolean },
): Promise<Set<string>>

export function deleteCatalogMirror(
  sql: unknown,
  categoryId: string,
  options?: { env?: CatalogEnvironment },
): Promise<string | null>

export const catalogShopifyConstants: {
  COLLECTION_HANDLE_PREFIX: string
  COLLECTION_TITLE_PREFIX: string
  UNCLASSIFIED_KEY: string
  DEFAULT_STOREFRONT_PUBLICATION_ID: string
}
