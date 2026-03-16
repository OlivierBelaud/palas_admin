// SPEC-057 — DML model.define() and property factories

import { DmlEntity } from './entity'
import { DmlProperty } from './property'
import type { DmlPropertyDefinition, DmlRelationDefinition, DmlEntityOptions } from './entity'

/**
 * Property factory functions for defining DML entity schemas.
 *
 * All factories return DmlProperty instances with fluent/chainable modifiers:
 *   model.text().setNullable().setDefault('untitled').setUnique()
 */
export const model = {
  /**
   * Define a new DML entity.
   *
   * @param name - Entity name (PascalCase)
   * @param schema - Property and relation definitions
   * @returns A DmlEntity instance
   */
  define(name: string, schema: Record<string, DmlPropertyDefinition | DmlRelationDefinition>): DmlEntity {
    return new DmlEntity(name, schema)
  },

  /** Text property (VARCHAR/TEXT) */
  text(): DmlProperty {
    return new DmlProperty('text')
  },

  /** Number/integer property */
  number(): DmlProperty {
    return new DmlProperty('number')
  },

  /** Boolean property */
  boolean(): DmlProperty {
    return new DmlProperty('boolean')
  },

  /** BigNumber property (NUMERIC + shadow raw_ JSONB column) */
  bigNumber(): DmlProperty {
    return new DmlProperty('bigNumber')
  },

  /** Float property (REAL) */
  float(): DmlProperty {
    return new DmlProperty('float')
  },

  /** Serial auto-increment property */
  serial(): DmlProperty {
    return new DmlProperty('serial')
  },

  /** DateTime property (TIMESTAMPTZ) */
  dateTime(): DmlProperty {
    return new DmlProperty('dateTime')
  },

  /** JSON/JSONB property */
  json(): DmlProperty {
    return new DmlProperty('json')
  },

  /** Enum property with allowed values */
  enum(values: string[] | Record<string, unknown>): DmlProperty {
    return new DmlProperty('enum', { values })
  },

  /** Array property (PostgreSQL native array) */
  array(): DmlProperty {
    return new DmlProperty('array')
  },

  /** ID property (TEXT, primary key) */
  id(options?: { prefix?: string }): DmlProperty {
    return new DmlProperty('id', { primaryKey: true, default: options?.prefix })
  },
}

export type { DmlEntityOptions }
