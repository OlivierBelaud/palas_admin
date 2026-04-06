import { BaseProperty } from './base'

export class BooleanProperty extends BaseProperty<boolean> {
  protected dataType = { name: 'boolean' as const }
}
