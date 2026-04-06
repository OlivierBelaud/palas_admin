import { BaseProperty } from './base'
import { PrimaryKeyModifier } from './primary-key'

export class TextProperty extends BaseProperty<string> {
  protected dataType = { name: 'text' as const, options: { searchable: false, translatable: false } }

  primaryKey(): PrimaryKeyModifier<string, TextProperty> {
    return new PrimaryKeyModifier(this)
  }

  searchable(): this {
    this._setSearchable()
    this.dataType.options.searchable = true
    return this
  }

  translatable(): this {
    this._setTranslatable()
    this.dataType.options.translatable = true
    return this
  }
}
