import { BaseProperty } from './base'
import { PrimaryKeyModifier } from './primary-key'

export class NumberProperty extends BaseProperty<number> {
  protected dataType = { name: 'number' as const }

  primaryKey(): PrimaryKeyModifier<number, NumberProperty> {
    return new PrimaryKeyModifier(this)
  }

  searchable(): this {
    this._setSearchable()
    return this
  }
}
