// Base property class — all DML property types extend this.
// Type parameter T tracks the inferred TypeScript type of the property.

import { ComputedProperty } from './computed'
import { NullableModifier } from './nullable'

/**
 * Nullable API — what is returned by .nullable().
 * Mirrors the runtime NullableModifier which forwards chain modifiers.
 */
export interface NullableApi<T> {
  /** @internal Type brand for InferEntity — do not use directly. */
  readonly $dataType: T | null
  /** Mark as searchable (forwarded to underlying property). */
  searchable(): NullableApi<T>
  /** Add a database index (forwarded to underlying property). */
  index(name?: string): NullableApi<T>
  /** Add a unique constraint (forwarded to underlying property). */
  unique(name?: string): NullableApi<T>
  /** Set a default value (forwarded to underlying property). */
  default(value: T): NullableApi<T>
  /** Serialize property metadata. */
  parse(fieldName: string): PropertyMetadata
}

export interface PropertyMetadata {
  fieldName: string
  dataType: { name: string; options?: Record<string, unknown> }
  nullable: boolean
  computed: boolean
  defaultValue?: unknown
  indexes: Array<{ name?: string; type?: string }>
  unique: boolean | string | undefined
  primaryKey: boolean
  searchable: boolean
  translatable: boolean
  values?: unknown
}

// ── Public API interface — what the developer sees in autocompletion ──

/**
 * Base DML property API — only public modifier methods visible.
 * Internal methods ($dataType, _set*, parse) are hidden from autocompletion.
 */
export interface DmlProperty<T> {
  /** @internal Type brand for InferEntity — do not use directly. */
  readonly $dataType: T
  /** Mark property as nullable. */
  nullable(): NullableApi<T>
  /** Mark as computed (derived, not stored). */
  // biome-ignore lint/suspicious/noExplicitAny: returns ComputedProperty
  computed(): any
  /** Add a database index. */
  index(name?: string): this
  /** Add a unique constraint. */
  unique(name?: string): this
  /** Set a default value. */
  default(value: T): this
  /** Serialize property metadata. */
  parse(fieldName: string): PropertyMetadata
}

/** Text property API — adds searchable, translatable, primaryKey. */
export interface TextApi extends DmlProperty<string> {
  searchable(): TextApi
  translatable(): TextApi
  /** Mark as primary key (terminal — no further chaining). */
  primaryKey(): { $dataType: string; parse: (fieldName: string) => PropertyMetadata }
  /** Serialize property metadata. */
  parse(fieldName: string): PropertyMetadata
}

/** Number property API — adds searchable, primaryKey. */
export interface NumberApi extends DmlProperty<number> {
  searchable(): NumberApi
  /** Mark as primary key (terminal — no further chaining). */
  primaryKey(): { $dataType: number }
}

/** Boolean property API — base only. */
export type BooleanApi = DmlProperty<boolean>

/** BigNumber property API — base only. */
export type BigNumberApi = DmlProperty<number>

/** Float property API — base only. */
export type FloatApi = DmlProperty<number>

/** AutoIncrement property API. */
export type AutoIncrementApi = DmlProperty<number>

/** DateTime property API — base only. */
export type DateTimeApi = DmlProperty<Date>

/** JSON property API — base only. */
// biome-ignore lint/suspicious/noExplicitAny: JSON can be any serializable value
export type JSONApi<T = any> = DmlProperty<T>

/** Enum property API. */
export type EnumApi<Values extends readonly string[]> = DmlProperty<Values[number]>

/** Array property API. */
export type ArrayApi = DmlProperty<unknown[]>

// ── Implementation class ─────────────────────────────────────────────

/**
 * Base DML property class.
 * Type parameter T is the inferred JS type of the property value.
 */
export abstract class BaseProperty<T> {
  /** Type-only for TypeScript inference. */
  $dataType!: T

  protected abstract dataType: { name: string; options?: Record<string, unknown> }

  #nullable = false
  #defaultValue?: unknown
  #indexes: Array<{ name?: string; type?: string }> = []
  #unique?: boolean | string
  #primaryKey = false
  #computed = false
  #searchable = false
  #translatable = false

  /** Mark property as nullable. Returns an object with $dataType: T | null for type inference. */
  nullable(): NullableApi<T> {
    return new NullableModifier(this) as unknown as NullableApi<T>
  }

  /** Mark as computed. Returns ComputedProperty<T | null, this> for type inference. */
  // biome-ignore lint/suspicious/noExplicitAny: returns ComputedProperty
  computed(): any {
    return new ComputedProperty(this)
  }

  /** Add an index. */
  index(name?: string): this {
    this.#indexes.push({ name })
    return this
  }

  /** Add a unique constraint. */
  unique(name?: string): this {
    this.#unique = name ?? true
    return this
  }

  /** Set a default value. */
  default(value: T): this {
    this.#defaultValue = value
    return this
  }

  /** Serialize property metadata. */
  parse(fieldName: string): PropertyMetadata {
    return {
      fieldName,
      dataType: this.dataType,
      nullable: this.#nullable,
      computed: this.#computed,
      defaultValue: this.#defaultValue,
      indexes: this.#indexes,
      unique: this.#unique,
      primaryKey: this.#primaryKey,
      searchable: this.#searchable,
      translatable: this.#translatable,
    }
  }

  /** @internal */ _setNullable(): void {
    this.#nullable = true
  }
  /** @internal */ _setComputed(): void {
    this.#computed = true
  }
  /** @internal */ _setPrimaryKey(): void {
    this.#primaryKey = true
  }
  /** @internal */ _setSearchable(): void {
    this.#searchable = true
  }
  /** @internal */ _setTranslatable(): void {
    this.#translatable = true
  }
}
