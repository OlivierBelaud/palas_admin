// SPEC-057c — hasOne relation

import type { DmlRelationDefinition } from '../entity'
import type { DmlEntity } from '../entity'

/**
 * Define a hasOne relation (1:1).
 * @param target - Lazy reference to the target entity
 * @param options - Optional relation configuration
 * @returns A DmlRelationDefinition
 */
export function hasOne(target: () => DmlEntity, options?: Record<string, unknown>): DmlRelationDefinition {
  return { __dmlRelation: true, type: 'hasOne', target, options }
}

/**
 * Define a hasOne relation with FK on the owner side.
 * @param target - Lazy reference to the target entity
 * @param options - Optional relation configuration
 * @returns A DmlRelationDefinition
 */
export function hasOneWithFK(target: () => DmlEntity, options?: Record<string, unknown>): DmlRelationDefinition {
  return { __dmlRelation: true, type: 'hasOneWithFK', target, options }
}
