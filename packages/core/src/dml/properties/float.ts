import { BaseProperty } from './base'

export class FloatProperty extends BaseProperty<number> {
  protected dataType = { name: 'float' as const }
}
