import { BaseProperty } from './base'

// biome-ignore lint/suspicious/noExplicitAny: JSON can be any serializable value
export class JSONProperty<T = any> extends BaseProperty<T> {
  protected dataType = { name: 'json' as const }
}
