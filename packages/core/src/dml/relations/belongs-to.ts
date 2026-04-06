// SPEC-057c — belongsTo relation

import type { DmlEntity, DmlRelationDefinition } from '../entity'

type EntityNameArg = keyof MantaGeneratedEntities | (string & {})

/**
 * Define a belongsTo relation (FK on this entity pointing to another).
 *
 * @example
 * ```typescript
 * // String form (preferred — zero imports)
 * export default defineModel('CustomerAddress', {
 *   customer: belongsTo('Customer'),     // → creates customer_id FK column
 *   address_1: field.text(),
 * })
 *
 * // Lazy ref form (legacy)
 * customer: belongsTo(() => Customer)
 * ```
 */
export function belongsTo(
  target: EntityNameArg | (() => DmlEntity),
  options?: Record<string, unknown>,
): DmlRelationDefinition {
  if (typeof target === 'string') {
    return {
      __dmlRelation: true,
      type: 'belongsTo',
      target: () => ({ name: target }) as unknown as DmlEntity,
      options,
      _entityName: target,
    }
  }
  return { __dmlRelation: true, type: 'belongsTo', target, options }
}
