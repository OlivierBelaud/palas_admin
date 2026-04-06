import { BaseProperty } from './base'

export class AutoIncrementProperty extends BaseProperty<number> {
  protected dataType = { name: 'serial' as const }
}
