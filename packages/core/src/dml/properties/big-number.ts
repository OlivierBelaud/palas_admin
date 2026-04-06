import { BaseProperty } from './base'

export class BigNumberProperty extends BaseProperty<number> {
  protected dataType = { name: 'bigNumber' as const }
}
