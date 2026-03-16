// SPEC-057c — belongsTo relation

import type { DmlRelationDefinition } from '../entity'
import type { DmlEntity } from '../entity'

/**
 * Define a belongsTo relation (inverse of hasOne/hasMany).
 * @param target - Lazy reference to the target entity
 * @param options - Optional relation configuration
 * @returns A DmlRelationDefinition
 */
export function belongsTo(target: () => DmlEntity, options?: Record<string, unknown>): DmlRelationDefinition {
  return { __dmlRelation: true, type: 'belongsTo', target, options }
}
