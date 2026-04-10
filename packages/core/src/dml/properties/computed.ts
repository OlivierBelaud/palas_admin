// ComputedProperty — marks a property as computed (no DB column), type becomes T | null.

import { MantaError } from '../../errors/manta-error'
import type { BaseProperty, PropertyMetadata } from './base'

export class ComputedProperty<T, Schema extends BaseProperty<T>> {
  $dataType!: T | null

  #schema: Schema

  constructor(schema: Schema) {
    this.#schema = schema
    if (schema && typeof schema._setComputed === 'function') {
      schema._setComputed()
    }
  }

  static isComputedProperty(obj: unknown): obj is ComputedProperty<unknown, BaseProperty<unknown>> {
    return obj instanceof ComputedProperty
  }

  parse(fieldName: string): PropertyMetadata {
    if (this.#schema && typeof this.#schema.parse === 'function') {
      return this.#schema.parse(fieldName)
    }
    throw new MantaError('INVALID_STATE', 'ComputedProperty: schema has no parse method')
  }
}
