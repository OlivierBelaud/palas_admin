// SPEC — InferEntity<T> type utility
// Extracts a typed object from a DmlEntity's schema definition.
// Each property class carries $dataType: T for inference.

import type { DmlEntity } from './entity'

/**
 * Extract the TypeScript type from a DML property.
 * Works with BaseProperty<T>, NullableModifier<T>, PrimaryKeyModifier<T>, EnumProperty<V>.
 */
type InferPropertyType<P> = P extends { $dataType: infer T } ? T : unknown

/**
 * Implicit columns added by the framework to every entity (ISO Medusa DML).
 * The user never defines these — they are always present.
 */
interface ImplicitColumns {
  id: string
  metadata: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

/**
 * Infer a plain object type from a DmlEntity definition.
 * Relations (marked with __dmlRelation) are excluded — only scalar properties are inferred.
 * Implicit columns (id, created_at, updated_at, deleted_at) are always included.
 *
 * Usage:
 *   const Product = model.define('Product', { title: field.text(), price: field.number() })
 *   type ProductType = InferEntity<typeof Product>
 *   // => { id: string, title: string, price: number, created_at: Date, updated_at: Date, deleted_at: Date | null }
 */
export type InferEntity<E> =
  E extends DmlEntity<infer S>
    ? ImplicitColumns & { [K in keyof S as S[K] extends { __dmlRelation: true } ? never : K]: InferPropertyType<S[K]> }
    : never
