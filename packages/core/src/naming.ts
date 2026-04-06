// Entity naming conventions — single source of truth.
//
// The ONLY input is the PascalCase entity name from defineModel('CustomerGroup', {...}).
// Everything else is derived:
//
//   PascalCase:     CustomerGroup     — defineModel() name (source of truth)
//   camelCase:      customerGroup     — module keys, query resolvers, commands, step.command.*
//   snake_case:     customer_group    — DB only (table columns, FK names)
//   camelCase+s:    customerGroups    — Drizzle table key (db.query.customerGroups)
//   kebab-case:     customer-group    — URL routes only (auto-converted)

import { MantaError } from './errors/manta-error'

/**
 * PascalCase → camelCase: 'CustomerGroup' → 'customerGroup'
 * Also handles snake_case input: 'customer_group' → 'customerGroup'
 */
export function toCamel(name: string): string {
  // If it's snake_case or kebab-case, convert to camelCase
  if (name.includes('_') || name.includes('-')) {
    return name.toLowerCase().replace(/[_-]([a-z])/g, (_, c: string) => c.toUpperCase())
  }
  // PascalCase → camelCase: just lowercase the first char
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/**
 * Any format → PascalCase: 'customerGroup' → 'CustomerGroup', 'customer_group' → 'CustomerGroup'
 */
export function toPascal(name: string): string {
  const camel = toCamel(name)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * PascalCase → snake_case: 'CustomerGroup' → 'customer_group'
 * Used only for DB table columns and FK names.
 */
export function toSnake(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

/**
 * PascalCase → kebab-case: 'CustomerGroup' → 'customer-group'
 * Used only for URL routes.
 */
export function toKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/**
 * Pluralize a name: 'customerGroup' → 'customerGroups'
 */
export function pluralize(name: string): string {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) {
    return `${name}es`
  }
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`
  }
  return `${name}s`
}

/**
 * PascalCase → camelCase plural: 'CustomerGroup' → 'customerGroups'
 * This is the Drizzle db.query key format.
 */
export function toTableKey(name: string): string {
  return pluralize(toCamel(name))
}

/**
 * Validate that an entity name is PascalCase.
 * Throws a helpful error if it's not.
 */
export function validatePascalCase(name: string, context: string): void {
  if (!name || name[0] !== name[0].toUpperCase() || name[0] === name[0].toLowerCase()) {
    throw new MantaError(
      'INVALID_DATA',
      `${context}: entity name "${name}" must be PascalCase (e.g. "${toPascal(name)}"). ` +
        `Got "${name}" which looks like ${name.includes('_') ? 'snake_case' : name.includes('-') ? 'kebab-case' : 'lowercase'}.`,
    )
  }
}

/**
 * Validate that a name used in defineLink/query is camelCase.
 * Throws if snake_case or other formats are used.
 */
export function validateCamelCase(name: string, context: string): void {
  if (name.includes('_')) {
    throw new MantaError(
      'INVALID_DATA',
      `${context}: "${name}" must be camelCase, not snake_case. Use "${toCamel(name)}" instead.`,
    )
  }
  if (name.includes('-')) {
    throw new MantaError(
      'INVALID_DATA',
      `${context}: "${name}" must be camelCase, not kebab-case. Use "${toCamel(name)}" instead.`,
    )
  }
  if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
    throw new MantaError(
      'INVALID_DATA',
      `${context}: "${name}" must be camelCase, not PascalCase. Use "${toCamel(name)}" instead.`,
    )
  }
}
