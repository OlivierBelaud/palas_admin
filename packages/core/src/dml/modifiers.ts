// SPEC-057b — DML property modifiers

import type { DmlPropertyDefinition } from './entity'

/**
 * Make a property nullable.
 * @param prop - The property definition
 * @returns Modified property with nullable=true
 */
export function nullable(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, nullable: true }
}

/**
 * Set a default value for a property.
 * @param prop - The property definition
 * @param value - The default value
 * @returns Modified property with default set
 */
export function defaultValue(prop: DmlPropertyDefinition, value: unknown): DmlPropertyDefinition {
  return { ...prop, default: value }
}

/**
 * Mark a property as indexed.
 * @param prop - The property definition
 * @param name - Optional index name
 * @returns Modified property with index=true
 */
export function indexed(prop: DmlPropertyDefinition, name?: string): DmlPropertyDefinition {
  return { ...prop, index: name ?? true }
}

/**
 * Mark a property as unique.
 * @param prop - The property definition
 * @param name - Optional constraint name
 * @returns Modified property with unique=true
 */
export function unique(prop: DmlPropertyDefinition, name?: string): DmlPropertyDefinition {
  return { ...prop, unique: name ?? true }
}

/**
 * Mark a property as computed (no column generated).
 * @param prop - The property definition
 * @returns Modified property with computed=true
 */
export function computed(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, computed: true }
}

/**
 * Mark a property as searchable.
 * @param prop - The property definition
 * @returns Modified property with searchable=true
 */
export function searchable(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, searchable: true }
}

/**
 * Mark a property as translatable.
 * @param prop - The property definition
 * @returns Modified property with translatable=true
 */
export function translatable(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, translatable: true }
}
