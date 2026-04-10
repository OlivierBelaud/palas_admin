// NullableModifier — wraps a property and changes its inferred type to T | null.

import type { BaseProperty, PropertyMetadata } from './base'

/**
 * Marks a property as nullable.
 * Changes the TypeScript inferred type from T to T | null.
 */
export class NullableModifier<T, Schema extends BaseProperty<T>> {
  /** Type-only: infers T | null */
  $dataType!: T | null

  #schema: Schema

  constructor(schema: Schema) {
    this.#schema = schema
    schema._setNullable()
  }

  static isNullableModifier(obj: unknown): obj is NullableModifier<unknown, BaseProperty<unknown>> {
    return obj instanceof NullableModifier
  }

  /** Forward searchable() to the underlying property. */
  searchable(): this {
    this.#schema._setSearchable()
    const schemaWithDataType = this.#schema as unknown as {
      dataType?: { options?: Record<string, unknown> }
    }
    if (typeof schemaWithDataType.dataType?.options === 'object' && schemaWithDataType.dataType.options !== null) {
      schemaWithDataType.dataType.options.searchable = true
    }
    return this
  }

  /** Forward index() to the underlying property. */
  index(name?: string): this {
    this.#schema.index(name)
    return this
  }

  /** Forward unique() to the underlying property. */
  unique(name?: string): this {
    this.#schema.unique(name)
    return this
  }

  /** Forward default() to the underlying property. */
  default(value: T): this {
    this.#schema.default(value)
    return this
  }

  /** Serialize to metadata. */
  parse(fieldName: string): PropertyMetadata {
    return this.#schema.parse(fieldName)
  }
}
