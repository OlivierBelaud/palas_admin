import { BaseProperty } from './base'

export class EnumProperty<const Values extends readonly string[]> extends BaseProperty<Values[number]> {
  protected dataType: { name: 'enum'; options: { values: Values } }

  constructor(values: Values) {
    super()
    this.dataType = { name: 'enum', options: { values } }
  }

  parse(fieldName: string) {
    const meta = super.parse(fieldName)
    meta.values = this.dataType.options.values
    return meta
  }
}
