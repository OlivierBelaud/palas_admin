// SPEC-057b — DML property modifiers (functional style)
// These are standalone functions that create modified copies of property definitions.
// For fluent API, use DmlProperty methods instead: field.text().nullable().unique()

import type { DmlPropertyDefinition } from './entity'

export function nullable(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, is_nullable: true }
}

export function defaultValue(prop: DmlPropertyDefinition, value: unknown): DmlPropertyDefinition {
  return { ...prop, default_value: value }
}

export function indexed(prop: DmlPropertyDefinition, name?: string): DmlPropertyDefinition {
  return { ...prop, is_indexed: name ?? true }
}

export function unique(prop: DmlPropertyDefinition, name?: string): DmlPropertyDefinition {
  return { ...prop, is_unique: name ?? true }
}

export function computed(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, is_computed: true }
}

export function searchable(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, is_searchable: true }
}

export function translatable(prop: DmlPropertyDefinition): DmlPropertyDefinition {
  return { ...prop, is_translatable: true }
}
