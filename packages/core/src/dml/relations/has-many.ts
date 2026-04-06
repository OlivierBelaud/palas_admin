// SPEC-057c — hasMany relation

import type { DmlEntity, DmlRelationDefinition } from '../entity'

type EntityNameArg = keyof MantaGeneratedEntities | (string & {})

/**
 * Define a hasMany relation (1:N — the other entity has a FK to this one).
 *
 * @example
 * ```typescript
 * export default defineModel('Customer', {
 *   first_name: field.text(),
 *   addresses: hasMany('CustomerAddress'),
 * })
 * ```
 */
export function hasMany(
  target: EntityNameArg | (() => DmlEntity),
  options?: Record<string, unknown>,
): DmlRelationDefinition {
  if (typeof target === 'string') {
    return {
      __dmlRelation: true,
      type: 'hasMany',
      target: () => ({ name: target }) as unknown as DmlEntity,
      options,
      _entityName: target,
    }
  }
  return { __dmlRelation: true, type: 'hasMany', target, options }
}
