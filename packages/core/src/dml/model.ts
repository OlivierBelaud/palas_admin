// SPEC-057 — DML model.define() and typed property factories
// model.define() creates entities. field.* creates properties.

import { MantaError } from '../errors/manta-error'
import { DmlEntity } from './entity'
import { ArrayProperty } from './properties/array'
import { AutoIncrementProperty } from './properties/autoincrement'
import type {
  ArrayApi,
  AutoIncrementApi,
  BigNumberApi,
  BooleanApi,
  DateTimeApi,
  EnumApi,
  FloatApi,
  JSONApi,
  NumberApi,
  TextApi,
} from './properties/base'
import { BigNumberProperty } from './properties/big-number'
import { BooleanProperty } from './properties/boolean'
import { DateTimeProperty } from './properties/date-time'
import { EnumProperty } from './properties/enum'
import { FloatProperty } from './properties/float'
import { JSONProperty } from './properties/json'
import { NumberProperty } from './properties/number'
import { TextProperty } from './properties/text'

/** Enforce PascalCase at the type level — rejects 'product', accepts 'Product'. */
type PascalCase<S extends string> = S extends `${infer First}${infer Rest}`
  ? First extends Uppercase<First>
    ? S
    : never
  : never

export const model = {
  /**
   * Define a new DML entity.
   * Name MUST be PascalCase (e.g. 'Product', not 'product').
   * @param name - Entity name (PascalCase)
   * @param schema - Property and relation definitions
   */
  define<const Name extends string, Schema extends Record<string, unknown>>(
    name: PascalCase<Name> extends never ? 'Entity name must be PascalCase (e.g. "Product", not "product")' : Name,
    schema: Schema,
  ): DmlEntity<Schema> {
    if (!name || name[0] !== name[0].toUpperCase() || name[0] === name[0].toLowerCase()) {
      throw new MantaError(
        'INVALID_DATA',
        `Entity name "${name}" must start with an uppercase letter (PascalCase). ` +
          `Use "${name.charAt(0).toUpperCase()}${name.slice(1)}" instead.`,
      )
    }
    return new DmlEntity(name, schema)
  },
}

/**
 * Define a new DML entity.
 * Top-level alias for `model.define()`.
 * Name MUST be PascalCase (e.g. 'Product', not 'product').
 *
 * @example
 * export const Product = defineModel('Product', {
 *   title: field.text(),
 *   price: field.number(),
 *   status: field.enum(['draft', 'active', 'archived']),
 * })
 */
export function defineModel<const Name extends string, Schema extends Record<string, unknown>>(
  name: PascalCase<Name> extends never ? 'Entity name must be PascalCase (e.g. "Product", not "product")' : Name,
  schema: Schema,
): DmlEntity<Schema> {
  return model.define(name as string as PascalCase<Name>, schema)
}

/**
 * `field` namespace — all property factories.
 * Use inside defineModel() schemas, defineCommand() Zod schemas, defineLink() extra columns, etc.
 *
 * @example
 * import { field } from '@manta/core'
 * const schema = { name: field.text(), price: field.number() }
 */
export const field = {
  /** Text property — infers `string` */
  text(): TextApi {
    return new TextProperty()
  },

  /** Number/integer property — infers `number` */
  number(): NumberApi {
    return new NumberProperty()
  },

  /** Boolean property — infers `boolean` */
  boolean(): BooleanApi {
    return new BooleanProperty()
  },

  /** BigNumber property (NUMERIC + shadow raw_ JSONB) — infers `number` */
  bigNumber(): BigNumberApi {
    return new BigNumberProperty()
  },

  /** Float property (REAL) — infers `number` */
  float(): FloatApi {
    return new FloatProperty()
  },

  /** Serial auto-increment — infers `number` */
  serial(): AutoIncrementApi {
    return new AutoIncrementProperty()
  },

  /** DateTime property (TIMESTAMPTZ) — infers `Date` */
  dateTime(): DateTimeApi {
    return new DateTimeProperty()
  },

  /** JSON/JSONB property — pass a generic for typed JSON: field.json<string[]>() */
  json<T = any>(): JSONApi<T> {
    return new JSONProperty<T>()
  },

  /** Enum property with allowed values — infers union of values */
  enum<const Values extends readonly string[]>(values: Values): EnumApi<Values> {
    return new EnumProperty(values) as unknown as EnumApi<Values>
  },

  /** Array property — infers `unknown[]` */
  array(): ArrayApi {
    return new ArrayProperty()
  },
}
