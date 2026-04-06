import { BaseProperty } from './base'

export class ArrayProperty extends BaseProperty<unknown[]> {
  protected dataType = { name: 'array' as const }
}
