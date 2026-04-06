// SPEC-057 — DML public API

export type { DmlEntityOptions, DmlPropertyDefinition, DmlRelationDefinition } from './entity'
export { DmlEntity } from './entity'
export type { InferEntity } from './infer'
export { field, model } from './model'
export { computed, defaultValue, indexed, nullable, searchable, translatable, unique } from './modifiers'
// Typed property classes (ISO Medusa V2)
// Legacy compat — DmlProperty is now BaseProperty
export {
  ArrayProperty,
  AutoIncrementProperty,
  BaseProperty,
  BaseProperty as DmlProperty,
  BigNumberProperty,
  BooleanProperty,
  ComputedProperty,
  DateTimeProperty,
  EnumProperty,
  FloatProperty,
  JSONProperty,
  NullableModifier,
  NumberProperty,
  PrimaryKeyModifier,
  type PropertyMetadata,
  TextProperty,
} from './properties'

// Relations
export { belongsTo } from './relations/belongs-to'
export { hasMany } from './relations/has-many'
export { hasOne, hasOneWithFK } from './relations/has-one'
export { manyToMany } from './relations/many-to-many'
