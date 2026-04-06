// PrimaryKeyModifier — marks a property as primary key, preserves type inference.

import type { BaseProperty, PropertyMetadata } from './base'

/**
 * Marks a property as the primary key.
 * Preserves the TypeScript inferred type T.
 */
export class PrimaryKeyModifier<T, Schema extends BaseProperty<T>> {
  $dataType!: T

  #schema: Schema

  constructor(schema: Schema) {
    this.#schema = schema
    schema._setPrimaryKey()
  }

  static isPrimaryKeyModifier(obj: unknown): obj is PrimaryKeyModifier<unknown, BaseProperty<unknown>> {
    return obj instanceof PrimaryKeyModifier
  }

  get schema(): Schema {
    return this.#schema
  }

  parse(fieldName: string): PropertyMetadata {
    return this.#schema.parse(fieldName)
  }
}
