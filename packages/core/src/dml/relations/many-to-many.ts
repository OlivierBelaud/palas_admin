// SPEC-057c — manyToMany relation

import type { DmlEntity, DmlRelationDefinition } from '../entity'

/**
 * Define a manyToMany relation (N:M via pivot table).
 * @param target - Lazy reference to the target entity
 * @param options - Optional relation configuration (pivotEntity, etc.)
 * @returns A DmlRelationDefinition
 */
export function manyToMany(target: () => DmlEntity, options?: Record<string, unknown>): DmlRelationDefinition {
  return { __dmlRelation: true, type: 'manyToMany', target, options }
}
