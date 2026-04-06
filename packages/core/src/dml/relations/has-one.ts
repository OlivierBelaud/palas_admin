// SPEC-057c — hasOne relation

import type { DmlEntity, DmlRelationDefinition } from '../entity'

type EntityNameArg = keyof MantaGeneratedEntities | (string & {})

/**
 * Define a hasOne relation (1:1 — the other entity has a FK to this one).
 *
 * @example
 * ```typescript
 * export default defineModel('Customer', {
 *   account: hasOne('CustomerAccount'),
 * })
 * ```
 */
export function hasOne(
  target: EntityNameArg | (() => DmlEntity),
  options?: Record<string, unknown>,
): DmlRelationDefinition {
  if (typeof target === 'string') {
    return {
      __dmlRelation: true,
      type: 'hasOne',
      target: () => ({ name: target }) as unknown as DmlEntity,
      options,
      _entityName: target,
    }
  }
  return { __dmlRelation: true, type: 'hasOne', target, options }
}

/**
 * Define a hasOne relation with FK on this entity (this entity stores the foreign key).
 *
 * @example
 * ```typescript
 * export default defineModel('CustomerAddress', {
 *   customer: hasOneWithFK('Customer'),  // → creates customer_id FK column
 * })
 * ```
 */
export function hasOneWithFK(
  target: EntityNameArg | (() => DmlEntity),
  options?: Record<string, unknown>,
): DmlRelationDefinition {
  if (typeof target === 'string') {
    return {
      __dmlRelation: true,
      type: 'hasOneWithFK',
      target: () => ({ name: target }) as unknown as DmlEntity,
      options,
      _entityName: target,
    }
  }
  return { __dmlRelation: true, type: 'hasOneWithFK', target, options }
}
