// SPEC-057c — hasMany relation

import type { DmlRelationDefinition } from '../entity'
import type { DmlEntity } from '../entity'

/**
 * Define a hasMany relation (1:N).
 * @param target - Lazy reference to the target entity
 * @param options - Optional relation configuration
 * @returns A DmlRelationDefinition
 */
export function hasMany(target: () => DmlEntity, options?: Record<string, unknown>): DmlRelationDefinition {
  return { __dmlRelation: true, type: 'hasMany', target, options }
}
